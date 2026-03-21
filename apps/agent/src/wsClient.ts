import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import {
  RelayToAgentSchema,
  safeParseJson,
  type AgentToRelay,
  type Control,
  type Input
} from "@bw/protocol";
import { config } from "./config.js";
import { PtyStreamPool } from "./pty/ptyStream.js";
import { SharedSessionBridge } from "./tmux/sharedSessionBridge.js";
import { SessionSerialQueue } from "./sessionQueue.js";
import { computeReconnectDelayMs } from "./retry.js";

type SessionState = {
  tool: "cc" | "cx";
  mode: "safe" | "yolo";
  cwd: string;
};

const useTmux = Object.keys(config.tmuxSessionTargets).length > 0;

export function startAgent(): void {
  const sessionState = new Map<string, SessionState>();
  const queue = new SessionSerialQueue();

  let ws: WebSocket | undefined;
  let attempt = 0;
  let reconnectTimer: NodeJS.Timeout | undefined;

  const wsSend = (msg: AgentToRelay) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(msg));
  };

  const pool = useTmux ? undefined : new PtyStreamPool((out) => {
    wsSend({ type: "output", ...out });
  });

  const bridge = useTmux
    ? new SharedSessionBridge({ targets: config.tmuxSessionTargets })
    : undefined;

  console.log(`[agent] transport=${useTmux ? "tmux" : "pty"}`);

  const scheduleReconnect = (why: string) => {
    if (reconnectTimer) return;
    const delay = computeReconnectDelayMs(attempt++);
    console.error(`[agent] reconnect scheduled why=${why} inMs=${delay}`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, delay);
  };

  const connect = () => {
    if (ws && ws.readyState === WebSocket.OPEN) return;

    try {
      ws?.removeAllListeners();
      ws?.terminate();
    } catch {
      // ignore
    }

    ws = new WebSocket(config.relayWsUrl);

    ws.on("open", () => {
      attempt = 0;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }

      console.log(`[agent] connected ${config.relayWsUrl}`);
      wsSend({
        type: "agent_hello",
        agentId: config.agentId,
        token: config.agentToken,
        capabilities: { cc: true, cx: true }
      });
    });

    ws.on("message", (data) => {
      const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
      const json = safeParseJson(text);
      const parsed = RelayToAgentSchema.safeParse(json);
      if (!parsed.success) return;

      if (parsed.data.type === "input") {
        const input = parsed.data as Input;
        sessionState.set(input.sessionKey, {
          tool: input.tool,
          mode: input.mode,
          cwd: input.cwd
        });

        if (bridge) {
          // tmux mode: send input and poll output until stable, then send once
          void queue.enqueue(input.sessionKey, async () => {
            const streamId = randomUUID();
            try {
              await bridge.sendInput({ tool: input.tool, text: input.text });

              const maxWaitMs = config.firstOutputTimeoutMs;
              const pollIntervalMs = config.streamIdleMs;
              const stableRounds = 5; // 连续 5 次无实质性输出后再等 3 秒确认
              const finalWaitMs = 3000; // 无输出后额外等待 3 秒

              let stableCount = 0;
              let totalWaitMs = 0;
              let buffer = "";

              while (totalWaitMs < maxWaitMs) {
                await new Promise((r) => setTimeout(r, pollIntervalMs));
                totalWaitMs += pollIntervalMs;

                const result = await bridge.captureOutput({ tool: input.tool });
                const meaningful = result.diff.trim().length > 0;

                if (meaningful) {
                  buffer += result.diff;

                  // 只有实质性变化才重置稳定计数
                  if (result.isSubstantial) {
                    stableCount = 0;
                  }

                  // 检测是否在等待用户确认（选择菜单或确认对话框）
                  const lastLines = buffer.split('\n').slice(-10).join('\n');
                  const isConfirmationPrompt =
                    lastLines.includes('Enter to confirm') ||
                    lastLines.includes('Do you want to proceed?') ||
                    /\(\s*y\s*\/\s*n\s*\)/i.test(lastLines) ||
                    /\[\s*y\s*\/\s*n\s*\]/i.test(lastLines);

                  if (isConfirmationPrompt) {
                    // 确认对话框，发送带提示的输出
                    wsSend({
                      type: "output",
                      sessionKey: input.sessionKey,
                      msgId: input.msgId,
                      streamId,
                      chunk: buffer + "\n\n⚠️ 检测到需要确认，请使用 /enter 发送回车继续。",
                      isFinal: true
                    });
                    return;
                  }

                  // 检测 Claude Code 空闲提示符（命令已完成）
                  const isIdlePrompt = /^\s*❯\s*$/m.test(lastLines);
                  if (isIdlePrompt) {
                    // 正常完成，直接发送输出
                    wsSend({
                      type: "output",
                      sessionKey: input.sessionKey,
                      msgId: input.msgId,
                      streamId,
                      chunk: buffer,
                      isFinal: true
                    });
                    return;
                  }

                  // 检测是否正在运行工具（状态更新）
                  const isRunning = lastLines.includes('Running...') ||
                                   lastLines.includes('Transfiguring...');
                  if (!isRunning && result.isSubstantial) {
                    // 有实质性输出且不是运行状态，重置计数
                    stableCount = 0;
                  }
                } else {
                  // 没有新输出
                  if (buffer.length > 0) {
                    stableCount++;
                  }
                }

                // 连续无实质性输出达到阈值
                if (stableCount >= stableRounds) {
                  // 额外等待确认真的结束了
                  await new Promise((r) => setTimeout(r, finalWaitMs));

                  // 再次检查是否有新输出
                  const finalResult = await bridge.captureOutput({ tool: input.tool });
                  if (finalResult.diff.trim().length > 0) {
                    // 还有新输出，继续循环
                    buffer += finalResult.diff;
                    if (finalResult.isSubstantial) {
                      stableCount = 0;
                    }
                    totalWaitMs += finalWaitMs;
                    continue;
                  }

                  // 确认结束
                  break;
                }
              }

              // 只在最后发送一次完整输出
              wsSend({
                type: "output",
                sessionKey: input.sessionKey,
                msgId: input.msgId,
                streamId,
                chunk: buffer.trim().length > 0 ? buffer : "（无输出）",
                isFinal: true
              });
            } catch (err) {
              wsSend({
                type: "output",
                sessionKey: input.sessionKey,
                msgId: input.msgId,
                streamId,
                chunk: `错误: ${String(err instanceof Error ? err.message : err)}`,
                isFinal: true
              });
            }
          });
        } else {
          // pty mode
          void queue.enqueue(input.sessionKey, async () => {
            await pool!.run({
              sessionKey: input.sessionKey,
              msgId: input.msgId,
              tool: input.tool,
              mode: input.mode,
              cwd: input.cwd,
              text: input.text
            });
          });
        }
        return;
      }

      if (parsed.data.type === "control") {
        const ctl = parsed.data as Control;
        const st = sessionState.get(ctl.sessionKey);
        const tool = st?.tool ?? "cc";

        if (ctl.action === "stop") {
          if (pool) pool.stop(ctl.sessionKey, tool);
          // tmux mode: send Ctrl-C
          if (bridge) {
            void bridge.sendInput({ tool, text: "\x03" }).catch(() => {});
          }
          return;
        }

        if (ctl.action === "enter") {
          // tmux mode: send Enter
          if (bridge) {
            void bridge.sendInput({ tool, text: "" }).catch(() => {});
          }
          // pty mode: send Enter
          if (pool) {
            // PTY 模式下通过 write 发送回车
            // 这里需要获取 pty handle，暂时不支持
          }
          return;
        }

        if (ctl.action === "permission") {
          // tmux mode: send /permission command to Claude Code
          if (bridge && ctl.mode) {
            void bridge.sendInput({ tool, text: `/permission ${ctl.mode}` }).catch(() => {});
          }
          return;
        }

        if (ctl.action === "send_key") {
          // tmux mode: send special key
          if (bridge && ctl.key) {
            void bridge.sendKey({ tool, key: ctl.key }).catch(() => {});
          }
          return;
        }

        if (ctl.action === "reset") {
          if (pool) pool.reset(ctl.sessionKey, tool);
          // tmux mode: no-op, shared session is externally managed
          return;
        }

        if (ctl.action === "start") {
          if (bridge) {
            const startTool = ctl.tool ?? tool;
            const replyMsgId = ctl.msgId ?? ctl.sessionKey;
            void (async () => {
              try {
                const msg = await bridge.startSession(startTool);
                wsSend({
                  type: "output",
                  sessionKey: ctl.sessionKey,
                  msgId: replyMsgId,
                  streamId: randomUUID(),
                  chunk: msg,
                  isFinal: true
                });
              } catch (err) {
                wsSend({
                  type: "output",
                  sessionKey: ctl.sessionKey,
                  msgId: replyMsgId,
                  streamId: randomUUID(),
                  chunk: `启动失败: ${String(err instanceof Error ? err.message : err)}`,
                  isFinal: true
                });
              }
            })();
          }
          return;
        }

        if (ctl.action === "status") {
          const cur =
            st ?? ({ tool: "cc", mode: "safe", cwd: config.workRoots[0] ?? "D:/" } as const);
          const qs = queue.stats(ctl.sessionKey);
          const target = useTmux ? config.tmuxSessionTargets[cur.tool] : undefined;
          wsSend({
            type: "status",
            sessionKey: ctl.sessionKey,
            tool: cur.tool,
            mode: cur.mode,
            cwd: cur.cwd,
            busy: qs.busy,
            queueDepth: qs.queueDepth,
            ...(useTmux ? {
              transport: "tmux" as const,
              targetSession: target?.session,
              targetPane: target?.pane
            } : {})
          });
          return;
        }

        if (ctl.action === "cwd" && typeof ctl.cwd === "string") {
          if (pool) {
            const next = st ?? { tool: "cc", mode: "safe", cwd: ctl.cwd };
            next.cwd = ctl.cwd;
            sessionState.set(ctl.sessionKey, next);
            pool.reset(ctl.sessionKey, tool);
          }
          // tmux mode: cwd is not applicable
        }
      }
    });

    ws.on("close", (code, reason) => {
      console.error(
        `[agent] ws closed code=${code} reason=${reason.toString()} url=${config.relayWsUrl}`
      );
      scheduleReconnect("close");
    });

    ws.on("error", (err) => {
      console.error(`[agent] ws error url=${config.relayWsUrl}`, err);
      // 不在这里 schedule，交给 close 事件统一处理，避免双重重连导致多连接。
    });
  };

  connect();
}
