# WinOnWeb (WOW)

> Unofficial web desktop UI simulation framework built with TypeScript & Astro. Not affiliated with or endorsed by Microsoft Corporation.

WinOnWeb 是一个运行在浏览器中的现代桌面环境仿真框架，内置窗口管理器、任务栏、开始菜单、文件资源管理器、任务管理器、虚拟硬件探测以及可配置主题与扩展协议（`wow/v1`），既可作为独立在线演示运行，也可作为宿主外壳嵌入第三方 Web 应用（例如 ExHyperV）。

## 特性

- **窗口与桌面系统**：支持窗口拖拽、边缘贴靠预览、最大化/最小化/多实例管理、桌面图标网格与右键菜单。
- **内置系统应用**：文件资源管理器（含虚拟文件系统骨架与属性页）、任务管理器（进程/性能图表/服务/启动项/运行新任务）、设置、存储实验等。
- **跨应用通信协议**：通过 `wow/v1` 消息通道与 `iframe` 子应用同步主题、音量、窗口状态及自定义业务消息。
- **宿主配置注入**：通过 `configureWinDesktopHost()` 注入外部应用清单（`WinAppManifest`）、快捷方式、主机名称与自启动应用，核心代码与具体业务零耦合。

## 本地开发

需要 Node.js 24+ 与 pnpm 11+：

```sh
pnpm install
pnpm dev
```

常用命令：

- `pnpm dev`：启动本地开发预览（默认端口 `5190`）
- `pnpm build`：构建静态产物到 `dist/`
- `pnpm check`：严格 TypeScript 类型检查与分层边界检查
- `pnpm preview`：预览构建产物

## 运行与部署

默认使用单域受信模式。应用商店按同源目录的 SHA-256 校验官方包，手工导入的包使用独立安装身份。单域内的应用与桌面共享浏览器源，只应导入信任的代码。

独立源部署可在构建时设置 `PUBLIC_WOW_APP_DOMAIN=apps.example.com` 和 `PUBLIC_WOW_SHELL_ORIGIN=https://desktop.example.com`。桌面部署到后者，引导页、静态资源和 `/wow/sw.js` 同时部署到通配 HTTPS 应用域。每个安装身份拥有自己的子域。引导页验证父窗口源，确认同源服务激活和版本文件写入后，桌面才提交活动指针。自定义宿主可通过 `configureDeployment` 提供 `AppOriginBridge`。

嵌套 WOW 的顶层宿主也应返回 `Cross-Origin-Opener-Policy: same-origin` 和 `Cross-Origin-Embedder-Policy: credentialless`，并在每一层跨源 iframe 的 `allow` 中委派 `cross-origin-isolated`。若设置了 `Permissions-Policy`，需将桌面与目标应用源纳入该特性的允许列表。应用包可声明 `requiresIsolation: true` 和可选的 `singleThreadEntry`，运行时在实际应用源检测隔离能力。

`createWowClient` 由包的 `./protocol` 入口导出。`await client.openApp(id)` 返回目标窗口的 `instanceId`，可传给 `callApp`、`sendToApp` 或 `connectData`。后者返回直连目标实例的 `MessagePort`，可通过其 transfer list 传输二进制数据。受控调用可用 `client.request(method, params, {signal, timeout})` 取消或设置超时。

## 许可证与版权声明

- 本项目源代码及内置矢量图标（`.ts`、`.astro`、`.css`、`.js`、`public/win11/icons/explorer/` 下的 `.svg`）基于 **MIT License** 开源（见 [LICENSE](./LICENSE)）；`public/win11/fonts/` 为 MIT 开源字体 `FluentSystemIcons-Regular`。
- 仓库 `public/win11/wallpapers/` 中的 Bloom 壁纸及 `public/win11/icons/*.png` 中的桌面核心视觉图标归 **Microsoft Corporation** 所有，仅用于非商业性的技术演示与 UI 仿真学习交流；本仓库不隶属于微软且未获微软官方背书。如权利人提出异议或移除通知，将在核实后第一时间下架替换。
