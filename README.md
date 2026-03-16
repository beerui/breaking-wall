# breaking-wall

飞书聊天控制本机 `claude code` / `codex` 的桥接系统（Relay + Agent + PTY 常驻）。

- 文档：`doc/runbook.md`
- v2 设计：`doc/superpowers/specs/2026-03-16-feishu-claude-codex-terminal-bridge-design-v2.md`
- v2 计划：`doc/superpowers/plans/2026-03-16-feishu-claude-codex-terminal-bridge-v2.md`

## Quickstart（本地联调）
1) 配置 Relay：复制 `apps/relay/.env.example` 为 `apps/relay/.env`
2) 配置 Agent：复制 `apps/agent/.env.example` 为 `apps/agent/.env`
3) `npm install`
4) 启动 Relay：`npm -w apps/relay run dev`
5) 启动 Agent：`npm -w apps/agent run dev`

然后在飞书里把事件订阅回调指向 Relay 的 `/feishu/webhook`。

## Requirements
- Node.js 20+（npm >= 7；推荐 npm 9+/10+）

如果 `npm i` 报错 `Unsupported URL Type "workspace:"`，请升级 Node.js/npm。

## Troubleshooting
- 如果 `npm run dev:agent` 报 `tsx` 不存在：请确认没有用 `--omit=dev` 安装，并执行 `npm i --include=dev`。
