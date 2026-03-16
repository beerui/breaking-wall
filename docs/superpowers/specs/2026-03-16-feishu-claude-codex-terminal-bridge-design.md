# 飞书控制本机 Claude Code / Codex 终端桥接（设计稿）

**日期：** 2026-03-16  
**目标：** 在飞书中用聊天指令，持续控制本机上的 `claude code` 与 `codex` CLI（连续上下文，不需要每条消息都写 `/cc`），并能手动切换工具与模式（`safe`/`yolo`）。

---

## 1. 背景与范围

### 1.1 要解决的问题
- 你在飞书里发消息 → 电脑本地的 CLI 工具（Claude Code / Codex）持续对话与执行 → 输出回飞书。
- 同一个会话需要“不中断”的连续上下文（交互式 TTY / PTY 常驻）。
- 需要显式控制模式：
  - `safe`：**软拦截**（仍把消息发给工具，但强制加前缀提示“只解释不执行”）
  - `yolo`：允许执行，并自动通过工具里的确认提示（不自动超时降级，由你手动切回）
- 工具切换：只要发一次 `/cc` 或 `/cx`，后续默认沿用，直到再次切换。

### 1.2 非目标（本期不做/不承诺）
- 复杂的多人协作编辑与合并（群聊多人共享同一个上下文的冲突管理）。
- 把任意 GUI 操作远程化（本期以终端交互为主）。
- 自动化“智能选择 cc/cx”的自然语言路由（你选择命令式 A 方案）。

---

## 2. 用户体验（飞书侧）

### 2.1 基本规则
- **普通文本**：默认发给当前工具（`cc` 或 `cx`）的持续会话。
- **斜杠命令**：改变会话状态或控制执行。

### 2.2 斜杠命令
- 工具切换：`/cc`、`/cx`
- 模式：`/mode safe`、`/mode yolo`
- 状态：`/status`（当前工具、模式、cwd、是否忙、队列长度）
- 中断：`/stop`（向 PTY 发送 Ctrl+C）
- 重置：`/reset`（重启当前工具 PTY，清空上下文）
- 工作目录：`/cwd <path>`（建议限制在允许根目录下，如 `D:\2026\`）

### 2.3 输出策略
- 工具输出按块回传（分片、限速），避免飞书消息长度限制与刷屏。
- 超长输出可折叠：先回“摘要 + 前 N 行”，并提示用 `/more`（可选扩展）继续。

---

## 3. 会话与隔离

### 3.1 会话键（session_key）
建议在中转层把飞书消息映射为稳定的 `session_key`：
- 私聊：`tenant_id + chat_id`
- 群聊：建议默认按“发消息的 user_id”隔离：`tenant_id + chat_id + user_id`
  - 这样可避免多人把同一个 PTY 上下文搅乱
  - 若未来需要“共享会话”，再做显式 `/share` 机制（非本期）

### 3.2 会话状态
每个 `session_key` 维护：
- `currentTool`: `"cc"` | `"cx"`
- `mode`: `"safe"` | `"yolo"`
- `cwd`: string
- `busy`: boolean（当前是否在输出流中）
- `queueDepth`: number（串行队列长度）

---

## 4. 系统架构

### 4.1 组件
1) **公网中转服务（Relay）**：Node.js/TS
- 飞书事件回调接入、验签/鉴权、路由与队列、审计日志
- 与本地 Agent 保持 WebSocket 长连接

2) **本地 Agent**：Node.js/TS（Windows 常驻进程）
- 维护交互式 PTY 会话：`claude code` 与 `codex`（各 1 个常驻进程，必要时重启）
- 执行“safe 前缀注入 / yolo 自动确认 / stop/reset/cwd”等逻辑
- 输出回传 Relay，再由 Relay 回飞书

3) **飞书 Bot**
- Relay 代表 Bot 调用飞书“发送消息”接口回传输出

### 4.2 数据流（高层）
飞书 → Relay（HTTP 回调）→ Relay（解析/路由/排队）→ Agent（WS 下发 input）→ PTY（cc/cx）→ Agent（读 stdout/stderr）→ Relay（WS 上送 output）→ 飞书（Bot 发消息）

---

## 5. Relay ↔ Agent 通信协议（WS）

### 5.1 认证
- Agent 启动后用 `AGENT_ID` + `AGENT_TOKEN` 连接 Relay。
- Relay 校验 token（建议支持轮换），并把 agent 标记为在线。

### 5.2 消息类型（建议 JSON）
- `agent_hello`
  - `{type:"agent_hello", agentId, token, capabilities:{cc:true,cx:true}}`
- `input`
  - `{type:"input", sessionKey, msgId, tool:"cc"|"cx", mode:"safe"|"yolo", cwd, text}`
- `output`
  - `{type:"output", sessionKey, msgId, streamId, chunk, isFinal}`
- `control`
  - `{type:"control", sessionKey, action:"stop"|"reset"|"status"|"cwd", ...}`
- `status`
  - `{type:"status", sessionKey, tool, mode, cwd, busy, queueDepth}`
- `heartbeat`

### 5.3 串行与幂等
- Relay 对每个 `sessionKey` 串行队列：同一会话一次只推一个 `input` 给 Agent。
- `msgId` 用于幂等与排查：Relay 可去重；Agent 可忽略已处理 msgId。

---

## 6. 模式语义（safe / yolo）

### 6.1 safe（软拦截）
策略：**仍转发文本给当前工具**，但在每次转发前注入强制前缀（系统提示）：
- “你处于 SAFE 模式：只允许解释、规划、阅读输出；不允许执行命令、不允许写文件/安装依赖/修改系统设置。若需要执行，请用户显式切换到 /mode yolo。”

说明：这不是强安全隔离，只是降低误执行概率；真正的安全边界仍应由“cwd 限制 + 账号权限 + 机器隔离”提供。

### 6.2 yolo
- 允许执行/写文件/运行命令。
- Agent 启用“自动确认”：
  - 对 PTY 输出中出现的常见确认提示（可配置规则表）自动写入响应（如 `y\n`、`yes\n`）。
  - 对明显危险的确认提示是否也自动通过：本期按你的要求“yolo 全放行”。

---

## 7. 安全与审计

### 7.1 访问控制
- Relay：只允许 allowlist 的飞书 `user_id` 使用控制能力（至少先做你自己的账号）。
- Agent：使用 token 认证；Relay 只把会话路由给已认证 agent。

### 7.2 限制与隔离（建议）
- `cwd` 限制：只允许落在配置的 `WORK_ROOTS`（例如 `D:\2026\`）。
- 最小权限原则：本机运行 Agent 的账号尽量不要是管理员账号（除非你明确需要）。

### 7.3 审计日志（Relay 落库）
- 输入：谁（user_id）在何时对哪个 session 发了什么（含命令/模式切换）。
- 输出：每条输出的摘要（长度、hash、前后若干字符）与错误信息。
- 便于追溯“什么时候开了 yolo、执行了什么”。

---

## 8. 可观测性与可靠性
- Relay：
  - 请求日志、WS 连接状态、队列长度、失败重试（飞书发消息失败重试）
- Agent：
  - PTY 进程存活、崩溃自动重启、断线自动重连
- 输出节流：避免同一会话输出过快导致飞书限流或刷屏

---

## 9. 部署建议
- Relay：云主机/容器（HTTPS + WS，同域名），配置飞书事件回调地址。
- Agent：本机常驻（Windows 任务计划/服务/手动启动均可），通过环境变量配置 Relay 地址与 token。

---

## 10. 风险与对策（摘要）
- safe 为软拦截：仍可能被工具误执行 → 通过 cwd 限制/账号隔离/审计降低风险。
- 群聊多人并发：上下文冲突 → 默认按 user_id 隔离 sessionKey。
- 输出超限：分片/限速/折叠。

---

## 11. 未决问题（后续可选）
- 是否需要 `/more`、`/tail`、`/files` 等辅助命令？
- 是否需要把“会话状态”在飞书里置顶展示（卡片消息）？
- 是否需要支持多台电脑/多 agent（通过 agentId 路由）？

