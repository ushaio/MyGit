import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, it, vi } from "vitest"
import { ThemeProvider } from "@/lib/theme"
import { Call } from "@wailsio/runtime"
import { TooltipProvider } from "@/components/ui/tooltip"
import { WorkbenchProvider } from "@/lib/workbench"
import App from "@/App"
import { alpha, beta, createBackend, linked } from "./backend"

let backend: ReturnType<typeof createBackend>
beforeEach(() => { backend = createBackend(); vi.mocked(Call.ByName).mockReset(); vi.mocked(Call.ByName).mockImplementation(backend.call as typeof Call.ByName) })
function mount() { return render(<ThemeProvider attribute="class" forcedTheme="light"><TooltipProvider delayDuration={0}><WorkbenchProvider><App /></WorkbenchProvider></TooltipProvider></ThemeProvider>) }
async function ready() { mount(); await screen.findByRole("button", { name: "Stage all" }); return userEvent.setup() }

it("loads a repository and stages actual selected files", async () => {
  const user = await ready()
  await user.click(screen.getByRole("button", { name: "Stage all" }))
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
  await user.click(within(dialog).getByRole("button", { name: "Save" }))
  await waitFor(() => expect(backend.state.Preferences.AIURL).toBe("https://api.example.com/v1"))
  expect(backend.state.Preferences.AIKey).toBe("sk-test")
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
