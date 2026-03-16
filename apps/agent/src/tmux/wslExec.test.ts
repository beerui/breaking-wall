import { describe, expect, test } from "vitest";
import { buildWslExecSpec } from "./wslExec.js";

describe("buildWslExecSpec", () => {
  test("wraps tmux command in wsl bash -lc", () => {
    expect(buildWslExecSpec(["tmux", "has-session", "-t", "bw-cx"])).toEqual({
      file: "wsl.exe",
      args: ["bash", "-lc", "tmux has-session -t bw-cx"]
    });
  });
});
