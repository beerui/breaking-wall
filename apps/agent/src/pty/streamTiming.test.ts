import { describe, expect, test } from "vitest";
import { getFinalizeDelayMs } from "./streamTiming.js";

describe("getFinalizeDelayMs", () => {
  test("uses firstOutputTimeoutMs before first output", () => {
    expect(
      getFinalizeDelayMs({
        seenData: false,
        config: { streamIdleMs: 1200, firstOutputTimeoutMs: 30_000 }
      })
    ).toBe(30_000);
  });

  test("uses streamIdleMs after output has started", () => {
    expect(
      getFinalizeDelayMs({
        seenData: true,
        config: { streamIdleMs: 1200, firstOutputTimeoutMs: 30_000 }
      })
    ).toBe(1200);
  });
});
