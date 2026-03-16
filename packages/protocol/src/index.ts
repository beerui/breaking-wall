import { z } from "zod";

export const ToolSchema = z.enum(["cc", "cx"]);
export type Tool = z.infer<typeof ToolSchema>;

export const ModeSchema = z.enum(["safe", "yolo"]);
export type Mode = z.infer<typeof ModeSchema>;

export const AgentHelloSchema = z.object({
  type: z.literal("agent_hello"),
  agentId: z.string().min(1),
  token: z.string().min(1),
  capabilities: z.object({
    cc: z.boolean(),
    cx: z.boolean()
  })
});
export type AgentHello = z.infer<typeof AgentHelloSchema>;

export const InputSchema = z.object({
  type: z.literal("input"),
  sessionKey: z.string().min(1),
  msgId: z.string().min(1),
  tool: ToolSchema,
  mode: ModeSchema,
  cwd: z.string().min(1),
  text: z.string()
});
export type Input = z.infer<typeof InputSchema>;

export const OutputSchema = z.object({
  type: z.literal("output"),
  sessionKey: z.string().min(1),
  msgId: z.string().min(1),
  streamId: z.string().min(1),
  chunk: z.string(),
  isFinal: z.boolean()
});
export type Output = z.infer<typeof OutputSchema>;

export const ControlSchema = z.object({
  type: z.literal("control"),
  sessionKey: z.string().min(1),
  action: z.enum(["stop", "reset", "status", "cwd", "start"]),
  cwd: z.string().optional(),
  tool: ToolSchema.optional(),
  msgId: z.string().optional()
});
export type Control = z.infer<typeof ControlSchema>;

export const StatusSchema = z.object({
  type: z.literal("status"),
  sessionKey: z.string().min(1),
  tool: ToolSchema,
  mode: ModeSchema,
  cwd: z.string().min(1),
  busy: z.boolean(),
  queueDepth: z.number().int().nonnegative(),
  transport: z.enum(["pty", "tmux"]).optional(),
  targetSession: z.string().optional(),
  targetPane: z.string().optional()
});
export type Status = z.infer<typeof StatusSchema>;

export const HeartbeatSchema = z.object({
  type: z.literal("heartbeat"),
  ts: z.number().int().nonnegative()
});
export type Heartbeat = z.infer<typeof HeartbeatSchema>;

export const RelayToAgentSchema = z.discriminatedUnion("type", [
  InputSchema,
  ControlSchema,
  HeartbeatSchema
]);
export type RelayToAgent = z.infer<typeof RelayToAgentSchema>;

export const AgentToRelaySchema = z.discriminatedUnion("type", [
  AgentHelloSchema,
  OutputSchema,
  StatusSchema,
  HeartbeatSchema
]);
export type AgentToRelay = z.infer<typeof AgentToRelaySchema>;

export function safeParseJson(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

