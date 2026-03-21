import Fastify from "fastify";
import path from "node:path";
import { config, isUserAllowed } from "./config.js";
import { JsonlAudit } from "./audit.js";
import { AgentHub, registerAgentWs } from "./ws.js";
import { normalizeFeishuWebhook } from "./feishu/webhook.js";
import { replyText } from "./feishu/send.js";
import type { AgentToRelay, Output, Status } from "@bw/protocol";

const audit = new JsonlAudit(config.auditJsonlPath);
const hub = new AgentHub();
const outputSeenByMsgId = new Map<string, boolean>();
const outputBufferByMsgId = new Map<string, string>();
const processedMessageIds = new Set<string>();

type SessionState = {
  tool: "cc" | "cx";
  mode: "safe" | "yolo";
  cwd: string;
  key: string;
  agentId: string;
};

const sessions = new Map<string, SessionState>();

function defaultCwd(): string {
  return config.workRoots[0] ?? "D:/";
}

function getSession(sessionKey: string, agentId?: string): SessionState {
  const existing = sessions.get(sessionKey);
  if (existing) return existing;
  const init: SessionState = {
    tool: "cc",
    mode: "safe",
    cwd: defaultCwd(),
    key: sessionKey,
    agentId: agentId ?? ""
  };
  sessions.set(sessionKey, init);
  return init;
}

function isCwdAllowed(cwd: string): boolean {
  const resolved = path.resolve(cwd);
  for (const root of config.workRoots) {
    const r = path.resolve(root);
    if (resolved === r) return true;
    if (resolved.startsWith(r + path.sep)) return true;
  }
  return false;
}

function splitForFeishu(text: string, maxLen = 1500): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    out.push(text.slice(i, i + maxLen));
    i += maxLen;
  }
  return out.length ? out : [""];
}

async function safeReply(messageId: string, text: string): Promise<void> {
  for (const chunk of splitForFeishu(text)) {
    await replyText(messageId, chunk);
  }
}

async function relaySendOrReplyError(params: {
  messageId: string;
  sessionKey: string;
  payload: any;
  auditData: Record<string, unknown>;
}): Promise<boolean> {
  try {
    hub.send(params.payload);
    await audit.log({
      type: "relay.to_agent",
      sessionKey: params.sessionKey,
      msgId: params.messageId,
      data: params.auditData
    });
    return true;
  } catch (err) {
    await audit.log({
      type: "error",
      sessionKey: params.sessionKey,
      msgId: params.messageId,
      data: { error: String(err) }
    });
    await safeReply(params.messageId, `转发到 agent 失败：${String(err)}`);
    return false;
  }
}

async function onAgentMessage(msg: AgentToRelay): Promise<void> {
  if (msg.type === "output") {
    const out = msg as Output;
    await audit.log({
      type: "agent.output",
      sessionKey: out.sessionKey,
      msgId: out.msgId,
      data: { streamId: out.streamId, isFinal: out.isFinal, len: out.chunk.length }
    });

    const hasText = Boolean(out.chunk && out.chunk.trim().length > 0);

    if (hasText) {
      outputSeenByMsgId.set(out.msgId, true);
      const existing = outputBufferByMsgId.get(out.msgId) ?? "";
      outputBufferByMsgId.set(out.msgId, existing + out.chunk);
    }

    if (out.isFinal) {
      const buffer = outputBufferByMsgId.get(out.msgId) ?? "";
      const seen = outputSeenByMsgId.get(out.msgId) ?? false;

      if (buffer.trim().length > 0) {
        await safeReply(out.msgId, buffer);
      } else if (!seen) {
        await safeReply(out.msgId, "（无输出：工具可能仍在等待输入/确认，或启动失败）");
      }

      outputSeenByMsgId.delete(out.msgId);
      outputBufferByMsgId.delete(out.msgId);
    }
    return;
  }

  if (msg.type === "status") {
    const st = msg as Status;
    await audit.log({
      type: "agent.output",
      sessionKey: st.sessionKey,
      data: { status: st }
    });
    return;
  }
}

const fastify = Fastify({ logger: true });

fastify.get("/health", async () => ({ ok: true }));

fastify.addContentTypeParser(
  "application/json",
  { parseAs: "buffer" },
  (_req, body, done) => {
    done(null, body);
  }
);

await registerAgentWs({ fastify, hub, onAgentMessage });

fastify.post("/feishu/webhook", async (req, reply) => {
  const raw = (req.body as Buffer | undefined)?.toString("utf8") ?? "";
  const headers = {
    "x-lark-request-timestamp": String(req.headers["x-lark-request-timestamp"] ?? ""),
    "x-lark-request-nonce": String(req.headers["x-lark-request-nonce"] ?? ""),
    "x-lark-signature": String(req.headers["x-lark-signature"] ?? "")
  };

  try {
    const normalized = normalizeFeishuWebhook({
      rawBody: raw,
      headers,
      ...(config.feishu.encryptKey ? { encryptKey: config.feishu.encryptKey } : {})
    });

    if (normalized.kind === "challenge") {
      return reply.send({ challenge: normalized.challenge });
    }

    if (normalized.kind === "ignore") {
      return reply.send({ ok: true });
    }

    if (!isUserAllowed(normalized.userId)) {
      await audit.log({
        type: "feishu.input",
        sessionKey: normalized.sessionKey,
        msgId: normalized.messageId,
        data: { deniedUserId: normalized.userId }
      });
      return reply.send({ ok: true });
    }

    const session = getSession(normalized.sessionKey);

    // 去重：检查是否已处理过此消息
    if (processedMessageIds.has(normalized.messageId)) {
      console.log(`[dedup] 跳过重复消息: ${normalized.messageId}`);
      return reply.send({ ok: true });
    }
    processedMessageIds.add(normalized.messageId);

    // 定期清理旧的消息ID（保留最近1000条）
    if (processedMessageIds.size > 1000) {
      const toDelete = Array.from(processedMessageIds).slice(0, 500);
      toDelete.forEach(id => processedMessageIds.delete(id));
    }

    // 确保 session 有 agentId
    if (!session.agentId) {
      const agent = hub.any();
      if (agent) {
        session.agentId = agent.agentId;
      }
    }

    if (normalized.kind === "command") {
      await audit.log({
        type: "feishu.command",
        sessionKey: normalized.sessionKey,
        msgId: normalized.messageId,
        data: { command: normalized.command, args: normalized.args }
      });

      if (normalized.command === "/help") {
        const lines = [
          "可用命令：",
          "",
          "【基础命令】",
          "/cc — 切换到 Claude Code",
          "/cx — 切换到 Codex",
          "/status — 查看当前会话状态",
          "/help — 显示此帮助信息",
          "",
          "【控制命令】",
          "/stop — 发送 Ctrl+C 中断当前执行",
          "/enter — 发送回车键（用于确认提示）",
          "/reset — 重置当前会话",
          "",
          "【模式切换】",
          "/mode safe — 切换到安全模式（需要确认每个操作）",
          "/mode yolo — 切换到 YOLO 模式（自动执行）",
          "",
          "【PTY 模式专用】",
          "/cwd <path> — 切换工作目录",
          "",
          "【Tmux 模式专用】",
          "/start [cc|cx] — 启动 tmux session 并运行 CLI",
          "/tab — 发送 Tab 键（用于修改命令）",
          "/esc — 发送 Esc 键（用于取消操作）",
          "/ctrl+o — 发送 Ctrl+O（用于展开内容）",
          "/up — 发送向上箭头（用于选择选项）",
          "/down — 发送向下箭头（用于选择选项）",
          "",
          "【Tmux 常用操作】",
          "创建会话: tmux new -s bw-cc",
          "列出会话: tmux ls",
          "附加会话: tmux attach -t bw-cc",
          "分离会话: Ctrl+b d",
          "查看历史: Ctrl+b [（按 q 退出）",
          "",
          "其他 / 开头的命令（如 /init, /compact 等）将直接转发给 CLI 工具。",
          "",
          "直接发送文本即可向当前工具发送指令。"
        ];
        await safeReply(normalized.messageId, lines.join("\n"));
        return reply.send({ ok: true });
      }

      if (normalized.command === "/cc") {
        session.tool = "cc";
        await safeReply(normalized.messageId, "已切换到 cc");
        return reply.send({ ok: true });
      }

      if (normalized.command === "/cx") {
        session.tool = "cx";
        await safeReply(normalized.messageId, "已切换到 cx");
        return reply.send({ ok: true });
      }

      if (normalized.command === "/mode") {
        const mode = normalized.args.trim().toLowerCase();
        if (mode === "safe" || mode === "yolo") {
          if (config.transport === "tmux") {
            // tmux 模式下，通过发送 /permission 命令切换
            const agent = hub.getAgent(session.agentId);
            if (!agent) {
              await safeReply(normalized.messageId, "Agent 未连接");
              return reply.send({ ok: true });
            }
            agent.socket.send(JSON.stringify({
              type: "control",
              sessionKey: session.key,
              action: "permission",
              mode,
              msgId: normalized.messageId
            }));
            await safeReply(normalized.messageId, `正在切换到 ${mode} 模式...`);
          } else {
            // pty 模式下，直接修改 session
            session.mode = mode;
            await safeReply(normalized.messageId, `mode=${mode}`);
          }
        } else {
          await safeReply(normalized.messageId, "用法：/mode safe|yolo");
        }
        return reply.send({ ok: true });
      }

      if (normalized.command === "/cwd") {
        if (config.transport === "tmux") {
          await safeReply(normalized.messageId, "shared-session 模式下不支持 /cwd，请在 tmux 会话中直接操作");
          return reply.send({ ok: true });
        }
        const next = normalized.args.trim();
        if (!next) {
          await safeReply(normalized.messageId, `cwd=${session.cwd}`);
          return reply.send({ ok: true });
        }
        if (!isCwdAllowed(next)) {
          await safeReply(normalized.messageId, "cwd 不在允许的 WORK_ROOTS 内");
          return reply.send({ ok: true });
        }
        session.cwd = next;
        await safeReply(normalized.messageId, `cwd=${next}`);
        return reply.send({ ok: true });
      }

      // 特殊键命令
      if (normalized.command === "/tab" || normalized.command === "/esc" ||
          normalized.command === "/ctrl+o" || normalized.command === "/up" ||
          normalized.command === "/down") {
        if (config.transport !== "tmux") {
          await safeReply(normalized.messageId, "特殊键命令仅在 tmux 模式下支持");
          return reply.send({ ok: true });
        }

        const keyMap: Record<string, string> = {
          "/tab": "Tab",
          "/esc": "Escape",
          "/ctrl+o": "C-o",
          "/up": "Up",
          "/down": "Down"
        };

        const key = keyMap[normalized.command];
        if (key) {
          const agent = hub.getAgent(session.agentId);
          if (!agent) {
            await safeReply(normalized.messageId, "Agent 未连接");
            return reply.send({ ok: true });
          }
          agent.socket.send(JSON.stringify({
            type: "control",
            sessionKey: session.key,
            action: "send_key",
            key,
            msgId: normalized.messageId
          }));
          await safeReply(normalized.messageId, `已发送 ${normalized.command}`);
        }
        return reply.send({ ok: true });
      }

      if (normalized.command === "/status") {
        const ok = await relaySendOrReplyError({
          messageId: normalized.messageId,
          sessionKey: normalized.sessionKey,
          payload: { type: "control", sessionKey: normalized.sessionKey, action: "status" },
          auditData: { type: "control", action: "status" }
        });
        if (!ok) return reply.send({ ok: true });

        if (config.transport === "tmux") {
          await safeReply(
            normalized.messageId,
            `tool=${session.tool} transport=tmux (shared-session)`
          );
        } else {
          await safeReply(
            normalized.messageId,
            `tool=${session.tool} mode=${session.mode} cwd=${session.cwd}`
          );
        }
        return reply.send({ ok: true });
      }

      if (normalized.command === "/start") {
        if (config.transport !== "tmux") {
          await safeReply(normalized.messageId, "/start 仅在 tmux 模式下可用");
          return reply.send({ ok: true });
        }
        const arg = normalized.args.trim().toLowerCase();
        const tool = arg === "cc" || arg === "cx" ? arg : session.tool;
        const ok = await relaySendOrReplyError({
          messageId: normalized.messageId,
          sessionKey: normalized.sessionKey,
          payload: { type: "control", sessionKey: normalized.sessionKey, action: "start", tool, msgId: normalized.messageId },
          auditData: { type: "control", action: "start", tool }
        });
        if (!ok) return reply.send({ ok: true });
        return reply.send({ ok: true });
      }

      if (normalized.command === "/stop") {
        const ok = await relaySendOrReplyError({
          messageId: normalized.messageId,
          sessionKey: normalized.sessionKey,
          payload: { type: "control", sessionKey: normalized.sessionKey, action: "stop" },
          auditData: { type: "control", action: "stop" }
        });
        if (!ok) return reply.send({ ok: true });

        await safeReply(normalized.messageId, "已发送 stop (Ctrl+C)");
        return reply.send({ ok: true });
      }

      if (normalized.command === "/enter") {
        const ok = await relaySendOrReplyError({
          messageId: normalized.messageId,
          sessionKey: normalized.sessionKey,
          payload: { type: "control", sessionKey: normalized.sessionKey, action: "enter" },
          auditData: { type: "control", action: "enter" }
        });
        if (!ok) return reply.send({ ok: true });

        await safeReply(normalized.messageId, "已发送回车");
        return reply.send({ ok: true });
      }

      if (normalized.command === "/reset") {
        if (config.transport === "tmux") {
          await safeReply(normalized.messageId, "shared-session 模式下 /reset 仅重置 relay 会话状态，tmux 会话不受影响");
        }
        const ok = await relaySendOrReplyError({
          messageId: normalized.messageId,
          sessionKey: normalized.sessionKey,
          payload: { type: "control", sessionKey: normalized.sessionKey, action: "reset" },
          auditData: { type: "control", action: "reset" }
        });
        if (!ok) return reply.send({ ok: true });

        if (config.transport !== "tmux") {
          await safeReply(normalized.messageId, "已 reset 当前会话");
        }
        return reply.send({ ok: true });
      }

      // 未识别的 slash 命令 → 作为文本转发给 CLI（如 Claude Code 的 /init, /compact 等）
    }

    // 统一处理文本输入（包括普通文本和未识别的 slash 命令）
    const inputText = normalized.kind === "text"
      ? normalized.text
      : `${normalized.command}${normalized.args ? " " + normalized.args : ""}`;

    await audit.log({
      type: "feishu.input",
      sessionKey: normalized.sessionKey,
      msgId: normalized.messageId,
      data: { len: inputText.length, tool: session.tool, mode: session.mode }
    });

    outputSeenByMsgId.set(normalized.messageId, false);

    const ok = await relaySendOrReplyError({
      messageId: normalized.messageId,
      sessionKey: normalized.sessionKey,
      payload: {
        type: "input",
        sessionKey: normalized.sessionKey,
        msgId: normalized.messageId,
        tool: session.tool,
        mode: session.mode,
        cwd: session.cwd,
        text: inputText
      },
      auditData: { type: "input", tool: session.tool, mode: session.mode, cwd: session.cwd }
    });

    if (!ok) return reply.send({ ok: true });

    return reply.send({ ok: true });
  } catch (err) {
    await audit.log({ type: "error", data: { error: String(err) } });
    req.log.error(err);
    return reply.code(200).send({ ok: true });
  }
});

await fastify.listen({ port: config.port, host: "0.0.0.0" });
