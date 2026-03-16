import "dotenv/config";

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing env: ${name}`);
  return val;
}

function parseList(val?: string): string[] {
  if (!val) return [];
  return val
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  relayWsUrl: required("RELAY_WS_URL"),
  agentId: required("AGENT_ID"),
  agentToken: required("AGENT_TOKEN"),

  ccCmdline: process.env.CC_CMDLINE ?? "claude code",
  cxCmdline: process.env.CX_CMDLINE ?? "codex",

  workRoots: parseList(process.env.WORK_ROOTS ?? "D:/2026"),

  // timing
  streamIdleMs: Number(process.env.STREAM_IDLE_MS ?? "1200"),
  firstOutputTimeoutMs: Number(process.env.FIRST_OUTPUT_TIMEOUT_MS ?? "120000"),

  // output chunking
  maxChunkLen: Number(process.env.MAX_CHUNK_LEN ?? "2000")
} as const;

