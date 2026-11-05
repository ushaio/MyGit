import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, it, vi } from "vitest"
import { ThemeProvider } from "@/lib/theme"
import { Call } from "@wailsio/runtime"
import { TooltipProvider } from "@/components/ui/tooltip"
import { WorkbenchProvider, useWorkbench } from "@/lib/workbench"
import { alpha, beta, createBackend } from "./backend"

let backend: ReturnType<typeof createBackend>
beforeEach(() => {
  backend = createBackend()
  vi.mocked(Call.ByName).mockReset()
  vi.mocked(Call.ByName).mockImplementation(backend.call as typeof Call.ByName)
})

function Probe() {
  const w = useWorkbench()
  return (
    <div>
      <button onClick={() => void w.openTerminal(alpha)}>open-alpha</button>
      <button onClick={() => void w.openTerminal(beta)}>open-beta</button>
      <button onClick={() => w.selectProject(alpha)}>select-alpha</button>
      <button onClick={() => w.selectProject(beta)}>select-beta</button>
      <button
        onClick={() =>
          void w.saveCommands([
            {
              ID: "",
              Label: "Dev server",
              Command: "npm run dev",
              Profile: "",
              Path: alpha,
            },
          ])
        }
      >
        add-command
      </button>
      <button
        onClick={() =>
          w.runCommand({
            ID: "",
            Label: "Dev server",
            Command: "npm run dev",
            Profile: "",
            Path: alpha,
          })
        }
      >
        run-command
      </button>
      <output data-testid="active">{w.activeTerminal}</output>
      <output data-testid="project">{w.project}</output>
      <output data-testid="mine">
        {w.terminalsFor(w.project).map((tab) => tab.id).join(",")}
      </output>
      <output data-testid="labels">
        {w.terminalsFor(w.project).map((tab) => tab.label).join(",")}
      </output>
      <output data-testid="commands">
        {w.commands.map((command) => command.Label).join(",")}
      </output>
    </div>
  )
}

function mount() {
  return render(
    <ThemeProvider attribute="class" forcedTheme="light">
      <TooltipProvider delayDuration={0}>
        <WorkbenchProvider>
          <Probe />
        </WorkbenchProvider>
      </TooltipProvider>
    </ThemeProvider>,
  )
}

it("keeps the active terminal inside the selected project", async () => {
  mount()
  const user = userEvent.setup()
  await waitFor(() =>
    expect(screen.getByTestId("project")).toHaveTextContent(alpha),
  )

  // Open a terminal on alpha, then on beta. Each project remembers its own tab.
  await user.click(screen.getByRole("button", { name: "open-alpha" }))
  await waitFor(() =>
    expect(screen.getByTestId("active")).toHaveTextContent("term-1"),
  )

  await user.click(screen.getByRole("button", { name: "open-beta" }))
  await waitFor(() =>
    expect(screen.getByTestId("project")).toHaveTextContent(beta),
  )
  await waitFor(() =>
    expect(screen.getByTestId("active")).toHaveTextContent("term-2"),
  )
  expect(screen.getByTestId("mine")).toHaveTextContent("term-2")

  // Switching back to alpha must restore alpha's terminal, not beta's.
  await user.click(screen.getByRole("button", { name: "select-alpha" }))
  await waitFor(() =>
    expect(screen.getByTestId("project")).toHaveTextContent(alpha),
  )
  await waitFor(() =>
    expect(screen.getByTestId("active")).toHaveTextContent("term-1"),
  )
  expect(screen.getByTestId("mine")).toHaveTextContent("term-1")
})

it("keeps the terminal command sidebar bound to the selected project", async () => {
  mount()
  const user = userEvent.setup()
  await waitFor(() =>
    expect(screen.getByTestId("project")).toHaveTextContent(alpha),
  )
  expect(screen.getByTestId("commands")).toHaveTextContent("")

  // A command saved on alpha stays on alpha.
  await user.click(screen.getByRole("button", { name: "add-command" }))
  await waitFor(() =>
    expect(screen.getByTestId("commands")).toHaveTextContent("Dev server"),
  )
  expect(backend.terminalCommands).toEqual([
    {
      ID: "cmd-1",
      Label: "Dev server",
      Command: "npm run dev",
      Profile: "",
      Path: alpha,
    },
  ])

  // beta has its own (empty) list.
  await user.click(screen.getByRole("button", { name: "select-beta" }))
  await waitFor(() =>
    expect(screen.getByTestId("project")).toHaveTextContent(beta),
  )
  await waitFor(() => expect(screen.getByTestId("commands")).toHaveTextContent(""))

  // Switching back restores alpha's command.
  await user.click(screen.getByRole("button", { name: "select-alpha" }))
  await waitFor(() =>
    expect(screen.getByTestId("project")).toHaveTextContent(alpha),
  )
  await waitFor(() =>
    expect(screen.getByTestId("commands")).toHaveTextContent("Dev server"),
  )
})

it("names a shortcut terminal after its command instead of the folder", async () => {
  mount()
  const user = userEvent.setup()
  await waitFor(() =>
    expect(screen.getByTestId("project")).toHaveTextContent(alpha),
  )
  await user.click(screen.getByRole("button", { name: "run-command" }))
  await waitFor(() =>
    expect(screen.getByTestId("labels")).toHaveTextContent("Dev server"),
  )
  // The folder name must not leak into the tab label.
  expect(screen.getByTestId("labels")).not.toHaveTextContent("alpha")
})

it("closes the active terminal tab on Ctrl+W", async () => {
  mount()
  const user = userEvent.setup()
  await waitFor(() =>
    expect(screen.getByTestId("project")).toHaveTextContent(alpha),
  )
  await user.click(screen.getByRole("button", { name: "open-alpha" }))
  await waitFor(() =>
    expect(screen.getByTestId("active")).toHaveTextContent("term-1"),
  )

  fireEvent.keyDown(window, { key: "w", ctrlKey: true })

  await waitFor(() =>
    expect(screen.getByTestId("mine").textContent).toBe(""),
  )
  expect(backend.closedTerminals).toEqual(["term-1"])
})
