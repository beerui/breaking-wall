# Feishu Shared tmux Bridge Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有“飞书 -> Relay -> Agent -> PTY”桥接改为“飞书 -> Relay -> Agent -> WSL/tmux 共享会话”，让本地终端与飞书共享同一 `cc/cx` 上下文。

**Architecture:** 保留 Relay 的飞书接入、鉴权、审计与路由职责，Agent 不再创建长期 `node-pty` 会话，而是通过 `wsl.exe` 调用 `tmux` 将输入注入共享 pane，并抓取 pane 输出增量回传。首期只支持固定的 `cc/cx` 共享会话映射，并收敛命令集到 `/cc` `/cx` `/status` `/reset`。

**Tech Stack:** TypeScript, Fastify, WebSocket, WSL, tmux, Vitest

---

## Chunk 1: Remove PTY-Centric Runtime From Agent

### Task 1: Add tmux session mapping config

**Files:**
- Modify: `apps/agent/src/config.ts`
- Modify: `apps/agent/.env.example`
- Modify: `apps/agent/.env`
- Test: `apps/agent/src/config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { parseSessionTargets } from "./config.js";

describe("parseSessionTargets", () => {
  test("parses cc/cx tmux session targets", () => {
    expect(parseSessionTargets("cc=bw-cc:0;cx=bw-cx:1")).toEqual({
      cc: { session: "bw-cc", pane: "0" },
      cx: { session: "bw-cx", pane: "1" }
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w apps/agent test -- src/config.test.ts`
Expected: FAIL because `parseSessionTargets` does not exist

- [ ] **Step 3: Write minimal implementation**

Add config parsing for a new env var such as `TMUX_SESSION_TARGETS=cc=bw-cc:0;cx=bw-cx:0`, and expose a typed mapping object.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w apps/agent test -- src/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/config.ts apps/agent/src/config.test.ts apps/agent/.env.example apps/agent/.env
git commit -m "feat(agent): add tmux session target config"
```

### Task 2: Introduce a tmux command adapter

**Files:**
- Create: `apps/agent/src/tmux/tmuxClient.ts`
- Create: `apps/agent/src/tmux/tmuxClient.test.ts`
- Reference: `apps/agent/src/config.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { buildSendKeysArgs, buildCapturePaneArgs } from "./tmuxClient.js";

describe("tmux command builders", () => {
  test("builds send-keys command for a pane", () => {
    expect(buildSendKeysArgs({ session: "bw-cx", pane: "0", text: "hi" })).toEqual([
      "tmux", "send-keys", "-t", "bw-cx:0", "hi", "C-m"
    ]);
  });

  test("builds capture-pane command for a pane", () => {
    expect(buildCapturePaneArgs({ session: "bw-cx", pane: "0" })).toEqual([
      "tmux", "capture-pane", "-p", "-t", "bw-cx:0"
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w apps/agent test -- src/tmux/tmuxClient.test.ts`
Expected: FAIL because file/module does not exist

- [ ] **Step 3: Write minimal implementation**

Implement pure helpers for:
- target formatting (`session:pane`)
- `send-keys`
- `capture-pane`
- `has-session`

Do not execute commands yet; keep this task focused on deterministic command construction.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w apps/agent test -- src/tmux/tmuxClient.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/tmux/tmuxClient.ts apps/agent/src/tmux/tmuxClient.test.ts
git commit -m "feat(agent): add tmux command adapter"
```

### Task 3: Add WSL shell executor for tmux commands

**Files:**
- Create: `apps/agent/src/tmux/wslExec.ts`
- Create: `apps/agent/src/tmux/wslExec.test.ts`
- Reference: `apps/agent/src/tmux/tmuxClient.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w apps/agent test -- src/tmux/wslExec.test.ts`
Expected: FAIL because module does not exist

- [ ] **Step 3: Write minimal implementation**

Implement:
- shell escaping for tmux args
- `wsl.exe` execution spec builder
- a small command runner using `node:child_process`

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w apps/agent test -- src/tmux/wslExec.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/tmux/wslExec.ts apps/agent/src/tmux/wslExec.test.ts
git commit -m "feat(agent): add WSL executor for tmux commands"
```

---

## Chunk 2: Build Shared-Session Bridge Runtime

### Task 4: Replace PTY stream pool with tmux-backed bridge service

**Files:**
- Create: `apps/agent/src/tmux/sharedSessionBridge.ts`
- Create: `apps/agent/src/tmux/sharedSessionBridge.test.ts`
- Modify: `apps/agent/src/wsClient.ts`
- Reference: `apps/agent/src/sessionQueue.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test, vi } from "vitest";
import { SharedSessionBridge } from "./sharedSessionBridge.js";

describe("SharedSessionBridge", () => {
  test("sends input to configured tmux pane", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "", code: 0 });
    const bridge = new SharedSessionBridge({ exec, targets: { cx: { session: "bw-cx", pane: "0" } } });

    await bridge.sendInput({ tool: "cx", text: "hi" });

    expect(exec).toHaveBeenCalledWith(expect.objectContaining({
      file: "wsl.exe"
    }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w apps/agent test -- src/tmux/sharedSessionBridge.test.ts`
Expected: FAIL because module does not exist

- [ ] **Step 3: Write minimal implementation**

Implement a bridge that can:
- resolve target by tool
- verify session existence
- send input using `tmux send-keys`
- return structured errors instead of throwing opaque text

Do not add output diffing in this task.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w apps/agent test -- src/tmux/sharedSessionBridge.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/tmux/sharedSessionBridge.ts apps/agent/src/tmux/sharedSessionBridge.test.ts apps/agent/src/wsClient.ts
git commit -m "feat(agent): add shared tmux session bridge"
```

### Task 5: Add capture-pane output snapshots and diffing

**Files:**
- Create: `apps/agent/src/tmux/outputDiff.ts`
- Create: `apps/agent/src/tmux/outputDiff.test.ts`
- Modify: `apps/agent/src/tmux/sharedSessionBridge.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { diffPaneOutput } from "./outputDiff.js";

describe("diffPaneOutput", () => {
  test("returns only new trailing output", () => {
    expect(diffPaneOutput("hello\nworld\n", "hello\nworld\nnext\n")).toBe("next\n");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w apps/agent test -- src/tmux/outputDiff.test.ts`
Expected: FAIL because module does not exist

- [ ] **Step 3: Write minimal implementation**

Implement stable diffing for pane snapshots. Favor a simple suffix/overlap algorithm over a full diff engine.

Wire the bridge so each tool/session remembers the last sent pane snapshot and only emits newly captured output.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w apps/agent test -- src/tmux/outputDiff.test.ts src/tmux/sharedSessionBridge.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/tmux/outputDiff.ts apps/agent/src/tmux/outputDiff.test.ts apps/agent/src/tmux/sharedSessionBridge.ts
git commit -m "feat(agent): add tmux output diffing"
```

### Task 6: Surface explicit errors instead of silent timeouts

**Files:**
- Modify: `apps/agent/src/wsClient.ts`
- Modify: `apps/relay/src/server.ts`
- Test: `apps/agent/src/tmux/sharedSessionBridge.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("returns readable error when tmux session is missing", async () => {
  const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "no server running", code: 1 });
  const bridge = new SharedSessionBridge({ exec, targets: { cx: { session: "bw-cx", pane: "0" } } });

  await expect(bridge.sendInput({ tool: "cx", text: "hi" })).rejects.toThrow(/bw-cx/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w apps/agent test -- src/tmux/sharedSessionBridge.test.ts`
Expected: FAIL because missing-session errors are not normalized

- [ ] **Step 3: Write minimal implementation**

Normalize and surface these errors clearly:
- WSL missing
- tmux missing
- session missing
- pane missing
- capture failure

Ensure relay replies with the normalized message body.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w apps/agent test -- src/tmux/sharedSessionBridge.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/wsClient.ts apps/relay/src/server.ts apps/agent/src/tmux/sharedSessionBridge.ts apps/agent/src/tmux/sharedSessionBridge.test.ts
git commit -m "fix(agent): return explicit tmux bridge errors"
```

---

## Chunk 3: Align Relay Command Semantics With Shared Sessions

### Task 7: Remove or downgrade PTY-specific command behavior in relay

**Files:**
- Modify: `apps/relay/src/server.ts`
- Modify: `apps/relay/src/feishu/webhook.ts`
- Modify: `doc/runbook.md`
- Test: `apps/relay/src/server.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("status reply does not mention cwd when bridge runs in shared-session mode", async () => {
  // assert `/status` reflects tool + shared session binding only
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w apps/relay test -- src/server.test.ts`
Expected: FAIL because shared-session mode semantics are not implemented

- [ ] **Step 3: Write minimal implementation**

Update relay behavior:
- `/status` should report tool + bound tmux target
- `/reset` should mean re-probe shared session binding
- `/cwd` should return a clear "unsupported in shared-session mode" message
- `/mode safe|yolo` should return a clear "not enabled in shared-session mode" message or be hidden entirely

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w apps/relay test -- src/server.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/relay/src/server.ts apps/relay/src/feishu/webhook.ts apps/relay/src/server.test.ts doc/runbook.md
git commit -m "refactor(relay): align commands with shared tmux sessions"
```

### Task 8: Adjust protocol/state objects for shared-session status

**Files:**
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/index.test.ts`
- Modify: `apps/agent/src/wsClient.ts`
- Modify: `apps/relay/src/server.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("status schema includes shared session target info", () => {
  // parse status payload with target session + pane
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @bw/protocol test -- src/index.test.ts`
Expected: FAIL because protocol lacks shared target fields

- [ ] **Step 3: Write minimal implementation**

Extend status payload to include shared target metadata such as:
- `targetSession`
- `targetPane`
- `transport: "tmux"`

Keep the schema change minimal and update agent/relay accordingly.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @bw/protocol test -- src/index.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/index.ts packages/protocol/src/index.test.ts apps/agent/src/wsClient.ts apps/relay/src/server.ts
git commit -m "feat(protocol): add shared tmux status fields"
```

---

## Chunk 4: Verification, Docs, and Manual Bring-Up

### Task 9: Document WSL/tmux setup and operator workflow

**Files:**
- Modify: `doc/runbook.md`
- Modify: `apps/agent/.env.example`
- Reference: `docs/superpowers/specs/2026-03-16-feishu-shared-tmux-bridge-design.md`

- [ ] **Step 1: Write the failing doc checklist**

Create a checklist in the task notes for the runbook to cover:
- WSL install prerequisite
- tmux install command
- how to create `bw-cc` / `bw-cx`
- how to attach locally
- how fly书 uses `/cc` `/cx`
- what is unsupported in v1

- [ ] **Step 2: Verify the doc gap exists**

Read: `doc/runbook.md`
Expected: current runbook still describes PTY-managed sessions, not shared `tmux`

- [ ] **Step 3: Write minimal documentation updates**

Add exact setup commands such as:

```bash
sudo apt-get update
sudo apt-get install -y tmux
tmux new -s bw-cx
codex
```

And the equivalent `bw-cc` flow.

- [ ] **Step 4: Review the updated docs**

Read the changed sections and confirm they no longer instruct users to rely on agent-created PTYs.

- [ ] **Step 5: Commit**

```bash
git add doc/runbook.md apps/agent/.env.example
git commit -m "docs: add shared tmux bridge setup guide"
```

### Task 10: Run end-to-end verification

**Files:**
- Reference: `apps/agent/src/tmux/sharedSessionBridge.ts`
- Reference: `apps/relay/src/server.ts`
- Reference: `doc/runbook.md`

- [ ] **Step 1: Run focused test suites**

Run:
```bash
npm -w @bw/protocol test
npm -w apps/agent test -- src/config.test.ts src/tmux/tmuxClient.test.ts src/tmux/wslExec.test.ts src/tmux/sharedSessionBridge.test.ts src/tmux/outputDiff.test.ts
npm -w apps/relay test
```

Expected: all relevant suites PASS

- [ ] **Step 2: Build the changed packages**

Run:
```bash
npm -w @bw/protocol run build
npm -w apps/agent run build
npm -w apps/relay run build
```

Expected: all builds exit 0

- [ ] **Step 3: Manual WSL/tmux smoke test**

Run locally:
```bash
wsl.exe bash -lc "tmux new-session -d -s bw-cx 'bash -lc \"codex\"'"
wsl.exe bash -lc "tmux new-session -d -s bw-cc 'bash -lc \"claude\"'"
```

Then:
- start relay
- start agent
- in Feishu send `/cx`
- send `hi`
- verify the text appears in `tmux attach -t bw-cx`
- verify Feishu receives new output

- [ ] **Step 4: Clean up the smoke sessions**

Run:
```bash
wsl.exe bash -lc "tmux kill-session -t bw-cx || true"
wsl.exe bash -lc "tmux kill-session -t bw-cc || true"
```

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "test: verify shared tmux bridge end to end"
```
