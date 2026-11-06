# MyGit — agent notes

Wails v3 desktop Git client. A **worktree-centered** workspace: several repos grouped under roots, each with its own worktrees, opened as tabs in one window. UI is Chinese/English (i18n), defaults to `zh-CN`.

- Backend: Go 1.27 (`module mygit-wails3`), Wails v3 services + embedded React assets
- Frontend: React 19 + TypeScript + Vite 8 + Tailwind 4 + Radix/shadcn-style components under `frontend/src/components/ui`
- Dev data dir: `%USERPROFILE%\.mygit-wails3` (override with `MYGIT_WAILS3_DATA_DIR`). Holds `workspace.json` with roots, selection, drafts, pinned refs, preferences.

## Commands

Run from repo root. `task` (go-task 3.54) wraps everything; `GOWORK=off` is set in `Taskfile.yml`.

| Goal | Command |
| --- | --- |
| Dev (Wails hot rebuild + Vite on :9245) | `task dev` |
| Build host binary | `task build` → `bin/` |
| Package installer | `task package` |
| Full check (vet + tsc + vitest) | `task check` |
| Go only | `go vet ./...` / `go test ./...` |
| Frontend typecheck | `cd frontend; npm run check` |
| Unit tests | `cd frontend; npm test` (vitest, jsdom) |
| Browser e2e | `cd frontend; npm run test:browser` (Playwright) |
| Regenerate bindings after changing exported Go service methods/types | `task bindings` |

`task build` runs the platform's `build/<os>/Taskfile.yml`; the generic pieces live in `build/Taskfile.yml`.

## Code intelligence

`.codegraph/` holds a local SQLite symbol/edge index (91 files, 1,418 nodes). Query it instead of grep+read loops:
`codegraph_explore(query, projectPath="D:\\Projects\\GitHub\\mygit-wails3")` returns verbatim source plus call paths and blast radius. Re-index with `codegraph init` after large refactors; the DB is git-ignored and per-machine.

## Layout

- `main.go` — app bootstrap: store → services → window → menu. `production` const from build tag files `mode_dev.go` / `mode_production.go` (build with `-tags production`).
- `internal/workspace` — persisted state. `store.go` loads/saves `workspace.json`, scans roots (`projects.go`), parses `git worktree list` (`worktrees.go`), derives remote source labels (`sources.go`).
- `internal/gitrepo` — all Git CLI work, no UI concerns. `git.go` (~1.9k lines) is the bulk; `inspect.go` (blame, log parsing), `interactive.go` (merge/rebase/cherry-pick/revert state machine), `diff.go` (line-level diff via `sergi/go-diff`), `operation.go` (in-progress operation detection).
- `internal/services` — Wails service layer. `repository.go` (snapshot/history/file/apply-lines/blame), `actions.go` (single `Execute(Action)` dispatch for every mutating git op), `files.go` (export/patch), `terminal.go` + `terminal_{windows,unix}.go` (PTY sessions via `charmbracelet/x/xpty`), `desktop.go` (dialogs, clipboard, open/reveal, save/open file), `ai.go` (`AIService.Models` lists an OpenAI-compatible endpoint's catalogue for the settings dialog; `AIService.CommitMessage` sends the staged diff to the configured model with the saved prompt, `AIService.DefaultCommitPrompt` is the built-in prompt an empty preference falls back to).
- `frontend/src/lib/` — `api.ts` re-exports generated bindings and helpers (`action()`, `changeRequest()`); `workbench.tsx` is the app state/actions context; `i18n.tsx`, `theme.tsx`, `graph.ts`, `diff.ts`.
- `frontend/src/components/` — feature panes: `projects.tsx` (sidebar/palette), `refs.tsx`, `history.tsx`, `files.tsx`, `diff-view.tsx`, `action-dialog.tsx`, `settings.tsx` (AI section fetches the endpoint's model list via `AI.Models` and offers it in a Select, plus the editable commit-message prompt), `terminal.tsx`.
- `frontend/bindings/` — **generated**, never hand-edit. `frontend/tests/backend.ts` fakes the service surface for tests; a new service method used by the UI needs a case there.

## Conventions / gotchas

- Mutating git work goes through `Action` + `Execute`, not ad-hoc service methods. Destructive actions require `Confirm=true` (see `TestDestructiveActionsRequireConfirmation`).
- `RepositoryService` queues per-worktree writes on two serial lanes keyed on the resolved real path (`lane` in `internal/services/lane.go`): local index work and remote work (`fetch`/`push`/`push-tag`/`delete-remote-*`) never block each other, and a writer waits for its turn (15s local, 60s remote) instead of failing the click. Reads take no lane. Non-idempotent kinds (`serialKinds`) are claimed so a queued second commit or merge is refused. Keep that shape: mutating git work must not reject just because another command is running.
- `gitrepo.Git` runs with `GIT_TERMINAL_PROMPT=0`, `GIT_PAGER=cat`, `GIT_EDITOR=true` — never let git prompt; failures must surface as errors. Network ops carry timeouts; `Run` is the short-timeout variant.
- `//go:embed all:frontend/dist` — a clean checkout must run the frontend build before `go build`, or the embed fails.
- Generated Go bindings are what the TS types come from; field names are PascalCase on both sides (`Action.Path`, `Repository.Changes`).
- Error messages are surfaced to users via sonner toasts; wrap failures with context rather than returning bare `exec` errors.
- Tests: Go tests use real temp repos (`git init` in `t.TempDir()`), so they exercise the real CLI — keep them hermetic and fast. Vitest has `restoreMocks: true` and a 10s timeout.
- **变更日志**：`CHANGELOG.md`（Keep a Changelog 格式）记录所有历史版本与当前未发布变更。任何功能（feature）、修复（fix）、重构或破坏性变更，都要在该文件顶部的「未发布」区块按 `新增 / 变更 / 修复 / 移除 / 安全` 归类登记；发布时把「未发布」提升为对应版本号并补发布日期。

## 只读请求

询问“为什么 / 是不是 / 会不会 / 怎么设计的 / 这样对不对”这类解释性问题时：
- 只允许读文件、跑只读命令，禁止任何写入（write / edit / git checkout / 包管理器安装）。
- 回答里区分“代码现状”与“我的建议”，不要把自己刚写的说成既有事实。
- 发现的缺口只描述，并单独问一句“要不要我改”，等明确答复。
- 动手前必须先输出 `git status --porcelain`；本轮结束时再输出一次。
