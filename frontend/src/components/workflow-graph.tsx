import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2, Circle, CircleMinus, Clock3, GitBranch, Loader2,
  Maximize, Minus, Plus, RefreshCw, XCircle,
} from "lucide-react";
import { Workflow, type WorkflowJob, type WorkflowTarget } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn, errorMessage } from "@/lib/utils";
import {
  buildWorkflowGraph, fitWorkflowGraph, zoomWorkflowGraph,
  type GraphViewport, type WorkflowGraphDefinition,
} from "@/lib/workflow-graph";
import { IconButton } from "@/components/shared";

function JobStatus({ job }: { job: WorkflowJob }) {
  const className = "size-4 shrink-0";
  if (job.Status === "in_progress")
    return <Loader2 className={cn(className, "motion-safe:animate-spin text-amber-500")} />;
  if (job.Conclusion === "success")
    return <CheckCircle2 className={cn(className, "text-emerald-600 dark:text-emerald-400")} />;
  if (["failure", "timed_out", "action_required", "startup_failure"].includes(job.Conclusion))
    return <XCircle className={cn(className, "text-destructive")} />;
  if (["cancelled", "skipped", "neutral"].includes(job.Conclusion))
    return <CircleMinus className={cn(className, "text-muted-foreground")} />;
  if (["queued", "waiting", "pending", "requested"].includes(job.Status))
    return <Clock3 className={cn(className, "text-muted-foreground")} />;
  return <Circle className={cn(className, "text-muted-foreground")} />;
}

export function WorkflowJobGraph({
  target, runID, jobs, selectedJobID, onSelect, statusLabel, duration,
}: {
  target: WorkflowTarget;
  runID: number;
  jobs: WorkflowJob[];
  selectedJobID?: number;
  onSelect: (jobID: number) => void;
  statusLabel: (job: WorkflowJob) => string;
  duration: (job: WorkflowJob) => string;
}) {
  const t = useT();
  const markerID = useId().replace(/:/g, "");
  const [definitions, setDefinitions] = useState<WorkflowGraphDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const canvas = useRef<HTMLDivElement>(null);
  const autoFit = useRef(true);
  const drag = useRef<{ pointer: number; x: number; y: number; view: GraphViewport } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [view, setView] = useState<GraphViewport>({ x: 0, y: 0, zoom: 1 });
  const graph = useMemo(() => buildWorkflowGraph(jobs, definitions), [jobs, definitions]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    Workflow.Graph(target, runID)
      .then((result) => { if (!cancelled) setDefinitions(result.Nodes ?? []); })
      .catch((cause: unknown) => { if (!cancelled) setError(errorMessage(cause)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [target, runID, revision]);

  const fit = useCallback(() => {
    const element = canvas.current;
    if (!element || !element.clientWidth || !element.clientHeight) return;
    autoFit.current = true;
    setView(fitWorkflowGraph(graph, { width: element.clientWidth, height: element.clientHeight }));
  }, [graph.width, graph.height]);

  useLayoutEffect(() => {
    if (loading) return;
    fit();
    const element = canvas.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => { if (autoFit.current) fit(); });
    observer.observe(element);
    return () => observer.disconnect();
  }, [fit, loading]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    function wheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      autoFit.current = false;
      const rect = element!.getBoundingClientRect();
      setView((current) => zoomWorkflowGraph(current, current.zoom * Math.exp(-event.deltaY * 0.005), {
        x: event.clientX - rect.left, y: event.clientY - rect.top,
      }));
    }
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);

  function zoom(factor: number) {
    const element = canvas.current;
    if (!element) return;
    autoFit.current = false;
    setView((current) => zoomWorkflowGraph(current, current.zoom * factor, {
      x: element.clientWidth / 2, y: element.clientHeight / 2,
    }));
  }

  return (
    <section aria-label={t("Workflow graph")} className="min-w-0 overflow-hidden rounded-lg border bg-background">
      <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-xs">
          <GitBranch className="size-3.5 text-muted-foreground" />
          <span className="font-medium">{t("Jobs")}</span>
          <span className="text-[11px] tabular-nums text-muted-foreground">{jobs.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <IconButton label="Zoom out" onClick={() => zoom(1 / 1.2)} disabled={loading || view.zoom <= 0.2}>
            <Minus className="size-3.5" />
          </IconButton>
          <span aria-live="polite" className="w-9 text-center text-[10px] tabular-nums text-muted-foreground">
            {Math.round(view.zoom * 100)}%
          </span>
          <IconButton label="Zoom in" onClick={() => zoom(1.2)} disabled={loading || view.zoom >= 1.5}>
            <Plus className="size-3.5" />
          </IconButton>
          <span className="mx-1 h-3 border-l" />
          <IconButton label="Fit to view" onClick={fit} disabled={loading}><Maximize className="size-3.5" /></IconButton>
        </div>
      </div>
      <div
        ref={canvas}
        role="region"
        aria-label={t("Job canvas")}
        aria-busy={loading}
        tabIndex={0}
        className={cn(
          "relative h-72 touch-none overflow-hidden bg-muted/25 outline-offset-[-2px]",
          dragging ? "cursor-grabbing" : "cursor-grab",
        )}
        style={{
          backgroundImage: "radial-gradient(circle, color-mix(in srgb, var(--muted-foreground) 24%, transparent) 1px, transparent 1px)",
          backgroundSize: "16px 16px",
          backgroundPosition: `${view.x % 16}px ${view.y % 16}px`,
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || (event.target as Element).closest("button")) return;
          canvas.current?.focus({ preventScroll: true });
          autoFit.current = false;
          drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, view };
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start || start.pointer !== event.pointerId) return;
          setView({ ...start.view, x: start.view.x + event.clientX - start.x, y: start.view.y + event.clientY - start.y });
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointer !== event.pointerId) return;
          drag.current = null;
          setDragging(false);
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
        onPointerCancel={() => { drag.current = null; setDragging(false); }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          const movement: Record<string, [number, number]> = {
            ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40],
          };
          if (movement[event.key]) {
            event.preventDefault();
            autoFit.current = false;
            const [x, y] = movement[event.key];
            setView((current) => ({ ...current, x: current.x + x, y: current.y + y }));
          } else if (["+", "=", "-", "0"].includes(event.key)) {
            event.preventDefault();
            if (event.key === "0") fit();
            else zoom(event.key === "-" ? 1 / 1.2 : 1.2);
          }
        }}
      >
        {loading ? (
          <div role="status" className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-4 motion-safe:animate-spin" />
            {t("Loading dependencies…")}
          </div>
        ) : <div
          data-workflow-graph-content=""
          className="absolute left-0 top-0 origin-top-left"
          style={{ width: graph.width, height: graph.height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
        >
          <svg width={graph.width} height={graph.height} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-visible">
            <defs>
              <marker id={markerID} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                <path d="M 0 0 L 7 3.5 L 0 7 z" fill="context-stroke" />
              </marker>
            </defs>
            {graph.edges.map((edge) => (
              <path
                key={edge.id}
                data-workflow-edge={edge.id}
                d={edge.path}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                markerEnd={`url(#${markerID})`}
                className={cn("text-muted-foreground/45", (
                  edge.source.jobs.some((job) => job.ID === selectedJobID) ||
                  edge.target.jobs.some((job) => job.ID === selectedJobID)
                ) && "text-primary")}
              />
            ))}
          </svg>
          {graph.nodes.map((node) => (
            <div
              key={node.id}
              data-workflow-node={node.id}
              role="group"
              aria-label={node.name}
              className="absolute overflow-hidden rounded-lg border bg-card text-card-foreground shadow-xs"
              style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
            >
              {node.jobs.length > 1 && (
                <div className="flex h-[34px] items-center justify-between gap-2 border-b bg-muted/50 px-3 text-[11px]">
                  <span className="truncate font-medium" title={node.name}>{node.name.replace(/\s*\(?\$\{\{.*?\}\}\)?/g, "").trim() || node.name}</span>
                  <span className="text-muted-foreground">{node.jobs.length}</span>
                </div>
              )}
              {node.jobs.length === 0 && (
                <div className="flex h-full items-center gap-2.5 px-3 text-xs text-muted-foreground">
                  <Circle className="size-4 shrink-0" />
                  <div className="min-w-0"><p className="truncate" title={node.name}>{node.name}</p><p className="mt-1 text-[10px]">{t("No matching job yet")}</p></div>
                </div>
              )}
              {node.jobs.map((job) => (
                <button
                  key={job.ID}
                  type="button"
                  aria-pressed={job.ID === selectedJobID}
                  title={job.Name}
                  className={cn(
                    "relative flex w-full items-start gap-2.5 border-b px-3 py-3 text-left last:border-b-0 hover:bg-accent/50 focus-visible:z-10 focus-visible:outline-offset-[-3px]",
                    node.jobs.length > 1 ? "h-16" : "h-[76px]",
                    job.ID === selectedJobID && "bg-accent text-accent-foreground ring-2 ring-inset ring-primary",
                  )}
                  onClick={() => onSelect(job.ID)}
                  onFocus={() => {
                    const element = canvas.current;
                    if (!element) return;
                    const top = node.y + (node.jobs.length > 1 ? 34 + node.jobs.indexOf(job) * 64 : 0);
                    if (node.x * view.zoom + view.x < 0 || (node.x + node.width) * view.zoom + view.x > element.clientWidth ||
                      top * view.zoom + view.y < 0 || (top + 76) * view.zoom + view.y > element.clientHeight) {
                      autoFit.current = false;
                      setView((current) => ({ ...current, x: element.clientWidth / 2 - (node.x + node.width / 2) * current.zoom, y: element.clientHeight / 2 - (top + 38) * current.zoom }));
                    }
                  }}
                >
                  <JobStatus job={job} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium leading-4">{job.Name}</p>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                      <span className="truncate">{statusLabel(job)}</span>
                      <span className="shrink-0 tabular-nums">{duration(job)}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ))}
        </div>}
      </div>
      <div className="flex min-h-8 items-center gap-2 border-t px-3 py-1.5 text-[10px] text-muted-foreground">
        {!loading && (error ? <><span role="status" className="min-w-0 flex-1" title={error}>{t("Dependencies unavailable. Showing jobs only.")}</span><IconButton label="Retry dependencies" onClick={() => setRevision((value) => value + 1)}><RefreshCw className="size-3" /></IconButton></> :
          graph.incomplete ? <span>{t("Some jobs could not be matched. Only known dependencies are shown.")}</span> :
          <span>{t("Drag to pan · Ctrl + scroll to zoom")}</span>)}
      </div>
    </section>
  );
}
