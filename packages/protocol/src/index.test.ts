import { describe, expect, test } from "vitest";
import { AgentHelloSchema, RelayToAgentSchema, StatusSchema, safeParseJson } from "./index.js";

describe("protocol", () => {
  test("safeParseJson returns undefined on invalid json", () => {
    expect(safeParseJson("{")).toBeUndefined();
  });

  test("AgentHello schema validates", () => {
    const parsed = AgentHelloSchema.parse({
      type: "agent_hello",
      agentId: "agent-1",
      token: "t",
      capabilities: { cc: true, cx: true }
    });
    expect(parsed.agentId).toBe("agent-1");
  });

  test("RelayToAgent rejects unknown type", () => {
    expect(() => RelayToAgentSchema.parse({ type: "nope" })).toThrow();
  });

  test("status schema accepts shared session target info", () => {
    const parsed = StatusSchema.parse({
      type: "status",
      sessionKey: "s1",
      tool: "cx",
      mode: "safe",
      cwd: "D:/2026",
      busy: false,
      queueDepth: 0,
      transport: "tmux",
      targetSession: "bw-cx",
      targetPane: "0"
    });
    expect(parsed.transport).toBe("tmux");
    expect(parsed.targetSession).toBe("bw-cx");
    expect(parsed.targetPane).toBe("0");
  });

  test("status schema still works without shared session fields", () => {
    const parsed = StatusSchema.parse({
      type: "status",
      sessionKey: "s1",
      tool: "cc",
      mode: "safe",
      cwd: "D:/2026",
      busy: false,
      queueDepth: 0
    });
    expect(parsed.transport).toBeUndefined();
    expect(parsed.targetSession).toBeUndefined();
  });
});

