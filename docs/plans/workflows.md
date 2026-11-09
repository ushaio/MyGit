# Git 面板工作流栏实施计划

状态：规划完成，功能尚未实现。执行等待当前会话开放 `workbuddy` 提供方。

## 目标与范围

在 Git 视图内增加可折叠的工作流栏，跟随选中仓库切换。第一版支持 GitHub Actions：工作流列表、运行历史、手动触发、重跑、取消、打开平台网页。Gitee 显示来源与网页入口；公开管理接口核实前，不显示可执行的管理按钮。

暂不包含：实时日志、制品下载、工作流 YAML 编辑、密钥管理、图形化流水线编排。

用户指定执行配置：provider=`workbuddy`、model=`deepseek-v4.1-flash`、reasoning_effort=`high`。不得静默更换模型。已查询当前会话，仅开放 `magpie`；`workbuddy` 查询返回 `LLM provider "workbuddy" is not allowed for this Session`。

## 已核实的代码基础

- `internal/workspace/sources.go`：已有 GitHub/Gitee/GitCode 远程来源识别，但调用 API 还需要解析 owner/repo。
- `internal/services/repository.go`：仓库快照提供 `Remotes`。
- `frontend/src/App.tsx`：Git/终端视图切换及仓库界面入口。
- `frontend/src/lib/workbench.tsx`：当前项目、worktree、仓库快照等上下文。
- `internal/services/desktop.go`：`DesktopService.OpenURL` 可复用。
- `go.mod`：已有间接依赖 `github.com/zalando/go-keyring v0.2.6`，需验证目标平台行为。
- `Taskfile.yml`：`task bindings` 生成绑定；`task check` 运行 Go vet、TypeScript、Vitest，Go 测试需另跑。

以下均为拟议设计，具体签名在子代理开始前由主代理固定。

## 服务与数据边界

独立的 `WorkflowService` 负责平台 API，避免将流水线网络请求塞进 Git Snapshot 或 Git 命令写队列。

核心模型采用 PascalCase 字段：

- Target：平台、host、owner、repo、remote 名称、仓库网页 URL。
- Capabilities：ListWorkflows、ListRuns、Dispatch、Rerun、Cancel、OpenWeb。
- Workflow：ID、Name、Path、State、HTMLURL。
- Run：ID、WorkflowID、Title、Status、Conclusion、Branch、HeadSHA、Event、CreatedAt、UpdatedAt、HTMLURL。
- Page：条目、分页信息；避免默认只返回首屏而无更多入口。
- AccountStatus：是否已配置凭据、账户标识；不向 UI 回传令牌。

服务操作：识别目标、读取账号状态、保存/删除令牌、列工作流、列运行记录、读取手动运行参数定义、触发、重跑、取消。

GitHub REST API 对应关系：

| 操作 | 接口 |
| --- | --- |
| 工作流列表 | GET /repos/{owner}/{repo}/actions/workflows |
| 仓库运行记录 | GET /repos/{owner}/{repo}/actions/runs |
| 单个工作流运行记录 | GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs |
| 手动触发 | POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches |
| 重跑 | POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun |
| 取消 | POST /repos/{owner}/{repo}/actions/runs/{run_id}/cancel |

手动运行必须要求 workflow_dispatch 配置；参数表单根据所选 ref 的工作流定义生成，并校验必填项和类型。缺少定义或权限不足时，显示明确原因。仅解析本地文件不能视作远端所选 ref 的可靠定义。

HTTP 请求使用超时、取消上下文、分页和可解释错误；处理 401、403、404、429、限流响应。避免将令牌写入 URL、日志、普通 workspace 配置或状态快照。凭据按平台/主机/账号保存到系统凭据库。凭据库不可用时明确报错，不静默退回明文文件。

远程地址覆盖 https、ssh://、git@host:owner/repo，拒绝不能识别的平台目标。凭据仅发送到与平台匹配的 API 主机，防止任意 remote 主机获得令牌。

## 界面与状态

- Git 视图内可折叠区域，顶部提供远程仓库、工作流、分支筛选及刷新。
- 默认 origin；同时存在 GitHub/Gitee remotes 时可切换，不根据本地目录名推断远端项目。
- 紧凑列表展示状态、标题、分支、提交、时间；选中工作流后查看其运行历史。
- 操作包含：运行、重跑、取消、打开网页。按钮受能力、运行状态和权限约束。
- 未配置账号、无远程、未开通流水线、无工作流、无记录、加载失败均有对应说明与下一步操作。
- 切仓库/远程时清空选择并取消旧请求；旧响应不得覆盖新页面。缓存身份按平台+主机+owner/repo 区分。
- 栏收起或页面不可见时停止轮询；运行中适度刷新并处理限流。保持 Git 与终端现有行为。
- 使用现有主题与组件、中文/英文文案、键盘焦点。UI 子代理应用 frontend-design 技能，先检查已有设计令牌再给出布局方案。

## 子代理分工与写入边界

### 子代理 A：后端

执行配置：workbuddy/deepseek-v4.1-flash high。

负责新的平台/工作流 Go 模块、工作流服务、凭据适配及 Go 测试。使用可注入 HTTP client 和凭据接口，测试不访问真实账户或系统凭据库。开始前读取 AGENTS.md，并优先用 codegraph。

不修改 App、前端绑定、全局 i18n、main 注册点或变更日志。提交给主代理：实际服务签名、类型、API 行为、测试结果及限制。

### 子代理 B：前端

执行配置：workbuddy/deepseek-v4.1-flash high。

主代理先固定服务接口；随后与 A 并行完成工作流栏组件、局部状态、操作表单及组件测试。使用 frontend-design 技能并沿用当前产品设计。不得手改生成绑定；必要时先依赖主代理约定的类型，最终统一切换为生成类型。

不修改后端、main、生成绑定或变更日志。全局 App/i18n/settings 变更交主代理集成，或在开始前明确独占文件。

### 主代理：接口协调、集成、审查

固定接口后同时启动 A/B，处理 main 服务注册、api 导出、设置入口、i18n 汇总、App 接入、测试 backend mock、生成绑定和变更日志。检查现有未提交改动，不覆盖 website/ 或其他并行修改。不提交、推送或发布。

## 验收与检查

1. HTTP 假服务器验证 API 路径、方法、分页、分支筛选、请求体、鉴权、超时和错误映射。
2. 凭据假实现验证保存/删除与隔离；普通配置和读取状态不得包含令牌。
3. 组件测试覆盖仓库 A 慢响应不能覆盖仓库 B、重复触发防护、Gitee 能力降级、表单校验和错误后可重试。
4. 新 UI 调用在 frontend/tests/backend.ts 有相应 fake service 支持。
5. 运行 task bindings，检查生成差异，然后 task check、设置 GOWORK=off 的 go test ./...、前端生产构建。
6. 使用项目现有浏览器测试入口检查工作流栏与布局；不启动替代 DSH GUI 服务。无真实凭据时说明线上账号端到端操作未验证。
7. CHANGELOG.md 未发布区块记录实际完成能力，不能将 Gitee 管理操作记为已支持。
8. 结束时检查 git status 和 diff，报告功能、验证结果与剩余限制。

## 参考资料

- https://docs.github.com/en/rest/actions/workflows
- https://docs.github.com/en/rest/actions/workflow-runs
- https://help.gitee.com/gitee-go/quick-start
