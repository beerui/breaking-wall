# 飞书控制本机 Claude Code / Codex 终端桥接 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个可用的“飞书聊天 → 公网 Relay → 本机 Agent → PTY(claude code/codex) → 输出回飞书”的最小系统，支持 `/cc` `/cx` `/mode safe|yolo` `/status` `/stop` `/reset` `/cwd`，并保持连续会话上下文。

**Architecture:** 单仓库 npm workspaces，`apps/relay`（公网中转）+ `apps/agent`（本机常驻）。Relay 处理飞书回调/路由/队列/审计，Agent 维护两个 `node-pty` 会话并进行 safe 前缀注入与 yolo 自动确认。

**Tech Stack:** Node.js 20+, TypeScript, WebSocket, `node-pty`, Fastify(HTTP), SQLite(Postgres 可替换), Vitest

---

## Chunk 1: Repo & Shared Protocol

### Task 1: 初始化仓库结构（workspaces）

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `apps/relay/package.json`
- Create: `apps/agent/package.json`
- Create: `packages/protocol/src/index.ts`
- Test: `packages/protocol/src/index.test.ts`

- [ ] **Step 1: 定义消息协议类型（protocol 包）**
- [ ] **Step 2: 为 protocol 写基础单测（schema/类型约束）**
- [ ] **Step 3: 初始化 workspaces 与 TS 构建脚本**
- [ ] **Step 4: 运行 protocol 测试**
  - Run: `npm -w packages/protocol test`
  - Expected: PASS

---

## Chunk 2: Relay（公网中转服务）

### Task 2: Relay 基础服务（HTTP + WS）

**Files:**
- Create: `apps/relay/src/server.ts`
- Create: `apps/relay/src/ws.ts`
- Create: `apps/relay/src/config.ts`
- Test: `apps/relay/src/ws.test.ts`

- [ ] **Step 1: 提供 WS endpoint（Agent 连接）**
  - Agent 连接后发送 `agent_hello` 完成认证
- [ ] **Step 2: 实现 sessionKey 串行队列（内存版）**
- [ ] **Step 3: 为 WS 路由与队列写单测**
- [ ] **Step 4: 跑 relay 测试**

### Task 3: 飞书回调接入（验签 + 解析 + 回发）

**Files:**
- Create: `apps/relay/src/feishu/webhook.ts`
- Create: `apps/relay/src/feishu/signature.ts`
- Create: `apps/relay/src/feishu/send.ts`
- Test: `apps/relay/src/feishu/signature.test.ts`

- [ ] **Step 1: 实现飞书回调验签（按飞书文档算法）**
- [ ] **Step 2: 解析消息为 command / text**
- [ ] **Step 3: 把 input 路由给对应 agent（WS 下发）**
- [ ] **Step 4: 接收 agent output 并回发飞书消息**
- [ ] **Step 5: 失败重试与限速（最小可用）**

### Task 4: 审计日志（最小可用）

**Files:**
- Create: `apps/relay/src/audit/db.ts`
- Create: `apps/relay/src/audit/migrations.sql`
- Create: `apps/relay/src/audit/log.ts`

- [ ] **Step 1: SQLite 落库（inputs/outputs/mode switches/errors）**
- [ ] **Step 2: 在关键路径写入审计**

---

## Chunk 3: Agent（本机常驻）

### Task 5: Agent 连接 Relay（WS + session 状态）

**Files:**
- Create: `apps/agent/src/main.ts`
- Create: `apps/agent/src/ws.ts`
- Create: `apps/agent/src/session/state.ts`
- Test: `apps/agent/src/session/state.test.ts`

- [ ] **Step 1: Agent 启动连接 Relay，发送 `agent_hello`**
- [ ] **Step 2: 维护 session 状态（tool/mode/cwd/busy）**
- [ ] **Step 3: 处理 `/cc /cx /mode /cwd /status` 等 control**

### Task 6: PTY 管理（claude code / codex）

**Files:**
- Create: `apps/agent/src/pty/ptyManager.ts`
- Create: `apps/agent/src/pty/prompts.ts`
- Test: `apps/agent/src/pty/prompts.test.ts`

- [ ] **Step 1: 引入 `node-pty`，启动两个常驻进程（命令可配置）**
- [ ] **Step 2: input 写入对应 PTY，stdout/stderr 读出并回传 Relay**
- [ ] **Step 3: `/stop` 发送 Ctrl+C；`/reset` 重启 PTY**

### Task 7: 模式实现（safe 软拦截 / yolo 自动确认）

**Files:**
- Create: `apps/agent/src/modes/safePrefix.ts`
- Create: `apps/agent/src/modes/yoloAutoConfirm.ts`
- Test: `apps/agent/src/modes/yoloAutoConfirm.test.ts`

- [ ] **Step 1: safe：对每次转发注入强制前缀**
- [ ] **Step 2: yolo：基于规则表检测确认提示并自动回复**
- [ ] **Step 3: 为自动确认写规则单测（输入输出样例）**

---

## Chunk 4: 端到端联调与发布

### Task 8: E2E 冒烟联调脚本与文档

**Files:**
- Create: `docs/runbook.md`
- Create: `apps/relay/.env.example`
- Create: `apps/agent/.env.example`

- [ ] **Step 1: 写运行手册（Relay 部署 + Agent 启动）**
- [ ] **Step 2: 冒烟测试清单**
  - `/status` 正常
  - 普通消息能持续对话
  - `/cc` `/cx` 切换有效
  - `/mode safe` 注入前缀生效
  - `/mode yolo` 自动确认生效（用可控示例验证）
  - `/stop` 可中断
  - `/reset` 重置会话

---

## 执行前置条件（你需要准备）
- 飞书：创建应用与 Bot，配置事件订阅回调到 Relay（公网 HTTPS），并开通发消息权限
- Relay：一台公网机器/容器，能提供 HTTPS + WebSocket
- Agent：本机已安装并能在终端运行 `claude code` 与 `codex`（命令路径写入配置）

