# WinOnWeb (WOW)

> Unofficial web desktop UI simulation framework built with TypeScript & Astro. Not affiliated with or endorsed by Microsoft Corporation.

WinOnWeb 是一个运行在浏览器中的现代桌面环境仿真框架，内置窗口管理器、任务栏、开始菜单、文件资源管理器、任务管理器、虚拟硬件探测以及可配置主题与扩展协议（`win11-app/v1`），既可作为独立在线演示运行，也可作为宿主外壳嵌入第三方 Web 应用（例如 ExHyperV）。

## 特性

- **窗口与桌面系统**：支持窗口拖拽、边缘贴靠预览、最大化/最小化/多实例管理、桌面图标网格与右键菜单。
- **内置系统应用**：文件资源管理器（含虚拟文件系统骨架与属性页）、任务管理器（进程/性能图表/服务/启动项/运行新任务）、设置、存储实验等。
- **跨应用通信协议**：通过 `win11-app/v1` 消息通道与 `iframe` 子应用同步主题、音量、窗口状态及自定义业务消息。
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
- `pnpm preview`：预览构建产物

## 许可证与版权声明

- 本项目源代码及内置矢量图标（`.ts`、`.astro`、`.css`、`.js`、`.svg`）基于 **MIT License** 开源（见 [LICENSE](./LICENSE)）；`public/win11/fonts/` 为 MIT 开源字体 `FluentSystemIcons-Regular`。
- 仓库 `public/win11/wallpapers/` 中的 Bloom 壁纸视觉资产及相关品牌商标归 **Microsoft Corporation** 所有，仅用于非商业性的技术演示与学习交流；如权利人提出异议或移除通知，将在核实后第一时间下架替换。
