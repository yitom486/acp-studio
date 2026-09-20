# Antigravity ACP Studio & @yitom/agy-acp-map 版本规范与发版铁律

本规则适用于本仓库所有关于 `@yitom/agy-acp-map` 及相关适配器的发版和版本控制。

## 一、版本号自增铁律（严禁擅自跳级）
1. **严格遵循 Patch 线性递增**：
   - 默认所有的日常发版、Bug 修复、协议对齐，只能自增末尾的 **Patch** 位（如 `0.1.3` -> `0.1.4` -> `0.1.5` -> `0.1.6` ...）。
2. **严禁未经用户许可跃迁 Minor / Major 大版本**：
   - 严禁任何 Agent / AI 助手或脚本擅自将版本提升至 `0.2.x`、`0.3.x`、`0.5.x` 或 `1.0.x`。
   - 只有在用户在对话中给出了**显式、无歧义的明确许可**（如“我允许升级到 0.2”或传入 `ALLOW_MINOR_BUMP=true`）后，方可调整中间位或大版本。

## 二、单一事实源（Single Source of Truth）
1. `package.json` 中的 `version` 字段为全局版本事实源。
2. `src/agent-sdk.ts` 中的 `AGENT_INFO.version`、UI 状态展示（Header / ChatInput / AuthModal）必须与 `package.json` 保持 100% 实时同步。
3. 发版时必须使用标准工具：
   ```bash
   # 仅在需要发布新 Patch 时执行（全自动自增、同步代码、构建并跑通 104 项测试）：
   bun run release:patch
   # 或自动发布至 npm：
   bun run release:publish
   ```
