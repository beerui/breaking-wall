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

type SessionState = {
  tool: "cc" | "cx";
  mode: "safe" | "yolo";
  cwd: string;
};

const sessions = new Map<string, SessionState>();

function defaultCwd(): string {
  return config.workRoots[0] ?? "D:/";
}

function getSession(sessionKey: string): SessionState {
  const existing = sessions.get(sessionKey);
  if (existing) return existing;
  const init: SessionState = { tool: "cx", mode: "safe", cwd: defaultCwd() };
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
      await safeReply(out.msgId, out.chunk);
    } else if (out.isFinal) {
      const seen = outputSeenByMsgId.get(out.msgId) ?? false;
      if (!seen) {
        outputSeenByMsgId.set(out.msgId, true);
        await safeReply(out.msgId, "（无输出：工具可能仍在等待输入/确认，或启动失败）");
      }
    }

    if (out.isFinal) outputSeenByMsgId.delete(out.msgId);
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
          "/cc — 切换到 Claude Code",
          "/cx — 切换到 Codex",
          "/start [cc|cx] — 启动 tmux session 并运行 CLI（tmux 模式）",
          "/stop — 发送 Ctrl+C 中断当前执行",
          "/reset — 重置当前会话",
          "/status — 查看当前会话状态",
          "/mode safe|yolo — 切换安全/YOLO 模式（pty 模式）",
          "/cwd <path> — 切换工作目录（pty 模式）",
          "/help — 显示此帮助信息",
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
        if (config.transport === "tmux") {
          await safeReply(normalized.messageId, "shared-session 模式下不支持 /mode 切换");
          return reply.send({ ok: true });
        }
        const mode = normalized.args.trim().toLowerCase();
        if (mode === "safe" || mode === "yolo") {
          session.mode = mode;
          await safeReply(normalized.messageId, `mode=${mode}`);
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

      await safeReply(normalized.messageId, "未知命令");
      return reply.send({ ok: true });
    }

    await audit.log({
      type: "feishu.input",
      sessionKey: normalized.sessionKey,
      msgId: normalized.messageId,
      data: { len: normalized.text.length, tool: session.tool, mode: session.mode }
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
        text: normalized.text
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
