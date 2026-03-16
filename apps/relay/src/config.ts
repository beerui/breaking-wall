import "dotenv/config";

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing env: ${name}`);
  return val;
}

function optional(name: string): string | undefined {
  const val = process.env[name];
  return val && val.length > 0 ? val : undefined;
}

function parseList(val?: string): string[] {
  if (!val) return [];
  return val
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseAgentTokens(val?: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!val) return map;
  for (const part of val.split(/\s*;\s*/)) {
    if (!part) continue;
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    map.set(part.slice(0, idx).trim(), part.slice(idx + 1).trim());
  }
  return map;
}

export const config = {
  port: Number(process.env.RELAY_PORT ?? "8787"),

  feishu: {
    appId: optional("FEISHU_APP_ID"),
    appSecret: optional("FEISHU_APP_SECRET"),
    verificationToken: optional("FEISHU_VERIFICATION_TOKEN"),
    encryptKey: optional("FEISHU_ENCRYPT_KEY")
  },

  allowedFeishuUserIds: new Set(parseList(process.env.ALLOWED_FEISHU_USER_IDS)),

  agentTokens: parseAgentTokens(process.env.AGENT_TOKENS),

  auditJsonlPath: process.env.AUDIT_JSONL_PATH ?? "./var/audit.jsonl",

  workRoots: parseList(process.env.WORK_ROOTS ?? "D:/2026"),

  transport: (process.env.TRANSPORT_MODE ?? "pty") as "pty" | "tmux"
} as const;

export function assertFeishuConfigured(): void {
  if (!config.feishu.appId || !config.feishu.appSecret) {
    throw new Error("FEISHU_APP_ID/FEISHU_APP_SECRET required to send messages");
  }
}

export function isUserAllowed(userId: string): boolean {
  if (config.allowedFeishuUserIds.size === 0) return true;
  return config.allowedFeishuUserIds.has(userId);
}

export function validateAgentToken(agentId: string, token: string): boolean {
  if (config.agentTokens.size === 0) return false;
  return config.agentTokens.get(agentId) === token;
}
