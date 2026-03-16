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
          // tmux mode: send input and poll output until stable
          void queue.enqueue(input.sessionKey, async () => {
            const streamId = randomUUID();
            try {
              await bridge.sendInput({ tool: input.tool, text: input.text });

              // poll: wait for first output, then keep polling until idle
              const maxWaitMs = config.firstOutputTimeoutMs;
              const pollIntervalMs = config.streamIdleMs;
              const stableRounds = 3; // output unchanged for N rounds → done

              let stableCount = 0;
              let lastSnapshot = "";
              let totalWaitMs = 0;
              let sentAny = false;

              while (totalWaitMs < maxWaitMs) {
                await new Promise((r) => setTimeout(r, pollIntervalMs));
                totalWaitMs += pollIntervalMs;

                const chunk = await bridge.captureOutput({ tool: input.tool });
                if (chunk.length > 0) {
                  sentAny = true;
                  stableCount = 0;
                  wsSend({
                    type: "output",
                    sessionKey: input.sessionKey,
                    msgId: input.msgId,
                    streamId,
                    chunk,
                    isFinal: false
                  });
                  lastSnapshot = chunk;
                } else {
                  // no new output
                  if (sentAny) {
                    stableCount++;
                    if (stableCount >= stableRounds) break;
                  }
                }
              }

              // send final marker
              wsSend({
                type: "output",
                sessionKey: input.sessionKey,
                msgId: input.msgId,
                streamId,
                chunk: "",
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
        const tool = st?.tool ?? "cx";

        if (ctl.action === "stop") {
          if (pool) pool.stop(ctl.sessionKey, tool);
          // tmux mode: send Ctrl-C
          if (bridge) {
            void bridge.sendInput({ tool, text: "" }).catch(() => {});
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
            st ?? ({ tool: "cx", mode: "safe", cwd: config.workRoots[0] ?? "D:/" } as const);
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
            const next = st ?? { tool: "cx", mode: "safe", cwd: ctl.cwd };
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
