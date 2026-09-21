# ACP Studio Desktop (Electron)

桌面客户端：Electron 窗口 + 进程内 Node 网关（Hono），前端 `dist` 由网关同源 served，
无需浏览器、无需常驻终端。

## 架构

```text
Electron main (Node, electron-dist/main.cjs)
 └─ in-process gateway (server/gateway.ts, Hono, WinterCG Request/Response)
     ├─ /api/universal/*  → 各 agent stdio 子进程（codex / gemini / …）
     ├─ /api/*            → legacy Antigravity 桥（library 模式）
     └─ /*                → dist/ 前端静态文件（ACP_PUBLIC_DIR 覆盖，见下）
```

`server/index.ts`（Bun）与 `server/node.ts`（Node）是同一 Hono app 的两种入口，
日常开发继续 `bun run dev` 即可，桌面端行为一致。

## 开发

```bash
bun run build            # 前端 dist
bun run build:electron   # 打包 main+preload 到 electron-dist/
bun run dev:electron     # 外接 vite(5188)+网关，只启动 Electron 窗口调试
```

## 生产运行（免安装验证）

```bash
bun run build && bun run build:electron
electron electron-dist/main.cjs   # main 内起网关并打开窗口
```

## 打包

`bunx electron-builder --win nsis dir --publish never`（`package.json#build`）。
注意两件事（均已踩坑）：

1. `electron/` 不能作为源码目录名——会与 npm `electron` 包撞名导致
   `Bun.build` 解析失败，本项目源码目录叫 `desktop/`。
2. `electron-builder` 在本机 Windows Defender 下解包官方 Electron 时会
   EBUSY，可先手动组装 `release/manual-unpacked` 验证（见 git 历史），
   或以管理员权限给输出目录加 Defender 排除后再跑 builder。

## 打包布局与路径铁律

- preload 路径必须经 `app.getAppPath()` 解析，**禁止 `__dirname`**
  （bun 打包时会把它内联成编译期绝对路径）。
- 前端静态目录必须经 `ACP_PUBLIC_DIR` 环境变量覆盖（main 内指向
  `<app>/dist`），**禁止依赖 `process.cwd()`**。
- `spawn` 跨运行时走 `spawnCrossPlatform`（`server/universal/AgentConnection.ts`）：
  Node 在 Windows 下直接 exec `.cmd` 会 `EINVAL`，须经 shell 中转。

## GitHub 运维流程

- `.github/workflows/ci.yml`：push/PR 跑类型检查 + universal 单测 + Web 构建 + Electron 打包校验。
- `.github/workflows/release.yml`：打 `v*` tag 即发版，产物为 NSIS 安装包 +
  绿色 dir 包，自动挂到 GitHub Release（未签名，SmartScreen 会提示；
  有证书后配 `CSC_LINK` / `CSC_KEY_PASSWORD` 即可消除）。
- legacy `tests/integration` 因依赖 live agy 流程、CI 里不跑（现状如此，
  与本次无关），门禁以 `tests/universal` 为准。
