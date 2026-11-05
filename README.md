# MyGit

MyGit 是一个基于 **Wails v3** 的桌面 Git 客户端。它以 **worktree 为中心** 组织工作区：可以把多个仓库挂到不同的 root 下，每个仓库拥有各自的 worktree，并在同一个窗口中以标签页的形式同时打开、切换和操作。

- 后端：Go 1.27（`module mygit-wails3`），Wails v3 服务 + 内嵌 React 资源
- 前端：React 19 + TypeScript + Vite 8 + Tailwind 4 + Radix/shadcn 风格组件
- 界面中英双语（i18n），默认 `zh-CN`

## 功能

- 多仓库 / 多 worktree 的统一工作区，侧边栏与命令面板快速切换
- 历史、引用、文件变更、逐行 diff、blame 等浏览能力
- 提交、拉取、推送、合并、变基、cherry-pick、revert 等常用 Git 操作
- 内置终端（PTY 会话）
- AI 辅助：拉取 OpenAI 兼容端点的模型列表，并根据暂存的 diff 生成提交信息

## 开发

从仓库根目录执行，`task`（go-task 3.54）封装了常用命令：

| 目标 | 命令 |
| --- | --- |
| 开发（Wails 热重载 + Vite :9245） | `task dev` |
| 构建本机程序 | `task build` → `bin/` |
| 打包安装程序 | `task package` |
| 完整检查（vet + tsc + vitest） | `task check` |
| 仅 Go | `go vet ./...` / `go test ./...` |
| 前端类型检查 | `cd frontend; npm run check` |
| 单元测试 | `cd frontend; npm test` |

开发数据目录默认为 `%USERPROFILE%\.mygit-wails3`（可用 `MYGIT_WAILS3_DATA_DIR` 覆盖）。

## 许可证

本项目基于 [MIT License](./LICENSE) 开源。

## 友情链接

- [LINUX DO](https://linux.do)
