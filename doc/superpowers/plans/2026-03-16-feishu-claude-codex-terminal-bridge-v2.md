# 飞书控制本机 Claude Code / Codex 终端桥接 Implementation Plan v2

> **Goal:** 最小可用：飞书 ↔ Relay ↔ 本机 Agent ↔ PTY(cc/cx)，支持 `/cc` `/cx` `/mode safe|yolo` `/status` `/stop` `/reset` `/cwd`；`safe`=原生交互不自动确认，`yolo`=自动确认。

## 0) Repo 结构（npm workspaces）
- `apps/relay`：公网服务（HTTP webhook + WS）
- `apps/agent`：本机常驻（WS client + node-pty）
- `packages/protocol`：共享消息类型与校验

## 1) Protocol（先做）
- [ ] 定义 WS 消息：`agent_hello` / `input` / `output` / `control` / `status` / `heartbeat`
- [ ] 单测：协议解码与基本校验（Vitest）

## 2) Relay（公网）
- [ ] HTTP：飞书 webhook（验签、解析 command/text）
- [ ] WS：Agent 接入认证（token）
- [ ] 路由：`session_key = tenant_id + chat_id`，同 session 串行队列
- [ ] 输出回飞书：分片 + 限速 + 失败重试（最小可用）
- [ ] 审计：SQLite（input、mode 切换、output 摘要、错误）

## 3) Agent（本机）
- [ ] WS：连接 Relay，维护 session 状态（tool/mode/cwd/busy）
- [ ] PTY：用 `node-pty` 启动并常驻 `claude code` 与 `codex`
- [ ] 控制命令：`/stop`(Ctrl+C) `/reset`(重启 PTY) `/cwd`
- [ ] 模式：`safe` 不做自动确认；`yolo` 启用自动确认规则表（可配置）
- [ ] 输出：按块回传 Relay（streamId、isFinal）

## 4) 联调与文档
- [ ] `doc/runbook.md`：Relay 部署 + Agent 启动 + 飞书配置
- [ ] 冒烟：连续对话、工具切换、safe/yolo 行为、stop/reset、生效的 cwd

