import type { FastifyInstance } from "fastify";
import websocketPlugin from "@fastify/websocket";
import type { WebSocket } from "ws";
import {
  AgentHelloSchema,
  AgentToRelaySchema,
  safeParseJson,
  type AgentToRelay,
  type RelayToAgent
} from "@bw/protocol";
import { validateAgentToken } from "./config.js";

export type AgentConn = {
  agentId: string;
  socket: WebSocket;
};

export class AgentHub {
  private readonly agents = new Map<string, AgentConn>();

  upsert(conn: AgentConn): void {
    this.agents.set(conn.agentId, conn);
  }

  remove(agentId: string): void {
    this.agents.delete(agentId);
  }

  any(): AgentConn | undefined {
    for (const a of this.agents.values()) return a;
    return undefined;
  }

  send(msg: RelayToAgent): void {
    const agent = this.any();
    if (!agent) throw new Error("No agent connected");
    agent.socket.send(JSON.stringify(msg));
  }
}

function coerceSocket(connectionOrSocket: unknown): WebSocket {
  const anyVal = connectionOrSocket as any;
  return (anyVal?.socket ?? anyVal) as WebSocket;
}

export async function registerAgentWs(params: {
  fastify: FastifyInstance;
  hub: AgentHub;
  onAgentMessage: (msg: AgentToRelay) => Promise<void>;
}): Promise<void> {
  await params.fastify.register(websocketPlugin);

  params.fastify.get("/agent", { websocket: true }, (connectionOrSocket, req) => {
    const socket = coerceSocket(connectionOrSocket);

    let agentId: string | undefined;
    params.fastify.log.info({ remote: req.ip }, "[relay] ws connected");

    socket.on("message", async (data) => {
      try {
        const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
        const json = safeParseJson(text);
        const parsed = AgentToRelaySchema.safeParse(json);
        if (!parsed.success) {
          socket.send(JSON.stringify({ type: "error", message: "invalid message" }));
          return;
        }

        if (parsed.data.type === "agent_hello") {
          const hello = AgentHelloSchema.parse(parsed.data);
          if (!validateAgentToken(hello.agentId, hello.token)) {
            socket.close(1008, "unauthorized");
            return;
          }
          agentId = hello.agentId;
          params.hub.upsert({ agentId: hello.agentId, socket });
          return;
        }

        await params.onAgentMessage(parsed.data);
      } catch (err) {
        params.fastify.log.error({ err }, "[relay] ws message handler error");
        try {
          socket.send(JSON.stringify({ type: "error", message: String(err) }));
        } catch {
          // ignore
        }
      }
    });

    socket.on("close", (code, reason) => {
      params.fastify.log.info(
        { agentId, code, reason: reason?.toString?.() },
        "[relay] ws closed"
      );
      if (agentId) params.hub.remove(agentId);
    });
  });
}
