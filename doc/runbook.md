# 飞书控制本机 Claude Code / Codex（部署与使用文档）

这套系统由三部分组成：
- **飞书应用/Bot**：接收你在飞书里的消息事件，并把输出回发到飞书。
- **Relay（公网中转服务）**：HTTP 接收飞书 webhook；WS 接收本机 Agent；负责路由、会话状态、审计。
- **Agent（本机常驻）**：与 Relay 建立 WS 连接；支持两种运行模式：
  - **PTY 模式**（默认）：在本机启动并维持 `claude code` 与 `codex` 的交互式 PTY 会话。
  - **tmux 共享会话模式**：通过 WSL 连接已有的 tmux 会话，本地终端与飞书共享同一上下文。

本项目的关键行为（按你要求）：
- 群聊/私聊默认 **不做 user 隔离**，同一个 `chat_id` 对应一个持续会话上下文。
- `/mode safe`：**允许直接执行**，但**不自动确认**（遇到确认提示时，你继续在飞书输入 `y/n/...`）。
- `/mode yolo`：允许执行 + **自动确认**（Agent 自动输入 `y/yes`）。

---

## 1. 你将得到什么

当部署完成后：
- 你在飞书里发普通文本，默认会作为输入写入当前工具（`cc` 或 `cx`）的 PTY，会话上下文持续保留。
- 你只需发一次 `/cc` 或 `/cx` 切换工具，后续普通文本一直沿用，直到再次切换。

---

## 2. 目录与入口

- Relay 入口：`apps/relay/src/server.ts`
  - 飞书 webhook：`POST /feishu/webhook`
  - Agent WebSocket：`GET /agent`（WS）
- Agent 入口：`apps/agent/src/main.ts`

---

## 3. 前置条件
### npm 版本要求（重要）
本仓库使用 npm workspaces（不再依赖 `workspace:*` 协议）。
- 如果你执行 `npm i` 仍失败，请先运行 `npm config get workspaces`（应为 `true`），并把 npm debug log 发我定位。
### 3.1 本机（运行 Agent）
- Windows（当前代码以 Windows 为主，PTY 用 `cmd.exe` 启动）
- Node.js 20+（含 npm；要求 npm >= 7，推荐 npm 9+/10+）
- 你本机已能在终端运行：
  - `claude code`（或你自己的启动命令）
  - `codex`（或你自己的启动命令）

> 说明：`node-pty` 在 Windows 上如果没有预编译包，可能需要 VS Build Tools 才能编译原生依赖。

### 3.2 公网服务器（运行 Relay）
- Node.js 20+（含 npm；要求 npm >= 7，推荐 npm 9+/10+）
- 一个域名或公网 IP
- HTTPS（强烈建议；飞书回调通常要求 HTTPS）
  - 你可以用 Nginx/Caddy/云厂商 HTTPS 负载均衡做 TLS 终止

### 3.3 飞书侧（创建应用）
- 企业自建应用
- 事件订阅：至少需要 `im.message.receive_v1`
- Bot 发消息权限（用于回发输出）

---

## 4. 飞书侧配置（推荐先用“非加密回调”跑通）

1) 创建应用并添加机器人（Bot）

2) 打开事件订阅
- 订阅事件：`im.message.receive_v1`
- 回调地址（指向 Relay）：
  - `https://<your-relay-domain>/feishu/webhook`

3) URL 验证（飞书会发 challenge）
- 当前 Relay 会处理 `url_verification` 并按飞书要求返回 challenge。

4) （可选）加密方式（Encrypt Key）
- 如果你在飞书开启了“加密方式”，Relay 需要配置 `FEISHU_ENCRYPT_KEY`。
- 当前实现会在收到 `encrypt` 字段时校验 `x-lark-signature` 并解密。
- 若你发现验签或解密与飞书实际不一致，请以飞书官方文档为准调整实现。

---

## 5. Relay 部署\n\n> 说明：仓库根目录 
pm install 会自动执行 postinstall，构建 @bw/protocol 的 dist/（否则运行时会找不到 dist/index.js）。\n\n## 5. Relay 部署

### 5.1 配置环境变量
复制示例：
- `apps/relay/.env.example` → `apps/relay/.env`

关键变量说明：
- `RELAY_PORT`：监听端口（默认 8787）
- `AGENT_TOKENS`：允许哪些 Agent 连接，格式 `agentId=token;agentId2=token2`
- `ALLOWED_FEISHU_USER_IDS`：允许操作的飞书 user_id（空=不限制；建议只填你自己）
- `WORK_ROOTS`：允许 `/cwd` 切换到的根目录列表（逗号或空格分隔）
- `AUDIT_JSONL_PATH`：审计 JSONL 文件路径（默认 `./var/audit.jsonl`）
- `FEISHU_APP_ID`/`FEISHU_APP_SECRET`：用于 Relay 调用飞书 API 回发消息

### 5.2 安装依赖与启动
在服务器上：
- 安装依赖：`npm install`
- 开发启动：`npm -w apps/relay run dev`
- 生产启动（示例）：
  - `npm -w apps/relay run build`
  - `node apps/relay/dist/server.js`

### 5.3 反向代理（Nginx 示例）
如果你用 Nginx 做 TLS 终止，需要支持 WebSocket Upgrade：

```nginx
server {
  listen 443 ssl;
  server_name your-relay-domain;

  # ssl_certificate ...;
  # ssl_certificate_key ...;

  location /feishu/webhook {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }

  location /agent {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "Upgrade";
    proxy_set_header Host $host;
  }
}
```

---

## 6. Agent（本机）部署与启动

### 6.1 配置环境变量
复制示例：
- `apps/agent/.env.example` → `apps/agent/.env`

关键变量说明：
- `RELAY_WS_URL`：Relay 的 WS 地址（例：`wss://<your-relay-domain>/agent`）
- `AGENT_ID`/`AGENT_TOKEN`：必须与 Relay 的 `AGENT_TOKENS` 匹配
- `CC_CMDLINE`：启动 Claude Code 的命令行（默认 `claude code`）
- `CX_CMDLINE`：启动 Codex 的命令行（默认 `codex`）
- `WORK_ROOTS`：建议与 Relay 一致（虽然当前约束主要在 Relay）

### 6.2 安装依赖与启动
在本机：
- 安装依赖：`npm install`
- 启动：`npm -w apps/agent run dev`

（可选）常驻方式：
- Windows 任务计划：开机启动 `npm -w apps/agent run dev`
- 或用你喜欢的进程管理器（注意把 `.env` 环境带上）

---

## 7. 飞书内使用说明

### 7.1 工具切换（持续生效）
- `/cc`：切到 Claude Code
- `/cx`：切到 Codex

### 7.2 模式
- `/mode safe`：不自动确认（但仍允许执行）
- `/mode yolo`：自动确认（Agent 会对常见 `y/n`、`are you sure` 等提示自动回复）

### 7.3 会话控制
- `/status`：显示当前 tool/mode/cwd（并向 Agent 请求 status）
- `/stop`：中断当前执行（Ctrl+C）
- `/reset`：重启当前工具的 PTY（清空上下文）
- `/cwd <path>`：切换工作目录（必须在 `WORK_ROOTS` 内）

### 7.4 交互确认（safe 模式）
当工具输出类似：
- `Continue? (y/n)`

你在飞书里直接回复：
- `y` 或 `n`

（注意不要以 `/` 开头，否则会被当成命令解析。）

---

## 8. 安全建议（非常重要）

因为你要求 `safe` 也“直接执行”，请务必做好这些安全边界：
- **强约束 WORK_ROOTS**：只允许在一个安全目录树内操作（例如 `D:/2026`）。
- **Relay 做 allowlist**：`ALLOWED_FEISHU_USER_IDS` 只填你自己的 user_id。
- **Agent 使用非管理员账号运行**：把系统破坏面降到最低。
- **审计留痕**：保留 `AUDIT_JSONL_PATH`，必要时做备份/轮转。
- **公网面最小化**：只暴露 `POST /feishu/webhook` 与 `GET /agent`。

---

## 9. 故障排查\n\n### 9.0 Agent 启动后立刻退出/dev 失败\n- 现在 Agent 会打印 WS 连接错误与自动重连日志（[agent] ws error / [agent] ws closed）。\n- 先确保 Relay 已启动，并且 pps/agent/.env 的 RELAY_WS_URL 指向正确的 ws:// 或 wss:// 地址。\n\n## 9. 故障排查

### 9.1 Agent 连不上 Relay
- 检查 Relay 是否启动并监听端口
- 检查 `RELAY_WS_URL` 是否可访问（公网需用 `wss://`）
- 检查 `AGENT_ID/AGENT_TOKEN` 是否与 Relay 的 `AGENT_TOKENS` 匹配

### 9.2 飞书发消息没回显
- Relay 需要 `FEISHU_APP_ID/FEISHU_APP_SECRET` 才能回发
- 检查飞书事件订阅是否订阅了 `im.message.receive_v1`
- 检查回调地址是否正确，是否能访问到 Relay
- 查看 Relay 日志与 `AUDIT_JSONL_PATH`

### 9.3 `/cwd` 报“不在允许的 WORK_ROOTS 内”
- 检查 Relay 的 `WORK_ROOTS`
- Windows 路径建议用 `D:/2026/...` 或 `D:\\2026\\...`，确保解析一致

### 9.4 yolo 自动确认不生效
- 仅在 `/mode yolo` 下启用
- 当前规则在 `apps/agent/src/modes/yoloAutoConfirm.ts`
  - 如果某些提示匹配不到，把实际提示文本加到规则里（正则/关键词）

---

## 10. 下一步可增强（可选）
- 输出更智能：合并短 chunk、对超长输出做”继续输出”指令
- 更强的并发/队列：严格把同一会话输入串行化（Relay 侧已预留队列模块，但当前 server.ts 还没接入）
- 更完善的会话状态持久化（把 sessions 写入 SQLite，而不是内存）
- 多 Agent 支持（多台电脑，按 agentId 路由）

---

## 11. tmux 共享会话模式（替代 PTY）

tmux 模式让本地终端与飞书共享同一个 `cc/cx` 上下文。你在本地 `tmux attach` 能看到飞书发来的输入和工具输出，反之亦然。

### 11.1 前置条件
- Windows 上需要安装 WSL（Agent 通过 `wsl.exe` 调用 tmux）
- WSL 内安装 tmux：
  ```bash
  sudo apt-get update && sudo apt-get install -y tmux
  ```

### 11.2 创建共享会话
在 WSL 终端中创建两个 tmux 会话，分别运行 cc 和 cx：

```bash
# 创建 codex 会话
tmux new-session -d -s bw-cx
tmux send-keys -t bw-cx “codex” C-m

# 创建 claude code 会话
tmux new-session -d -s bw-cc
tmux send-keys -t bw-cc “claude” C-m
```

本地查看/操作：
```bash
tmux attach -t bw-cx   # 查看 codex 会话
tmux attach -t bw-cc   # 查看 claude code 会话
# Ctrl+B D 退出 attach（不会关闭会话）
```

### 11.3 Agent 配置
在 `apps/agent/.env` 中添加：
```env
# tmux 共享会话映射（设置后自动启用 tmux 模式，不再使用 PTY）
TMUX_SESSION_TARGETS=cc=bw-cc:0;cx=bw-cx:0
```

格式：`tool=session_name:pane_index`，多个用 `;` 分隔。

### 11.4 Relay 配置
在 `apps/relay/.env` 中添加：
```env
# 设为 tmux 后，/mode 和 /cwd 命令将被禁用
TRANSPORT_MODE=tmux
```

### 11.5 tmux 模式下的命令差异
| 命令 | PTY 模式 | tmux 模式 |
|------|----------|-----------|
| `/cc` `/cx` | 切换工具 | 切换工具 |
| `/status` | 显示 tool/mode/cwd | 显示 tool + tmux target |
| `/stop` | 发送 Ctrl+C | 发送 Ctrl+C |
| `/reset` | 重启 PTY | 仅重置 relay 状态，tmux 会话不受影响 |
| `/mode` | 切换 safe/yolo | 不支持（共享会话下无意义） |
| `/cwd` | 切换工作目录 | 不支持（请在 tmux 会话中直接操作） |

### 11.6 清理会话
```bash
wsl.exe bash -lc “tmux kill-session -t bw-cx || true”
wsl.exe bash -lc “tmux kill-session -t bw-cc || true”
```



## 常见安装问题

### 1) `tsx` 不是内部或外部命令
原因：`tsx` 在 `apps/*` 里是 **devDependencies**。如果你安装时省略了 dev 依赖（例如 `NODE_ENV=production`、或 `npm i --omit=dev`），就会导致运行 `npm run dev:*` 找不到 `tsx`。

排查：
- `echo $env:NODE_ENV`
- `npm config get omit`

修复：在仓库根目录重新安装（确保包含 dev 依赖）：
- `npm i --include=dev`

安装完成后自检：
- `dir node_modules\.bin\tsx*`



### 9.5 Relay 启动报 Fastify 插件版本不匹配
如果你看到类似：
- `@fastify/websocket - expected '5.x' fastify version, '4.x' is installed`

说明依赖版本没对齐。解决方式：
- 在仓库根目录执行 `npm i` 重新安装依赖（确保 `apps/relay/package.json` 里 fastify 与 `@fastify/websocket` 主版本匹配）。

### 9.6 Agent 反复 `ws closed code=1006`
这通常表示 Relay 端在 WebSocket 握手/消息处理时抛错导致连接异常断开。
- 先看 Relay 终端日志里是否有 stack trace。
- 常见原因：`@fastify/websocket` 使用方式与 fastify 主版本不一致。

### 9.7 Agent 出现大量重复 `connected`
正常情况下一个 Agent 应该只维持 1 条 WS 连接。
- 现在 Agent 会打印 `reconnect scheduled`，用于确认是否在异常重连。
- 如果 Relay 日志里短时间出现大量 `[relay] ws connected`，请重启 Agent，确保只跑了一个 `npm run dev:agent` 进程。


