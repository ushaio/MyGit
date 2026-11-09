import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, it, vi } from "vitest"
import { ThemeProvider } from "@/lib/theme"
import { Call, Events, Window } from "@wailsio/runtime"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { WorkbenchProvider } from "@/lib/workbench"
import App from "@/App"
import { APP_VERSION } from "@/lib/app-info"
import { alpha, beta, createBackend, linked } from "./backend"

vi.mock("@/components/terminal", () => ({ TerminalPane: () => null }))
let backend: ReturnType<typeof createBackend>
beforeEach(() => { localStorage.clear(); backend = createBackend(); vi.mocked(Call.ByName).mockReset(); vi.mocked(Call.ByName).mockImplementation(backend.call as typeof Call.ByName); vi.mocked(Window.Close).mockClear() })
function mount() { return render(<ThemeProvider attribute="class" forcedTheme="light"><TooltipProvider delayDuration={0}><WorkbenchProvider><App /></WorkbenchProvider><Toaster /></TooltipProvider></ThemeProvider>) }
async function ready() { mount(); await screen.findByRole("button", { name: "Stage all" }); return userEvent.setup() }

it("badges projects with open terminals and expands their terminal list", async () => {
  const user = await ready()
  await user.click(screen.getByRole("button", { name: /Pinned/ }))
  const alphaRow = screen.getAllByRole("button", { name: "alpha" }).find((el) => el.classList.contains("nav-project"))!
  fireEvent.contextMenu(alphaRow, { button: 2, clientX: 120, clientY: 120 })
  await user.click(await screen.findByRole("menuitem", { name: "New terminal" }))
  await waitFor(() => expect(backend.terminals).toEqual([alpha]))
  const toggle = await screen.findByRole("button", { name: "Show terminals (1)" })
  expect(toggle).toHaveAttribute("aria-expanded", "false")
  await user.click(toggle)
  expect(toggle).toHaveAttribute("aria-expanded", "true")
  await screen.findByRole("button", { name: "Terminal: alpha" })

  fireEvent.contextMenu(alphaRow, { button: 2, clientX: 120, clientY: 120 })
  await user.click(await screen.findByRole("menuitem", { name: "New terminal" }))
  await waitFor(() => expect(backend.terminals).toEqual([alpha, alpha]))
  expect(await screen.findByRole("button", { name: "Show terminals (2)" })).toBeInTheDocument()
  await screen.findByRole("button", { name: "Terminal: alpha 2" })
  await user.click(screen.getByRole("button", { name: "Terminal: alpha" }))
  await waitFor(() => expect(screen.getByRole("button", { name: "Terminal: alpha" })).toHaveAttribute("data-active", "true"))
})
it("loads a repository and stages actual selected files", async () => {
  const user = await ready()
  await user.click(screen.getByRole("button", { name: "Stage all" }))
  await waitFor(() => expect(backend.writes).toHaveLength(1))
  expect(backend.writes[0]).toMatchObject({ Kind: "stage", Path: alpha, Area: 2, Files: ["src/main.go"] })
})
it("stages a single file from the row action", async () => {
  const user = await ready()
  await user.click(screen.getByRole("button", { name: "Stage file src/main.go" }))
  await waitFor(() => expect(backend.writes).toHaveLength(1))
  expect(backend.writes[0]).toMatchObject({ Kind: "stage", Path: alpha, Area: 2, Files: ["src/main.go"] })
})
it("copies code content from the diff toolbar", async () => {
  const user = await ready()
  await user.click(await screen.findByRole("button", { name: "Copy content" }))
  await waitFor(() => expect(backend.copied).toEqual(["package new\n"]))
})
it("offers copy commands in the diff context menu", async () => {
  await ready()
  const diff = await screen.findByLabelText("Changes")
  fireEvent.contextMenu(diff, { button: 2, clientX: 500, clientY: 200 })
  const item = await screen.findByRole("menuitem", { name: "Copy after" })
  fireEvent.click(item)
  await waitFor(() => expect(backend.copied).toEqual(["package new\n"]))
})
it("does not checkout merely by browsing another worktree", async () => {
  const user = await ready()
  await user.click(screen.getByRole("button", { name: /^Worktrees/ }))
  await user.dblClick(screen.getByRole("button", { name: "feature" }))
  await waitFor(() => expect(backend.selections).toContainEqual([alpha, linked]))
  expect(backend.writes).toHaveLength(0)
})
it("requires confirmation before creating a branch", async () => {
  const user = await ready()
  await user.click(screen.getByRole("button", { name: "New branch" }))
  const dialog = await screen.findByRole("dialog")
  await user.clear(within(dialog).getByRole("textbox", { name: "Name" }))
  await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "feature/ui")
  expect(backend.writes).toHaveLength(0)
  await user.click(within(dialog).getByRole("button", { name: "Confirm" }))
  await waitFor(() => expect(backend.writes).toHaveLength(1))
  expect(backend.writes[0]).toMatchObject({ Kind: "branch", Name: "feature/ui", Ref: "HEAD", Confirm: true })
})
it("retains a commit draft when leaving and returning to changes", async () => {
  const user = await ready()
  await user.type(screen.getByRole("textbox", { name: "Commit message" }), "Keep this draft")
  await user.click(screen.getByRole("button", { name: "All commits" }))
  await waitFor(() => expect(backend.state.Drafts?.[alpha]).toBe("Keep this draft"))
  await user.click(screen.getByRole("button", { name: /Current changes/ }))
  expect(await screen.findByRole("textbox", { name: "Commit message" })).toHaveValue("Keep this draft")
})
it("writes a commit message from the staged changes", async () => {
  const user = await ready()
  const box = screen.getByRole("textbox", { name: "Commit message" })
  await user.type(box, "old draft")
  await user.click(screen.getByRole("button", { name: "Generate commit message" }))
  await waitFor(() => expect(box).toHaveValue("feat: describe the staged changes"))
  await user.click(await screen.findByRole("button", { name: "Undo" }))
  expect(box).toHaveValue("old draft")
})
it("refreshes without changing the chosen view", async () => {
  const user = await ready()
  await user.click(screen.getByRole("button", { name: "All commits" }))
  await screen.findByRole("textbox", { name: "Search history…" })
  await user.keyboard("{Control>}r{/Control}")
  expect(await screen.findByRole("textbox", { name: "Search history…" })).toBeInTheDocument()
  expect(screen.queryByRole("textbox", { name: "Commit message" })).not.toBeInTheDocument()
})
it("ignores a late response from a previously selected repository", async () => {
  let release: (value: unknown) => void = () => {}
  const delayed = new Promise(resolve => { release = resolve })
  vi.mocked(Call.ByName).mockImplementation(((name: string, ...args: unknown[]) => name.endsWith(".Snapshot") && args[0] === alpha ? delayed : backend.call(name, ...args)) as typeof Call.ByName)
  mount()
  const user = userEvent.setup()
  await user.click(await screen.findByRole("button", { name: /Ungrouped projects/ }))
  await user.click(await screen.findByRole("button", { name: "beta" }))
  await screen.findByRole("textbox", { name: "Search history…" })
  await act(async () => { release(backend.snapshot(alpha)); await delayed })
  expect(document.querySelector("header")).toHaveTextContent("beta")
  expect(document.querySelector("footer")).toHaveTextContent(beta)
})
it("keeps AI settings in a sectioned settings dialog", async () => {
  const user = await ready()
  await user.click(screen.getByRole("button", { name: "Settings" }))
  const dialog = await screen.findByRole("dialog")
  await user.click(within(dialog).getByRole("button", { name: "AI" }))
  await user.type(within(dialog).getByLabelText("API URL"), "https://api.example.com/v1")
  await user.type(within(dialog).getByLabelText("API Key"), "sk-test")
  await user.click(within(dialog).getByRole("button", { name: "Fetch models" }))
  await waitFor(() => expect(within(dialog).getByText("2 models available")).toBeInTheDocument())
  await user.click(within(dialog).getByRole("combobox", { name: "Model" }))
  await user.click(await screen.findByRole("option", { name: "deepseek-chat" }))
  await user.type(within(dialog).getByLabelText("Commit message prompt"), "Write in Chinese.")
  expect(await within(dialog).findByText("Show the built-in prompt")).toBeInTheDocument()
  await user.click(within(dialog).getByRole("button", { name: "Save" }))
  await waitFor(() => expect(backend.state.Preferences.AIURL).toBe("https://api.example.com/v1"))
  expect(backend.state.Preferences.AIKey).toBe("sk-test")
  expect(backend.state.Preferences.AIModel).toBe("deepseek-chat")
  expect(backend.state.Preferences.AICommitPrompt).toBe("Write in Chinese.")
})
it("saves the default view from the general settings", async () => {
  const user = await ready()
  await user.click(screen.getByRole("button", { name: "Settings" }))
  const dialog = await screen.findByRole("dialog")
  expect(within(dialog).getByRole("combobox", { name: "Default view" })).toHaveTextContent("Git")
  await user.click(within(dialog).getByRole("combobox", { name: "Default view" }))
  await user.click(await screen.findByRole("option", { name: "Terminal" }))
  await user.click(within(dialog).getByRole("button", { name: "Save" }))
  await waitFor(() => expect(backend.state.Preferences.DefaultView).toBe("terminal"))
})
it("opens a terminal on launch when the terminal view is the default", async () => {
  backend.state.Preferences.DefaultView = "terminal"
  await ready()
  await waitFor(() => expect(backend.terminals).toEqual([alpha]))
})
it("opens the data location from the folders section", async () => {
  const user = await ready()
  await user.click(screen.getByRole("button", { name: "Settings" }))
  const dialog = await screen.findByRole("dialog")
  await user.click(within(dialog).getByRole("button", { name: "Folders" }))
  const open = within(dialog).getByRole("button", { name: "Open data location" })
  await waitFor(() => expect(open).toBeEnabled())
  expect(within(dialog).getByText("C:/Users/test/.mygit-wails3")).toBeInTheDocument()
  await user.click(open)
  await waitFor(() => expect(backend.opened).toEqual(["C:/Users/test/.mygit-wails3"]))
})
it("checks for updates before offering the download", async () => {
  backend.checkUpdateResult.Available = true
  backend.checkUpdateResult.Latest = "9.9.9"
  backend.checkUpdateResult.URL = "https://github.com/ushaio/MyGit/releases/tag/v9.9.9"
  const user = await ready()
  await user.click(screen.getByRole("button", { name: "Settings" }))
  const dialog = await screen.findByRole("dialog")
  await user.click(within(dialog).getByRole("button", { name: "About" }))
  expect(within(dialog).getAllByText("v" + APP_VERSION).length).toBeGreaterThan(0)
  expect(
    within(dialog).getByText(/Manage several repositories and all of their worktrees/),
  ).toBeInTheDocument()
  await user.click(
    within(dialog).getByRole("button", { name: "Check for updates" }),
  )
  await waitFor(() =>
    expect(within(dialog).getByText("A new version is available:")).toBeInTheDocument(),
  )
  expect(within(dialog).getByText("v9.9.9")).toBeInTheDocument()
  await user.click(within(dialog).getByRole("button", { name: "Download and install" }))
  await waitFor(() => expect(backend.downloaded).toBe(1))
  await waitFor(() =>
    expect(backend.installed).toEqual(["C:/Temp/MyGit-update/MyGit-amd64-installer.exe"]),
  )
  expect(backend.openedUrls).toEqual([])
})
it("reports when there is no newer version", async () => {
  backend.checkUpdateResult.Available = false
  backend.checkUpdateResult.Latest = "0.2.0"
  const user = await ready()
  await user.click(screen.getByRole("button", { name: "Settings" }))
  const dialog = await screen.findByRole("dialog")
  await user.click(within(dialog).getByRole("button", { name: "About" }))
  await user.click(
    within(dialog).getByRole("button", { name: "Check for updates" }),
  )
  await waitFor(() =>
    expect(
      within(dialog).getByText(/You're running the latest version\./),
    ).toBeInTheDocument(),
  )
  expect(
    within(dialog).queryByRole("button", { name: "Download and install" }),
  ).not.toBeInTheDocument()
})
it("shows a floating update prompt on launch and installs in place", async () => {
  backend.checkUpdateResult.Available = true
  backend.checkUpdateResult.Latest = "9.9.9"
  const user = await ready()
  const prompt = await screen.findByRole("status", { name: "Software update" })
  expect(within(prompt).getByText("v9.9.9")).toBeInTheDocument()
  await user.click(
    within(prompt).getByRole("button", { name: "Download and install" }),
  )
  await waitFor(() => expect(backend.downloaded).toBe(1))
  await waitFor(() =>
    expect(backend.installed).toEqual([
      "C:/Temp/MyGit-update/MyGit-amd64-installer.exe",
    ]),
  )
  expect(backend.openedUrls).toEqual([])
})
it("reorders grouped projects by drag and drop and keeps the order", async () => {
  backend.state.Groups = [{ ID: "g1", Name: "Group one" }]
  for (const child of backend.state.Trees?.[0]?.Children || []) {
    if (child) { child.Group = "g1"; child.Pinned = false }
  }
  const user = await ready()
  await user.click(screen.getByRole("button", { name: /Group one/ }))
  const row = (name: string) => screen.getAllByRole("button", { name }).find((el) => el.classList.contains("nav-project"))!
  fireEvent.dragStart(row("beta"))
  fireEvent.dragOver(row("alpha"))
  fireEvent.drop(row("alpha"))
  await waitFor(() => expect(backend.state.ProjectOrder?.g1).toEqual(["C:/Projects/beta", "C:/Projects/alpha"]))
  // The rendered order follows the saved order.
  const labels = screen.getAllByRole("button").filter((el) => el.classList.contains("nav-project")).map((el) => el.textContent)
  expect(labels).toEqual(["beta", "alpha"])
})
it("turns platforms into tabs and lists a repository under each host it uses", async () => {
  backend.state.Groups = [{ ID: "g1", Name: "Group one" }]
  const children = backend.state.Trees?.[0]?.Children || []
  const alphaNode = children.find((child) => child?.Path === alpha)!
  const betaNode = children.find((child) => child?.Path === beta)!
  alphaNode.Pinned = false
  alphaNode.Source = "github"
  alphaNode.Sources = ["github", "gitee"]
  alphaNode.Group = "g1"
  betaNode.Source = "github"
  betaNode.Sources = ["github"]
  const user = await ready()
  // "All" keeps the groups and the ungrouped tree; the fixed GitHub section is
  // gone, and a host tab only exists while a project uses it.
  const tabs = screen.getAllByRole("tab").map((el) => el.textContent)
  expect(tabs).toEqual(["All", "GitHub", "Gitee"])
  await user.click(screen.getByRole("button", { name: /Group one/ }))
  await user.click(screen.getByRole("button", { name: /Ungrouped projects/ }))
  const listed = () =>
    screen
      .getAllByRole("button")
      .filter((el) => el.classList.contains("nav-project"))
      .map((el) => el.textContent)
  expect(listed()).toEqual(["alpha", "beta"])

  // GitHub aggregates the repositories whose sources include github.
  await user.click(screen.getByRole("tab", { name: "GitHub" }))
  expect(listed()).toEqual(["alpha", "beta"])
  // Gitee lists only alpha, which is mirrored there as well.
  await user.click(screen.getByRole("tab", { name: "Gitee" }))
  expect(listed()).toEqual(["alpha"])
  // Platform rows keep the full project menu, including grouping.
  const row = screen
    .getAllByRole("button", { name: "alpha" })
    .find((el) => el.classList.contains("nav-project"))!
  fireEvent.contextMenu(row, { button: 2, clientX: 120, clientY: 120 })
  expect(
    await screen.findByRole("menuitem", { name: "Set group" }),
  ).toBeInTheDocument()
})
it("labels grouping as Move to group for plain projects", async () => {
  const user = await ready()
  await user.click(screen.getByRole("button", { name: /Ungrouped projects/ }))
  const row = screen
    .getAllByRole("button", { name: "beta" })
    .find((el) => el.classList.contains("nav-project"))!
  fireEvent.contextMenu(row, { button: 2, clientX: 120, clientY: 120 })
  expect(
    await screen.findByRole("menuitem", { name: "Move to group" }),
  ).toBeInTheDocument()
})
it("never lists a project under two groups", async () => {
  // Workspace files from older builds could hold groups without an id, and an
  // empty id matched every ungrouped project in every such group.
  backend.state.Groups = [
    { ID: "", Name: "MO Gallery" },
    { ID: "", Name: "Fork" },
  ]
  const children = backend.state.Trees?.[0]?.Children || []
  children.forEach((child) => {
    if (child) child.Pinned = false
  })
  const user = await ready()
  await user.click(screen.getByRole("button", { name: /Ungrouped projects/ }))
  const labels = screen
    .getAllByRole("button")
    .filter((el) => el.classList.contains("nav-project"))
    .map((el) => el.textContent)
  expect(labels).toEqual(["alpha", "beta"])
  expect(screen.queryByText("MO Gallery")).not.toBeInTheDocument()
})
it("offers clone and add-folder from the sidebar add button", async () => {
  const user = await ready()
  vi.mocked(Call.ByName).mockImplementation(((name: string, ...args: unknown[]) =>
    name.endsWith(".ChooseFolder")
      ? Promise.resolve("C:/Clone")
      : backend.call(name, ...args)) as typeof Call.ByName)
  await user.click(screen.getByRole("button", { name: "Add folder" }))
  const dialog = await screen.findByRole("dialog")
  expect(within(dialog).getByText("Clone from Git")).toBeInTheDocument()
  expect(
    within(dialog).getByText("Add a local folder you already have."),
  ).toBeInTheDocument()
  await user.click(within(dialog).getByRole("button", { name: /Clone from Git/ }))
  const address = await within(dialog).findByRole("textbox", {
    name: "Repository address",
  })
  await user.type(address, "https://github.com/example/repo.git")
  await user.click(within(dialog).getByRole("button", { name: "Confirm" }))
  await waitFor(() => expect(backend.state.Selected).toBe("C:/Clone/repo"))
  expect(
    await within(dialog).findByRole("button", { name: "Done" }),
  ).toBeInTheDocument()
})
it("asks what closing should do and remembers the choice", async () => {
  const listeners: Record<string, () => void> = {}
  vi.mocked(Events.On).mockImplementation(((name: string, callback: () => void) => { listeners[name] = callback; return () => {} }) as typeof Events.On)
  mount()
  await screen.findByRole("button", { name: "Stage all" })
  const user = userEvent.setup()
  await act(async () => { listeners["app:close-request"]?.() })
  const dialog = await screen.findByRole("dialog")
  await user.click(within(dialog).getByRole("checkbox", { name: "Remember my choice" }))
  await user.click(within(dialog).getByRole("button", { name: "Quit app" }))
  await waitFor(() => expect(Call.ByName).toHaveBeenCalledWith("mygit-wails3/internal/services.AppService.ResolveClose", "exit", true))
  await waitFor(() => expect(Window.Close).toHaveBeenCalled())
  await waitFor(() => expect(backend.state.Preferences.CloseAction).toBe("exit"))
  expect(backend.state.Preferences.CloseConfirm).toBe(false)
})
it("re-enables the quit reminder from settings", async () => {
  backend.state.Preferences.CloseConfirm = false
  const user = await ready()
  await user.click(screen.getByRole("button", { name: "Settings" }))
  const dialog = await screen.findByRole("dialog")
  const checkbox = within(dialog).getByRole("checkbox", { name: "Quit reminder" })
  expect(checkbox).not.toBeChecked()
  await user.click(checkbox)
  await user.click(within(dialog).getByRole("button", { name: "Save" }))
  await waitFor(() => expect(backend.state.Preferences.CloseConfirm).toBe(true))
})
it("starts every project section collapsed and restores the last open state", async () => {
  const view = mount()
  await screen.findByRole("button", { name: "Stage all" })
  const user = userEvent.setup()
  const navRows = () =>
    screen
      .queryAllByRole("button")
      .filter((el) => el.classList.contains("nav-project"))
      .map((el) => el.textContent)
  expect(navRows()).toEqual([])
  const pinned = screen.getByRole("button", { name: /Pinned/ })
  expect(pinned).toHaveAttribute("data-state", "closed")

  await user.click(pinned)
  expect(pinned).toHaveAttribute("data-state", "open")
  expect(navRows()).toEqual(["alpha"])
  expect(localStorage.getItem("mygit:section:projects:pinned")).toBe("open")

  // Opening the app again rebuilds the sidebar from the remembered state.
  view.unmount()
  mount()
  await screen.findByRole("button", { name: "Stage all" })
  expect(screen.getByRole("button", { name: /Pinned/ })).toHaveAttribute("data-state", "open")
  expect(navRows()).toEqual(["alpha"])
})
