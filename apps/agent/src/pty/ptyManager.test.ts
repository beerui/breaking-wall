import { describe, expect, test } from "vitest";
import { buildWindowsPtySpec } from "./ptyManager.js";

describe("buildWindowsPtySpec", () => {
  test("keeps Claude sessions in an interactive cmd shell", () => {
    expect(buildWindowsPtySpec("cc", "claude", "D:/2026/project")).toEqual({
      file: "cmd.exe",
      args: ["/k", "claude"]
    });
  });

  test("routes default Codex sessions through WSL", () => {
    expect(buildWindowsPtySpec("cx", "codex", "D:/2026/project")).toEqual({
      file: "wsl.exe",
      args: ["--cd", "/mnt/d/2026/project", "bash", "-lc", "codex"]
    });
  });
});
