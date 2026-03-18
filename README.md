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

## 飞书命令使用指南

### 基础命令
- `/help` - 显示帮助信息
- `/cc` - 切换到 Claude Code
- `/cx` - 切换到 Codex
- `/status` - 查看当前会话状态

### 控制命令
- `/stop` - 发送 Ctrl+C 中断当前执行
- `/enter` - 发送回车键（用于确认提示）
- `/reset` - 重置当前会话

### 模式切换
- `/mode safe` - 切换到安全模式（需要确认每个操作）
- `/mode yolo` - 切换到 YOLO 模式（自动执行）

### PTY 模式专用
- `/cwd <path>` - 切换工作目录

### Tmux 模式专用
- `/start [cc|cx]` - 启动 tmux session 并运行 CLI
- `/tab` - 发送 Tab 键（用于修改命令）
- `/esc` - 发送 Esc 键（用于取消操作）
- `/ctrl+o` - 发送 Ctrl+O（用于展开内容）
- `/up` - 发送向上箭头（用于选择选项）
- `/down` - 发送向下箭头（用于选择选项）

### Tmux 常用操作

**会话管理：**
```bash
# 创建新会话
tmux new -s bw-cc

# 列出所有会话
tmux ls

# 附加到会话
tmux attach -t bw-cc

# 分离会话（在 tmux 内按键）
Ctrl+b d

# 杀死会话
tmux kill-session -t bw-cc
```

**窗格操作（在 tmux 内）：**
```bash
Ctrl+b %     # 垂直分割窗格
Ctrl+b "     # 水平分割窗格
Ctrl+b 方向键 # 切换窗格
Ctrl+b x     # 关闭当前窗格
Ctrl+b z     # 最大化/恢复当前窗格
```

**查看历史输出：**
```bash
Ctrl+b [     # 进入复制模式（可滚动查看历史）
q            # 退出复制模式
```

### 使用场景示例

**场景 1：Claude Code 需要确认**
```
Claude Code: Do you want to proceed? (y/n)
你在飞书: /enter
```

**场景 2：修改命令**
```
Claude Code: Tab to amend, Esc to cancel
你在飞书: /tab
```

**场景 3：选择选项**
```
Claude Code:
  1. Option A
  2. Option B
你在飞书: /down  （选择 Option B）
你在飞书: /enter （确认选择）
```

**场景 4：切换到 YOLO 模式**
```
你在飞书: /mode yolo
系统: 正在切换到 yolo 模式...
```

## Requirements
- Node.js 20+（npm >= 7；推荐 npm 9+/10+）

如果 `npm i` 报错 `Unsupported URL Type "workspace:"`，请升级 Node.js/npm。

## Troubleshooting
- 如果 `npm run dev:agent` 报 `tsx` 不存在：请确认没有用 `--omit=dev` 安装，并执行 `npm i --include=dev`。
