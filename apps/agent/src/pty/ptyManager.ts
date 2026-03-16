import type { IPty } from "node-pty";
import pty from "node-pty";
import { config } from "../config.js";

export type Tool = "cc" | "cx";

export type PtyExitInfo = {
  exitCode: number;
  signal?: number;
};

export type PtyHandle = {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
  onData: (cb: (data: string) => void) => void;
  onExit: (cb: (info: PtyExitInfo) => void) => void;
};

export type PtyController = {
  reset: (sessionKey: string, tool: Tool) => void;
  stop: (sessionKey: string, tool: Tool) => void;
  getOrCreate: (sessionKey: string, tool: Tool, cwd: string) => PtyHandle;
};

type Key = string;

type WindowsPtySpec = {
  file: string;
  args: string[];
};

function cmdlineForTool(tool: Tool): string {
  return tool === "cc" ? config.ccCmdline : config.cxCmdline;
}

function toWslPath(cwd: string): string {
  const normalized = cwd.replace(/\\/g, "/");
  const m = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (!m) return normalized;
  const drive = m[1]!.toLowerCase();
  const rest = m[2] ?? "";
  return `/mnt/${drive}/${rest}`;
}

function shouldUseWslForCodex(tool: Tool, cmdline: string): boolean {
  return tool === "cx" && /^codex(?:\s|$)/i.test(cmdline.trim());
}

export function buildWindowsPtySpec(tool: Tool, cmdline: string, cwd: string): WindowsPtySpec {
  if (shouldUseWslForCodex(tool, cmdline)) {
    return {
      file: "wsl.exe",
      args: ["--cd", toWslPath(cwd), "bash", "-lc", cmdline]
    };
  }

  return {
    file: "cmd.exe",
    args: ["/k", cmdline]
  };
}

function makeKey(sessionKey: string, tool: Tool): Key {
  return `${sessionKey}:${tool}`;
}

export class PtyManager implements PtyController {
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
    const spec = buildWindowsPtySpec(tool, cmdline, cwd);

    const p = pty.spawn(spec.file, spec.args, {
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
      },
      onExit: (cb) => {
        p.onExit(({ exitCode, signal }) => cb({ exitCode, ...(signal !== undefined ? { signal } : {}) }));
      }
    };
  }
}
