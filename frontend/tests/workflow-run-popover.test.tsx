import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { Workflow, type WorkflowInput } from "@/lib/api";
import { LanguageProvider } from "@/lib/i18n";
import { WorkflowRunPopover } from "@/components/workflow-run-popover";

vi.mock("@/lib/api", () => ({ Workflow: { Inputs: vi.fn(), Dispatch: vi.fn() } }));
const target = { Platform: "github", Host: "github.com", APIHost: "api.github.com", Owner: "owner", Repo: "repo", Remote: "origin", WebURL: "https://github.com/owner/repo" };
const workflow = { ID: 42, Name: "Package", Path: ".github/workflows/package.yml", State: "active", HTMLURL: "" };
function input(Name: string, Type = "string", extra: Partial<WorkflowInput> = {}): WorkflowInput {
  return { Name, Type, Description: "", Required: false, Default: "", Options: [], ...extra };
}
function mount(props = {}) {
  const onDispatched = vi.fn();
  const ui = (extra = {}) => <LanguageProvider language="en"><WorkflowRunPopover target={target} workflow={workflow} branches={["master", "dev"]} initialRef="master" onDispatched={onDispatched} {...props} {...extra} /></LanguageProvider>;
  const view = render(ui());
  return { ...view, onDispatched, ui };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(Workflow.Inputs).mockResolvedValue([]);
  vi.mocked(Workflow.Dispatch).mockResolvedValue(undefined);
});

it("opens the input form directly, preserves choice/boolean defaults, and submits entered values", async () => {
  const defs = [
    input("mode", "choice", { Description: "Run mode", Options: ["verify", "release"] }),
    input("version", "string", { Description: "Release version" }),
    input("dry_run", "boolean", { Required: true }),
    input("attempts", "number", { Default: "2" }),
  ];
  vi.mocked(Workflow.Inputs).mockResolvedValue(defs);
  const user = userEvent.setup();
  const { onDispatched } = mount();
  await user.click(screen.getByRole("button", { name: "Run workflow" }));
  const popup = screen.getByRole("dialog", { name: "Run workflow" });
  expect(await within(popup).findByRole("combobox", { name: "mode" })).toHaveTextContent("verify");
  expect(Workflow.Inputs).toHaveBeenCalledWith(target, workflow.Path, "master");
  expect(Workflow.Dispatch).not.toHaveBeenCalled();
  expect(within(popup).queryByText("Run this workflow?")).not.toBeInTheDocument();
  await user.type(within(popup).getByRole("textbox", { name: "version" }), "0.3.2");
  await user.clear(within(popup).getByRole("spinbutton", { name: "attempts" }));
  await user.type(within(popup).getByRole("spinbutton", { name: "attempts" }), "3");
  await user.click(within(popup).getByRole("button", { name: "Start run" }));
  await waitFor(() => expect(Workflow.Dispatch).toHaveBeenCalledWith(target, 42, "master", [
    { ...defs[0], Default: "verify" }, { ...defs[1], Default: "0.3.2" },
    { ...defs[2], Default: "false" }, { ...defs[3], Default: "3" },
  ]));
  expect(onDispatched).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("blocks running until loading succeeds and retries input failures in place", async () => {
  let resolve!: (defs: WorkflowInput[]) => void;
  vi.mocked(Workflow.Inputs).mockRejectedValueOnce(new Error("Cannot read workflow"))
    .mockImplementationOnce(() => new Promise((done) => { resolve = done; }) as ReturnType<typeof Workflow.Inputs>);
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole("button", { name: "Run workflow" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Cannot read workflow");
  expect(screen.getByRole("button", { name: "Start run" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(screen.getByRole("status")).toHaveTextContent("Loading workflow inputs…");
  fireEvent.submit(screen.getByRole("button", { name: "Start run" }).closest("form")!);
  expect(Workflow.Dispatch).not.toHaveBeenCalled();
  await act(async () => { resolve([]); });
  expect(screen.getByText("This workflow has no inputs.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Start run" }));
  expect(Workflow.Dispatch).toHaveBeenCalledWith(target, 42, "master", []);
});

it("reloads inputs for the selected branch and ignores a late response from the old branch", async () => {
  let resolveOld!: (defs: WorkflowInput[]) => void;
  vi.mocked(Workflow.Inputs).mockImplementationOnce(() => new Promise((done) => { resolveOld = done; }) as ReturnType<typeof Workflow.Inputs>)
    .mockResolvedValueOnce([input("dev_only", "string", { Default: "dev value" })]);
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole("button", { name: "Run workflow" }));
  await user.click(screen.getByRole("combobox", { name: "Ref" }));
  await user.click(screen.getByRole("option", { name: "dev" }));
  expect(await screen.findByRole("textbox", { name: "dev_only" })).toHaveValue("dev value");
  expect(Workflow.Inputs).toHaveBeenLastCalledWith(target, workflow.Path, "dev");
  await act(async () => { resolveOld([input("master_only")]); });
  expect(screen.queryByRole("textbox", { name: "master_only" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Start run" }));
  expect(Workflow.Dispatch).toHaveBeenCalledWith(target, 42, "dev", [input("dev_only", "string", { Default: "dev value" })]);
});

it("ignores closed requests and preserves values when dispatch fails", async () => {
  let resolveOld!: (defs: WorkflowInput[]) => void;
  vi.mocked(Workflow.Inputs).mockImplementationOnce(() => new Promise((done) => { resolveOld = done; }) as ReturnType<typeof Workflow.Inputs>)
    .mockResolvedValueOnce([input("version", "string", { Required: true })]);
  vi.mocked(Workflow.Dispatch).mockRejectedValueOnce(new Error("Permission denied"));
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole("button", { name: "Run workflow" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Run workflow" }));
  const version = await screen.findByRole("textbox", { name: "version" });
  await act(async () => { resolveOld([input("obsolete")]); });
  expect(screen.queryByRole("textbox", { name: "obsolete" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Start run" }));
  expect(Workflow.Dispatch).not.toHaveBeenCalled();
  await user.type(version, "0.3.2");
  await user.click(screen.getByRole("button", { name: "Start run" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Permission denied");
  expect(version).toHaveValue("0.3.2");
  await user.click(screen.getByRole("button", { name: "Start run" }));
  expect(Workflow.Dispatch).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
