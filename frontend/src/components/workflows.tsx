import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ChevronRight,
  ExternalLink,
  GitBranch,
  Layers,
  Loader2,
  Play,
  RefreshCw,
  X,
} from "lucide-react";
import {
  Desktop,
  Workflow,
  type WorkflowAccount,
  type WorkflowCapabilities,
  type WorkflowInfo,
  type WorkflowInput,
  type WorkflowJob,
  type WorkflowRun,
  type WorkflowStep,
  type WorkflowTarget,
} from "@/lib/api";
import { report, useWorkbench } from "@/lib/workbench";
import { useT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorNotice, IconButton, Loading } from "@/components/shared";
import { WorkflowJobGraph } from "@/components/workflow-graph";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn, errorMessage } from "@/lib/utils";
import { WorkflowLog } from "@/components/workflow-log";

const OPEN_KEY = "mygit:workflows:open";

function storedOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberOpen(open: boolean) {
  try {
    window.localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    /* storage is best-effort */
  }
}

function platformLabel(platform: string | undefined): string {
  switch (platform) {
    case "github":
      return "GitHub";
    case "gitee":
      return "Gitee";
    case "gitcode":
      return "GitCode";
    default:
      return platform ?? "";
  }
}

function platformTone(platform: string | undefined): string {
  switch (platform) {
    case "gitee":
      return "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300";
    case "gitcode":
      return "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300";
    case "github":
      return "border-border bg-foreground/5 text-muted-foreground";
    default:
      return "border-border bg-muted/40 text-muted-foreground";
  }
}

function PlatformBadge({ platform }: { platform: string | undefined }) {
  if (!platform) return null;
  return (
    <Badge
      variant="outline"
      className={cn(
        "px-1.5 py-0 text-[10px] font-semibold",
        platformTone(platform),
      )}
    >
      {platformLabel(platform)}
    </Badge>
  );
}

function StateBadge({ state }: { state: string }) {
  const t = useT();
  const active = state === "active";
  return (
    <Badge
      variant="outline"
      className={cn(
        "px-1.5 py-0 text-[10px] font-normal",
        active
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {active ? t("Active") : state || t("Disabled")}
    </Badge>
  );
}

function runSignal(
  run: Pick<WorkflowRun, "Status" | "Conclusion">,
  t: (text: string) => string,
): { label: string; tone: string } {
  if (run.Status === "in_progress") {
    return {
      label: t("In progress"),
      tone: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    };
  }
  if (run.Status === "queued") {
    return {
      label: t("Queued"),
      tone: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    };
  }
  if (run.Status === "completed") {
    switch (run.Conclusion) {
      case "success":
        return {
          label: t("Success"),
          tone: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        };
      case "failure":
        return {
          label: t("Failure"),
          tone: "border-destructive/30 bg-destructive/10 text-destructive",
        };
      case "cancelled":
        return {
          label: t("Cancelled"),
          tone: "border-border bg-muted/40 text-muted-foreground",
        };
      case "skipped":
        return {
          label: t("Skipped"),
          tone: "border-border bg-muted/40 text-muted-foreground",
        };
      default:
        return {
          label: t("Completed"),
          tone: "border-border bg-muted/40 text-muted-foreground",
        };
    }
  }
  return {
    label: run.Status || t("Unknown"),
    tone: "border-border bg-muted/40 text-muted-foreground",
  };
}

function RunBadge({ run }: { run: WorkflowRun }) {
  const t = useT();
  const { label, tone } = runSignal(run, t);
  return (
    <Badge
      variant="outline"
      className={cn("px-1.5 py-0 text-[10px] font-normal", tone)}
    >
      {label}
    </Badge>
  );
}

function formatTime(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateTime(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function isActive(run: WorkflowRun): boolean {
  return run.Status === "queued" || run.Status === "in_progress";
}

function statusDot(status: string, conclusion: string): string {
  if (conclusion === "success") return "bg-emerald-500";
  if (
    conclusion === "failure" ||
    conclusion === "timed_out" ||
    conclusion === "cancelled"
  ) {
    return "bg-destructive";
  }
  if (status === "in_progress") return "bg-amber-500";
  return "bg-muted-foreground/40";
}

function formatDuration(start: string, end: string): string {
  const from = new Date(start).getTime();
  const to = new Date(end).getTime();
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return "—";
  const total = Math.round((to - from) / 1000);
  const minutes = Math.floor(total / 60);
  if (minutes >= 60) {
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }
  return minutes > 0 ? `${minutes}m ${total % 60}s` : `${total}s`;
}

function remoteOrder(
  remotes: Record<string, string | undefined>,
): [string, string][] {
  return Object.entries(remotes)
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .sort((a, b) => (a[0] === "origin" ? -1 : b[0] === "origin" ? 1 : 0));
}

type WorkflowSource = {
  target: WorkflowTarget | null;
  caps: WorkflowCapabilities | null;
  account: WorkflowAccount | null;
  workflows: WorkflowInfo[];
  resolving: boolean;
  loading: boolean;
  error: string;
  noRemote: boolean;
  refresh: () => void;
};

/**
 * Resolves the workflow target (platform + owner/repo) from the current repo's
 * remotes and fetches its capabilities, account status and workflow list. Both
 * the sidebar list and the main run view use this independently; results are
 * cheap and cached server-side.
 */
function useWorkflowSource(): WorkflowSource {
  const w = useWorkbench();
  const remotes = w.repo?.Remotes ?? {};
  const signature = JSON.stringify(remotes);
  const repoKey = w.repo?.Path ?? "";
  const [target, setTarget] = useState<WorkflowTarget | null>(null);
  const [caps, setCaps] = useState<WorkflowCapabilities | null>(null);
  const [account, setAccount] = useState<WorkflowAccount | null>(null);
  const [workflows, setWorkflows] = useState<WorkflowInfo[]>([]);
  const [resolving, setResolving] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [noRemote, setNoRemote] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setResolving(true);
    setError("");
    setNoRemote(false);
    setTarget(null);
    setCaps(null);
    setAccount(null);
    setWorkflows([]);
    setLoading(false);

    const entries = remoteOrder(remotes);
    if (entries.length === 0) {
      setNoRemote(true);
      setResolving(false);
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      let resolved: WorkflowTarget | null = null;
      for (const [name, url] of entries) {
        try {
          resolved = await Workflow.ResolveTarget(name, url);
          break;
        } catch {
          /* try the next remote */
        }
      }
      if (cancelled) return;
      if (!resolved) {
        setNoRemote(true);
        setResolving(false);
        return;
      }
      const capsValue = await Workflow.Capabilities(resolved);
      if (cancelled) return;
      const accountValue = await Workflow.Account(resolved);
      if (cancelled) return;
      setTarget(resolved);
      setCaps(capsValue);
      setAccount(accountValue);
      if (capsValue.ListWorkflows && accountValue.Configured) {
        setLoading(true);
        const list = await Workflow.ListWorkflows(resolved, 1);
        if (cancelled) return;
        setWorkflows(list.Workflows ?? []);
        setLoading(false);
      }
      setResolving(false);
    })().catch((e: unknown) => {
      if (cancelled) return;
      setError(errorMessage(e));
      setResolving(false);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [repoKey, signature, reloadKey]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);
  return {
    target,
    caps,
    account,
    workflows,
    resolving,
    loading,
    error,
    noRemote,
    refresh,
  };
}

function ViewOnlyBody({ target }: { target: WorkflowTarget }) {
  const t = useT();
  return (
    <div className="flex flex-col items-start gap-2 px-1 py-2">
      <p className="max-w-prose text-[11px] leading-relaxed text-muted-foreground">
        {t(
          "Gitee and GitCode repositories are view-only: MyGit links to their web pages but does not run workflows there.",
        )}
      </p>
      <Button
        size="sm"
        variant="outline"
        onClick={() => void report(Desktop.OpenURL(target.WebURL))}
      >
        <ExternalLink className="size-3" />
        {t("Open on")} {platformLabel(target.Platform)}
      </Button>
    </div>
  );
}

function TokenRequiredBody() {
  const t = useT();
  const w = useWorkbench();
  return (
    <div className="flex flex-col items-start gap-2 px-1 py-2">
      <p className="max-w-prose text-[11px] leading-relaxed text-muted-foreground">
        {t("A GitHub token is required to run workflows.")}
      </p>
      <Button size="sm" variant="outline" onClick={() => w.setSettings(true)}>
        {t("Open settings")}
      </Button>
    </div>
  );
}

function WorkflowItem({
  title,
  subtitle,
  active,
  onClick,
  icon,
  badge,
}: {
  title: string;
  subtitle?: string;
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active}
      title={subtitle ? `${title}\n${subtitle}` : title}
      className="nav-row text-xs"
    >
      {icon}
      <span className="flex min-w-0 flex-1 flex-col items-start">
        <span className="w-full truncate">{title}</span>
        {subtitle && (
          <span className="w-full truncate font-mono text-[10px] text-muted-foreground">
            {subtitle}
          </span>
        )}
      </span>
      {badge}
    </button>
  );
}

/**
 * Sidebar section listing "All workflows" and each workflow script. Selecting
 * one sets the main view to that script's run history.
 */
export function WorkflowsBar({
  activeWorkflow = -1,
  onSelectWorkflow,
}: {
  activeWorkflow?: number;
  onSelectWorkflow?: (workflowID: number) => void;
} = {}) {
  const t = useT();
  const [open, setOpen] = useState(storedOpen);
  const {
    target,
    caps,
    account,
    workflows,
    resolving,
    loading,
    error,
    noRemote,
    refresh,
  } = useWorkflowSource();

  const toggle = () =>
    setOpen((value) => {
      rememberOpen(!value);
      return !value;
    });

  function body() {
    if (resolving) return <Loading />;
    if (noRemote) {
      return (
        <p className="px-1 py-2 text-[11px] text-muted-foreground">
          {t("No remote configured")}
        </p>
      );
    }
    if (error) return <ErrorNotice error={error} retry={refresh} />;
    if (!target || !caps) return null;
    if (!caps.ListWorkflows) return <ViewOnlyBody target={target} />;
    if (!account?.Configured) return <TokenRequiredBody />;
    return (
      <div className="flex flex-col">
        <WorkflowItem
          title={t("All workflows")}
          active={activeWorkflow === 0}
          onClick={() => onSelectWorkflow?.(0)}
          icon={<Layers className="size-3.5 shrink-0 text-muted-foreground" />}
        />
        {workflows.map((workflow) => (
          <WorkflowItem
            key={workflow.ID}
            title={workflow.Name}
            subtitle={workflow.Path}
            active={activeWorkflow === workflow.ID}
            onClick={() => onSelectWorkflow?.(workflow.ID)}
            icon={
              <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
            }
            badge={<StateBadge state={workflow.State} />}
          />
        ))}
        {loading && workflows.length === 0 && <Loading />}
        {!loading && workflows.length === 0 && (
          <p className="px-1 py-2 text-[11px] text-muted-foreground">
            {t("No workflows in this repository.")}
          </p>
        )}
      </div>
    );
  }

  return (
    <section
      className="mt-1 border-t border-border/60"
      aria-label={t("Workflows")}
    >
      <div className="section-title">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
        >
          <ChevronRight
            className={cn(
              "size-3 shrink-0 transition-transform",
              open && "rotate-90",
            )}
          />
          <GitBranch className="size-3 shrink-0" />
          <span className="truncate">{t("Workflows")}</span>
          <PlatformBadge platform={target?.Platform} />
        </button>
        <IconButton
          label="Refresh"
          onClick={refresh}
          disabled={resolving || loading}
        >
          <RefreshCw
            className={cn("size-3", (resolving || loading) && "animate-spin")}
          />
        </IconButton>
      </div>
      {open && <div className="pb-2">{body()}</div>}
    </section>
  );
}

function WorkflowJobDetails({
  target,
  run,
  job,
  onClose,
}: {
  target: WorkflowTarget;
  run: WorkflowRun;
  job: WorkflowJob;
  onClose: () => void;
}) {
  const t = useT();
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const [logsRequested, setLogsRequested] = useState(false);
  const [logs, setLogs] = useState<Record<number, string>>({});
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState("");
  const [logsRevision, setLogsRevision] = useState(0);

  useEffect(() => {
    if (!logsRequested) return;
    let ignore = false;
    setLogsLoading(true);
    setLogsError("");
    Workflow.JobLogs(target, run.ID, job.ID)
      .then((result) => {
        if (!ignore)
          setLogs(
            Object.fromEntries(
              (result.Steps ?? []).map((step) => [step.Number, step.Content]),
            ),
          );
      })
      .catch((error: unknown) => {
        if (!ignore) setLogsError(errorMessage(error));
      })
      .finally(() => {
        if (!ignore) setLogsLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [target, run.ID, job.ID, logsRequested, logsRevision]);

  function toggleStep(number: number) {
    setExpandedSteps((current) => {
      const next = new Set(current);
      if (next.has(number)) next.delete(number);
      else next.add(number);
      return next;
    });
    setLogsRequested(true);
  }

  return (
    <aside
      aria-label={`${t("Jobs")}: ${job.Name}`}
      className="flex min-h-0 min-w-0 flex-col border-t bg-background @2xl:border-l @2xl:border-t-0"
    >
      <header className="flex shrink-0 items-start gap-3 border-b px-4 py-3">
        <div className="min-w-0 flex-1 space-y-1">
          <p
            className="truncate text-[11px] text-muted-foreground"
            title={run.Title}
          >
            {t("Run")} #{run.Number} · {run.Title}
          </p>
          <h2 className="break-words text-sm font-semibold">{job.Name}</h2>
        </div>
        <IconButton label="Close" onClick={onClose}>
          <X className="size-3.5" />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4 text-xs">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 border-b pb-4">
          <dt className="text-muted-foreground">{t("Status")}</dt>
          <dd className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                statusDot(job.Status, job.Conclusion),
              )}
            />
            <span className="break-words">{runSignal(job, t).label}</span>
          </dd>
          <dt className="text-muted-foreground">{t("Duration")}</dt>
          <dd className="tabular-nums">
            {formatDuration(job.StartedAt, job.CompletedAt)}
          </dd>
          <dt className="text-muted-foreground">{t("Started")}</dt>
          <dd>{formatDateTime(job.StartedAt)}</dd>
          <dt className="text-muted-foreground">{t("Completed")}</dt>
          <dd>{formatDateTime(job.CompletedAt)}</dd>
        </dl>
        <div className="mb-2 mt-4 flex items-center justify-between gap-2">
          <h3 className="font-medium">{t("Steps")}</h3>
          <div className="flex items-center gap-2">
            <span className="tabular-nums text-muted-foreground">
              {job.Steps?.length ?? 0}
            </span>
            {logsRequested && (
              <IconButton
                label="Refresh logs"
                disabled={logsLoading}
                onClick={() => setLogsRevision((value) => value + 1)}
              >
                <RefreshCw
                  className={cn("size-3", logsLoading && "animate-spin")}
                />
              </IconButton>
            )}
          </div>
        </div>
        {(job.Steps ?? []).length === 0 ? (
          <p className="py-3 text-muted-foreground">{t("No steps")}</p>
        ) : (
          <ol className="divide-y divide-border/60">
            {(job.Steps ?? []).map((step: WorkflowStep) => (
              <li key={step.Number}>
                <button
                  type="button"
                  aria-expanded={expandedSteps.has(step.Number)}
                  aria-controls={`job-${job.ID}-step-${step.Number}`}
                  onClick={() => toggleStep(step.Number)}
                  className="flex w-full items-start gap-2 rounded px-1 py-2.5 text-left hover:bg-accent/40"
                >
                  <ChevronRight
                    className={cn(
                      "mt-0.5 size-3 shrink-0 text-muted-foreground",
                      expandedSteps.has(step.Number) && "rotate-90",
                    )}
                  />
                  <span className="w-4 shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {step.Number}
                  </span>
                  <span
                    title={runSignal(step, t).label}
                    className={cn(
                      "mt-1 size-1.5 shrink-0 rounded-full",
                      statusDot(step.Status, step.Conclusion),
                    )}
                  />
                  <span className="min-w-0 flex-1 break-words">
                    {step.Name}
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {formatDuration(step.StartedAt, step.CompletedAt)}
                  </span>
                </button>
                <div
                  id={`job-${job.ID}-step-${step.Number}`}
                  hidden={!expandedSteps.has(step.Number)}
                  className="mb-2 min-w-0"
                >
                  {expandedSteps.has(step.Number) &&
                    (logsLoading ? (
                      <div
                        role="status"
                        className="flex items-center gap-2 px-3 py-4 text-muted-foreground"
                      >
                        <Loader2 className="size-3 animate-spin" />
                        {t("Loading logs…")}
                      </div>
                    ) : logsError ? (
                      <ErrorNotice
                        error={logsError}
                        retry={() => setLogsRevision((value) => value + 1)}
                      />
                    ) : logs[step.Number] !== undefined ? (
                      <WorkflowLog content={logs[step.Number]} />
                    ) : (
                      <div className="flex items-center justify-between gap-2 px-3 py-4 text-muted-foreground">
                        <p>
                          {t(
                            step.Status === "completed"
                              ? "No log output for this step."
                              : "Logs are not available yet.",
                          )}
                        </p>
                        <IconButton
                          label="Refresh logs"
                          onClick={() => setLogsRevision((value) => value + 1)}
                        >
                          <RefreshCw className="size-3" />
                        </IconButton>
                      </div>
                    ))}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}

/**
 * Run history stays full-width until the user selects a job. Its details then
 * open beside the list, with an independent scroll area.
 */
export function WorkflowRunsView({ workflowID }: { workflowID: number }) {
  const w = useWorkbench();
  const t = useT();
  const {
    target,
    caps,
    account,
    workflows,
    resolving,
    loading,
    error,
    noRemote,
    refresh,
  } = useWorkflowSource();
  const selected =
    workflows.find((workflow) => workflow.ID === workflowID) ?? null;

  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [jobs, setJobs] = useState<Record<number, WorkflowJob[]>>({});
  const [jobsLoading, setJobsLoading] = useState<Record<number, boolean>>({});
  const [jobsError, setJobsError] = useState<Record<number, string>>({});
  const [jobSelection, setJobSelection] = useState<{
    runID: number;
    jobID: number;
  } | null>(null);
  const [refValue, setRefValue] = useState(w.repo?.Tracking?.Branch || "main");
  const [formOpen, setFormOpen] = useState(false);
  const [inputDefs, setInputDefs] = useState<WorkflowInput[]>([]);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const requestRef = useRef(0);
  const jobsRequestRef = useRef(0);

  useEffect(() => {
    setExpanded(new Set());
    setJobSelection(null);
    setJobs({});
    setJobsLoading({});
    setJobsError({});
    return () => {
      jobsRequestRef.current += 1;
    };
  }, [w.repo?.Path, workflowID]);

  useEffect(() => {
    setRefValue(w.repo?.Tracking?.Branch || "main");
  }, [w.repo?.Path]);

  const canRead = !!target && !!caps?.ListRuns && !!account?.Configured;

  useEffect(() => {
    if (!canRead || !target) {
      setRuns([]);
      return;
    }
    const token = ++requestRef.current;
    let cancelled = false;
    setRunsLoading(true);
    setRunsError("");
    Workflow.ListRuns(target, workflowID, "", 1)
      .then((page) => {
        if (!cancelled && token === requestRef.current)
          setRuns(page.Runs ?? []);
      })
      .catch((e: unknown) => {
        if (!cancelled && token === requestRef.current)
          setRunsError(errorMessage(e));
      })
      .finally(() => {
        if (!cancelled && token === requestRef.current) setRunsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canRead, target, workflowID, reloadKey]);

  useEffect(() => {
    if (!canRead || !target) return;
    for (const id of Array.from(expanded)) {
      if (jobs[id] !== undefined || jobsLoading[id] || jobsError[id]) continue;
      loadJobs(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, canRead, target, jobs, jobsLoading, jobsError]);

  function loadJobs(id: number) {
    if (!target) return;
    const token = jobsRequestRef.current;
    setJobsLoading((previous) => ({ ...previous, [id]: true }));
    setJobsError((previous) => ({ ...previous, [id]: "" }));
    Workflow.Jobs(target, id)
      .then((result) => {
        if (token !== jobsRequestRef.current) return;
        setJobs((previous) => ({ ...previous, [id]: result.Jobs ?? [] }));
      })
      .catch((e: unknown) => {
        if (token !== jobsRequestRef.current) return;
        setJobsError((previous) => ({ ...previous, [id]: errorMessage(e) }));
      })
      .finally(() => {
        if (token !== jobsRequestRef.current) return;
        setJobsLoading((previous) => ({ ...previous, [id]: false }));
      });
  }

  const hasActive = runs.some(isActive);
  useEffect(() => {
    if (!hasActive) return;
    const timer = window.setInterval(() => setReloadKey((k) => k + 1), 10000);
    return () => window.clearInterval(timer);
  }, [hasActive]);

  const bumpRuns = useCallback(() => setReloadKey((k) => k + 1), []);

  async function doDispatch(payload: WorkflowInput[]) {
    if (!target || !selected || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await Workflow.Dispatch(target, selected.ID, refValue, payload);
      setFormOpen(false);
      setInputDefs([]);
      setInputValues({});
      setFormError("");
      bumpRuns();
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function openRun() {
    if (!target || !selected) return;
    try {
      const defs =
        (await Workflow.Inputs(target, selected.Path, refValue)) ?? [];
      if (defs.length === 0) {
        await doDispatch([]);
        return;
      }
      const initial: Record<string, string> = {};
      for (const def of defs) initial[def.Name] = def.Default ?? "";
      setInputDefs(defs);
      setInputValues(initial);
      setFormError("");
      setFormOpen(true);
    } catch (e) {
      setRunsError(errorMessage(e));
    }
  }

  async function confirmRun() {
    if (!selected) return;
    const missing = inputDefs.find(
      (def) => def.Required && !(inputValues[def.Name] ?? "").trim(),
    );
    if (missing) {
      setFormError(`${t("Required")}: ${missing.Name}`);
      return;
    }
    await doDispatch(
      inputDefs.map((def) => ({
        ...def,
        Default: inputValues[def.Name] ?? def.Default ?? "",
      })),
    );
  }

  async function act(promise: Promise<unknown>) {
    try {
      await promise;
      bumpRuns();
    } catch (e) {
      setRunsError(errorMessage(e));
    }
  }

  function workflowName(id: number): string {
    return workflows.find((workflow) => workflow.ID === id)?.Name ?? "";
  }

  function toggleExpanded(id: number) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (expanded.has(id) && jobSelection?.runID === id) setJobSelection(null);
  }

  function list() {
    if (resolving || loading) return <Loading />;
    if (noRemote) {
      return (
        <p className="p-4 text-xs text-muted-foreground">
          {t("No remote configured")}
        </p>
      );
    }
    if (error) return <ErrorNotice error={error} retry={refresh} />;
    if (!target || !caps) return null;
    if (!caps.ListRuns) return <ViewOnlyBody target={target} />;
    if (!account?.Configured) return <TokenRequiredBody />;
    if (runsLoading && runs.length === 0) return <Loading />;
    if (runsError) return <ErrorNotice error={runsError} retry={bumpRuns} />;
    if (runs.length === 0) {
      return (
        <p className="p-8 text-center text-xs text-muted-foreground">
          {t("No runs yet.")}
        </p>
      );
    }
    return (
      <ul className="divide-y divide-border/60">
        {runs.map((run) => {
          const active = isActive(run);
          return (
            <li
              key={run.ID}
              className="border-b border-border/60 last:border-b-0"
            >
              <div className="flex items-center gap-3 px-4 py-2 text-xs hover:bg-accent/40">
                <button
                  type="button"
                  onClick={() => toggleExpanded(run.ID)}
                  aria-expanded={expanded.has(run.ID)}
                  aria-label={`${t("Run")} #${run.Number}`}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <ChevronRight
                    className={cn(
                      "size-3 shrink-0 text-muted-foreground transition-transform",
                      expanded.has(run.ID) && "rotate-90",
                    )}
                  />
                  <RunBadge run={run} />
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    #{run.Number}
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate font-medium"
                    title={run.Title}
                  >
                    {run.Title}
                  </span>
                </button>
                {workflowID === 0 && (
                  <span className="hidden shrink-0 text-[11px] text-muted-foreground @2xl:inline">
                    {workflowName(run.WorkflowID)}
                  </span>
                )}
                <span className="hidden shrink-0 items-center gap-1 text-[11px] text-muted-foreground @xl:flex">
                  <GitBranch className="size-3" />
                  <span className="max-w-32 truncate">{run.Branch}</span>
                </span>
                <span className="hidden shrink-0 text-[11px] tabular-nums text-muted-foreground @3xl:inline">
                  {formatTime(run.CreatedAt)}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  {active
                    ? caps?.Cancel && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button size="xs" variant="outline">
                              {t("Cancel")}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent
                            align="end"
                            className="w-52 space-y-2"
                          >
                            <p className="text-xs">{t("Cancel this run?")}</p>
                            <div className="flex justify-end gap-1">
                              <PopoverClose asChild>
                                <Button size="xs" variant="ghost">
                                  {t("Cancel")}
                                </Button>
                              </PopoverClose>
                              <PopoverClose asChild>
                                <Button
                                  size="xs"
                                  onClick={() =>
                                    void act(Workflow.Cancel(target!, run.ID))
                                  }
                                >
                                  {t("Confirm")}
                                </Button>
                              </PopoverClose>
                            </div>
                          </PopoverContent>
                        </Popover>
                      )
                    : caps?.Rerun && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button size="xs" variant="outline">
                              {t("Rerun")}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent
                            align="end"
                            className="w-52 space-y-2"
                          >
                            <p className="text-xs">{t("Rerun this run?")}</p>
                            <div className="flex justify-end gap-1">
                              <PopoverClose asChild>
                                <Button size="xs" variant="ghost">
                                  {t("Cancel")}
                                </Button>
                              </PopoverClose>
                              <PopoverClose asChild>
                                <Button
                                  size="xs"
                                  onClick={() =>
                                    void act(Workflow.Rerun(target!, run.ID))
                                  }
                                >
                                  {t("Confirm")}
                                </Button>
                              </PopoverClose>
                            </div>
                          </PopoverContent>
                        </Popover>
                      )}
                  <IconButton
                    label="Open run"
                    onClick={() => void report(Desktop.OpenURL(run.HTMLURL))}
                  >
                    <ExternalLink className="size-3" />
                  </IconButton>
                </div>
              </div>
              {expanded.has(run.ID) && (
                <div className="min-w-0 space-y-3 border-t bg-muted/20 px-4 py-3 text-[11px]">
                  <dl className="grid grid-cols-[4rem_minmax(0,1fr)] gap-x-3 gap-y-1 @2xl:grid-cols-[4rem_minmax(0,1fr)_4rem_minmax(0,1fr)]">
                    <dt className="text-muted-foreground">{t("Status")}</dt>
                    <dd className="flex items-center gap-2">
                      <RunBadge run={run} />
                      <span className="text-muted-foreground">
                        {run.Status}
                        {run.Conclusion ? ` · ${run.Conclusion}` : ""}
                      </span>
                    </dd>
                    <dt className="text-muted-foreground">{t("Event")}</dt>
                    <dd>{run.Event || "—"}</dd>
                    <dt className="text-muted-foreground">{t("Branch")}</dt>
                    <dd className="font-mono">{run.Branch || "—"}</dd>
                    <dt className="text-muted-foreground">{t("Commit")}</dt>
                    <dd className="truncate font-mono" title={run.HeadSHA}>
                      {run.HeadSHA || "—"}
                    </dd>
                    <dt className="text-muted-foreground">{t("Run ID")}</dt>
                    <dd className="tabular-nums">{run.ID}</dd>
                  </dl>
                  <div className="min-w-0">
                    {jobsLoading[run.ID] && !jobs[run.ID]?.length ? (
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <Loader2 className="size-3 animate-spin" />
                        {t("Loading…")}
                      </div>
                    ) : jobsError[run.ID] ? (
                      <ErrorNotice
                        error={jobsError[run.ID]}
                        retry={() => loadJobs(run.ID)}
                      />
                    ) : (jobs[run.ID]?.length ?? 0) === 0 ? (
                      <p className="text-muted-foreground">{t("No jobs")}</p>
                    ) : (
                      <WorkflowJobGraph
                        target={target}
                        runID={run.ID}
                        jobs={jobs[run.ID] ?? []}
                        selectedJobID={jobSelection?.runID === run.ID ? jobSelection.jobID : undefined}
                        onSelect={(jobID) => setJobSelection({ runID: run.ID, jobID })}
                        statusLabel={(job) => runSignal(job, t).label}
                        duration={(job) => formatDuration(job.StartedAt, job.CompletedAt)}
                      />
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  const heading =
    workflowID === 0
      ? t("All workflow runs")
      : selected?.Name || t("Workflow runs");
  const branches = w.repo?.Refs?.Branches ?? [];
  const detailRun = runs.find((run) => run.ID === jobSelection?.runID);
  const detailJob = detailRun
    ? jobs[detailRun.ID]?.find((job) => job.ID === jobSelection?.jobID)
    : undefined;

  return (
    <div className="@container flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3 text-xs">
        <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate font-medium">{heading}</span>
        {workflowID !== 0 && selected && (
          <span className="hidden truncate font-mono text-[11px] text-muted-foreground sm:inline">
            {selected.Path}
          </span>
        )}
        <div className="flex-1" />
        {selected && caps?.Dispatch && (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">
              {t("Ref")}
            </span>
            <Select value={refValue} onValueChange={setRefValue}>
              <SelectTrigger
                size="sm"
                className="h-7 w-32 text-xs"
                aria-label={t("Ref")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {branches.map((branch) => (
                  <SelectItem key={branch.Name} value={branch.Name}>
                    {branch.Name}
                  </SelectItem>
                ))}
                {!branches.some((branch) => branch.Name === refValue) && (
                  <SelectItem value={refValue}>{refValue}</SelectItem>
                )}
              </SelectContent>
            </Select>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  disabled={submitting}
                  aria-label={t("Run workflow")}
                >
                  {submitting ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Play className="size-3" />
                  )}
                  {t("Run workflow")}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-56 space-y-2">
                <p className="text-xs">{t("Run this workflow?")}</p>
                <div className="flex justify-end gap-1">
                  <PopoverClose asChild>
                    <Button size="xs" variant="ghost">
                      {t("Cancel")}
                    </Button>
                  </PopoverClose>
                  <PopoverClose asChild>
                    <Button size="xs" onClick={() => void openRun()}>
                      {t("Confirm")}
                    </Button>
                  </PopoverClose>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        )}
        <IconButton label="Refresh" onClick={bumpRuns} disabled={runsLoading}>
          <RefreshCw className={cn("size-3", runsLoading && "animate-spin")} />
        </IconButton>
      </div>
      <div
        className={cn(
          "grid min-h-0 flex-1",
          detailRun && detailJob
            ? "grid-rows-[minmax(0,1fr)_minmax(0,1fr)] @2xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] @2xl:grid-rows-1"
            : "grid-cols-1 grid-rows-1",
        )}
      >
        <div className="@container min-h-0 min-w-0 overflow-auto">{list()}</div>
        {target && detailRun && detailJob && (
          <WorkflowJobDetails
            key={`${target.WebURL}:${detailRun.ID}:${detailJob.ID}`}
            target={target}
            run={detailRun}
            job={detailJob}
            onClose={() => setJobSelection(null)}
          />
        )}
      </div>

      <Dialog
        open={formOpen}
        onOpenChange={(next) => {
          if (!submitting) setFormOpen(next);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">
              {t("Run workflow")}
              {selected ? ` · ${selected.Name}` : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 text-xs">
            {formError && (
              <p role="alert" className="text-[11px] text-destructive">
                {formError}
              </p>
            )}
            {inputDefs.map((def) => (
              <label key={def.Name} className="grid gap-1">
                <span className="flex items-center gap-0.5 font-medium">
                  {def.Name}
                  {def.Required && <span className="text-destructive">*</span>}
                </span>
                {def.Description && (
                  <span className="text-[11px] text-muted-foreground">
                    {def.Description}
                  </span>
                )}
                {def.Type === "boolean" ? (
                  <Checkbox
                    aria-label={def.Name}
                    checked={inputValues[def.Name] === "true"}
                    onCheckedChange={(checked) =>
                      setInputValues((values) => ({
                        ...values,
                        [def.Name]: checked === true ? "true" : "false",
                      }))
                    }
                  />
                ) : def.Type === "choice" ? (
                  <Select
                    value={inputValues[def.Name] || def.Options?.[0] || ""}
                    onValueChange={(value) =>
                      setInputValues((values) => ({
                        ...values,
                        [def.Name]: value,
                      }))
                    }
                  >
                    <SelectTrigger aria-label={def.Name} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(def.Options ?? []).map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    aria-label={def.Name}
                    value={inputValues[def.Name] ?? ""}
                    onChange={(event) =>
                      setInputValues((values) => ({
                        ...values,
                        [def.Name]: event.target.value,
                      }))
                    }
                  />
                )}
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setFormOpen(false)}
              disabled={submitting}
            >
              {t("Cancel")}
            </Button>
            <Button onClick={() => void confirmRun()} disabled={submitting}>
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              {t("Start run")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
