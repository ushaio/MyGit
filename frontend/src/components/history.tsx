import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  GitBranch,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Git, changeRequest, type Commit } from "@/lib/api";
import {
  buildGraph,
  foldCommits,
  graphColors,
  type GraphRow,
} from "@/lib/graph";
import { errorMessage } from "@/lib/utils";
import { copy, useWorkbench } from "@/lib/workbench";
import { useT } from "@/lib/i18n";
import { FileBrowser } from "./files";
import { ErrorNotice, IconButton, Loading } from "./shared";
import type { ViewSelection } from "./refs";

function GraphCell({ row, width }: { row: GraphRow; width: number }) {
  const x = (column: number) => 9 + column * 12;
  const color = graphColors[Math.max(row.id, 0) % graphColors.length];
  return (
    <svg
      width={width}
      height={32}
      className="shrink-0 overflow-hidden"
      aria-hidden="true"
    >
      {row.lines.map((line, i) => (
        <path
          key={i}
          d={`${line.top >= 0 ? `M${x(line.top)} 0 C${x(line.top)} 10 ${x(line.column)} 8 ${x(line.column)} 16` : `M${x(line.column)} 16`} ${line.bottom >= 0 ? `C${x(line.column)} 24 ${x(line.bottom)} 22 ${x(line.bottom)} 32` : ""}`}
          fill="none"
          stroke={graphColors[Math.max(line.id, 0) % graphColors.length]}
          strokeWidth={1.6}
        />
      ))}
      {row.column >= 0 && (
        <>
          <circle cx={x(row.column)} cy={16} r={4.2} fill="var(--background)" />
          <circle cx={x(row.column)} cy={16} r={3.1} fill={color} />
        </>
      )}
    </svg>
  );
}

export function HistoryView({
  view,
  onView,
}: {
  view: ViewSelection;
  onView: (value: ViewSelection) => void;
}) {
  const w = useWorkbench(),
    t = useT();
  const [commits, setCommits] = useState<Commit[]>([]);
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [kind, setKind] = useState(0);
  const [selected, setSelected] = useState<Commit | null>(null);
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [compare, setCompare] = useState<Commit | null>(null);
  const [hasMore, setHasMore] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [moreLoading, setMoreLoading] = useState(false);
  const scroll = useRef<HTMLDivElement>(null),
    generation = useRef(0);
  const requestKey = `${w.path}|${view.ref || ""}|${view.file || ""}|${view.reflog}|${search}|${kind}|${w.version}`;
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const current = ++generation.current;
    setLoading(true);
    setError("");
    setCommits([]);
    setSelected(null);
    setCompare(null);
    setCollapsed(new Set());
    setMoreLoading(false);
    Git.History({
      Path: w.path,
      Query: search,
      Ref: view.ref || "",
      File: view.file || "",
      Kind: kind,
      Offset: 0,
      Limit: 200,
      Reflog: !!view.reflog,
    })
      .then((page) => {
        if (generation.current === current) {
          setCommits(page.Commits || []);
          setHasMore(page.HasMore);
        }
      })
      .catch((error) => {
        if (generation.current === current) setError(errorMessage(error));
      })
      .finally(() => {
        if (generation.current === current) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, [requestKey]);
  const shown = useMemo(() => {
    const hidden = foldCommits(commits, collapsed);
    return commits.filter((commit) => !hidden.has(commit.Hash));
  }, [commits, collapsed]);
  const graph = useMemo(
    () =>
      buildGraph(
        shown.map((commit) =>
          collapsed.has(commit.Hash)
            ? { ...commit, Parents: commit.Parents?.slice(0, 1) || [] }
            : commit,
        ),
      ),
    [shown, collapsed],
  );
  const graphWidth = Math.max(
    30,
    Math.min(196, Math.max(1, ...graph.map((row) => row.columns)) * 12 + 12),
  );
  const virtual = useVirtualizer({
    count: shown.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 32,
    overscan: 20,
  });
  async function loadMore() {
    if (moreLoading) return;
    const current = generation.current;
    setMoreLoading(true);
    try {
      const page = await Git.History({
        Path: w.path,
        Query: search,
        Ref: view.ref || "",
        File: view.file || "",
        Kind: kind,
        Offset: commits.length,
        Limit: 200,
        Reflog: !!view.reflog,
      });
      if (generation.current === current) {
        setCommits((old) => [...old, ...(page.Commits || [])]);
        setHasMore(page.HasMore);
      }
    } catch (error) {
      if (generation.current === current) setError(errorMessage(error));
    } finally {
      if (generation.current === current) setMoreLoading(false);
    }
  }
  function choose(commit: Commit) {
    setSelected(commit);
  }
  function checkout(commit: Commit) {
    w.request("Checkout", { Kind: "checkout", Ref: commit.Hash });
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <Search className="size-3.5 text-muted-foreground" />
        <Input
          data-history-search
          aria-label={t("Search history…")}
          placeholder={t("Search history…")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-7 max-w-sm border-0 bg-transparent text-xs shadow-none"
        />
        <Select
          value={String(kind)}
          onValueChange={(value) => setKind(Number(value))}
        >
          <SelectTrigger className="h-7 w-28 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {["Message", "Author", "Path", "Content"].map((label, i) => (
              <SelectItem key={i} value={String(i)}>
                {t(label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto truncate text-xs text-muted-foreground">
          {view.file || view.ref || (view.reflog ? "Reflog" : t("All commits"))}
        </div>
        {view.file && (
          <IconButton label="Close" onClick={() => onView({ mode: "history" })}>
            <X className="size-3" />
          </IconButton>
        )}
      </div>
      {compare && (
        <div className="flex items-center gap-2 border-b bg-accent/30 px-3 py-1 text-xs">
          <code>{compare.Short}</code>
          <span className="truncate">{compare.Subject}</span>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-6"
            disabled={!selected || selected.Hash === compare.Hash}
            onClick={() =>
              selected &&
              onView({ mode: "compare", from: compare.Hash, to: selected.Hash })
            }
          >
            {t("Compare commits")}
          </Button>
          <IconButton label="Close" onClick={() => setCompare(null)}>
            <X className="size-3" />
          </IconButton>
        </div>
      )}
      <div className="history-header h-7 shrink-0 border-b bg-muted/50 px-3 text-[11px] text-muted-foreground">
        <span>{t("Message")}</span>
        <span>{t("Author")}</span>
        <span>{t("Hash")}</span>
        <span className="history-date">{t("Date")}</span>
      </div>
      {error && <ErrorNotice error={error} retry={w.refresh} />}
      {loading ? (
        <Loading />
      ) : (
        <div
          ref={scroll}
          className="min-h-0 flex-1 overflow-auto"
          role="grid"
          aria-label={t("All commits")}
        >
          {!shown.length && (
            <div className="p-8 text-center text-xs text-muted-foreground">
              {t("No commits")}
            </div>
          )}
          <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
            {virtual.getVirtualItems().map((item) => {
              const commit = shown[item.index],
                row = graph[item.index];
              return (
                <ContextMenu key={commit.Hash}>
                  <ContextMenuTrigger asChild>
                    <div
                      role="row"
                      tabIndex={0}
                      className="history-row px-3"
                      data-active={selected?.Hash === commit.Hash}
                      style={{
                        position: "absolute",
                        top: 0,
                        width: "100%",
                        transform: `translateY(${item.start}px)`,
                      }}
                      onClick={() => choose(commit)}
                      onDoubleClick={() => checkout(commit)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          choose(commit);
                        }
                        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                          e.preventDefault();
                          const next = Math.max(
                            0,
                            Math.min(
                              shown.length - 1,
                              item.index + (e.key === "ArrowDown" ? 1 : -1),
                            ),
                          );
                          choose(shown[next]);
                          virtual.scrollToIndex(next);
                        }
                      }}
                    >
                      <div className="flex min-w-0 items-center">
                        <GraphCell row={row} width={graphWidth} />
                        {(commit.Parents?.length || 0) > 1 && (
                          <button
                            type="button"
                            aria-label={
                              collapsed.has(commit.Hash)
                                ? "Expand merge"
                                : "Collapse merge"
                            }
                            className="mr-1 shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCollapsed((old) => {
                                const next = new Set(old);
                                next.has(commit.Hash)
                                  ? next.delete(commit.Hash)
                                  : next.add(commit.Hash);
                                return next;
                              });
                            }}
                          >
                            {collapsed.has(commit.Hash) ? (
                              <ChevronRight className="size-3" />
                            ) : (
                              <ChevronDown className="size-3" />
                            )}
                          </button>
                        )}
                        <div className="mr-2 flex max-w-64 shrink-0 gap-1 overflow-hidden">
                          {(commit.Refs || []).slice(0, 3).map((ref) => (
                            <Badge
                              key={ref}
                              variant={
                                ref.includes("HEAD") ? "default" : "secondary"
                              }
                              className="max-w-40 truncate rounded-sm px-1 py-0 text-[10px] font-normal"
                            >
                              {ref.replace("HEAD -> ", "").replace("tag: ", "")}
                            </Badge>
                          ))}
                        </div>
                        <span
                          className="truncate text-xs"
                          title={commit.Subject}
                        >
                          {commit.Subject}
                        </span>
                      </div>
                      <span
                        className="truncate pr-2 text-xs text-muted-foreground"
                        title={commit.AuthorEmail}
                      >
                        {commit.Author}
                      </span>
                      <code className="text-[11px] text-muted-foreground">
                        {commit.Short}
                      </code>
                      <time
                        className="history-date text-[11px] text-muted-foreground"
                        title={commit.AuthorDate}
                      >
                        {new Date(commit.AuthorDate).toLocaleDateString()}
                      </time>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-56">
                    <ContextMenuItem onSelect={() => checkout(commit)}>
                      {t("Checkout")}
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={() =>
                        w.request("New branch", {
                          Kind: "branch",
                          Ref: commit.Hash,
                        })
                      }
                    >
                      {t("New branch")}
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={() =>
                        w.request("New tag", { Kind: "tag", Ref: commit.Hash })
                      }
                    >
                      {t("New tag")}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      onSelect={() =>
                        w.request("Merge", { Kind: "merge", Ref: commit.Hash })
                      }
                    >
                      {t("Merge")}
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={() =>
                        w.request("Rebase", {
                          Kind: "rebase",
                          Ref: commit.Hash,
                        })
                      }
                    >
                      {t("Rebase")}
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={() =>
                        w.request("Cherry-pick", {
                          Kind: "cherry-pick",
                          Ref: commit.Hash,
                          Parent: (commit.Parents?.length || 0) > 1 ? 1 : 0,
                        })
                      }
                    >
                      {t("Cherry-pick")}
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={() =>
                        w.request("Revert", {
                          Kind: "revert",
                          Ref: commit.Hash,
                          Parent: (commit.Parents?.length || 0) > 1 ? 1 : 0,
                        })
                      }
                    >
                      {t("Revert")}
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={() =>
                        w.request("Reset to commit", {
                          Kind: "reset",
                          Ref: commit.Hash,
                        })
                      }
                    >
                      {t("Reset to commit")}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={() => setCompare(commit)}>
                      {t("Select for comparison")}
                    </ContextMenuItem>
                    {compare && compare.Hash !== commit.Hash && (
                      <ContextMenuItem
                        onSelect={() =>
                          onView({
                            mode: "compare",
                            from: compare.Hash,
                            to: commit.Hash,
                          })
                        }
                      >
                        {t("Compare commits")}
                      </ContextMenuItem>
                    )}
                    <ContextMenuItem
                      onSelect={() =>
                        onView({ mode: "compare", from: commit.Hash, to: "" })
                      }
                    >
                      {t("Compare with worktree")}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={() => copy(commit.Hash)}>
                      {t("Copy hash")}
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={() =>
                        copy(
                          commit.Subject +
                            (commit.Body ? "\n\n" + commit.Body : ""),
                        )
                      }
                    >
                      {t("Copy message")}
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </div>
          {hasMore && (
            <div className="flex justify-center p-3">
              <Button
                size="sm"
                variant="outline"
                onClick={loadMore}
                disabled={moreLoading}
              >
                {t(moreLoading ? "Loading…" : "Load more")}
              </Button>
            </div>
          )}
        </div>
      )}
      {selected && (
        <CommitDetails
          key={selected.Hash}
          commit={selected}
          onClose={() => setSelected(null)}
          onFileHistory={(file) => onView({ mode: "history", file })}
        />
      )}
    </div>
  );
}

function CommitDetails({
  commit,
  onClose,
  onFileHistory,
}: {
  commit: Commit;
  onClose: () => void;
  onFileHistory: (file: string) => void;
}) {
  const w = useWorkbench(),
    t = useT();
  const [tab, setTab] = useState("details");
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !w.pending) onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose, w.pending]);
  return (
    <section className="commit-details" aria-label={t("Details")}>
      <div className="flex h-10 shrink-0 items-center gap-1 border-b bg-muted/40 px-3">
        {["details", "changes", "files"].map((value) => (
          <Button
            key={value}
            variant={tab === value ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setTab(value)}
          >
            {t(
              value === "details"
                ? "Details"
                : value === "changes"
                  ? "Changes"
                  : "Files",
            )}
          </Button>
        ))}
        <code className="ml-auto text-xs text-muted-foreground">
          {commit.Short}
        </code>
        <IconButton label="Copy hash" onClick={() => copy(commit.Hash)}>
          <Copy className="size-3" />
        </IconButton>
        <IconButton label="Close" onClick={onClose}>
          <X className="size-3" />
        </IconButton>
      </div>
      {tab === "details" ? (
        <div className="min-h-0 flex-1 overflow-auto p-5 select-text">
          <h2 className="mb-4 text-sm font-semibold">{commit.Subject}</h2>
          <dl className="grid grid-cols-[80px_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
            <dt className="text-muted-foreground">{t("Author")}</dt>
            <dd>
              {commit.Author} &lt;{commit.AuthorEmail}&gt;
            </dd>
            <dt className="text-muted-foreground">{t("Date")}</dt>
            <dd>{new Date(commit.AuthorDate).toLocaleString()}</dd>
            <dt className="text-muted-foreground">{t("Hash")}</dt>
            <dd className="break-all font-mono">{commit.Hash}</dd>
            <dt className="text-muted-foreground">{t("Parents")}</dt>
            <dd className="break-all font-mono">{commit.Parents?.join(" ")}</dd>
          </dl>
          {commit.Body && (
            <pre className="mt-5 whitespace-pre-wrap break-words border-t pt-4 font-sans text-xs leading-relaxed">
              {commit.Body}
            </pre>
          )}
        </div>
      ) : (
        <FileBrowser
          request={changeRequest(
            w.path,
            tab === "files" ? "files" : "commit",
            commit.Hash,
          )}
          onHistory={onFileHistory}
        />
      )}
    </section>
  );
}
