import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { autoConfirmResponse } from "../modes/yoloAutoConfirm.js";
import type { Tool, PtyHandle } from "./ptyManager.js";
import { PtyManager } from "./ptyManager.js";
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

type Active = {
  sessionKey: string;
  msgId: string;
  streamId: string;
  mode: "safe" | "yolo";
  seenData: boolean;
  resolve: () => void;
  reject: (err: unknown) => void;
  timer?: NodeJS.Timeout;
};

type Wrapper = {
  cwd: string;
  handle: PtyHandle;
  attached: boolean;
};

export class PtyStreamPool {
  private readonly mgr = new PtyManager();
  private readonly wrappers = new Map<Key, Wrapper>();
  private readonly active = new Map<Key, Active>();

  constructor(private readonly sink: OutputSink) {}

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
      this.wrappers.set(k, { cwd: run.cwd, handle, attached: false });
    }

    const w = this.wrappers.get(k)!;
    w.cwd = run.cwd;
    w.handle = handle;

    if (!w.attached) {
      handle.onData((data) => this.onData(k, data));
      w.attached = true;
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
        reject
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

    const chunk =
      data.length > config.maxChunkLen
        ? data.slice(0, config.maxChunkLen)
        : data;

    this.sink({
      sessionKey: a.sessionKey,
      msgId: a.msgId,
      streamId: a.streamId,
      chunk,
      isFinal: false
    });

    if (a.mode === "yolo") {
      const reply = autoConfirmResponse(data);
      if (reply) {
        const w = this.wrappers.get(k);
        w?.handle.write(reply);
      }
    }

    this.bumpFinalizeTimer(k);
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
