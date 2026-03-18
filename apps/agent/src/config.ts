import "dotenv/config";

export type TmuxSessionTarget = {
  session: string;
  pane: string;
};

export type TmuxSessionTargets = Partial<Record<"cc" | "cx", TmuxSessionTarget>>;

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

export function parseSessionTargets(val?: string): TmuxSessionTargets {
  if (!val) return {};

  const out: TmuxSessionTargets = {};
  for (const item of val.split(";").map((s) => s.trim()).filter(Boolean)) {
    const [toolRaw, targetRaw] = item.split("=");
    const tool = toolRaw?.trim();
    const target = targetRaw?.trim();
    if ((tool !== "cc" && tool !== "cx") || !target) continue;

    const [session, pane] = target.split(":");
    if (!session || !pane) continue;
    out[tool] = { session, pane };
  }

  return out;
}

export const config = {
  relayWsUrl: required("RELAY_WS_URL"),
  agentId: required("AGENT_ID"),
  agentToken: required("AGENT_TOKEN"),

  ccCmdline: process.env.CC_CMDLINE ?? "claude code",
  cxCmdline: process.env.CX_CMDLINE ?? "codex",

  workRoots: parseList(process.env.WORK_ROOTS ?? "D:/2026"),
  tmuxSessionTargets: parseSessionTargets(process.env.TMUX_SESSION_TARGETS),

  // Anthropic API configuration
  anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL,
  anthropicAuthToken: process.env.ANTHROPIC_AUTH_TOKEN,
  anthropicModel: process.env.ANTHROPIC_MODEL,

  // timing
  streamIdleMs: Number(process.env.STREAM_IDLE_MS ?? "1200"),
  firstOutputTimeoutMs: Number(process.env.FIRST_OUTPUT_TIMEOUT_MS ?? "120000"),

  // output chunking
  maxChunkLen: Number(process.env.MAX_CHUNK_LEN ?? "2000")
} as const;
