import { describe, expect, test } from "vitest";
import { diffPaneOutput } from "./outputDiff.js";

describe("diffPaneOutput", () => {
  test("returns only new trailing output", () => {
    const result = diffPaneOutput("hello\nworld\n", "hello\nworld\nnext\n");
    expect(result.diff).toBe("next\n");
    expect(result.isSubstantial).toBe(true);
  });
});
