# 飞书控制本机 Claude Code / Codex 终端桥接（设计稿 v2）

**日期：** 2026-03-16  
**Goal：** 飞书聊天持续控制本机 `claude code` / `codex` CLI（PTY 常驻、连续上下文），通过 `/cc` `/cx` 切换工具，通过 `/mode safe|yolo` 控制“是否自动确认”。

## 核心约束（按你最新要求）
- 群聊/私聊都假设只有你一个人使用：**不做 user_id 隔离**，同一个 `chat_id` 只有一个会话上下文。
- `safe`：**直接执行**、不注入任何“只解释/不执行”的提示；**不自动确认**（原生交互，由你继续在飞书里输入 `y/n/...`）。
- `yolo`：直接执行 + **自动确认**（不自动降级，你手动切回）。

## 飞书指令
- `/cc` `/cx`：切换当前工具（持续生效）
- `/mode safe|yolo`
- `/status`：工具/模式/cwd/忙碌/队列
- `/stop`：Ctrl+C
- `/reset`：重启当前工具 PTY
- `/cwd <path>`：设置工作目录（建议限制在 `WORK_ROOTS`）

## 架构（推荐）
- Relay（公网，Node.js/TS）：飞书回调验签、会话路由、串行队列、审计、与 Agent 的 WS
- Agent（本机，Node.js/TS）：维护两条 `node-pty` 会话（cc/cx），转发输入与回传输出；yolo 自动确认

## session_key
- `session_key = tenant_id + chat_id`（群聊也一样）

## 风险提示
- 因为 `safe` 也允许执行，“安全”主要依赖 `cwd` 根目录限制、运行账号权限、审计日志；`yolo` 进一步放大风险（自动确认）。

