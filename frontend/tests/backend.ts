import type { Action, Commit, FileContent, FileRequest, ProjectNode, Repository, TerminalCommand, WorkspaceState } from "@/lib/api"

export const alpha = "C:/Projects/alpha", beta = "C:/Projects/beta", linked = "C:/Worktrees/feature"
function node(Path: string, Repository = false, Children: ProjectNode[] = []): ProjectNode { return { Path, Repository, Children, Bare: false, Open: true, Missing: false, Pinned: Path === alpha, Removed: false, Group: "", Root: !Repository, Icon: "", Source: "github" } }
export function commit(Hash = "a".repeat(40), Subject = "Initial commit", Parents: string[] = []): Commit { return { Hash, Short: Hash.slice(0, 8), Parents, Refs: ["HEAD -> main"], Author: "Test Author", AuthorEmail: "test@example.com", Committer: "Test Author", CommitterEmail: "test@example.com", AuthorDate: "2026-01-01T00:00:00Z", CommitDate: "2026-01-01T00:00:00Z", CoAuthors: [], Subject, Body: "Commit description" } }
export function createBackend() {
  const state: WorkspaceState = { Version: 1, Roots: ["C:/Projects"], Trees: [node("C:/Projects", false, [node(alpha, true), node(beta, true)])], Groups: [], Selected: alpha, Worktrees: {}, Drafts: {}, PinnedRefs: {}, AutoFetch: {}, Preferences: { Theme: "light", Language: "en", Editor: "", Wrap: true, SidebarWidth: 232, AIURL: "", AIKey: "", AIModel: "", AICommitPrompt: "" } }
  const file = { Path: "src/main.go", OldPath: "src/main.go", Status: 77, Added: 1, Deleted: 1, Area: 2, Commit: "" }
  const writes: Action[] = [], copied: string[] = [], selections: string[][] = [], opened: string[] = []
  const terminals: string[] = [], closedTerminals: string[] = [], terminalShells: string[] = [], terminalWrites: string[] = []
  let terminalCommands: Record<string, TerminalCommand[]> = {}
  function snapshot(path: string): Repository { return { Path: path, Bare: false, Changes: { Top: path, From: "a".repeat(40), To: "", Files: path === beta ? [] : [{ ...file }] }, Refs: { Branches: [{ Name: "main", Hash: "a".repeat(40), Upstream: { Remote: "origin", Branch: "main" }, Ahead: 0, Behind: 0 }], Remotes: [], Tags: [] }, Tracking: { Branch: path === linked ? "feature" : "main", Upstream: "origin/main", Ahead: 0, Behind: 0 }, Worktrees: [{ Path: alpha, Branch: "main", HEAD: "a".repeat(40), Main: true, Bare: false, Detached: false, Locked: false, Prunable: false }, { Path: linked, Branch: "feature", HEAD: "b".repeat(40), Main: false, Bare: false, Detached: false, Locked: false, Prunable: false }], Stashes: [], Remotes: { origin: "https://github.com/example/alpha.git" }, Operation: { Kind: 0 } } }
  function content(req: FileRequest): FileContent { return { File: { ...file, Area: req.Area }, Before: "package old\n", After: "package new\n", Token: "file-version", Lines: [{ Kind: "delete", Text: "package old\n", Old: 1, New: 0 }, { Kind: "add", Text: "package new\n", Old: 0, New: 1 }], Binary: false, Truncated: false, BeforeImage: "", AfterImage: "" } }
  async function call(name: string, ...args: unknown[]): Promise<unknown> {
    const method = name.split(".").at(-1)
    switch (method) {
      case "State": case "Refresh": return structuredClone(state)
      case "Select": state.Selected = args[0] as string; if (args[1]) state.Worktrees![args[0] as string] = args[1] as string; selections.push(args as string[]); return structuredClone(state)
      case "Snapshot": return snapshot(args[0] as string)
      case "Changes": return snapshot((args[0] as { Path: string }).Path).Changes
      case "File": return content(args[0] as FileRequest)
      case "History": return { Commits: [commit()], HasMore: false }
      case "Execute": writes.push(args[0] as Action); return
      case "CopyText": copied.push(args[0] as string); return
      case "SaveDraft": state.Drafts![args[0] as string] = args[1] as string; return
      case "SetPreferences": state.Preferences = args[0] as WorkspaceState["Preferences"]; return structuredClone(state)
      case "DataPath": return "C:/Users/test/.mygit-wails3"
      case "Models": return [{ ID: "deepseek-chat", Owner: "deepseek" }, { ID: "gpt-4o-mini", Owner: "openai" }]
      case "DefaultCommitPrompt": return "You write commit messages for a Git repository."
      case "CommitMessage": return "feat: describe the staged changes"
      case "ChooseFolder": return ""
      case "Blame": return []
      case "Start": terminals.push(args[0] as string); terminalShells.push(args[3] as string); return `term-${terminals.length}`
      case "Profiles": return [
        { ID: "cmd", Label: "Command Prompt", Shell: "C:/Windows/System32/cmd.exe", Args: [], Detail: "C:/Windows/System32/cmd.exe", Kind: "cmd", Available: true, Default: false },
        { ID: "powershell", Label: "Windows PowerShell", Shell: "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe", Args: ["-NoLogo"], Detail: "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe", Kind: "powershell", Available: true, Default: true },
        { ID: "pwsh", Label: "PowerShell 7", Shell: "C:/Program Files/PowerShell/7/pwsh.exe", Args: ["-NoLogo"], Detail: "C:/Program Files/PowerShell/7/pwsh.exe", Kind: "pwsh", Available: true, Default: false },
        { ID: "gitbash", Label: "Git Bash", Shell: "", Args: ["--login", "-i"], Detail: "", Kind: "bash", Available: false, Default: false },
      ]
      case "Read": return { Data: "", Offset: 0, Closed: false, Reset: false }
      case "Commands": return structuredClone(terminalCommands[args[0] as string] || [])
      case "SaveCommands": {
        const project = args[0] as string
        const saved = (args[1] as TerminalCommand[]).map((command, index) => ({ ...command, ID: command.ID || `cmd-${index + 1}` }))
        terminalCommands[project] = saved
        return structuredClone(saved)
      }
      case "Write": terminalWrites.push(args[1] as string); return
      case "Resize": return
      case "Close": closedTerminals.push(args[0] as string); return
      case "RebasePlan": return [commit()]
      case "OpenPath": opened.push(args[0] as string); return
      case "Reveal": case "SaveText": case "OpenURL": return
      default: throw new Error(`Unhandled test call ${name}`)
    }
  }
  return { state, call, writes, copied, selections, opened, terminals, closedTerminals, terminalShells, terminalWrites, get terminalCommands() { return terminalCommands[alpha] || [] }, snapshot, content }
}
