import type { TmuxSessionTargets } from "../config.js";
import { buildCapturePaneArgs, buildSendKeysArgs } from "./tmuxClient.js";
import { diffPaneOutput } from "./outputDiff.js";
import { buildWslExecSpec, runExec, type ExecResult, type ExecSpec } from "./wslExec.js";

export type BridgeExec = (spec: ExecSpec) => Promise<ExecResult>;

function normalizeTmuxError(stderr: string, target: { session: string; pane: string }): string {
  const lower = stderr.toLowerCase();
  if (lower.includes("no server running")) {
    return `tmux 服务未运行，请先在 WSL 中启动 tmux session "${target.session}"`;
  }
  if (lower.includes("session not found")) {
    return `tmux session "${target.session}" 不存在，请先创建: tmux new -s ${target.session}`;
  }
  if (lower.includes("pane not found") || lower.includes("can't find pane")) {
    return `tmux pane "${target.session}:${target.pane}" 不存在`;
  }
  if (lower.includes("capture-pane")) {
    return `tmux capture-pane 失败 (session="${target.session}", pane="${target.pane}"): ${stderr}`;
  }
  return `tmux 操作失败 (session="${target.session}"): ${stderr}`;
}

function normalizeExecError(err: unknown, target: { session: string; pane: string }): Error {
  const msg = String(err instanceof Error ? err.message : err);
  const lower = msg.toLowerCase();
  if (lower.includes("enoent") || lower.includes("not found")) {
    return new Error(`WSL 不可用或未安装，无法执行 tmux 命令 (target="${target.session}:${target.pane}")`);
  }
  return new Error(`执行 WSL 命令失败: ${msg}`);
}

export class SharedSessionBridge {
  private readonly exec: BridgeExec;
  private readonly targets: TmuxSessionTargets;
  private readonly snapshots = new Map<string, string>();

  constructor(params: { exec?: BridgeExec; targets: TmuxSessionTargets }) {
    this.exec = params.exec ?? runExec;
    this.targets = params.targets;
  }

  async sendInput(params: { tool: "cc" | "cx"; text: string }): Promise<void> {
    const target = this.mustGetTarget(params.tool);
    let result: ExecResult;
    try {
      const spec = buildWslExecSpec(buildSendKeysArgs({ ...target, text: params.text }));
      result = await this.exec(spec);
    } catch (err) {
      throw normalizeExecError(err, target);
    }
    if (result.code !== 0) {
      throw new Error(normalizeTmuxError(result.stderr, target));
    }
  }

  async captureOutput(params: { tool: "cc" | "cx" }): Promise<string> {
    const target = this.mustGetTarget(params.tool);
    let result: ExecResult;
    try {
      const spec = buildWslExecSpec(buildCapturePaneArgs(target));
      result = await this.exec(spec);
    } catch (err) {
      throw normalizeExecError(err, target);
    }
    if (result.code !== 0) {
      throw new Error(normalizeTmuxError(result.stderr, target));
    }

    const key = this.targetKey(params.tool);
    const previous = this.snapshots.get(key) ?? "";
    const current = result.stdout;
    this.snapshots.set(key, current);
    return diffPaneOutput(previous, current);
  }

  private mustGetTarget(tool: "cc" | "cx") {
    const target = this.targets[tool];
    if (!target) {
      throw new Error(`No tmux target configured for tool: ${tool}`);
    }
    return target;
  }

  private targetKey(tool: "cc" | "cx"): string {
    return tool;
  }
}
