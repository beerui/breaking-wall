import { describe, expect, test, vi } from "vitest";
import { computeReconnectDelayMs } from "./retry.js";

describe("computeReconnectDelayMs", () => {
  test("grows with attempt and caps", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(computeReconnectDelayMs(0)).toBe(250);
    expect(computeReconnectDelayMs(1)).toBe(500);
    expect(computeReconnectDelayMs(2)).toBe(1000);
    expect(computeReconnectDelayMs(10)).toBe(10_000);
  });
});
