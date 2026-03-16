import { describe, expect, test, vi } from "vitest";
import { SharedSessionBridge } from "./sharedSessionBridge.js";

describe("SharedSessionBridge", () => {
  test("sends input to configured tmux pane", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "", code: 0 });
    const bridge = new SharedSessionBridge({
      exec,
      targets: {
        cx: { session: "bw-cx", pane: "0" }
      }
    });

    await bridge.sendInput({ tool: "cx", text: "hi" });

    // first call: send-keys -l (literal text)
    expect(exec).toHaveBeenCalledWith(
      expect.objectContaining({
        file: "wsl.exe",
        args: ["bash", "-lc", "tmux send-keys -t bw-cx:0 -l hi"]
      })
    );
    // second call: send-keys C-m (enter)
    expect(exec).toHaveBeenCalledWith(
      expect.objectContaining({
        file: "wsl.exe",
        args: ["bash", "-lc", "tmux send-keys -t bw-cx:0 C-m"]
      })
    );
    expect(exec).toHaveBeenCalledTimes(2);
  });

  test("returns readable error when tmux session is missing", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "no server running on /tmp/tmux-1000/default", code: 1 });
    const bridge = new SharedSessionBridge({
      exec,
      targets: { cx: { session: "bw-cx", pane: "0" } }
    });

    await expect(bridge.sendInput({ tool: "cx", text: "hi" })).rejects.toThrow(/bw-cx/);
  });

  test("returns readable error when tmux is not installed", async () => {
    const exec = vi.fn().mockRejectedValue(new Error("spawn wsl.exe ENOENT"));
    const bridge = new SharedSessionBridge({
      exec,
      targets: { cx: { session: "bw-cx", pane: "0" } }
    });

    await expect(bridge.sendInput({ tool: "cx", text: "hi" })).rejects.toThrow(/WSL/);
  });

  test("returns readable error when session does not exist", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "session not found: bw-cx", code: 1 });
    const bridge = new SharedSessionBridge({
      exec,
      targets: { cx: { session: "bw-cx", pane: "0" } }
    });

    await expect(bridge.sendInput({ tool: "cx", text: "hi" })).rejects.toThrow(/bw-cx/);
  });

  test("captures only new pane output", async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "hello\n", stderr: "", code: 0 })
      .mockResolvedValueOnce({ stdout: "hello\nworld\n", stderr: "", code: 0 });

    const bridge = new SharedSessionBridge({
      exec,
      targets: {
        cx: { session: "bw-cx", pane: "0" }
      }
    });

    expect(await bridge.captureOutput({ tool: "cx" })).toBe("hello\n");
    expect(await bridge.captureOutput({ tool: "cx" })).toBe("world\n");
  });
});
