import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, it, vi } from "vitest"
import { ThemeProvider } from "@/lib/theme"
import { Call } from "@wailsio/runtime"
import { TooltipProvider } from "@/components/ui/tooltip"
import { LanguageProvider } from "@/lib/i18n"
import { WorkbenchProvider, useWorkbench } from "@/lib/workbench"
import { RestoreTerminalsDialog } from "@/components/restore-terminals"
import { alpha, createBackend } from "./backend"

let backend: ReturnType<typeof createBackend>
beforeEach(() => {
  backend = createBackend()
  vi.mocked(Call.ByName).mockReset()
  vi.mocked(Call.ByName).mockImplementation(backend.call as typeof Call.ByName)
})

function Probe() {
  const w = useWorkbench()
  return (
    <>
      <output data-testid="labels">
        {w.terminalsFor(w.project).map((tab) => tab.label).join(",")}
      </output>
      <output data-testid="page">{w.page}</output>
    </>
  )
}

function mount() {
  return render(
    <ThemeProvider attribute="class" forcedTheme="light">
      <TooltipProvider delayDuration={0}>
        <LanguageProvider language="en">
          <WorkbenchProvider>
            <RestoreTerminalsDialog />
            <Probe />
          </WorkbenchProvider>
        </LanguageProvider>
      </TooltipProvider>
    </ThemeProvider>,
  )
}

it("offers the saved terminals on launch and reopens them with their commands", async () => {
  backend.lastSession.Tabs = [
    { Project: alpha, Path: alpha, Label: "Dev server", Profile: "cmd", Command: "npm run dev" },
  ]
  backend.lastSession.Active = 0
  backend.lastSession.Page = "terminal"
  mount()
  const dialog = await screen.findByRole("dialog")
  expect(within(dialog).getByText("Dev server")).toBeInTheDocument()
  expect(within(dialog).getByText("npm run dev")).toBeInTheDocument()
  const user = userEvent.setup()
  await user.click(within(dialog).getByRole("button", { name: "Restore" }))
  await waitFor(() => expect(backend.terminals).toEqual([alpha]))
  expect(backend.terminalShells).toEqual(["cmd"])
  expect(backend.terminalWrites).toContain("npm run dev\r")
  expect(screen.getByTestId("labels")).toHaveTextContent("Dev server")
  expect(screen.getByTestId("page")).toHaveTextContent("terminal")
})

it("declines the restore and clears the saved layout", async () => {
  backend.lastSession.Tabs = [{ Project: alpha, Path: alpha, Label: "Shell" }]
  mount()
  const dialog = await screen.findByRole("dialog")
  const user = userEvent.setup()
  await user.click(within(dialog).getByRole("button", { name: "Don't restore" }))
  await waitFor(() => expect(backend.lastSession.Tabs).toEqual([]))
  expect(backend.terminals).toEqual([])
})
