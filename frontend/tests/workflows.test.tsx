import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageProvider } from "@/lib/i18n";
import { useWorkbench, report } from "@/lib/workbench";
import {
  Workflow,
  Desktop,
  type WorkflowJob,
  type WorkflowRun,
} from "@/lib/api";
import { WorkflowsBar, WorkflowRunsView } from "@/components/workflows";

vi.mock("@/lib/api", () => ({
  Workflow: {
    ResolveTarget: vi.fn(),
    Capabilities: vi.fn(),
    Account: vi.fn(),
    SaveToken: vi.fn(),
    DeleteToken: vi.fn(),
    ListWorkflows: vi.fn(),
    ListRuns: vi.fn(),
    Jobs: vi.fn(),
    Graph: vi.fn(),
    JobLogs: vi.fn(),
    Inputs: vi.fn(),
    Dispatch: vi.fn(),
    Rerun: vi.fn(),
    Cancel: vi.fn(),
  },
  Desktop: { OpenURL: vi.fn() },
}));

vi.mock("@/lib/workbench", () => ({
  useWorkbench: vi.fn(),
  report: vi.fn(),
}));

const githubTarget = {
  Platform: "github",
  Host: "github.com",
  APIHost: "api.github.com",
  Owner: "octocat",
  Repo: "hello",
  Remote: "origin",
  WebURL: "https://github.com/octocat/hello",
};

const allCapabilities = {
  ListWorkflows: true,
  ListRuns: true,
  Dispatch: true,
  Rerun: true,
  Cancel: true,
  OpenWeb: true,
};

const defaultWorkflow = {
  ID: 10,
  Name: "Workflow A",
  Path: ".github/workflows/a.yml",
  State: "active",
  HTMLURL: "https://github.com/octocat/hello/actions/workflows/a.yml",
};

const defaultRun: WorkflowRun = {
  ID: 9001,
  WorkflowID: 10,
  Number: 7,
  Title: "Update main",
  Status: "completed",
  Conclusion: "success",
  Branch: "main",
  HeadSHA: "a".repeat(40),
  Event: "push",
  CreatedAt: "2026-01-01T00:00:00Z",
  UpdatedAt: "2026-01-01T00:05:00Z",
  HTMLURL: "https://github.com/octocat/hello/actions/runs/9001",
};
const buildJob: WorkflowJob = {
  ID: 501,
  RunID: 9001,
  Name: "Build & Package (windows)",
  Status: "completed",
  Conclusion: "success",
  StartedAt: defaultRun.CreatedAt,
  CompletedAt: defaultRun.UpdatedAt,
  Steps: [
    {
      Number: 1,
      Name: "Set up job",
      Status: "completed",
      Conclusion: "success",
      StartedAt: defaultRun.CreatedAt,
      CompletedAt: "2026-01-01T00:00:05Z",
    },
  ],
};
const publishJob: WorkflowJob = {
  ...buildJob,
  ID: 502,
  Name: "Publish release",
  Steps: [],
};

function mockRunHistory() {
  vi.mocked(Workflow.ListRuns).mockResolvedValue({
    Runs: [defaultRun],
    Total: 1,
    Page: 1,
    PerPage: 30,
    HasMore: false,
  });
  vi.mocked(Workflow.Jobs).mockResolvedValue({
    Jobs: [buildJob, publishJob],
    Total: 2,
  });
}

function resetDefaults() {
  vi.mocked(Workflow.ResolveTarget).mockResolvedValue(githubTarget as never);
  vi.mocked(Workflow.Capabilities).mockResolvedValue(allCapabilities as never);
  vi.mocked(Workflow.Account).mockResolvedValue({
    Platform: "github",
    Host: "github.com",
    Configured: true,
    Account: "octocat",
  } as never);
  vi.mocked(Workflow.ListWorkflows).mockResolvedValue({
    Workflows: [defaultWorkflow],
    Total: 1,
    Page: 1,
    PerPage: 30,
    HasMore: false,
  } as never);
  vi.mocked(Workflow.ListRuns).mockResolvedValue({
    Runs: [],
    Total: 0,
    Page: 1,
    PerPage: 30,
    HasMore: false,
  } as never);
  vi.mocked(Workflow.Inputs).mockResolvedValue([] as never);
  vi.mocked(Workflow.Jobs).mockResolvedValue({ Jobs: [], Total: 0 } as never);
  vi.mocked(Workflow.Graph).mockResolvedValue({
    Nodes: [
      { ID: "build", Name: "Build & Package", Needs: [] },
      { ID: "publish", Name: "Publish release", Needs: ["build"] },
    ],
  });
  vi.mocked(Workflow.JobLogs).mockResolvedValue({
    Steps: [
      {
        Number: 1,
        Content:
          "2026-01-01T00:00:00.0000000Z Current runner version: '2.338.2'\n2026-01-01T00:00:00.1000000Z ##[group]Operating System\n2026-01-01T00:00:00.2000000Z Microsoft Windows Server 2025\n2026-01-01T00:00:00.3000000Z ##[endgroup]\n",
      },
    ],
  });
  vi.mocked(Workflow.Dispatch).mockResolvedValue(undefined as never);
  vi.mocked(Workflow.Rerun).mockResolvedValue(undefined as never);
  vi.mocked(Workflow.Cancel).mockResolvedValue(undefined as never);
  vi.mocked(Desktop.OpenURL).mockResolvedValue(undefined as never);
  vi.mocked(report).mockResolvedValue(undefined as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  resetDefaults();
});

function makeStub(path: string, remoteURL: string) {
  return {
    repo: {
      Path: path,
      Name: path,
      Remotes: { origin: remoteURL },
      Refs: { Branches: [{ Name: "main" }, { Name: "dev" }] },
      Tracking: { Branch: "main" },
    },
    path,
    busy: false,
    settings: false,
    setSettings: vi.fn(),
  };
}

function ui() {
  return (
    <TooltipProvider delayDuration={0}>
      <LanguageProvider language="en">
        <WorkflowsBar />
      </LanguageProvider>
    </TooltipProvider>
  );
}

function renderBar(stub: unknown) {
  vi.mocked(useWorkbench).mockReturnValue(stub as never);
  return render(ui());
}

function runsUi(workflowID = 10) {
  return (
    <TooltipProvider delayDuration={0}>
      <LanguageProvider language="en">
        <WorkflowRunsView workflowID={workflowID} />
      </LanguageProvider>
    </TooltipProvider>
  );
}

function renderRuns(stub: unknown) {
  vi.mocked(useWorkbench).mockReturnValue(stub as never);
  return render(runsUi());
}

async function expand(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Workflows/ }));
}

it("opens job details only after selection and keeps the run list available", async () => {
  mockRunHistory();
  const user = userEvent.setup();
  renderRuns(makeStub("/repo", "https://github.com/octocat/hello.git"));

  const run = await screen.findByRole("button", { name: "Run #7" });
  expect(Workflow.Jobs).not.toHaveBeenCalled();
  await user.click(run);
  const build = await screen.findByRole("button", { name: /Build & Package/ });
  const publish = screen.getByRole("button", { name: /Publish release/ });
  expect(build).toHaveAttribute("aria-pressed", "false");
  expect(publish).toHaveAttribute("aria-pressed", "false");
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  expect(screen.queryByText("Set up job")).not.toBeInTheDocument();

  await user.click(build);
  let details = screen.getByRole("complementary", {
    name: `Jobs: ${buildJob.Name}`,
  });
  const step = within(details).getByRole("button", { name: /Set up job/ });
  expect(step).toHaveAttribute("aria-expanded", "false");
  expect(Workflow.JobLogs).not.toHaveBeenCalled();
  await user.click(step);
  expect(step).toHaveAttribute("aria-expanded", "true");
  const output = await within(details).findByRole("region", {
    name: "Step logs",
  });
  expect(
    within(output).getByText("Current runner version: '2.338.2'"),
  ).toBeVisible();
  const group = within(output)
    .getByText("Operating System")
    .closest("details")!;
  expect(group).not.toHaveAttribute("open");
  expect(
    within(output).getByText("Microsoft Windows Server 2025"),
  ).not.toBeVisible();
  await user.click(within(output).getByText("Operating System"));
  expect(
    within(output).getByText("Microsoft Windows Server 2025"),
  ).toBeVisible();
  expect(Workflow.JobLogs).toHaveBeenCalledWith(
    githubTarget,
    defaultRun.ID,
    buildJob.ID,
  );
  await user.click(step);
  expect(step).toHaveAttribute("aria-expanded", "false");
  expect(output).not.toBeInTheDocument();
  await user.click(step);
  expect(Workflow.JobLogs).toHaveBeenCalledTimes(1);
  expect(run).toBeInTheDocument();
  expect(build).toHaveAttribute("aria-pressed", "true");
  expect(details.parentElement).toBe(
    run.closest("ul")?.parentElement?.parentElement,
  );

  await user.click(publish);
  details = screen.getByRole("complementary", {
    name: `Jobs: ${publishJob.Name}`,
  });
  expect(within(details).getByText("No steps")).toBeInTheDocument();
  expect(screen.queryByText("Set up job")).not.toBeInTheDocument();
  expect(build).toHaveAttribute("aria-pressed", "false");

  await user.click(within(details).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  expect(publish).toHaveAttribute("aria-pressed", "false");
  expect(run).toHaveAttribute("aria-expanded", "true");

  await user.click(build);
  await user.click(run);
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
});

it("waits for dependencies before showing the first job layout", async () => {
  mockRunHistory();
  let resolveGraph!: (value: { Nodes: { ID: string; Name: string; Needs: string[] }[] }) => void;
  vi.mocked(Workflow.Graph).mockImplementationOnce(() => new Promise((resolve) => { resolveGraph = resolve; }) as ReturnType<typeof Workflow.Graph>);
  const user = userEvent.setup();
  renderRuns(makeStub("/repo", "https://github.com/octocat/hello.git"));
  await user.click(await screen.findByRole("button", { name: "Run #7" }));
  const canvas = await screen.findByRole("region", { name: "Job canvas" });
  expect(canvas).toHaveAttribute("aria-busy", "true");
  expect(within(canvas).getByRole("status")).toHaveTextContent("Loading dependencies…");
  expect(canvas.querySelectorAll("[data-workflow-node]")).toHaveLength(0);
  expect(screen.getByRole("button", { name: "Fit to view" })).toBeDisabled();

  resolveGraph({ Nodes: [
    { ID: "build", Name: "Build & Package", Needs: [] },
    { ID: "publish", Name: "Publish release", Needs: ["build"] },
  ] });
  await within(canvas).findByRole("button", { name: /Build & Package/ });
  expect(canvas).toHaveAttribute("aria-busy", "false");
  expect(canvas.querySelectorAll("[data-workflow-node]")).toHaveLength(2);
  expect(canvas.querySelectorAll("[data-workflow-edge]")).toHaveLength(1);
  expect(within(canvas).queryByRole("status")).not.toBeInTheDocument();
});

it("keeps jobs usable when dependencies fail and restores links on retry", async () => {
  mockRunHistory();
  vi.mocked(Workflow.Graph).mockRejectedValueOnce(new Error("Workflow source unavailable"));
  const user = userEvent.setup();
  renderRuns(makeStub("/repo", "https://github.com/octocat/hello.git"));
  await user.click(await screen.findByRole("button", { name: "Run #7" }));
  expect(await screen.findByText("Dependencies unavailable. Showing jobs only.")).toBeVisible();
  const graph = screen.getByRole("region", { name: "Workflow graph" });
  expect(graph.querySelectorAll("[data-workflow-edge]")).toHaveLength(0);
  await user.click(within(graph).getByRole("button", { name: /Build & Package/ }));
  expect(screen.getByRole("complementary")).toBeVisible();
  await user.click(within(graph).getByRole("button", { name: "Retry dependencies" }));
  await waitFor(() => expect(graph.querySelectorAll("[data-workflow-edge]")).toHaveLength(1));
  expect(Workflow.Graph).toHaveBeenCalledWith(githubTarget, defaultRun.ID);
  expect(within(graph).getByRole("button", { name: /Build & Package/ })).toHaveAttribute("aria-pressed", "true");
});

it("ignores dependencies returned after their run was collapsed", async () => {
  mockRunHistory();
  let resolveGraph!: (value: { Nodes: { ID: string; Name: string; Needs: string[] }[] }) => void;
  vi.mocked(Workflow.Graph).mockImplementationOnce(() => new Promise((resolve) => { resolveGraph = resolve; }) as ReturnType<typeof Workflow.Graph>);
  const user = userEvent.setup();
  renderRuns(makeStub("/repo", "https://github.com/octocat/hello.git"));
  const run = await screen.findByRole("button", { name: "Run #7" });
  await user.click(run);
  await screen.findByRole("region", { name: "Workflow graph" });
  await user.click(run);
  resolveGraph({ Nodes: [{ ID: "stale", Name: "Stale job", Needs: [] }] });
  await user.click(run);
  await screen.findByRole("button", { name: /Build & Package/ });
  await waitFor(() => expect(screen.queryByText("Loading dependencies…")).not.toBeInTheDocument());
  expect(screen.queryByText("Stale job")).not.toBeInTheDocument();
});

it("allows retrying unavailable job logs without losing the selected step", async () => {
  mockRunHistory();
  vi.mocked(Workflow.JobLogs).mockRejectedValueOnce(
    new Error("Logs are not available yet"),
  );
  const user = userEvent.setup();
  renderRuns(makeStub("/repo", "https://github.com/octocat/hello.git"));
  await user.click(await screen.findByRole("button", { name: "Run #7" }));
  await user.click(
    await screen.findByRole("button", { name: /Build & Package/ }),
  );
  const step = screen.getByRole("button", { name: /Set up job/ });
  await user.click(step);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Logs are not available yet",
  );
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(
    await screen.findByRole("region", { name: "Step logs" }),
  ).toBeVisible();
  expect(step).toHaveAttribute("aria-expanded", "true");
  expect(Workflow.JobLogs).toHaveBeenCalledTimes(2);
});

it("clears job selection when switching workflows", async () => {
  mockRunHistory();
  const user = userEvent.setup();
  const view = renderRuns(
    makeStub("/repo", "https://github.com/octocat/hello.git"),
  );
  await user.click(await screen.findByRole("button", { name: "Run #7" }));
  await user.click(
    await screen.findByRole("button", { name: /Build & Package/ }),
  );
  expect(screen.getByRole("complementary")).toBeInTheDocument();

  view.rerender(runsUi(0));
  await waitFor(() =>
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument(),
  );
  await user.click(await screen.findByRole("button", { name: "Run #7" }));
  expect(
    await screen.findByRole("button", { name: /Build & Package/ }),
  ).toHaveAttribute("aria-pressed", "false");
});

it("ignores a slow response from the previous repository", async () => {
  const workflowA = { ...defaultWorkflow, ID: 1, Name: "Workflow A" };
  const workflowB = {
    ...defaultWorkflow,
    ID: 2,
    Name: "Workflow B",
    Path: ".github/workflows/b.yml",
  };
  let resolveA!: (value: unknown) => void;
  const pendingA = new Promise((resolve) => {
    resolveA = resolve;
  });

  vi.mocked(Workflow.ResolveTarget).mockImplementation((async (
    _name: string,
    url: string,
  ) => {
    const isB = url.includes("/b.git");
    return {
      Platform: "github",
      Host: "github.com",
      APIHost: "api.github.com",
      Owner: isB ? "b-owner" : "a-owner",
      Repo: "repo",
      Remote: "origin",
      WebURL: url,
    };
  }) as never);
  vi.mocked(Workflow.ListWorkflows).mockImplementation((target: any) => {
    if (target?.Owner === "a-owner") return pendingA as any;
    return Promise.resolve({
      Workflows: [workflowB],
      Total: 1,
      Page: 1,
      PerPage: 30,
      HasMore: false,
    } as never);
  });

  const user = userEvent.setup();
  const view = renderBar(
    makeStub("/repo-a", "https://github.com/a-owner/a.git"),
  );
  await expand(user);
  await waitFor(() => expect(Workflow.ListWorkflows).toHaveBeenCalledTimes(1));

  const stubB = makeStub("/repo-b", "https://github.com/b-owner/b.git");
  vi.mocked(useWorkbench).mockReturnValue(stubB as never);
  view.rerender(ui());

  expect(await screen.findByText("Workflow B")).toBeInTheDocument();

  resolveA({
    Workflows: [workflowA],
    Total: 1,
    Page: 1,
    PerPage: 30,
    HasMore: false,
  });

  await waitFor(() =>
    expect(screen.getByText("Workflow B")).toBeInTheDocument(),
  );
  expect(screen.queryByText("Workflow A")).not.toBeInTheDocument();
});

it("does not dispatch twice while a run request is in flight", async () => {
  vi.mocked(Workflow.Inputs).mockResolvedValue([] as never);
  vi.mocked(Workflow.Dispatch).mockImplementation(
    (() => new Promise<void>(() => {})) as never,
  );

  const user = userEvent.setup();
  renderRuns(makeStub("/repo", "https://github.com/octocat/hello.git"));

  const runButton = await screen.findByRole("button", {
    name: "Run workflow",
  });
  await user.click(runButton);
  await user.click(await screen.findByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(Workflow.Dispatch).toHaveBeenCalledTimes(1));
  expect(runButton).toBeDisabled();

  fireEvent.click(runButton);
  fireEvent.click(runButton);
  await new Promise((resolve) => setTimeout(resolve, 20));

  expect(Workflow.Dispatch).toHaveBeenCalledTimes(1);
});

it("downgrades Gitee repositories to a web link", async () => {
  vi.mocked(Workflow.ResolveTarget).mockResolvedValue({
    Platform: "gitee",
    Host: "gitee.com",
    APIHost: "gitee.com/api/v5",
    Owner: "owner",
    Repo: "repo",
    Remote: "origin",
    WebURL: "https://gitee.com/owner/repo",
  } as never);
  vi.mocked(Workflow.Capabilities).mockResolvedValue({
    ListWorkflows: false,
    ListRuns: false,
    Dispatch: false,
    Rerun: false,
    Cancel: false,
    OpenWeb: true,
  } as never);

  const user = userEvent.setup();
  renderBar(makeStub("/repo", "https://gitee.com/owner/repo.git"));
  await expand(user);

  const openButton = await screen.findByRole("button", {
    name: /Open on Gitee/,
  });
  expect(openButton).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Run workflow" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Cancel" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Rerun" }),
  ).not.toBeInTheDocument();
  expect(Workflow.ListWorkflows).not.toHaveBeenCalled();

  await user.click(openButton);
  expect(Desktop.OpenURL).toHaveBeenCalledWith("https://gitee.com/owner/repo");
});

it("blocks submissions that miss a required input", async () => {
  vi.mocked(Workflow.Inputs).mockResolvedValue([
    {
      Name: "reason",
      Description: "",
      Required: true,
      Type: "string",
      Default: "",
      Options: null,
    },
  ] as never);

  const user = userEvent.setup();
  renderRuns(makeStub("/repo", "https://github.com/octocat/hello.git"));

  await user.click(await screen.findByRole("button", { name: "Run workflow" }));
  await user.click(await screen.findByRole("button", { name: "Confirm" }));
  const dialog = await screen.findByRole("dialog");

  await user.click(within(dialog).getByRole("button", { name: "Start run" }));

  expect(await screen.findByText(/required/i)).toBeInTheDocument();
  expect(Workflow.Dispatch).not.toHaveBeenCalled();
});

it("shows an error then recovers when Retry succeeds", async () => {
  const workflow = { ...defaultWorkflow, ID: 3, Name: "Workflow A" };
  let callCount = 0;
  vi.mocked(Workflow.ListWorkflows).mockImplementation((() => {
    callCount += 1;
    if (callCount === 1) return Promise.reject(new Error("network down"));
    return Promise.resolve({
      Workflows: [workflow],
      Total: 1,
      Page: 1,
      PerPage: 30,
      HasMore: false,
    });
  }) as never);

  const user = userEvent.setup();
  renderBar(makeStub("/repo", "https://github.com/octocat/hello.git"));
  await expand(user);

  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("network down")).toBeInTheDocument();

  await user.click(within(alert).getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Workflow A")).toBeInTheDocument();
});
