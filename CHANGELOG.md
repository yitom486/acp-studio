# Changelog

本文件由 `bun run release:patch`（及 minor/major 变体）自动维护：
发版时把 `Unreleased` 小节归档为新版本，手工只管往 `Unreleased` 里加条目。
版本号规则见 `.agents/rules/version_control.md`，事实源为 `package.json`。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
日期为发版当日（UTC+8）。

## [Unreleased]

### Added
<!-- 日常开发把条目写在这里（- 开头一行一条），发版时自动归档；注释行不计入归档 -->
- 终端抽屉藏而不杀：关闭只 `display:none` 隐藏，xterm/WS/shell 跨开关保留，重开零重建（兼修二次打开白屏）；右上 X 只隐藏，新增电源按钮才真正结束 PTY 会话
- 工具卡片“终端打开”携带执行 cwd：无则回落当前工作区；与现存活会话不同目录时仅提示、不悄悄杀 shell
- PTY 断线续接：WS 断后 shell 保留 3 分钟，同 id 重连即续接原会话（刷新/闪断不丢状态），到期无续接才杀；重影接管自动关旧端
- WSL 完整项目能力：工作区指向 `\\wsl$\<distro>\...` 即自动经 `wsl.exe` 跑终端（PTY/`--cd`）/单次执行（`sh -c`）/git，文件读写经 9P 直通零改动；终端徽标 `WSL · <distro>`，Linux 路径误填有明示

## [0.1.4] - 2026-10-12

### Added
- 输入框工具栏精简：只保留模型与思考等级，附件、/ 命令、权限（Auto review）、模式、Fast mode、模型库收进“更多”弹层；按容器宽度自适应收缩；聊天栏最小宽度 360px
- 顶栏精简：智能体、连接状态、pid、认证收进左上角状态胶囊（点开查看详情、切换智能体、连接 / 认证 / 退出）；顶栏单行不换行，窄宽度下变更 / 终端 / 通道 / 工作区收进“…”菜单
### Fixed
- 文件树悬停抖动与“ResizeObserver loop completed…”错误提示：文件树按内容区（不含内边距）取整测量、RAF 合并去重，容器隔离布局，滚动条槽位固定；该良性错误不再弹出提示（仍记录到控制台）
- 输入框打字时布局抖动：输入框 2–8 行内按整行增长、超出内部滚动；聊天区滚动条槽位固定；贴底跟随对尺寸变化去重
- Windows 桌面快捷方式与 exe 显示默认 Electron 图标：此前关闭了 signAndEditExecutable，导致图标未写入 exe；现在嵌入完整多尺寸 ico（16–256），并补齐 macOS icns、Linux 16–512 图标、网页 favicon/manifest

## [0.1.3] - 2026-10-12

### Added
- 斜杠命令：无命令时显示“该智能体暂未提供命令”；命令名支持 `:` `.` 等字符；显示参数提示（ACP input.hint）；生成中可浏览（回车只填入不发送）；内置本地命令 /clear /mode /help（标注“本地”，不发给智能体）
- 工作台可拖拽分栏（侧栏/文件树/编辑器/聊天），布局自动持久化，Ctrl+B / Ctrl+Shift+E 折叠同步
- 文件树或系统文件拖入输入框：工作区内文件/文件夹转为 @ 引用（文件夹最多 20 个文件），外部文件按大小限制作为附件；@ 引用显示为可删除的标签
- 只读 Jupyter Notebook (.ipynb) 查看器：Shiki 高亮、Markdown 单元、文本/图片/错误输出，HTML 输出在沙箱 iframe 中渲染，大文件分批挂载
- Markdown 文件所见即所得模式（Milkdown，按需加载，默认源码），保存时保留未改动块的原始格式
- 聊天中的数学公式渲染（KaTeX，按需加载）、历史回放显示用户图片、流式输出中未闭合代码块正常渲染
- **检查更新入口**：应用菜单（macOS“ACP Studio”菜单 / Windows·Linux“帮助”菜单）与标题栏菜单都有“检查更新…”；新增“设置 → 关于与更新”，显示版本、平台、更新状态与下载进度、上次检查时间、“自动检查更新”开关，手动检查无新版时明确提示“已是最新版本”；窗口在后台时发现新版 / 下载完成会发系统通知（点通知打开关于页），前台则在右下角弹出提示；开发版 / 浏览器模式注明不检查更新。
- **原生菜单与命令**：文件（新建窗口、新会话、打开文件夹、最近打开、保存、关闭标签页、在文件管理器中显示、复制路径、设置）、编辑（撤销 / 重做 / 剪切 / 复制 / 粘贴 / 全选）、视图（命令面板、切换侧栏 / 文件树 / 终端 / 深浅色、缩放、全屏）、帮助（检查更新、更新日志、报告问题、关于）。原生菜单、标题栏菜单（Windows / Linux / 浏览器）、命令面板（Ctrl/⌘+Shift+P）与快捷键共用一套命令注册表。
- **多窗口**：“新建窗口”打开独立窗口，每个窗口记住自己的工作区；打开文件夹时用当前窗口；命令行再次启动并带目录参数（如 `acp-studio .`）会在新窗口打开该目录；最近打开的文件夹同步到系统“最近文档”。
- **工作区文件树**（react-arborist）：目录懒加载、虚拟滚动、完整键盘导航、拖拽移动、行内重命名、新建文件 / 文件夹、删除（进系统回收站）、右键“在文件管理器中显示 / 复制路径 / 查看改动对比”；git 状态徽标（M / A / D / U）且包含改动的目录显示圆点；磁盘变化（含智能体写文件）自动刷新。
- **代码编辑器**（CodeMirror 6）：标签页（单击预览为斜体、双击或开始编辑即固定）、未保存圆点、Ctrl/⌘+S 保存、关闭前确认；语法高亮按扩展名懒加载（TS/JS/JSON/Markdown/CSS/HTML/Python/Rust/YAML）；配色全部取自主题变量，切换主题时随整页一起淡入淡出。
- **改动对比**：`@codemirror/merge` 并排 / 统一两种视图（HEAD ↔ 工作区，未改动段落折叠）。
- **智能体修改已打开文件时自动刷新**：无本地改动就直接重载并短暂高亮新增 / 修改的行；有未保存改动则显示冲突条（用磁盘版本 / 覆盖保存 / 对比）。
- 后端文件接口 `/api/universal/fs/*`：`list`（单层）、`read`（含 mtime，2MB 上限、拒绝二进制）、`write`（mtime 乐观锁，冲突返回 409 与磁盘内容，原子替换）、`create`、`rename`、`delete`（回收站）、`watch`（SSE，100ms 合并）。
### Security
- 新文件接口与其余网关接口同样强制令牌；路径一律相对工作区解析并经 realpath 校验，`..`、绝对路径、指向工作区外的软链接都拒绝（列目录时这类软链接不可展开）；不能写 / 改 / 删 `.git` 内的文件，不能删除或重命名工作区根；工作区本身仍不能是文件系统根或系统目录。
- 应用内外链一律交给系统浏览器打开，不再在应用里新开窗口。
### Fixed
- 斜杠命令列表在 session/new、load、resume 之后到达时丢失、切换会话后串用：网关按会话缓存 available_commands_update 并随会话响应返回，前端按会话保存
- CI 中 fs watch SSE 测试偶发失败（读取循环会丢弃已到达的数据块）

## [0.1.2] - 2026-10-12

### Added
- 流式输出体验：在底部时自动跟随新内容（ResizeObserver，80px 阈值），往上翻看时绝不强制滚动，点“回到底部”重新跟随；生成中的回答气泡外有一圈缓慢旋转的细光环与柔光，结束后淡出；新段落轻微淡入，光标改为跟在文字末尾的细竖线；系统开启“减少动态效果”时关闭这些动画。
- 主题切换改为整页一次交叉淡化（View Transitions，统一 180ms / 同一缓动），切换期间关闭元素自身过渡，各部分同时完成、不再卡顿；去掉对所有元素常驻的全局颜色过渡，8 处 `transition-all` 改为只过渡需要的属性；不支持或开启“减少动态效果”时直接切换。
- 开发假数据 `?fixture=stream`：模拟逐字流式输出，便于检查上述效果。
### Fixed
- 自动更新：安装包文件名去掉空格（如 `ACP-Studio-Setup-<版本>.exe`），`latest*.yml` 里的文件名与 GitHub Release 附件一致，否则更新会下载 404。
### Changed
- Windows 安装改为向导：首次安装可选择安装目录（固定为当前用户安装，去掉“为谁安装”选择页；安装器侧边栏 / 页眉换成 ACP Studio 品牌图），创建桌面与开始菜单快捷方式；之后的自动更新仍后台静默安装（`/S`），沿用注册表里记录的安装目录，不再弹向导。
- CI / Release 工作流的 GitHub Actions 升级到 Node 24 版本（checkout v7、upload-artifact v7、download-artifact v8、action-gh-release v3）。

## [0.1.1] - 2026-10-12

### Added
- **自动更新**（类似 VS Code / Zed）：打包版启动 10 秒后及每 4 小时检查 GitHub Releases；发现新版在左下角提示，点“更新”后台差分下载并显示进度，下载完点“重启并更新”静默安装，不点则退出或下次打开时自动装好，不再走安装向导。Windows（NSIS 一键安装）与 Linux AppImage 支持自动安装；macOS（未签名）与 deb 只提示并跳转下载页。
- 界面采用 tweakcn **vercel** 主题，浅色 / 深色 / 黑 / 白四档；对话区单色化（审批提示、徽标去彩色），“未跟踪”徽标改为中性虚线样式。
- 开发模式假数据路由 `?fixture=conversation` / `?fixture=approval`，方便截图与调样式，不进生产构建。
- 发版说明由 CHANGELOG 生成：`bun run release:notes <版本>` 截取对应小节，Release 工作流用它作为 GitHub Release 正文。
- 浏览器模式的网关令牌页与一次性登录链接（`/?token=...`，网关启动时打印）；Electron 经 preload 自动注入令牌。
### Security
- 网关对所有 `/api/universal/*`（含 `terminal/exec`）与 PTY WebSocket 强制访问令牌：不带或带错令牌一律 401，不再因为“没有 Origin 头”放行；Origin / Host 校验保留。
- 删除 `routes.ts` 里“安全模块导入失败就放行”的可选鉴权代码，改为静态导入、失败即拒绝；路由响应不再返回 `Access-Control-Allow-Origin: *`。
- 工作区白名单从“只告警”改为强制：智能体经 ACP `fs/write_text_file` 只能写会话工作区（session cwd + additionalDirectories + `ACP_WORKSPACE_ROOTS`）之内，`..` 与软链接逃逸同样拒绝；文件系统根 / 系统目录不能作为工作区（`workspace/validate` 返回 403，`session/new` 拒绝）。
### Fixed
- Windows CI：测试钩子（关闭桥接、删临时目录）超时从 10s 放宽到 30s，避免发版时偶发超时。
- 浅色主题下 diff 注释颜色对比度不足（改为 `#4b535d`，满足 WCAG AA）。
- 终端工作目录不存在时不再悄悄换成网关当前目录：`terminal/exec` 返回 400 并写明路径（cwd 也必须显式给出），ACP `terminal/create` 把错误回给智能体；终端抽屉显示网关返回的具体原因。
- 打开集成终端时整个界面崩溃进错误页（`You must set the allowProposedApi option`）：xterm 6 下 Unicode11Addon 用到的 `term.unicode` 属于 proposed API，Terminal 补上 `allowProposedApi: true`。
- `bun run test` 全绿：`@yitom/acp-client` 集成测试改为等 `session/update` 通知落地再断言（原先与 prompt 响应赛跑）。
- 测试不再写真实 `~/.acp-studio/agents.json`：全局 setup 把 `ACP_AGENTS_FILE` / `ACP_AGENTS_HOME` / `ACP_GATEWAY_TOKEN` 指向临时目录。
### Changed
- `server/universal/routes.ts`（1000+ 行 if 链）拆成按功能划分的 Hono 子路由 `server/universal/http/*`，请求体用 zod 校验；坏 JSON 或字段类型不对返回 400，不再静默当成 `{}` 继续。其余接口行为不变。
- `@agentclientprotocol/sdk` 升级到 1.8（`^1.8.0`），类型检查与全部测试通过。
### Removed
- 去掉对话区入场（BlurFade）与闪光文字动画；删除未使用的 `ChatArea.tsx`、`UniversalComposer.tsx`。
- 遗留文件 `scripts/stage-my-changes.py`（写死 `D:\` 路径）、空的 `scratch/out.json`、`run-zed-acp.cmd`。
- 未使用的依赖 `@bufbuild/protobuf`；`@yitom/acp-client` 只被测试使用，移到 devDependencies 并锁定 `0.1.2`（不再用 `latest`）。

## [0.1.0] - 2026-10-12

首个公开发版（此前 `package.json` 误标 1.0.0，回正为 0.1.0 起步）。

### Added
- 通用 ACP v1 网关（`server/universal`）：多 agent stdio 管理、
  permission/fs/terminal/elicitation 客户端能力、authStatus 透出、
  fork/providers 透传、load 回放收集、HTTP/SSE 接口。
- ACP Studio Web 工作台：Agents/Sessions 侧边栏、模型库浏览器
  （模型/思考等级/权限选择与发现）、slash 联想、附件（拖拽/粘贴/预览）、
  Markdown 富文本、git 变更查看（前后对照 + 统一 diff）、
  providers 面板、elicitation 表单、权限审批流。
- Hono 网关（Bun/Node 双入口）与 Electron 桌面壳（进程内网关、
  打包配置、GitHub CI/Release 工作流）。
- 前端工程化：zustand 客户端状态、TanStack Query 服务端状态、
  shadcn + Magic UI 组件体系、蓝灰变量主题、集中错误处理
  （error-bus/ErrorBoundary/ErrorToast）。
- 文档：`docs/sdk`（客户端/服务端写法，TS+Rust）、agent 规则
  （版本/ UI 设计/错误处理/状态管理）。
- **真 PTY 交互终端**（`node-pty` + WebSocket）：抽屉打开即探活，可用走
  WS 全双工真 shell（原生回显、`Ctrl+C` 即 SIGINT、job control、vim/ssh
  可用），不可用（Bun dev 网关）回落单次执行并明示；标题栏 `PTY`/`单次`
  徽标、fit 列数同步、预填只打字不回车、断线显式重连；`ACP_GATEWAY=node`
  一键切 Node 网关体验（`dev:desktop` 默认仍是 Bun 网关）。
- **终端 xterm addons**：链接可点、回滚搜索（`Ctrl+F`）、一键导出 `.log`、
  Unicode11 CJK 列宽对齐；`Ctrl+L` 清屏。
- **终端浮动面板**：右下浮动替代整条占底，标题栏拖动、八向缩放、几何
  持久化；xterm 配色跟随 4 套主题（浅色 ANSI 压暗、black/white 对调），
  切换热更新不重建。
- **排队/插队**：流转中发送进队列按序排出（edit/reload 先清队列）；
  插队按钮先停当前轮再发送；`TerminalCard` 加“终端打开”（预填不执行）。
- **@-mention 文件引用**：`@` 触发工作区文件防抖搜索（网关只读端点，
  cwd 禁闭/数量字节封顶/拒二进制），选中拼 `resource` 附件进发送管线。
- **本轮改动撤销**：助手 footer“改动 N”进 TurnChanges 面板，逐文件
  Diff（复用 Git 审查）/还原（confirm + git restore）；非 git 只读。
- **发送失败自动重试**：传输类错误重发（默认 2 次 backoff），注脚成功即
  清；abort/auth/语义错误永不重试。
- Studio store 新增 `useStudioShallow` / `useStudioMessages`：选择性订阅
  视图状态，刻意排除 `messages`（流式热路径字段）。
- README 新增“桥接库三源版本对齐”小节：根 `package.json ^x.y.z` /
  `scratch` 子模组 commit pin / runner 缓存 `@latest` 三源语义与对齐策略
  （发版前 `bun update` + 锁定；实际运行版本以 `initialize` 的
  `agentInfo.version` 为准）。
- 新增 `tests/universal/presets-runner.test.ts`：断言
  `antigravity-stdio` 解析为 runner 命令（含 `@yitom/agy-acp-map@latest`、
  不含 `.exe`），codex 回归守卫同在。

### Changed
- **正式包可用 PTY**：`node-pty` 改 external（native 不可打进 cjs），
  `files` 收运行子集（去 pdb/map/单测），整包 `asarUnpack`；加载双路径
  （包内 CJS 走裸 require，Node ESM 走 createRequire）。
- **Studio 外壳重渲染修复**：`App.tsx` 原先用无选择器
  `useStudioStore()` 订阅整个 store，导致每个流式分片都重渲染整个布局。
  现改为 `useStudioShallow` 选择性订阅，`messages` 下移到真正渲染它的
  `ChatArea`（经 `useStudioMessages`）；持久化 effect 改为按需
  `getState()` 读取，不再订阅热路径。符合
  `.agents/rules/state_management.md` 的选择器订阅约定。
- **tsconfig 渐进严格化第一步**：保持 `strict:false`，新增
  `"strictNullChecks": true`（基线 `bunx tsc --noEmit` 0 错误，试开增量
  0 错误 <20 阈值）；全量 `strict:true` 暂缓（残留 4 个 TS7022
  于 `src/lib/universal-api.ts` 回放聚合），渐进路线
  （session→SSE→安装→权限/elicitation→文件终端）已写进 `tsconfig.json` 注释。
- **README 过期引用修正**：`server/acp-stdio.ts`（不存在）改为
  `server/universal/` + `server/index.ts` / `server/node.ts` 与桥自带
  `sdk-server.ts`（`bun run acp:stdio` 真入口）；`src/lib/sse-client.ts`
  改为 `src/lib/universal-api.ts`；`server/bridge/agyBridge.ts` 改为
  `server/universal/*`；核心库徽章 `v0.1.3` 改为 `v0.1.6`
  （以根 `package.json` 为准）；测试徽章改为“74 Vitest (universal)”
  并注明黑盒需本地 `bun`；目录结构小节与真实布局对齐
  （`server/universal`、`desktop`、`tests/universal`）。
- **agy 切 codex 式 runner**：`antigravity-stdio` 不再 spawn 86MB
  managed exe，改为 `bunx @yitom/agy-acp-map@latest` 直起 thin JS
  `bin.js`（与 codex 预设同构）；`registry.ts` 删除 exe override
  分支；`agent-installer.ts` 的 `MANAGED_AGENTS` 清空为通用空表，
  bridge/exe 解析（`bridgeSource` / `resolveBridgeExe` /
  dev-checkout）与 `resetHeadlessLauncherCache` 一并退役；
  `routes.ts` 删除 `/bridge-source`、`/install-state`、`/install`、
  `/install/:jobId` 端点；前端删除安装徽标/安装按钮/bridge 切换/
  自动更新开关整条线（`App`、`Sidebar`、`universal-api`）；
  `desktop/main.ts` 删除 `agy-headless.exe` 打包挂载；
  `acp:stdio` 脚本改为 `bunx @yitom/agy-acp-map@latest`；
  依赖升 `@yitom/agy-acp-map ^0.1.13`（thin npm，无大 exe）；
  `no-silent-fallbacks` 规则同步到 runner 语义（本地桥联调改走
  自定义 profile 覆盖）。
- **历史恢复丢回答修复**：`handleSend` 全程不调 `snapshotThread`，
  trailing 自动快照只在会话/线程切换后触发，流式完成后再无落盘，
  reload 回来只剩用户问。现改为每轮结束（成功/失败/abort）立即
  `snapshotThread`；`freezeMessage` 落盘只保留最终答案（+thought），
  tool 调用与结果展示层可见、永不落盘。
- **连接即 resume**：`handleConnect` 的 resume 分支之前丢弃
  `session/resume` 返回的 modes/models/config，模型选择器空到首问；
  现回应用 + `applyDefaultConfigOptions`；`handleOpenSession` 在
  load 回放成功后显式 `resume` 绑定（失败只 warn，不阻断已绑定的历史）。
  编排归 Studio，桥只负责 ACP 协议动作。
- **标题**：`index.html` 改为自有标题 `ACP Studio`。
- **桥 0.1.14（reload 对等）**：取消/失败轮也落半截文本（`partial` 标记），
  `session/load` 照常回放；子模组 pin 到桥 `9d270f4`（`v0.1.15`），CI 新增桥历史测试门禁
  （`history-partial-persist` + `session-history`）；npm 线上为 `0.1.16`
  （含本轮 MCP+partial 全部修复，已验 tarball：旧硬错无残留），
  本地基线跟进到 `^0.1.16`（`bun.lock` 同步，代码内无直接引用）。

### Fixed
- **静默错误 loud 化**（`no-silent-fallbacks` / `error_handling`）：
  `server/universal/registry.ts` 自定义 agents 文件解析/持久化失败由静默
  `return []` 改为 `console.warn` 带文件路径 + 原因（仍返回 `[]` 保活网关）；
  `server/universal/presets.ts` 的 `ACP_AGENTS_JSON` 损坏同样 `console.warn`
  保活；`src/App.tsx` 工作区默认值、配置恢复链、一次性会话清理的裸
  `.catch(()=>{})` / 空 `catch` 改为 `console.warn` / `console.debug`
  （逻辑不变）；剪贴板复制失败改 `console.debug`；
  `findRunnerBin` 逐项试探补 deterministically 无害注释。
  可预期清理失败（disconnect/close）允许忽略但均已留痕；
  本轮横切另含安全加固、agent 异步按需安装、SSE 发送互斥、前端懒加载拆分，
  细节见各专项条目（此处仅汇总，不编造版本号）。

[Unreleased]: https://github.com/yitom486/acp-studio/compare/v0.1.4...HEAD
[0.1.0]: https://github.com/yitom486/acp-studio/releases/tag/v0.1.0
[0.1.1]: https://github.com/yitom486/acp-studio/releases/tag/v0.1.1
[0.1.2]: https://github.com/yitom486/acp-studio/releases/tag/v0.1.2
[0.1.3]: https://github.com/yitom486/acp-studio/releases/tag/v0.1.3
[0.1.4]: https://github.com/yitom486/acp-studio/releases/tag/v0.1.4
