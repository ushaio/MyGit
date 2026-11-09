# 工作流栏 — 固定接口契约（主代理钉死，A/B 共同遵守）

本文件是实现 `docs/plans/workflows.md` 时，主代理固定的服务接口与数据契约。A（后端）按此实现，
B（前端）按此消费；任何偏离必须先告知主代理。

## 包与文件

- 后端全部放在 `internal/services` 包：
  - `internal/services/workflow.go` — `WorkflowService`、模型类型、凭据接口、HTTP 客户端注入、构造器。
  - `internal/services/workflow_github.go` — GitHub REST 实现、远程 URL → Target 解析、工作流 YAML 参数解析。
  - `internal/services/workflow_test.go` — 假 HTTP server + 假凭据实现，不碰真实账户/系统凭据库。
- 前端组件：`frontend/src/components/workflows.tsx`（B 负责），测试 `frontend/src/components/workflows.test.tsx`。

## Go 模型（PascalCase 导出字段，放 `internal/services/workflow.go`）

```go
// WorkflowTarget 是一个可操作平台的仓库目标。ResolveTarget 产出它。
type WorkflowTarget struct {
    Platform string // "github" | "gitee" | "gitcode"
    Host     string // 远程主机，例如 "github.com"
    APIHost  string // API 主机，例如 "api.github.com"；Gitee/GitCode 为空
    Owner    string
    Repo     string
    Remote   string // 远程名称，例如 "origin"
    WebURL   string // 平台网页地址，例如 https://github.com/owner/repo
}

// WorkflowCapabilities 说明某目标支持哪些操作。Gitee/GitCode 只有 OpenWeb=true。
type WorkflowCapabilities struct {
    ListWorkflows bool
    ListRuns      bool
    Dispatch      bool
    Rerun         bool
    Cancel        bool
    OpenWeb       bool
}

type Workflow struct {
    ID      int64
    Name    string
    Path    string // 例如 .github/workflows/ci.yml
    State   string // active | disabled_manually | ...
    HTMLURL string
}

type WorkflowRun struct {
    ID         int64
    WorkflowID int64
    Number     int
    Title      string
    Status     string // queued | in_progress | completed | ...
    Conclusion string // success | failure | cancelled | skipped | ""（未完成时）
    Branch     string
    HeadSHA    string
    Event      string
    CreatedAt  string // ISO8601
    UpdatedAt  string
    HTMLURL    string
}

type WorkflowList struct {
    Workflows []Workflow
    Total     int
    Page      int
    PerPage   int
    HasMore   bool
}

type WorkflowRuns struct {
    Runs    []WorkflowRun
    Total   int
    Page    int
    PerPage int
    HasMore bool
}

type WorkflowAccount struct {
    Platform   string
    Host       string
    Configured bool
    Account    string // 已配置返回登录名；未知为 ""
}

// WorkflowInput 是 workflow_dispatch 的一个参数。
type WorkflowInput struct {
    Name        string
    Description string
    Required    bool
    Type        string // "string" | "boolean" | "choice" | "environment"
    Default     string
    Options     []string // 仅 choice 有值
}
```

## 服务方法（`*WorkflowService` 导出）

```go
// 解析远程 URL 为目标；不可识别平台返回错误。
func (s *WorkflowService) ResolveTarget(remoteName, remoteURL string) (WorkflowTarget, error)

// 某平台能力矩阵（纯函数，无网络）。
func (s *WorkflowService) Capabilities(target WorkflowTarget) WorkflowCapabilities

// 账号状态（是否已存令牌、登录名）。
func (s *WorkflowService) Account(target WorkflowTarget) (WorkflowAccount, error)

// 保存/删除令牌。GitHub 用 GET /user 校验令牌并取登录名；非 GitHub 返回“不支持”错误。
func (s *WorkflowService) SaveToken(target WorkflowTarget, token string) (WorkflowAccount, error)
func (s *WorkflowService) DeleteToken(target WorkflowTarget) (WorkflowAccount, error)

// 页从 1 开始；空分支表示不按分支过滤。perPage 固定 20。
func (s *WorkflowService) ListWorkflows(target WorkflowTarget, page int) (WorkflowList, error)
func (s *WorkflowService) ListRuns(target WorkflowTarget, workflowID int64, branch string, page int) (WorkflowRuns, error)

// 读取所选 ref 的远端工作流定义里 workflow_dispatch.inputs；无定义返回空切片。
func (s *WorkflowService) Inputs(target WorkflowTarget, workflowPath string, ref string) ([]WorkflowInput, error)

func (s *WorkflowService) Dispatch(target WorkflowTarget, workflowID int64, ref string, inputs []WorkflowInput) error
func (s *WorkflowService) Rerun(target WorkflowTarget, runID int64) error
func (s *WorkflowService) Cancel(target WorkflowTarget, runID int64) error
```

构造器：`func NewWorkflowService() *WorkflowService`，使用系统凭据库（`github.com/zalando/go-keyring`）与
`http.DefaultClient`。为测试注入内部构造函数或同包直接设字段（`client httpDoer`、`creds credentialStore`）。

## 内部接口（可注入，测试用）

```go
type httpDoer interface{ Do(*http.Request) (*http.Response, error) }

type credentialStore interface {
    Get(service, account string) (string, error) // keyring.ErrNotFound 表示未存
    Set(service, account, secret string) error
    Delete(service, account string) error
}
```

- 生产实现 `keyringCredentialStore` 包装 `keyring.Get/Set/Delete`，service 固定 `"mygit-wails3.workflows"`，
  account 用 `platform + "|" + host`（例如 `github|github.com`）。凭据库不可用要返回明确错误，绝不退回明文文件。
- 令牌只随请求发往与该平台匹配的 API 主机（GitHub 仅 `api.github.com`）。绝不写 URL/日志/workspace.json/快照。

## GitHub REST 行为

- 基础地址 `https://api.github.com`。所有请求带 `Accept: application/vnd.github+json`、`User-Agent: MyGit`，
  有令牌时带 `Authorization: Bearer <token>`。超时 20s（`context.WithTimeout`）。
- 列表接口带 `per_page=20&page=N`；`total_count` 决定 `HasMore = page*perPage < total`。
- 工作流列表：`GET /repos/{owner}/{repo}/actions/workflows`。
- 运行记录：`GET /repos/{owner}/{repo}/actions/runs?branch=` 或
  `GET /repos/{owner}/{repo}/actions/workflows/{workflowID}/runs?branch=`（workflowID>0 时）。
- 触发：`POST /repos/{owner}/{repo}/actions/workflows/{workflowID}/dispatches`，体 `{"ref":ref,"inputs":{...}}`，成功 204。
- 重跑：`POST /repos/{owner}/{repo}/actions/runs/{runID}/rerun`（204）。
- 取消：`POST /repos/{owner}/{repo}/actions/runs/{runID}/cancel`（202）。
- 参数定义：`GET /repos/{owner}/{repo}/contents/{workflowPath}?ref={ref}` 取 `{content,encoding:base64}`，解码后用
  `gopkg.in/yaml.v3`（已在模块图内）解析，读取 `on.workflow_dispatch.inputs`。`on` 也可能是字符串/列表，此时无参数。
- 错误映射：401→“令牌无效或已过期”；403→“权限不足或触发限流”；404→“仓库不存在、Actions 未启用或无权访问”；
  429→“触发 GitHub 限流，请稍后重试”。错误正文用单行截断（≤240 rune）。
- `Dispatch` 前校验：`ref` 非空；`inputs` 中 `Required` 且当前值为空的项报错。

## 前端约定（B 遵守）

- 服务在 `@/lib/api` 以 `Workflow` 名字导出；类型 `WorkflowTarget, WorkflowCapabilities, Workflow, WorkflowRun,
  WorkflowList, WorkflowRuns, WorkflowAccount, WorkflowInput` 一并从 `@/lib/api` 导出（主代理加）。
- 组件 `WorkflowsBar` 挂在 Git 视图 `RepositoryContent` 内、`.repository-body` 之上（主代理接入 App.tsx）。
- 通过 `useWorkbench()` 取 `w.repo`（`Remotes: map[string]string`、`Refs.Branches: Ref[]`、`Tracking.Branch`）、
  `w.path`、`w.busy`、`w.setSettings`。
- 远程选择：优先 `origin`，否则第一个能被 `Workflow.ResolveTarget` 解析成功的远程。
- 切仓库/远程清空选择并取消旧请求；旧响应不得覆盖新页面（用请求序号/AbortController/ref 守卫）。
- 收起或页面不可见停止轮询；有运行中（status=queued/in_progress）时约每 10s 刷新一次。
- 未配置账号、无远程、平台不支持管理、无工作流、无记录、加载失败都要有说明与下一步操作。
- 令牌配置入口：组件内“配置令牌”内联表单调用 `Workflow.SaveToken`（并另有设置页入口，主代理加）。
