import type { Action, Commit, FileContent, FileRequest, ProjectNode, Repository, TerminalCommand, WorkspaceState } from "@/lib/api"

export const alpha = "C:/Projects/alpha", beta = "C:/Projects/beta", linked = "C:/Worktrees/feature"
function node(Path: string, Repository = false, Children: ProjectNode[] = []): ProjectNode { return { Path, Repository, Children, Bare: false, Open: true, Missing: false, Pinned: Path === alpha, Removed: false, Group: "", Root: !Repository, Icon: "", Sources: [], Source: "" } }
export function commit(Hash = "a".repeat(40), Subject = "Initial commit", Parents: string[] = []): Commit { return { Hash, Short: Hash.slice(0, 8), Parents, Refs: ["HEAD -> main"], Author: "Test Author", AuthorEmail: "test@example.com", Committer: "Test Author", CommitterEmail: "test@example.com", AuthorDate: "2026-01-01T00:00:00Z", CommitDate: "2026-01-01T00:00:00Z", CoAuthors: [], Subject, Body: "Commit description" } }
export function createBackend() {
  const state: WorkspaceState = { Version: 1, Roots: ["C:/Projects"], Trees: [node("C:/Projects", false, [node(alpha, true), node(beta, true)])], Groups: [], Selected: alpha, Worktrees: {}, Drafts: {}, PinnedRefs: {}, AutoFetch: {}, ProjectOrder: {}, Preferences: { Theme: "light", Language: "en", Editor: "", Wrap: true, SidebarWidth: 232, DefaultView: "git", AIURL: "", AIKey: "", AIModel: "", AICommitPrompt: "", CloseAction: "minimize", CloseConfirm: true } }
  const file = { Path: "src/main.go", OldPath: "src/main.go", Status: 77, Added: 1, Deleted: 1, Area: 2, Commit: "" }
  const writes: Action[] = [], copied: string[] = [], selections: string[][] = [], opened: string[] = [], openedUrls: string[] = []
  const openedTools: string[][] = [], toolAvailability: Record<string, boolean> = { code: true }
  const checkUpdateResult = { Current: "0.2.0", Latest: "0.2.0", Available: false, URL: "https://github.com/ushaio/MyGit/releases/tag/v0.2.0", Name: "v0.2.0", PublishedAt: "2026-02-01T00:00:00Z", AssetName: "MyGit-amd64-installer.exe", AssetURL: "https://github.com/ushaio/MyGit/releases/download/v0.2.0/MyGit-amd64-installer.exe", AssetSize: 12345678 }
  let downloaded = 0
  const installed: string[] = []
  const terminals: string[] = [], closedTerminals: string[] = [], terminalShells: string[] = [], terminalWrites: string[] = []
  const lastSession: { Tabs: { Project?: string; Path?: string; Label?: string; Profile?: string; Command?: string }[]; Active: number; Page: string } = { Tabs: [], Active: -1, Page: "git" }
  let terminalCommands: Record<string, TerminalCommand[]> = {}
  let commonTerminalCommands: TerminalCommand[] = []
  let workflowToken = ""
  const workflowItem = { ID: 101, Name: "CI", Path: ".github/workflows/ci.yml", State: "active", HTMLURL: "https://github.com/example/alpha/actions/workflows/ci.yml" }
  const workflowRun = { ID: 9001, WorkflowID: 101, Number: 7, Title: "Update main", Status: "completed", Conclusion: "success", Branch: "main", HeadSHA: "a".repeat(40), Event: "push", CreatedAt: "2026-01-01T00:00:00Z", UpdatedAt: "2026-01-01T00:05:00Z", HTMLURL: "https://github.com/example/alpha/actions/runs/9001" }
  const workflowActiveRun = { ID: 9002, WorkflowID: 101, Number: 8, Title: "Nightly build", Status: "in_progress", Conclusion: "", Branch: "main", HeadSHA: "b".repeat(40), Event: "workflow_dispatch", CreatedAt: "2026-01-01T01:00:00Z", UpdatedAt: "2026-01-01T01:02:00Z", HTMLURL: "https://github.com/example/alpha/actions/runs/9002" }
  const workflowJob = { ID: 501, RunID: 9001, Name: "Build & Package (windows)", Status: "completed", Conclusion: "success", StartedAt: "2026-01-01T00:00:00Z", CompletedAt: "2026-01-01T00:05:00Z", Steps: [{ Number: 1, Name: "Set up job", Status: "completed", Conclusion: "success", StartedAt: "2026-01-01T00:00:00Z", CompletedAt: "2026-01-01T00:00:05Z" }] }
  const workflowJob2 = { ID: 502, RunID: 9001, Name: "Publish release", Status: "completed", Conclusion: "success", StartedAt: "2026-01-01T00:05:00Z", CompletedAt: "2026-01-01T00:05:11Z", Steps: [] }
  function snapshot(path: string): Repository { return { Path: path, Bare: false, Changes: { Top: path, From: "a".repeat(40), To: "", Files: path === beta ? [] : [{ ...file }] }, Refs: { Branches: [{ Name: "main", Hash: "a".repeat(40), Upstream: { Remote: "origin", Branch: "main" }, Ahead: 0, Behind: 0 }], Remotes: [], Tags: [] }, Tracking: { Branch: path === linked ? "feature" : "main", Upstream: "origin/main", Ahead: 0, Behind: 0 }, Worktrees: [{ Path: alpha, Branch: "main", HEAD: "a".repeat(40), Main: true, Bare: false, Detached: false, Locked: false, Prunable: false }, { Path: linked, Branch: "feature", HEAD: "b".repeat(40), Main: false, Bare: false, Detached: false, Locked: false, Prunable: false }], Stashes: [], Remotes: { origin: "https://github.com/example/alpha.git" }, Operation: { Kind: 0 } } }
  function content(req: FileRequest): FileContent { return { File: { ...file, Area: req.Area }, Before: "package old\n", After: "package new\n", Token: "file-version", Lines: [{ Kind: "delete", Text: "package old\n", Old: 1, New: 0 }, { Kind: "add", Text: "package new\n", Old: 0, New: 1 }], Binary: false, Truncated: false, BeforeImage: "", AfterImage: "" } }
  async function call(name: string, ...args: unknown[]): Promise<unknown> {
    const method = name.split(".").at(-1)
    switch (method) {
      case "State": case "Refresh": return structuredClone(state)
      case "Select": state.Selected = args[0] as string; if (args[1]) state.Worktrees![args[0] as string] = args[1] as string; selections.push(args as string[]); return structuredClone(state)
      case "SetProjectOrder": state.ProjectOrder![args[0] as string] = [...(args[1] as string[])]; return structuredClone(state)
      case "Snapshot": return snapshot(args[0] as string)
      case "Changes": return snapshot((args[0] as { Path: string }).Path).Changes
      case "File": return content(args[0] as FileRequest)
      case "History": return { Commits: [commit()], HasMore: false }
      case "Execute": writes.push(args[0] as Action); return
      case "CopyText": copied.push(args[0] as string); return
      case "SaveDraft": state.Drafts![args[0] as string] = args[1] as string; return
      case "SetPreferences": state.Preferences = args[0] as WorkspaceState["Preferences"]; return structuredClone(state)
      case "ResolveClose": {
        if (args[1]) {
          state.Preferences.CloseAction = args[0] as string
          state.Preferences.CloseConfirm = false
        }
        return structuredClone(state)
      }
      case "DataPath": return "C:/Users/test/.mygit-wails3"
      case "Models": return [{ ID: "deepseek-chat", Owner: "deepseek" }, { ID: "gpt-4o-mini", Owner: "openai" }]
      case "DefaultCommitPrompt": return "You write commit messages for a Git repository."
      case "CommitMessage": return "feat: describe the staged changes"
      case "ChooseFolder": return ""
      case "AddFolder": {
        const added = args[0] as string
        state.Roots = [...(state.Roots || []), added]
        state.Trees = [...(state.Trees || []), node(added, true)]
        return structuredClone(state)
      }
      case "Clone": {
        const target = args[1] as string
        const cloned = `${target}/repo`
        state.Roots = [...(state.Roots || []), cloned]
        state.Trees = [...(state.Trees || []), node(cloned, true)]
        state.Selected = cloned
        return { State: structuredClone(state), Path: cloned }
      }
      case "Blame": return []
      case "Start": terminals.push(args[0] as string); terminalShells.push(args[3] as string); return `term-${terminals.length}`
      case "Profiles": return [
        { ID: "cmd", Label: "Command Prompt", Shell: "C:/Windows/System32/cmd.exe", Args: [], Detail: "C:/Windows/System32/cmd.exe", Kind: "cmd", Available: true, Default: false },
        { ID: "powershell", Label: "Windows PowerShell", Shell: "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe", Args: ["-NoLogo"], Detail: "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe", Kind: "powershell", Available: true, Default: true },
        { ID: "pwsh", Label: "PowerShell 7", Shell: "C:/Program Files/PowerShell/7/pwsh.exe", Args: ["-NoLogo"], Detail: "C:/Program Files/PowerShell/7/pwsh.exe", Kind: "pwsh", Available: true, Default: false },
        { ID: "gitbash", Label: "Git Bash", Shell: "", Args: ["--login", "-i"], Detail: "", Kind: "bash", Available: false, Default: false },
        { ID: "wsl", Label: "WSL", Shell: "C:/Windows/System32/wsl.exe", Args: [], Detail: "C:/Windows/System32/wsl.exe", Kind: "wsl", Available: true, Default: false },
      ]
      case "Read": return { Data: "", Offset: 0, Closed: false, Reset: false }
      case "Commands": return structuredClone(terminalCommands[args[0] as string] || [])
      case "SaveCommands": {
        const project = args[0] as string
        const saved = (args[1] as TerminalCommand[]).map((command, index) => ({ ...command, ID: command.ID || `cmd-${index + 1}` }))
        terminalCommands[project] = saved
        return structuredClone(saved)
      }
      case "CommonCommands": return structuredClone(commonTerminalCommands)
      case "SaveCommonCommands": {
        const saved = (args[0] as TerminalCommand[]).map((command, index) => ({ ...command, ID: command.ID || `common-${index + 1}` }))
        commonTerminalCommands = saved
        return structuredClone(saved)
      }
      case "MoveCommand": {
        const project = args[0] as string, id = args[1] as string, toCommon = args[2] as boolean
        const projectList = terminalCommands[project] || []
        if (toCommon) {
          const moved = projectList.find((command) => command.ID === id)
          if (!moved) throw new Error("terminal command not found")
          terminalCommands[project] = projectList.filter((command) => command.ID !== id)
          commonTerminalCommands = [...commonTerminalCommands, moved]
        } else {
          const moved = commonTerminalCommands.find((command) => command.ID === id)
          if (!moved) throw new Error("terminal command not found")
          commonTerminalCommands = commonTerminalCommands.filter((command) => command.ID !== id)
          terminalCommands[project] = [...projectList, moved]
        }
        return {
          Project: structuredClone(terminalCommands[project] || []),
          Common: structuredClone(commonTerminalCommands),
        }
      }
      case "Write": terminalWrites.push(args[1] as string); return
      case "Resize": return
      case "Close": closedTerminals.push(args[0] as string); return
      case "LastSession": return structuredClone(lastSession)
      case "SaveSession": {
        const layout = args[0] as { Tabs?: unknown[]; Active?: number; Page?: string }
        lastSession.Tabs = structuredClone(layout.Tabs || []) as typeof lastSession.Tabs
        lastSession.Active = layout.Active ?? -1
        lastSession.Page = layout.Page || ""
        return
      }
      case "ClearSession": lastSession.Tabs = []; lastSession.Active = -1; lastSession.Page = ""; return
      case "RebasePlan": return [commit()]
      case "ToolAvailable": return toolAvailability[args[0] as string] === true
      case "OpenTool": openedTools.push(args as string[]); return
      case "OpenPath": opened.push(args[0] as string); return
      case "OpenURL": openedUrls.push(args[0] as string); return
      case "CheckUpdate": return { ...checkUpdateResult }
      case "DownloadUpdate": downloaded += 1; return "C:/Temp/MyGit-update/MyGit-amd64-installer.exe"
      case "InstallUpdate": installed.push(args[0] as string); return
      case "Reveal": case "SaveText": return
      case "ResolveTarget": {
        const remote = args[0] as string, url = args[1] as string
        const match = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url)
        if (!match) throw new Error(`unsupported remote ${url}`)
        const [, owner, repo] = match
        return { Platform: "github", Host: "github.com", APIHost: "api.github.com", Owner: owner, Repo: repo, Remote: remote, WebURL: `https://github.com/${owner}/${repo}` }
      }
      case "Capabilities": return { ListWorkflows: true, ListRuns: true, Dispatch: true, Rerun: true, Cancel: true, OpenWeb: true }
      case "Account": return { Platform: "github", Host: "github.com", Configured: workflowToken.length > 0, Account: workflowToken ? "octocat" : "" }
      case "SaveToken": {
        const token = (args[1] as string).trim()
        if (!token) throw new Error("token is required")
        workflowToken = token
        return { Platform: "github", Host: "github.com", Configured: true, Account: "octocat" }
      }
      case "DeleteToken": workflowToken = ""; return { Platform: "github", Host: "github.com", Configured: false, Account: "" }
      case "ListWorkflows": return { Workflows: [workflowItem], Total: 1, Page: 1, PerPage: 20, HasMore: false }
      case "ListRuns": return { Runs: [workflowRun, workflowActiveRun], Total: 2, Page: 1, PerPage: 20, HasMore: false }
      case "Jobs": return { Jobs: [workflowJob, workflowJob2], Total: 2 }
      case "Graph": return { Nodes: [{ ID: "build", Name: "Build & Package", Needs: [] }, { ID: "publish", Name: "Publish release", Needs: ["build"] }] }
      case "JobLogs": return { Steps: [{ Number: 1, Content: "2026-01-01T00:00:00.0000000Z Current runner version: '2.338.2'\n2026-01-01T00:00:00.1000000Z ##[group]Runner Image Provisioner\n2026-01-01T00:00:00.2000000Z Hosted Compute Agent\n2026-01-01T00:00:00.3000000Z ##[endgroup]\n2026-01-01T00:00:00.4000000Z ##[group]Operating System\n2026-01-01T00:00:00.5000000Z Microsoft Windows Server 2025\n2026-01-01T00:00:00.6000000Z ##[endgroup]\n2026-01-01T00:00:01.0000000Z Secret source: Actions\n2026-01-01T00:00:01.1000000Z Prepare workflow directory\n2026-01-01T00:00:01.2000000Z Download action repository 'actions/checkout@v4' (SHA:11bd71901bbe5b1630ceea73d27597364c9af683)\n" }] }
      case "Inputs": return []
      case "Dispatch": case "Rerun": case "Cancel": return
      default: throw new Error(`Unhandled test call ${name}`)
    }
  }
  return { state, call, writes, copied, selections, opened, openedUrls, openedTools, toolAvailability, checkUpdateResult, get downloaded() { return downloaded }, installed, terminals, closedTerminals, terminalShells, terminalWrites, lastSession, get terminalCommands() { return terminalCommands[alpha] || [] }, get commonTerminalCommands() { return commonTerminalCommands }, snapshot, content }
}
