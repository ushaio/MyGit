import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Check,
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  Loader2,
  Plus,
  Minus,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AI,
  Git,
  Workspace,
  Desktop,
  action,
  type ChangeRequest,
  type FileChange,
  type BlameLine,
} from "@/lib/api";
import { basename, errorMessage, joinPath } from "@/lib/utils";
import { copy, report, useWorkbench } from "@/lib/workbench";
import { useT } from "@/lib/i18n";
import { DiffView } from "./diff-view";
import { ErrorNotice, IconButton, Loading } from "./shared";

const fileKey = (file: FileChange) => `${file.Area}:${file.Path}`;

// A flattened row of the files panel. A tall tree of thousands of files is
// rendered as one flat list so the list itself can be virtualized: only the
// rows in (or near) the viewport mount. Section headers and collapsible
// folders are rows too, so ordering and collapsing behave exactly like the
// old recursive tree.
type FileSection = {
  kind: "section";
  id: string;
  title: string;
  count: number;
  area: number | null;
};
type FileFolder = {
  kind: "folder";
  id: string;
  area: number;
  name: string;
  path: string;
  depth: number;
  files: FileChange[];
};
type FileLeaf = { kind: "file"; id: string; file: FileChange; depth: number };
type FileRow = FileSection | FileFolder | FileLeaf;

export function FileBrowser({
  request,
  onHistory,
}: {
  request: ChangeRequest;
  onHistory?: (file: string) => void;
}) {
  const w = useWorkbench(),
    t = useT();
  const [files, setFiles] = useState<FileChange[]>([]);
  const [active, setActive] = useState<FileChange | null>(null);
  const [chosen, setChosen] = useState(new Set<string>());
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [query, setQuery] = useState("");
  const [closed, setClosed] = useState(new Set<string>());
  const [blame, setBlame] = useState<{
    file: string;
    rows: BlameLine[];
    error: string;
    loading: boolean;
  } | null>(null);
  const blameGeneration = useRef(0);
  const loadedKey = useRef("");
  const current = request.Mode === "changes",
    key = JSON.stringify(request);
  useEffect(() => {
    let alive = true;
    const fresh = loadedKey.current !== key;
    setLoading(true);
    setError("");
    if (fresh) setFiles([]);
    Git.Changes(request)
      .then((value) => {
        if (!alive) return;
        const next = value.Files || [];
        setFiles(next);
        setActive(
          (previous) =>
            next.find((f) => fileKey(f) === (previous && fileKey(previous))) ||
            next[0] ||
            null,
        );
        setChosen(
          (previous) =>
            new Set(
              [...previous].filter((key) =>
                next.some((f) => fileKey(f) === key),
              ),
            ),
        );
      })
      .catch((error) => {
        if (alive) setError(errorMessage(error));
      })
      .finally(() => {
        if (alive) {
          setLoading(false);
          loadedKey.current = key;
        }
      });
    return () => {
      alive = false;
    };
  }, [key, w.version]);
  async function openBlame(file: FileChange) {
    const generation = ++blameGeneration.current;
    setBlame({ file: file.Path, rows: [], error: "", loading: true });
    try {
      const rows = await Git.Blame(request.Path, request.Revision, file.Path);
      if (generation === blameGeneration.current)
        setBlame({
          file: file.Path,
          rows: rows || [],
          error: "",
          loading: false,
        });
    } catch (error) {
      if (generation === blameGeneration.current)
        setBlame({
          file: file.Path,
          rows: [],
          error: errorMessage(error),
          loading: false,
        });
    }
  }
  function pick(file: FileChange, e?: MouseEvent) {
    setActive(file);
    if (e?.shiftKey && active?.Area === file.Area) {
      const group = files.filter((f) => f.Area === file.Area);
      const from = group.findIndex((f) => f.Path === active.Path),
        to = group.findIndex((f) => f.Path === file.Path);
      setChosen(
        new Set(
          group.slice(Math.min(from, to), Math.max(from, to) + 1).map(fileKey),
        ),
      );
    } else if (e?.ctrlKey || e?.metaKey)
      setChosen((old) => {
        const next = new Set(old);
        next.has(fileKey(file))
          ? next.delete(fileKey(file))
          : next.add(fileKey(file));
        return next;
      });
    else setChosen(new Set([fileKey(file)]));
  }
  function paths(file: FileChange) {
    return chosen.has(fileKey(file))
      ? files
          .filter((f) => f.Area === file.Area && chosen.has(fileKey(f)))
          .map((f) => f.Path)
      : [file.Path];
  }
  function stage(list: FileChange[], area: number) {
    if (!list.length) return;
    const target = area === 1 ? 2 : 1;
    const moving = new Set(list.map(fileKey));
    const moved = <T extends FileChange>(file: T): T =>
      moving.has(fileKey(file)) ? { ...file, Area: target } : file;
    // Move the rows now so the click feels instant; the reload below reconciles
    // with what git actually reports.
    setFiles((old) => old.map(moved));
    setActive((old) => (old ? moved(old) : old));
    void w
      .execute(
        action(area === 1 ? "unstage" : "stage", request.Path, {
          Area: area,
          Files: list.map((f) => f.Path),
        }),
      )
      .then((ok) => {
        if (!ok) w.refresh();
      });
  }
  function fileRow(file: FileChange, depth: number) {
    return (
      <ContextMenu key={fileKey(file)}>
        <ContextMenuTrigger asChild>
          <div
            className="group flex items-center gap-1"
            style={{ paddingLeft: depth * 10 }}
            onContextMenu={() => {
              if (!chosen.has(fileKey(file))) {
                setActive(file);
                setChosen(new Set([fileKey(file)]));
              }
            }}
          >
            {current && (
              <Checkbox
                className="ml-1 size-3.5 shrink-0"
                checked={chosen.has(fileKey(file))}
                aria-label={`${t("Files")} ${file.Path}`}
                onCheckedChange={(checked) => {
                  setActive(file);
                  setChosen((old) => {
                    const next = new Set(old);
                    checked
                      ? next.add(fileKey(file))
                      : next.delete(fileKey(file));
                    return next;
                  });
                }}
              />
            )}
            <button
              type="button"
              className="nav-row file-row min-w-0 flex-1"
              data-active={active && fileKey(active) === fileKey(file)}
              title={file.Path}
              onClick={(e) => pick(file, e)}
              onDoubleClick={() => current && stage([file], file.Area)}
            >
              <File />
              <span className="truncate">{basename(file.Path)}</span>
              <span
                className="ml-auto text-[10px] font-semibold"
                style={{
                  color:
                    file.Status === 68
                      ? "var(--diff-delete-text)"
                      : file.Status === 65
                        ? "var(--diff-add-text)"
                        : file.Status === 85
                          ? "var(--destructive)"
                          : "var(--muted-foreground)",
                }}
              >
                {String.fromCharCode(file.Status)}
              </span>
              {current && (
                <span
                  role="button"
                  tabIndex={0}
                  className="ml-1 grid size-4 shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100"
                  aria-label={`${t(file.Area === 1 ? "Unstage file" : "Stage file")} ${file.Path}`}
                  title={`${t(file.Area === 1 ? "Unstage file" : "Stage file")} ${file.Path}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActive(file);
                    stage([file], file.Area);
                  }}
                  onDoubleClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      stage([file], file.Area);
                    }
                  }}
                >
                  {file.Area === 1 ? (
                    <Minus className="size-3" />
                  ) : (
                    <Plus className="size-3" />
                  )}
                </span>
              )}
            </button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          {current && (
            <>
              <ContextMenuItem
                disabled={!!w.busy}
                onSelect={() =>
                  stage(
                    files.filter(
                      (f) =>
                        f.Area === file.Area && paths(file).includes(f.Path),
                    ),
                    file.Area,
                  )
                }
              >
                {t(file.Area === 1 ? "Unstage" : "Stage")}
              </ContextMenuItem>
              {file.Area === 2 && (
                <ContextMenuItem
                  className="text-destructive"
                  onSelect={() =>
                    w.request("Discard changes", {
                      Kind: "discard",
                      Files: paths(file),
                      Area: file.Area,
                    })
                  }
                >
                  {t("Discard changes")}
                </ContextMenuItem>
              )}
              <ContextMenuItem
                onSelect={() =>
                  w.request("Stash", {
                    Kind: "stash-files",
                    Files: paths(file),
                    Area: file.Area,
                  })
                }
              >
                {t("Stash")}
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem
            onSelect={() =>
              report(current ? Desktop.OpenPath(joinPath(request.Path, file.Path)) : Git.ExportFile({ Request: request, File: file.Path, Area: file.Area }, "open"))
            }
          >
            {t("Open file")}
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() =>
              report(Desktop.Reveal(joinPath(request.Path, file.Path)))
            }
          >
            {t("Reveal file")}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => copy(paths(file).join("\n"))}>
            {t("Copy path")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          {onHistory && (
            <ContextMenuItem onSelect={() => onHistory(file.Path)}>
              {t("File history")}
            </ContextMenuItem>
          )}
          <ContextMenuItem onSelect={() => openBlame(file)}>
            {t("Blame")}
          </ContextMenuItem>
          {request.Revision && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                className="text-destructive"
                onSelect={() =>
                  w.request("Restore file", {
                    Kind: "restore-file",
                    Ref: request.Revision,
                    Files: [file.Path],
                  })
                }
              >
                {t("Restore file")}
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
    );
  }
  // Walk the folder tree in the same order the recursive tree did, but push
  // flat rows instead of nesting React nodes. Collapsed folders are not
  // descended, exactly like before.
  function flatten(
    list: FileChange[],
    prefix: string,
    depth: number,
    out: FileRow[],
  ) {
    const entries = new Map<string, FileChange[]>();
    for (const file of list) {
      const name = file.Path.slice(prefix.length).split("/")[0];
      entries.set(name, [...(entries.get(name) || []), file]);
    }
    const sorted = [...entries.entries()].sort(
      ([a, aa], [b, bb]) =>
        Number(bb[0].Path !== prefix + b) -
          Number(aa[0].Path !== prefix + a) || a.localeCompare(b),
    );
    for (const [name, group] of sorted) {
      if (group[0].Path === prefix + name) {
        out.push({ kind: "file", id: fileKey(group[0]), file: group[0], depth });
        continue;
      }
      const path = prefix + name + "/";
      const id = `${group[0].Area}:${path}`;
      out.push({
        kind: "folder",
        id,
        area: group[0].Area,
        name,
        path,
        depth,
        files: group,
      });
      if (!closed.has(id)) flatten(group, path, depth + 1, out);
    }
  }
  function sectionRow(row: FileSection) {
    const key = row.area === null ? "files" : row.area;
    const area = row.area ?? 0;
    const open = !collapsedSections.has(key);
    return (
      <div className="section-title">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
          onClick={() =>
            setCollapsedSections((old) => {
              const next = new Set(old);
              next.has(key) ? next.delete(key) : next.add(key);
              return next;
            })
          }
        >
          <ChevronRight
            className={`size-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          />
          <span className="truncate">{t(row.title)}</span>
          <span className="ml-auto text-[10px] font-normal tabular-nums">
            {row.count}
          </span>
        </button>
        {row.area !== null && (
          <IconButton
            label={area === 1 ? "Unstage all" : "Stage all"}
            disabled={!!w.busy || row.count === 0}
            onClick={() =>
              stage(
                files.filter((f) => f.Area === area),
                area,
              )
            }
          >
            {area === 1 ? <Minus className="size-3" /> : <Plus className="size-3" />}
          </IconButton>
        )}
      </div>
    );
  }
  function folderRow(row: FileFolder) {
    const { id, name, path, depth, files: group } = row;
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            className="nav-row file-row"
            style={{ paddingLeft: depth * 10 + 6 }}
            onClick={() =>
              setClosed((old) => {
                const next = new Set(old);
                next.has(id) ? next.delete(id) : next.add(id);
                return next;
              })
            }
          >
            <ChevronRight
              className={`!size-3 ${closed.has(id) ? "" : "rotate-90"}`}
            />
            <Folder />
            <span className="truncate">{name}</span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {current && (
            <ContextMenuItem onSelect={() => stage(group, group[0].Area)}>
              {t(group[0].Area === 1 ? "Unstage" : "Stage")}
            </ContextMenuItem>
          )}
          <ContextMenuItem
            onSelect={() =>
              report(Desktop.OpenPath(joinPath(request.Path, path)))
            }
          >
            {t("Open folder")}
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => copy(group.map((f) => f.Path).join("\n"))}
          >
            {t("Copy path")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }
  const visible = useMemo(
    () =>
      files.filter((file) =>
        file.Path.toLowerCase().includes(query.toLowerCase()),
      ),
    [files, query],
  );
  const [collapsedSections, setCollapsedSections] = useState<
    Set<number | "files">
  >(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => {
    const out: FileRow[] = [];
    if (current) {
      for (const area of [2, 1]) {
        out.push({
          kind: "section",
          id: `section:${area}`,
          title: area === 1 ? "Staged" : "Unstaged",
          count: files.filter((f) => f.Area === area).length,
          area,
        });
        if (!collapsedSections.has(area))
          flatten(
            visible.filter((f) => f.Area === area),
            "",
            0,
            out,
          );
      }
    } else {
      out.push({
        kind: "section",
        id: "section:files",
        title: "Files",
        count: files.length,
        area: null,
      });
      if (!collapsedSections.has("files")) flatten(visible, "", 0, out);
    }
    return out;
  }, [current, visible, files, closed, collapsedSections]);
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 30,
    overscan: 20,
  });
  if (loading && loadedKey.current !== key) return <Loading />;
  if (error) return <ErrorNotice error={error} retry={w.refresh} />;
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="file-panel">
        <div className="border-b px-2 py-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-7 text-xs"
            placeholder={t("Filter files…")}
            aria-label={t("Filter files…")}
          />
        </div>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto px-1 pb-3">
          <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
            {virtual.getVirtualItems().map((item) => {
              const row = rows[item.index];
              return (
                <div
                  key={row.id}
                  data-index={item.index}
                  ref={virtual.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    width: "100%",
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  {row.kind === "section"
                    ? sectionRow(row)
                    : row.kind === "folder"
                      ? folderRow(row)
                      : fileRow(row.file, row.depth)}
                </div>
              );
            })}
          </div>
        </div>
        {current && <CommitForm key={request.Path} />}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {active && files.some((f) => fileKey(f) === fileKey(active)) ? (
          <DiffView
            request={{ Request: request, File: active.Path, Area: active.Area }}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
            {current && !files.length ? (
              <>
                <Check className="size-4" />
                {t("Working tree clean")}
              </>
            ) : (
              t("Select a file to review")
            )}
          </div>
        )}
      </div>
      <Dialog
        open={!!blame}
        onOpenChange={(open) => {
          if (!open) {
            blameGeneration.current++;
            setBlame(null);
          }
        }}
      >
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{t("Blame")}</DialogTitle>
            <DialogDescription>{blame?.file}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto">
            {blame?.loading ? (
              <Loading />
            ) : blame?.error ? (
              <ErrorNotice error={blame.error} />
            ) : (
              blame?.rows.map((row, index) => (
                <div
                  key={index}
                  className="flex min-h-6 gap-4 whitespace-pre font-mono text-xs leading-6 even:bg-muted/50 select-text"
                >
                  <span className="w-20 shrink-0 text-primary">
                    {row.Short}
                  </span>
                  <span className="w-28 shrink-0 truncate text-muted-foreground">
                    {row.Author}
                  </span>
                  <span className="w-8 shrink-0 text-right text-muted-foreground">
                    {index + 1}
                  </span>
                  <span>{row.Text}</span>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CommitForm() {
  const w = useWorkbench(),
    t = useT();
  const [message, setMessage] = useState(w.state?.Drafts?.[w.path] || "");
  const [amend, setAmend] = useState(false);
  const [generating, setGenerating] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    latest = useRef(message),
    dirty = useRef(false);
  const path = w.path;
  // Dragging the box taller is for reading the draft in front of you; it must
  // not follow you to the next worktree or survive the commit that empties it.
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (box.current) box.current.style.height = "";
  }, [path]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (dirty.current) void report(w.saveDraft(path, latest.current));
    },
    [path, w.saveDraft],
  );
  function edit(value: string) {
    setMessage(value);
    latest.current = value;
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void w
        .saveDraft(path, value)
        .then(() => {
          if (latest.current === value) dirty.current = false;
        })
        .catch((error) => toast.error(errorMessage(error)));
    }, 400);
  }
  // generate asks the configured model for a commit message written from the
  // staged diff. It replaces the draft, but keeps the previous text one click
  // away in the toast, so a model reply never silently discards typed work.
  async function generate() {
    if (generating) return;
    setGenerating(true);
    try {
      const text = (await AI.CommitMessage(path)).trim();
      if (!text) return;
      const previous = message.trim();
      edit(text);
      if (previous && previous !== text)
        toast(t("Replaced the commit draft"), {
          action: { label: t("Undo"), onClick: () => edit(previous) },
        });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setGenerating(false);
    }
  }
  async function commit(push = false) {
    if (!message.trim() || w.busy) return;
    if (timer.current) clearTimeout(timer.current);
    try {
      await w.saveDraft(path, message);
      dirty.current = false;
      if (amend) {
        w.request("Amend last commit", {
          Kind: "commit",
          Message: message,
          Mode: "amend",
        });
        return;
      }
      const success = await w.execute(
        action("commit", path, { Message: message, Mode: push ? "push" : "" }),
      );
      if (success) {
        setMessage("");
        latest.current = "";
        if (box.current) box.current.style.height = "";
      }
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }
  return (
    <form
      className="grid shrink-0 gap-2 border-t bg-muted/30 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void commit();
      }}
    >
      <label htmlFor="commit-message" className="text-xs font-medium">
        {t("Commit message")}
      </label>
      <div className="relative">
        <Textarea
          ref={box}
          id="commit-message"
          value={message}
          onChange={(e) => edit(e.target.value)}
          placeholder={t("Summary and optional description")}
          className="h-24 resize-y overflow-y-auto bg-background pr-10 text-xs"
          style={{ fieldSizing: "fixed" } as CSSProperties}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void commit();
            }
          }}
        />
        <IconButton
          label="Generate commit message"
          className="absolute top-1.5 right-1.5"
          disabled={!!w.busy || generating}
          onClick={() => void generate()}
        >
          {generating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
        </IconButton>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Checkbox
          checked={amend}
          onCheckedChange={(checked) => setAmend(!!checked)}
        />
        {t("Amend last commit")}
      </label>
      <div className="flex">
        <Button
          type="submit"
          size="sm"
          className="h-8 flex-1 rounded-r-none"
          disabled={
            !!w.busy ||
            !message.trim() ||
            (!amend && !w.repo?.Changes.Files?.some((f) => f.Area === 1))
          }
        >
          {t("Commit")}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="sm"
              className="h-8 rounded-l-none border-l border-primary-foreground/20 px-2"
              aria-label={t("Commit")}
              disabled={!!w.busy || !message.trim()}
            >
              <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem
              disabled={
                amend || !w.repo?.Changes.Files?.some((f) => f.Area === 1)
              }
              onSelect={() => commit(true)}
            >
              {t("Commit and push")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </form>
  );
}
