import os from "node:os";
import type { IPty } from "node-pty";
import pty from "node-pty";
import { config } from "../config.js";

export type Tool = "cc" | "cx";

export type PtyHandle = {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
  onData: (cb: (data: string) => void) => void;
};

type Key = string;

function cmdlineForTool(tool: Tool): string {
  return tool === "cc" ? config.ccCmdline : config.cxCmdline;
}

function makeKey(sessionKey: string, tool: Tool): Key {
  return `${sessionKey}:${tool}`;
}

export class PtyManager {
  private readonly ptys = new Map<Key, IPty>();

  reset(sessionKey: string, tool: Tool): void {
    const key = makeKey(sessionKey, tool);
    const existing = this.ptys.get(key);
    if (existing) {
      try {
        existing.kill();
      } catch {
        // ignore
      }
      this.ptys.delete(key);
    }
  }

  stop(sessionKey: string, tool: Tool): void {
    const key = makeKey(sessionKey, tool);
    const existing = this.ptys.get(key);
    if (!existing) return;
    existing.write("\x03");
  }

  getOrCreate(sessionKey: string, tool: Tool, cwd: string): PtyHandle {
    const key = makeKey(sessionKey, tool);
    const existing = this.ptys.get(key);
    if (existing) return this.wrap(existing);

    const cmdline = cmdlineForTool(tool);

    const p = pty.spawn("cmd.exe", ["/c", cmdline], {
      name: "xterm-color",
      cols: 120,
      rows: 40,
      cwd,
      env: {
        ...process.env,
        TERM: "xterm-256color"
      }
    });

    this.ptys.set(key, p);
    return this.wrap(p);
  }

  private wrap(p: IPty): PtyHandle {
    return {
      write: (data) => p.write(data),
      resize: (cols, rows) => p.resize(cols, rows),
      kill: () => p.kill(),
      onData: (cb) => {
        p.onData(cb);
      }
    };
  }
}
