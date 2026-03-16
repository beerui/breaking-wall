import { describe, expect, test } from "vitest";
import { diffPaneOutput } from "./outputDiff.js";

describe("diffPaneOutput", () => {
  test("returns only new trailing output", () => {
    expect(diffPaneOutput("hello\nworld\n", "hello\nworld\nnext\n")).toBe("next\n");
  });
});
