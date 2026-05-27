# 代码审计 2026-05-27

本轮审查针对当前 `fix/msbuild-assets-exclude` 分支，重点检查第三轮审计修复落地后的回归风险、Windows 便携包产物契约，以及产品定位是否继续保持为“跨软件 / 跨窗口 / 跨项目的多任务完整操作台”。

## Findings

### R-1 集成测试随机监听到 Fetch 禁止端口，整套测试会偶发失败 (P1)

- 路径：[packages/daemon/test/server.integration.test.mjs](../packages/daemon/test/server.integration.test.mjs#L34) `withServer` / `withServerSnapshot` 与 `request`
- 现状：测试以 `port: 0` 获取操作系统分配的端口，再通过 Node `fetch()` 请求该端口。2026-05-27 的首轮 `npm test` 中，`daemon 重启后 workflow snapshot 恢复并通过 WS 推送给重连的 GUI` 失败，错误为 `TypeError: fetch failed` / `Error: bad port`；随后单测复跑与整套测试复跑均通过。
- 影响：代码无行为回归时，CI 仍可能随机红灯，阻塞合并和发布判断。
- 修复方向：测试 HTTP helper 改用 `node:http` 发请求，或在测试启动 helper 中规避 WHATWG blocked-port 列表；新增一次固定回归，确保 snapshot 重启场景不依赖随机端口是否合法。

### R-2 WebView native 导航边界显式放行任意 `data:` URI (P1)

- 路径：[packages/gui/MainWindow.xaml.cs](../packages/gui/MainWindow.xaml.cs#L285) `OnWebViewNavigationStarting`；[packages/gui/wwwroot/chat.js](../packages/gui/wwwroot/chat.js#L3231) `shouldInterceptAnchor`
- 现状：C# host 对所有 `data:` 导航直接放行；前端 click 路径也把 `data:` 归为无需转交 host 的内部链接。当前 `DOMPurify` 测试会剥除 markdown 中的 `data:text/html` 链接，因此已知 markdown 输入路径暂未直接暴露利用链，但 native 边界本身未做到只信任 `https://codepanion.local/` 与 `about:blank`。
- 影响：未来一旦出现新的 DOM 生成路径或 sanitizer 配置回归，`data:text/html` 页面可在 WebView 环境中运行脚本，并接触 `window.chrome.webview.postMessage` 的 native 消息表面。
- 修复方向：native 层只放行 `https://codepanion.local` 与精确的 `about:blank`，取消所有 `data:` 导航；前端对 `data:` 一律拦截并交给 host 拒绝；补 JS 回归以及 host 侧可测试的 URI 判定逻辑。

### R-3 便携包验收条件与已落地的运行时依赖布局互相矛盾 (P2)

- 路径：[DEVELOPMENT_TASKS.md](../DEVELOPMENT_TASKS.md#L75)、[DEVELOPMENT_TASKS.md](../DEVELOPMENT_TASKS.md#L279)、[scripts/package-windows.ps1](../scripts/package-windows.ps1#L129)
- 现状：S-2 已明确把 `node-pty` 和 `pino` 运行时依赖复制到 `dist/CodePanion-win-x64/daemon/node_modules/`，而 Alpha 真机验收仍要求打包产物“不含 `node_modules`”。本轮 `npm run package:windows` 已实际生成该目录。
- 影响：即使产物可运行，也永远无法按现有验收文字完成 Alpha 收口；后续人工审查会误把必要运行时文件当作发布噪音。
- 修复方向：将验收标准改为只允许经过清单约束的 runtime module 子集，不包含源码、测试、示例与多余平台 native prebuild；增加自动化产物清单 / packaged daemon 启动 smoke check。

### R-4 当前真相文档与包元数据仍沿用旧“控制平面”产品口径 (P2)

- 路径：[package.json](../package.json#L5)、[packages/daemon/package.json](../packages/daemon/package.json#L4)、[docs/API.md](API.md#L3)、[docs/ARCHITECTURE.md](ARCHITECTURE.md#L5)、[docs/MONITORING_SOURCES.md](MONITORING_SOURCES.md#L3)、[docs/README.md](README.md#L3)
- 现状：README、POSITIONING 与 PRODUCT_ROADMAP 已采用多任务完整操作台定位，但上述仍将产品描述为 `AI coding workflow control plane` / “AI 开发工作流控制台 / 控制平面”。
- 影响：文档入口与 package metadata 对外提供冲突叙事，继续造成开发方向向 IDE / 编程工作流中控偏移。
- 修复方向：保留 daemon 内部“事件中枢 / 协议层”的技术描述，但对外产品描述统一到多任务操作台，并一次性搜索核验受影响真相文档。

### R-5 `config.json` 损坏隔离新增行为没有直接回归测试 (P2)

- 路径：[packages/daemon/src/config.ts](../packages/daemon/src/config.ts#L163)、[packages/daemon/test/configPermissions.test.mjs](../packages/daemon/test/configPermissions.test.mjs)
- 现状：本分支新增 `loadConfig()` 的损坏 JSON / schema 失败隔离和默认配置重建路径，但现有 config 测试只覆盖 `writeOwnerOnly` 的权限效果，没有验证隔离文件名、新文件重建及 daemon 继续启动的行为。
- 影响：该启动健壮性修复以后被改坏时，主测试不会及时阻止启动回归。
- 修复方向：让配置加载支持注入临时 home/config path，补 JSON parse 失败和 schema 失败两条回归测试。

## Verification

- `npm test`：首次失败 1 项，错误为随机端口触发 `fetch failed: bad port`；再次完整运行通过，daemon 246 项中 244 通过、2 项平台跳过，adapter-sdk 21 项通过，DTO 校验通过。
- `node --test packages/daemon/test/server.integration.test.mjs`：复跑通过 38/38，印证 R-1 为测试不稳定风险。
- `npm run gui:build`：通过，0 warning / 0 error。
- `npm run package:windows`：通过，并输出 `Daemon runtime deps copied to D:\CodePanion\dist\CodePanion-win-x64\daemon\node_modules`，直接印证 R-3。

## 下一批次

下一批开发应先完成 R-1 与 R-2，恢复可靠测试门禁并关闭 native 导航边界缺口；随后完成 R-3 / R-4 / R-5 的验收口径、定位一致性和回归覆盖收口。具体执行步骤见 [2026-05-27-alpha-stabilization-plan.md](superpowers/plans/2026-05-27-alpha-stabilization-plan.md)。

## 修复状态

2026-05-27 本轮 Alpha 稳定性阶段已完成 R-1 至 R-5：

- R-1：集成测试 HTTP helper 改为 `node:http`，并连续执行 `server.integration.test.mjs` 10 次通过。
- R-2：WebView2 host 只放行虚拟 HTTPS host 与精确 `about:blank`；`data:` 链接交由 host 拒绝，并新增 GUI 回归。
- R-3：新增 `scripts/validate-portable-package.ps1`，将运行时模块白名单、开发文件剔除、平台 prebuild 与 packaged Node require probe 纳入 `package:windows` 门禁。
- R-4：package 元数据和当前真相文档已统一为“跨软件、跨窗口、跨项目的多任务完整操作台”。
- R-5：配置加载支持临时测试路径，新增损坏 JSON 与 schema 失败两条隔离/重建回归。

验证通过：`npm test`、`npm run gui:build`、`npm run package:windows`、`npm run validate:portable`。
