# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

breaking-wall 是一个飞书聊天控制本机 `claude code` / `codex` CLI 的桥接系统。通过 Relay（公网服务器）接收飞书 webhook，经 WebSocket 转发给本地 Agent，Agent 管理 PTY/tmux 会话执行 CLI 命令并回传输出。

消息流：`飞书 → Relay(/feishu/webhook) → WebSocket → Agent → PTY/tmux → 输出 → Relay → 飞书`

## Architecture

npm workspaces monorepo，三个包：

- **apps/relay** (`@bw/relay`) — Fastify 5 HTTP + WebSocket 服务，接收飞书事件、管理 Agent 连接、路由命令
- **apps/agent** (`@bw/agent`) — WebSocket 客户端，管理 node-pty 或 tmux 会话，执行 CLI 并回传输出
- **packages/protocol** (`@bw/protocol`) — Zod schema 定义所有消息类型（Input/Output/Control/Status），被 relay 和 agent 共同依赖

两种传输模式：
- **PTY 模式**（默认）：Agent 用 node-pty 生成独立终端进程
- **Tmux 共享模式**：连接 WSL 内已有 tmux session，本地终端和飞书共享上下文

## Common Commands

```bash
# 安装依赖（需要 Node.js 20+, npm >= 7）
npm install

# 全量构建（所有 workspace）
npm run build

# 全量测试
npm run test

# 单个 workspace 测试
npm -w apps/relay run test
npm -w apps/agent run test
npm -w packages/protocol run test

# 用 vitest 跑单个测试文件
npx -w apps/agent vitest run src/pty/ptyStream.test.ts

# 开发启动
npm run dev:relay    # 启动 Relay
npm run dev:agent    # 启动 Agent

# 单独构建 protocol（其他包的 predev 会自动触发）
npm -w @bw/protocol run build
```

## Key Technical Details

- TypeScript strict 模式，`ES2022` target，`NodeNext` module resolution
- `noUncheckedIndexedAccess: true` 和 `exactOptionalPropertyTypes: true` — 索引访问返回 `T | undefined`，可选属性不能赋 `undefined`
- ESM only（所有包 `"type": "module"`），导入需要 `.js` 扩展名
- 运行时校验用 Zod（`packages/protocol/src/index.ts` 定义所有消息 schema）
- 测试框架：Vitest
- dev 模式用 tsx 直接运行 TypeScript

## Key Source Files

- `packages/protocol/src/index.ts` — 所有消息类型的 Zod schema，修改协议从这里开始
- `apps/relay/src/server.ts` — Relay 入口，Fastify 路由和命令分发
- `apps/relay/src/ws.ts` — AgentHub，WebSocket 连接管理
- `apps/relay/src/feishu/webhook.ts` — 飞书事件解析（challenge/command/text）
- `apps/agent/src/wsClient.ts` — Agent WebSocket 客户端，消息处理和模式路由
- `apps/agent/src/pty/ptyManager.ts` — PTY 生命周期管理
- `apps/agent/src/pty/ptyStream.ts` — 输出流分块、idle 检测、finalization
- `apps/agent/src/tmux/sharedSessionBridge.ts` — Tmux 会话桥接

## Environment Configuration

Relay 和 Agent 各有独立 `.env`，参考 `.env.example`：
- `apps/relay/.env` — 端口、飞书凭证、Agent token、用户白名单、WORK_ROOTS、TRANSPORT_MODE
- `apps/agent/.env` — Relay WS 地址、Agent 凭证、CLI 命令行、tmux targets、流控参数
