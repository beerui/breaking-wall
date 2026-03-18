# Breaking-Wall 修复总结

## 已完成的修复

### 1. ✅ 修复消息轰炸问题

**问题描述：**
- Claude Code 执行长任务时，飞书收到大量重复的中间状态消息
- 状态更新（如 "Transfiguring... (1m 43s · 4.5k tokens)"）被识别为新输出
- 导致 `stableCount` 一直重置，无法达到稳定状态

**解决方案：**
1. **改进 `outputDiff.ts`**：
   - 返回 `DiffResult` 对象，包含 `diff` 和 `isSubstantial` 标志
   - 添加 `isSubstantialChange()` 函数，识别"实质性变化"
   - 检测 Claude Code 状态更新模式（Transfiguring、Running、时间计数、token 计数）
   - 只有新增行或实质性内容变化才算"有意义的输出"

2. **修改 `wsClient.ts` 的稳定检测逻辑**：
   - 使用 `isSubstantial` 标志判断是否重置 `stableCount`
   - 状态更新不重置稳定计数
   - 增加稳定检测参数：`stableRounds: 2 → 5`，`finalWaitMs: 2000 → 3000`
   - 总等待时间：约 9 秒无实质性输出才发送

3. **更新 `sharedSessionBridge.ts`**：
   - `captureOutput()` 返回 `DiffResult` 对象而不是字符串

**效果：**
- 大幅减少飞书消息数量（从每次轮询都发送 → 只在真正稳定时发送）
- 用户体验更好，不会被消息轰炸

---

### 1.1 ✅ 修复飞书重复消息问题

**问题描述：**
- 用户发送一个命令（如 `/help` 或 `/tab`），收到 2 条重复回复
- 飞书可能会重复发送同一个消息的 webhook 事件

**解决方案：**
1. **添加消息去重机制**：
   - 在 `server.ts` 添加 `processedMessageIds` Set 存储已处理的消息ID
   - 在处理消息前检查是否已处理过
   - 定期清理旧的消息ID（保留最近1000条）

**效果：**
- 每个消息只处理一次，不会重复回复
- 避免飞书重复事件导致的问题

---

### 2. ✅ 支持 /mode 切换（tmux 模式）

**问题描述：**
- 用户在飞书发送 `/mode yolo` 命令
- 系统回复"shared-session 模式下不支持 /mode 切换"
- 但实际上 tmux 模式可以通过 Claude Code 的 `/permission` 命令切换

**解决方案：**
1. **修改 `protocol/src/index.ts`**：
   - 在 `ControlSchema` 添加 `"permission"` action
   - 添加 `mode` 字段（可选）

2. **修改 `relay/src/server.ts`**：
   - 移除 tmux 模式下的 `/mode` 限制检查
   - tmux 模式下，发送 `control` 消息（action: "permission"）到 Agent
   - pty 模式下，保持原有逻辑（直接修改 session.mode）

3. **修改 `agent/src/wsClient.ts`**：
   - 添加 `permission` action 处理
   - 向 tmux session 发送 `/permission <mode>` 命令

4. **修改 `relay/src/ws.ts`**：
   - 在 `AgentHub` 添加 `getAgent(agentId)` 方法

5. **修改 `relay/src/server.ts` 的 SessionState**：
   - 添加 `key` 和 `agentId` 字段
   - 在 `getSession()` 时自动关联 agentId

**效果：**
- tmux 模式下可以通过飞书切换权限模式
- 无需重启 session，即时生效

---

### 3. ✅ 完善交互支持

**问题描述：**
- Claude Code 有丰富的交互模式（多选项确认、特殊键操作）
- 当前系统只支持 `/enter` 和直接发送文本
- 缺少对特殊键的支持（Tab, Esc, Ctrl+O, 方向键等）

**解决方案：**
1. **修改 `protocol/src/index.ts`**：
   - 在 `ControlSchema` 添加 `"send_key"` action
   - 添加 `key` 字段（可选）

2. **修改 `relay/src/server.ts`**：
   - 添加特殊键命令处理：`/tab`, `/esc`, `/ctrl+o`, `/up`, `/down`
   - 映射命令到 tmux 键名（Tab, Escape, C-o, Up, Down）
   - 更新 `/help` 帮助信息

3. **修改 `agent/src/tmux/tmuxClient.ts`**：
   - 添加 `buildSendKeyArgs()` 函数

4. **修改 `agent/src/tmux/sharedSessionBridge.ts`**：
   - 添加 `sendKey()` 方法
   - 导入 `buildSendKeyArgs`

5. **修改 `agent/src/wsClient.ts`**：
   - 添加 `send_key` action 处理
   - 调用 `bridge.sendKey()`

**效果：**
- 用户可以在飞书发送特殊键命令
- 支持 Claude Code 的所有交互场景
- 更好的用户体验

---

## 测试结果

✅ 所有测试通过：
- `@bw/agent`: 20 tests passed
- `@bw/relay`: 4 tests passed
- `@bw/protocol`: 5 tests passed

---

## 关键文件修改

1. `packages/protocol/src/index.ts` - 添加 `permission` 和 `send_key` action，添加 `key` 字段
2. `apps/agent/src/tmux/outputDiff.ts` - 实质性变化检测
3. `apps/agent/src/tmux/sharedSessionBridge.ts` - 返回 DiffResult，添加 sendKey 方法
4. `apps/agent/src/tmux/tmuxClient.ts` - 添加 buildSendKeyArgs 函数
5. `apps/agent/src/wsClient.ts` - 改进稳定检测 + permission 和 send_key 处理
6. `apps/relay/src/server.ts` - 支持 tmux 模式 /mode 切换，添加特殊键命令
7. `apps/relay/src/ws.ts` - 添加 getAgent 方法

---

## 使用说明

### 消息轰炸修复
- 自动生效，无需配置
- 系统会智能识别状态更新 vs 实质性输出
- 只在真正稳定时发送消息到飞书

### /mode 切换
在飞书发送：
```
/mode yolo
```
系统会：
- tmux 模式：向 Claude Code 发送 `/permission yolo`
- pty 模式：直接修改 session 的 mode

### 特殊键命令
在飞书发送：
```
/tab       # 发送 Tab 键（用于修改命令）
/esc       # 发送 Esc 键（用于取消）
/ctrl+o    # 发送 Ctrl+O（用于展开内容）
/up        # 发送向上箭头（用于选择选项）
/down      # 发送向下箭头（用于选择选项）
```

**使用场景：**
- Claude Code 提示 "Tab to amend" → 发送 `/tab`
- Claude Code 提示 "Esc to cancel" → 发送 `/esc`
- Claude Code 提示 "ctrl+o to expand" → 发送 `/ctrl+o`
- 多选项菜单 → 发送 `/up` 或 `/down` 选择，然后 `/enter` 确认

---

## 下一步建议

1. **监控实际效果**：
   - 观察飞书消息数量是否显著减少
   - 检查是否有误判（该发送的消息没发送）
   - 测试特殊键命令是否正常工作

2. **调整参数**（如需要）：
   - `stableRounds`: 当前 5 轮（6 秒）
   - `finalWaitMs`: 当前 3000ms（3 秒）
   - 可根据实际使用情况调整

3. **可能的增强功能**：
   - 添加智能提示：检测到特定输出时自动提示用户可用命令
   - 添加数字选择快捷方式：检测到选项菜单时，直接发送数字
   - 添加更多特殊键支持（如 Ctrl+C, Ctrl+D 等）

4. **考虑添加配置**：
   - 允许用户自定义稳定检测参数
   - 允许用户自定义状态更新模式
   - 允许用户自定义特殊键映射

## 部署步骤

1. **构建项目**：
   ```bash
   npm run build
   ```

2. **重启服务**：
   ```bash
   # 重启 Relay
   npm run dev:relay

   # 重启 Agent
   npm run dev:agent
   ```

3. **测试验证**：
   - 在飞书发送一个长时间运行的命令，观察消息数量
   - 在飞书发送 `/mode yolo`，验证是否切换成功
   - 触发需要确认的命令，测试 `/tab`、`/esc` 等特殊键
