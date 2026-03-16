import { describe, expect, test } from "vitest";
import { AgentHelloSchema, RelayToAgentSchema, safeParseJson } from "./index.js";

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
});

