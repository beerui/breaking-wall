import { describe, expect, test } from "vitest";
import { diffPaneOutput } from "./outputDiff.js";

describe("diffPaneOutput", () => {
  test("returns only new trailing output", () => {
    const result = diffPaneOutput("hello\nworld\n", "hello\nworld\nnext\n");
    expect(result.diff).toBe("next\n");
    expect(result.isSubstantial).toBe(true);
  });

  test("fast path: current starts with previous", () => {
    const result = diffPaneOutput("abc", "abcdef");
    expect(result.diff).toBe("def");
  });

  test("line-based common prefix", () => {
    const prev = "line1\nline2\nline3";
    const curr = "line1\nline2\nline3\nline4\nline5";
    const result = diffPaneOutput(prev, curr);
    // fast path: startsWith matches, diff includes the \n separator
    expect(result.diff).toBe("\nline4\nline5");
  });

  test("scrollback rotation — top lines dropped", () => {
    const prev = "line1\nline2\nline3\nline4";
    const curr = "line3\nline4\nline5\nline6";
    const result = diffPaneOutput(prev, curr);
    expect(result.diff).toBe("line5\nline6");
  });

  test("completely different content returns full current", () => {
    const prev = "aaa\nbbb";
    const curr = "xxx\nyyy";
    const result = diffPaneOutput(prev, curr);
    expect(result.diff).toBe(curr);
  });

  test("empty previous returns full current", () => {
    const result = diffPaneOutput("", "hello\nworld");
    expect(result.diff).toBe("hello\nworld");
    expect(result.isSubstantial).toBe(true);
  });

  test("no change returns empty diff", () => {
    const result = diffPaneOutput("hello\nworld", "hello\nworld");
    expect(result.diff).toBe("");
    expect(result.isSubstantial).toBe(false);
  });

  test("handles large buffers without hanging", () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `line-${i}`);
    const prev = lines.join("\n");
    const curr = lines.concat(["new-line"]).join("\n");
    const start = Date.now();
    const result = diffPaneOutput(prev, curr);
    const elapsed = Date.now() - start;
    expect(result.diff).toBe("\nnew-line");
    expect(elapsed).toBeLessThan(500); // should be nearly instant
  });
});
