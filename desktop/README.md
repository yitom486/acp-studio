# ACP Studio Desktop (Electron)

桌面客户端：Electron 窗口 + 进程内 Node 网关（Hono），前端 `dist` 由网关同源 served，
无需浏览器、无需常驻终端。

## 架构

```text
Electron main (Node, electron-dist/main.cjs)
 └─ in-process gateway (server/gateway.ts, Hono, WinterCG Request/Response)
     ├─ /api/universal/*  → 通用 Agent stdio 适配器（codex / antigravity / opencode / …）
     └─ /*                → dist/ 前端静态文件（ACP_PUBLIC_DIR 覆盖，见下）
```

`server/index.ts`（Bun）与 `server/node.ts`（Node）是同一 Hono app 的两种入口，
日常开发继续 `bun run dev` 即可，桌面端行为一致。

## 开发

```bash
bun run dev:desktop      # 【推荐】一键启动桌面开发环境（自动编译主进程 + 启动网关与 Vite + 开启热更新桌面窗口）
ACP_GATEWAY=node bun run dev:desktop   # 要体验真 PTY 终端：改跑 Node 网关（默认 Bun 网关无 node-pty，终端回落单次模式）

# 亦可分步调试：
bun run build:electron   # 仅打包 main+preload 到 electron-dist/
bun run dev              # 启动网关 (3004) + Vite (5188)
bun run dev:electron     # 外接已启动的 vite(5188)+网关，只启动 Electron 窗口调试
```

## 生产运行（免安装验证）

```bash
bun run build && bun run build:electron
electron electron-dist/main.cjs   # main 内起网关并打开窗口
```

## 打包

先执行 `bun run build && bun run build:electron`，再执行 `bun run package:win`
（macOS/Linux 分别用 `package:mac` / `package:linux`）。打包脚本先生成
`.acp-tmp/desktop-app`：完整复制 `dist` 与 `electron-dist`，发布 manifest 仅声明
外置原生依赖 `node-pty`，附当前平台/架构的原生运行文件及第三方许可证汇总。
Mermaid、Markdown、数学公式等前端依赖已编译进 `dist`，不再额外复制其 npm 原始包。
`bun run stage:desktop` 可以单独检查发布目录；不要跳过 staging 直接调用 builder。
发布构建压缩主进程与 preload，KaTeX CSS 只引用 WOFF2 字体（不打包重复的
WOFF/TTF）。界面和开发演示共用 `public/icon.png`；高清猫咪原图保存在
`build/acp-studio-cat.png`，不复制到前端发布目录。
原生终端使用系统 ConPTY（显式 `useConptyDll: false`），保留 WinPTY 回退文件；
发布目录不带实验版 `conpty.dll` / `OpenConsole.exe` 和仅用于编译的
`node-addon-api`。其许可证仍保留在第三方声明中，开发依赖不变。
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
- **真 PTY（node-pty）是 native 模块**（`server/universal/pty.ts`）：
  `package.json#build.asarUnpack` 含 `**/*.node`（asar 内 native 不可加载，
  必须解包）；打包机上 electron-builder 默认 `npmRebuild` 会按 Electron ABI
  重编（需配好编译工具链：Windows 要 VS Build Tools）。dev 下 Bun 网关无
  PTY（回落单次执行），要真 PTY 请用 `dev:server:node`（Node 网关）或
  Electron 内置网关。
  例外：`npmRebuild` 已关（`false`）——node-pty 是 N-API 模块，prebuild
  跨 Node/Electron ABI 通用，源码重编纯属浪费（且本机缺 Spectre 库会编
  失败，见 MSB8040）；只有换 node-pty 大版本或缺对应平台 prebuild 时才
  需要开重编（届时配好工具链再开）。

## 远端网关（WSL / SSH，UI 留本机）

前端默认连同源本地网关；设置 → 网关可填自定义基址（如
`http://127.0.0.1:4004`），HTTP/WS 全链路（`apiFetch` 前缀 + PTY 候选基址优先）
自动跟过去，令牌按基址隔离保存。切基址自动重载页面（会话状态归属网关）。

- **网关跑进 WSL（原生 Linux agent/工具）**：WSL 内进仓库目录，
  `PORT=4004 bun run dev:server:node`，基址填 `http://127.0.0.1:4004`，
  令牌贴 WSL 里 `~/.acp-studio/.gateway-token`，工作区直接用 Linux 路径。
- **SSH 远端**：远端起网关（只听 127.0.0.1 即可），本地
  `ssh -L 4004:127.0.0.1:3004 user@host -N`，基址填 `http://127.0.0.1:4004`。
- 非回环 http 基址设置页会 loud 警告（明文 token 出本机）；跨源能通是因为
  CORS 只回显可信本地 Origin（`server/universal/security.ts`，端口不限）。

## GitHub 运维流程

- `.github/workflows/ci.yml`：push/PR 跑类型检查 + universal 单测 + Web 构建 + Electron 打包校验。
- `.github/workflows/release.yml`：打 `v*` tag 即发版，产物为 NSIS 安装包 +
  绿色 dir 包，自动挂到 GitHub Release（未签名，SmartScreen 会提示；
  有证书后配 `CSC_LINK` / `CSC_KEY_PASSWORD` 即可消除）。
- legacy `tests/integration` 因依赖 live agy 流程、CI 里不跑（现状如此，
  与本次无关），门禁以 `tests/universal` 为准。
