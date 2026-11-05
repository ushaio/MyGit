<div align="center">

<img src="build/appicon.png" alt="MyGit Logo" width="128" />

<h1>MyGit</h1>

<p><b>以 worktree 为中心的桌面 Git 客户端</b></p>
<p>把多个仓库、每个仓库的多个 worktree，收进一个窗口里统一管理。</p>

<p>
  <img alt="Go" src="https://img.shields.io/badge/Go-1.27-00ADD8?logo=go&logoColor=white" />
  <img alt="Wails" src="https://img.shields.io/badge/Wails-v3-DF0000?logo=wails&logoColor=white" />
  <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" />
  <img alt="License" src="https://img.shields.io/badge/License-MIT-green.svg" />
  <img alt="Platform" src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-4c8bf5" />
</p>

</div>

---

## ✨ 特性

| | |
| --- | --- |
| 🗂️ **多仓库工作区** | 多个仓库挂到不同 root 下，侧边栏与命令面板快速切换 |
| 🌿 **worktree 为中心** | 每个仓库的 worktree 独立成标签页，同窗口并行操作 |
| 📜 **历史与引用** | 浏览提交历史、分支与标签（refs），快速定位 |
| 🔍 **差异与追责** | 逐行 diff、文件变更查看，以及 blame 追溯 |
| ⚡ **完整 Git 操作** | 提交、拉取、推送、合并、变基、cherry-pick、revert |
| 💻 **内置终端** | 基于 PTY 的多标签终端会话 |
| 🤖 **AI 提交信息** | 拉取 OpenAI 兼容端点的模型列表，按暂存 diff 生成提交信息 |
| 🌗 **双语 + 主题** | 中英双语（默认 `zh-CN`），支持明暗主题 |

## 🧱 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面框架 | [Wails v3](https://wails.io) |
| 后端 | Go 1.27（`module mygit-wails3`） |
| 前端 | React 19 + TypeScript |
| 构建 | Vite 8 |
| 样式 / 组件 | Tailwind CSS 4 + Radix UI / shadcn 风格 |
| 测试 | Go `test` · Vitest · Playwright |

## 🚀 开发

从仓库根目录执行，`task`（go-task 3.54）封装了常用命令：

| 目标 | 命令 |
| --- | --- |
| 开发（Wails 热重载 + Vite `:9245`） | `task dev` |
| 构建本机程序 | `task build` → `bin/` |
| 打包安装程序 | `task package` |
| 完整检查（vet + tsc + vitest） | `task check` |
| 仅 Go | `go vet ./...` / `go test ./...` |
| 前端类型检查 | `cd frontend; npm run check` |
| 单元测试 | `cd frontend; npm test` |
| 浏览器端到端测试 | `cd frontend; npm run test:browser` |

> 💾 开发数据目录默认为 `%USERPROFILE%\.mygit-wails3`，可用 `MYGIT_WAILS3_DATA_DIR` 覆盖。

## 🤝 友情链接

<p>
  <a href="https://linux.do"><img alt="LINUX DO" src="https://img.shields.io/badge/LINUX%20DO-linux.do-1f9cf0?logo=discourse&logoColor=white" /></a>
</p>

- [LINUX DO](https://linux.do)

## 📄 许可证

本项目基于 [MIT License](./LICENSE) 开源。
