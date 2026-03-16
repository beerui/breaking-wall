import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";

export type AuditEvent = {
  ts: string;
  type:
    | "feishu.input"
    | "feishu.command"
    | "relay.to_agent"
    | "agent.output"
    | "error";
  sessionKey?: string;
  msgId?: string;
  data?: Record<string, unknown>;
};

export class JsonlAudit {
  constructor(private readonly filePath: string) {}

  async log(event: Omit<AuditEvent, "ts">): Promise<void> {
    const full: AuditEvent = { ts: new Date().toISOString(), ...event };
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, JSON.stringify(full) + "\n", "utf8");
  }
}
