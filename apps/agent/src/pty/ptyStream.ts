import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { autoConfirmResponse } from "../modes/yoloAutoConfirm.js";
import { PtyManager, type Tool, type PtyController, type PtyExitInfo } from "./ptyManager.js";
import { getFinalizeDelayMs } from "./streamTiming.js";

export type InputRun = {
  sessionKey: string;
  msgId: string;
  tool: Tool;
  mode: "safe" | "yolo";
  cwd: string;
  text: string;
};

export type OutputSink = (msg: {
  sessionKey: string;
  msgId: string;
  streamId: string;
  chunk: string;
  isFinal: boolean;
}) => void;

type Key = string;
function keyOf(sessionKey: string, tool: Tool): Key {
  return `${tool}::${sessionKey}`;
}

function parseKey(k: Key): { tool: Tool; sessionKey: string } {
  const idx = k.indexOf("::");
  return {
    tool: k.slice(0, idx) as Tool,
    sessionKey: k.slice(idx + 2)
  };
}

type Active = {
  sessionKey: string;
  msgId: string;
  streamId: string;
  mode: "safe" | "yolo";
  seenData: boolean;
  resolve: () => void;
  reject: (err: unknown) => void;
  timer?: NodeJS.Timeout;
  buffer: string;
  lastFlushTime: number;
};

type Wrapper = {
  cwd: string;
  attached: boolean;
  exitAttached: boolean;
};

export class PtyStreamPool {
  private readonly wrappers = new Map<Key, Wrapper>();
  private readonly active = new Map<Key, Active>();

  constructor(
    private readonly sink: OutputSink,
    private readonly mgr: PtyController = new PtyManager()
  ) {}

  reset(sessionKey: string, tool: Tool): void {
    this.mgr.reset(sessionKey, tool);
    const k = keyOf(sessionKey, tool);
    this.wrappers.delete(k);
    const a = this.active.get(k);
    if (a?.timer) clearTimeout(a.timer);
    this.active.delete(k);
  }

  stop(sessionKey: string, tool: Tool): void {
    this.mgr.stop(sessionKey, tool);
  }

  async run(run: InputRun): Promise<void> {
    const k = keyOf(run.sessionKey, run.tool);
    const wrapper = this.wrappers.get(k);
    if (wrapper && wrapper.cwd !== run.cwd) {
      this.reset(run.sessionKey, run.tool);
    }

    const handle = this.mgr.getOrCreate(run.sessionKey, run.tool, run.cwd);

    if (!this.wrappers.get(k)) {
      this.wrappers.set(k, { cwd: run.cwd, attached: false, exitAttached: false });
    }

    const w = this.wrappers.get(k)!;
    w.cwd = run.cwd;

    if (!w.attached) {
      handle.onData((data) => this.onData(k, data));
      w.attached = true;
    }

    if (!w.exitAttached) {
      handle.onExit((info) => this.onExit(k, info));
      w.exitAttached = true;
    }

    const streamId = randomUUID();

    await new Promise<void>((resolve, reject) => {
      const a: Active = {
        sessionKey: run.sessionKey,
        msgId: run.msgId,
        streamId,
        mode: run.mode,
        seenData: false,
        resolve,
        reject,
        buffer: "",
        lastFlushTime: Date.now()
      };

      this.active.set(k, a);
      this.bumpFinalizeTimer(k);

      const input =
        run.text.endsWith("\n") || run.text.endsWith("\r")
          ? run.text
          : run.text + "\r";
      handle.write(input);
    });
  }

  private onData(k: Key, data: string): void {
    const a = this.active.get(k);
    if (!a) return;

    a.seenData = true;
    a.buffer += data;

    const now = Date.now();
    const flushInterval = 2000; // 2秒批量发送一次
    const shouldFlush =
      a.buffer.length >= config.maxChunkLen ||
      now - a.lastFlushTime >= flushInterval;

    if (shouldFlush && a.buffer.length > 0) {
      this.sink({
        sessionKey: a.sessionKey,
        msgId: a.msgId,
        streamId: a.streamId,
        chunk: a.buffer,
        isFinal: false
      });
      a.buffer = "";
      a.lastFlushTime = now;
    }

    if (a.mode === "yolo") {
      const reply = autoConfirmResponse(data);
      if (reply) {
        const parsed = parseKey(k);
        const handle = this.mgr.getOrCreate(parsed.sessionKey, parsed.tool, this.wrappers.get(k)?.cwd ?? "");
        handle.write(reply);
      }
    }

    this.bumpFinalizeTimer(k);
  }

  private onExit(k: Key, info: PtyExitInfo): void {
    const parsed = parseKey(k);
    this.wrappers.delete(k);
    this.mgr.reset(parsed.sessionKey, parsed.tool);

    const a = this.active.get(k);
    if (!a) return;
    if (a.timer) clearTimeout(a.timer);

    const details = typeof info.signal === "number"
      ? `exitCode=${info.exitCode} signal=${info.signal}`
      : `exitCode=${info.exitCode}`;

    this.sink({
      sessionKey: a.sessionKey,
      msgId: a.msgId,
      streamId: a.streamId,
      chunk: `PTY exited before producing output: ${details}`,
      isFinal: true
    });

    this.active.delete(k);
    a.resolve();
  }

  private bumpFinalizeTimer(k: Key): void {
    const a = this.active.get(k);
    if (!a) return;
    if (a.timer) clearTimeout(a.timer);

    const delay = getFinalizeDelayMs({
      seenData: a.seenData,
      config: {
        streamIdleMs: config.streamIdleMs,
        firstOutputTimeoutMs: config.firstOutputTimeoutMs
      }
    });

    a.timer = setTimeout(() => {
      // 发送剩余 buffer
      if (a.buffer.length > 0) {
        this.sink({
          sessionKey: a.sessionKey,
          msgId: a.msgId,
          streamId: a.streamId,
          chunk: a.buffer,
          isFinal: false
        });
      }
      // 发送结束标记
      this.sink({
        sessionKey: a.sessionKey,
        msgId: a.msgId,
        streamId: a.streamId,
        chunk: "",
        isFinal: true
      });
      this.active.delete(k);
      a.resolve();
    }, delay);
  }
}
