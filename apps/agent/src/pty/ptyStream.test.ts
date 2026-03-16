import { describe, expect, test } from "vitest";
import { PtyStreamPool, type OutputSink } from "./ptyStream.js";
import type { PtyController, PtyHandle, Tool } from "./ptyManager.js";

class FakeHandle implements PtyHandle {
  private dataListeners: Array<(data: string) => void> = [];
  private exitListeners: Array<(info: { exitCode: number; signal?: number }) => void> = [];
  writes: string[] = [];

  write(data: string): void {
    this.writes.push(data);
  }

  resize(): void {}

  kill(): void {}

  onData(cb: (data: string) => void): void {
    this.dataListeners.push(cb);
  }

  onExit(cb: (info: { exitCode: number; signal?: number }) => void): void {
    this.exitListeners.push(cb);
  }

  emitData(data: string): void {
    for (const cb of this.dataListeners) cb(data);
  }

  emitExit(info: { exitCode: number; signal?: number }): void {
    for (const cb of this.exitListeners) cb(info);
  }
}

class FakeManager implements PtyController {
  readonly handle = new FakeHandle();

  reset(): void {}

  stop(): void {}

  getOrCreate(_sessionKey: string, _tool: Tool, _cwd: string): PtyHandle {
    return this.handle;
  }
}

describe("PtyStreamPool", () => {
  test("reports a final error when the child process exits before producing output", async () => {
    const outputs: Array<Parameters<OutputSink>[0]> = [];
    const mgr = new FakeManager();
    const pool = new PtyStreamPool((msg) => outputs.push(msg), mgr);

    const runPromise = pool.run({
      sessionKey: "s1",
      msgId: "m1",
      tool: "cx",
      mode: "safe",
      cwd: "D:/2026/project",
      text: "hi"
    });

    mgr.handle.emitExit({ exitCode: 1 });
    await runPromise;

    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toEqual(
      expect.objectContaining({
        sessionKey: "s1",
        msgId: "m1",
        isFinal: true,
        chunk: expect.stringContaining("PTY exited before producing output")
      })
    );
  });
});
