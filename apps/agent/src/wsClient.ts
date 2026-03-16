import WebSocket from "ws";
import {
  RelayToAgentSchema,
  safeParseJson,
  type AgentToRelay,
  type Control,
  type Input
} from "@bw/protocol";
import { config } from "./config.js";
import { PtyStreamPool } from "./pty/ptyStream.js";
import { SessionSerialQueue } from "./sessionQueue.js";
import { computeReconnectDelayMs } from "./retry.js";

type SessionState = {
  tool: "cc" | "cx";
  mode: "safe" | "yolo";
  cwd: string;
};

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

  const pool = new PtyStreamPool((out) => {
    wsSend({ type: "output", ...out });
  });

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

        void queue.enqueue(input.sessionKey, async () => {
          await pool.run({
            sessionKey: input.sessionKey,
            msgId: input.msgId,
            tool: input.tool,
            mode: input.mode,
            cwd: input.cwd,
            text: input.text
          });
        });
        return;
      }

      if (parsed.data.type === "control") {
        const ctl = parsed.data as Control;
        const st = sessionState.get(ctl.sessionKey);
        const tool = st?.tool ?? "cx";

        if (ctl.action === "stop") {
          pool.stop(ctl.sessionKey, tool);
          return;
        }

        if (ctl.action === "reset") {
          pool.reset(ctl.sessionKey, tool);
          return;
        }

        if (ctl.action === "status") {
          const cur =
            st ?? ({ tool: "cx", mode: "safe", cwd: config.workRoots[0] ?? "D:/" } as const);
          const qs = queue.stats(ctl.sessionKey);
          wsSend({
            type: "status",
            sessionKey: ctl.sessionKey,
            tool: cur.tool,
            mode: cur.mode,
            cwd: cur.cwd,
            busy: qs.busy,
            queueDepth: qs.queueDepth
          });
          return;
        }

        if (ctl.action === "cwd" && typeof ctl.cwd === "string") {
          const next = st ?? { tool: "cx", mode: "safe", cwd: ctl.cwd };
          next.cwd = ctl.cwd;
          sessionState.set(ctl.sessionKey, next);
          pool.reset(ctl.sessionKey, tool);
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
