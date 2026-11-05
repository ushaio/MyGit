import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Copy, Download, WrapText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Desktop,
  Git,
  Workspace,
  type FileContent,
  type FileRequest,
  type Line,
} from "@/lib/api";
import { changedRange, splitLines } from "@/lib/diff";
import { basename, cn, errorMessage } from "@/lib/utils";
import { copy, report, useWorkbench } from "@/lib/workbench";
import { useT } from "@/lib/i18n";
import { ErrorNotice, IconButton, Loading } from "./shared";

export function DiffView({ request }: { request: FileRequest }) {
  const w = useWorkbench(),
    t = useT();
  const [content, setContent] = useState<FileContent | null>(null);
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [layout, setLayout] = useState<"unified" | "split">("unified");
  const [selected, setSelected] = useState(new Set<number>());
  const [textSelection, setTextSelection] = useState("");
  const [discard, setDiscard] = useState(false),
    [applying, setApplying] = useState(false);
  const [reload, setReload] = useState(0);
  const lastLine = useRef(0),
    scroll = useRef<HTMLDivElement>(null),
    loadedKey = useRef("");
  const key = JSON.stringify(request),
    // Staging or unstaging the file being viewed must not blank the diff; only a
    // different file or revision is a fresh load.
    freshKey = JSON.stringify({ ...request, Area: 0 });
  useEffect(() => {
    let alive = true;
    const fresh = loadedKey.current !== freshKey;
    setLoading(true);
    setError("");
    if (fresh) {
      setContent(null);
      setSelected(new Set());
      lastLine.current = 0;
    }
    Git.File(request)
      .then((value) => {
        if (!alive) return;
        setContent(value);
        setSelected(new Set());
        lastLine.current = 0;
      })
      .catch((error) => {
        if (alive) setError(errorMessage(error));
      })
      .finally(() => {
        if (alive) {
          setLoading(false);
          loadedKey.current = freshKey;
        }
      });
    return () => {
      alive = false;
    };
  }, [key, w.version, reload]);
  const lines = content?.Lines || [];
  const split = useMemo(() => splitLines(lines), [content]);
  const wrap = w.state?.Preferences.Wrap ?? true;
  const virtual = useVirtualizer({
    count: layout === "split" ? split.length : lines.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 21,
    overscan: 24,
  });
  const canStage =
    request.Request.Mode === "changes" &&
    content?.File.Status !== 85 &&
    !content?.Binary &&
    !content?.Truncated;
  const changeCount = lines.filter((line) => line.Kind !== "context").length;
  useEffect(() => {
    virtual.measure();
  }, [layout, wrap, content?.Token]);
  function toggle(index: number, shift: boolean) {
    if (lines[index]?.Kind === "context") return;
    const range = shift
      ? changedRange(lines, lastLine.current, index)
      : [index];
    setSelected((old) => {
      const next = new Set(old);
      const remove = !shift && old.has(index);
      for (const i of range) remove ? next.delete(i) : next.add(i);
      return next;
    });
    lastLine.current = index;
  }
  async function apply(discardLines = false) {
    if (!content || applying || w.busy) return;
    setApplying(true);
    try {
      await w.applyLines({
        Request: request,
        Token: content.Token,
        Lines: [...selected],
        Discard: discardLines,
        Confirm: discardLines,
      });
      setDiscard(false);
      w.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setApplying(false);
    }
  }
  function lineCell(
    line: Line | undefined,
    index: number | undefined,
    side?: "left" | "right",
  ) {
    return (
      <div
        className={cn(
          "diff-line",
          side && "min-w-0 flex-1 basis-0",
          side === "left" && "border-r",
        )}
        data-kind={line?.Kind}
        data-selected={index !== undefined && selected.has(index)}
      >
        {line && (
          <>
            <button
              type="button"
              className="diff-line-number hover:bg-accent focus-visible:z-10"
              aria-label={`${line.Old || line.New} ${t(line.Kind === "context" ? "Content" : "Select all changes")}`}
              aria-pressed={index !== undefined && selected.has(index)}
              disabled={!canStage || line.Kind === "context"}
              onClick={(e) => index !== undefined && toggle(index, e.shiftKey)}
            >
              {side === "left"
                ? line.Old || ""
                : side === "right"
                  ? line.New || ""
                  : line.Old || ""}
            </button>
            {!side && (
              <span className="diff-line-number">{line.New || ""}</span>
            )}
            <span className="diff-line-sign">
              {line.Kind === "add" ? "+" : line.Kind === "delete" ? "−" : " "}
            </span>
            <span className="diff-line-text">
              {line.Text.replace(/\r?\n$/, "") || " \u200b"}
            </span>
          </>
        )}
      </div>
    );
  }
  if (loading && loadedKey.current !== freshKey) return <Loading />;
  if (error)
    return <ErrorNotice error={error} retry={() => setReload((v) => v + 1)} />;
  if (!content) return null;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-10 shrink-0 items-center gap-2 border-b bg-muted/40 px-3">
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs select-text"
          title={request.File}
        >
          {request.File}
        </span>
        <span className="text-[11px] text-[var(--diff-add-text)]">
          +{content.File.Added}
        </span>
        <span className="mr-2 text-[11px] text-[var(--diff-delete-text)]">
          −{content.File.Deleted}
        </span>
        <div className="flex rounded-md border p-0.5">
          {(["unified", "split"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={cn(
                "rounded px-2 py-0.5 text-[11px]",
                layout === mode && "bg-background text-primary shadow-xs",
              )}
              onClick={() => setLayout(mode)}
            >
              {t(mode === "unified" ? "Unified" : "Split")}
            </button>
          ))}
        </div>
        <IconButton
          label="Wrap lines"
          onClick={() =>
            w.state &&
            w.update(
              Workspace.SetPreferences({ ...w.state.Preferences, Wrap: !wrap }),
            )
          }
        >
          <WrapText className={cn("size-3.5", wrap && "text-primary")} />
        </IconButton>
        <IconButton
          label="Copy content"
          disabled={content.Binary || content.Truncated}
          onClick={() => copy(content.After)}
        >
          <Copy className="size-3.5" />
        </IconButton>
        <IconButton
          label="Save as…"
          disabled={content.Binary || content.Truncated}
          onClick={() =>
            report(Desktop.SaveText(basename(request.File), content.After))
          }
        >
          <Download className="size-3.5" />
        </IconButton>
      </div>
      {content.File.Status === 85 && (
        <div className="flex items-center gap-2 border-b bg-amber-500/10 px-3 py-2 text-xs">
          <span className="flex-1">
            {t("This worktree has an unfinished Git operation.")}
          </span>
          {["ours", "theirs"].map((side) => (
            <Button
              key={side}
              variant="outline"
              size="sm"
              disabled={!!w.busy}
              onClick={() =>
                w.request(side === "ours" ? "Use ours" : "Use theirs", {
                  Kind: "resolve",
                  Files: [request.File],
                  Mode: side,
                })
              }
            >
              {t(side === "ours" ? "Use ours" : "Use theirs")}
            </Button>
          ))}
        </div>
      )}
      {content.BeforeImage || content.AfterImage ? (
        <div className="grid flex-1 grid-cols-2 overflow-auto">
          {[content.BeforeImage, content.AfterImage].map((image, index) => (
            <div
              key={index}
              className="flex min-w-0 flex-col items-center gap-4 border-r p-5"
            >
              <span className="text-xs text-muted-foreground">
                {t(index ? "After" : "Before")}
              </span>
              {image && (
                <img
                  src={image}
                  alt={t(index ? "After" : "Before")}
                  className="max-h-full max-w-full object-contain"
                />
              )}
            </div>
          ))}
        </div>
      ) : content.Truncated || content.Binary ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          {t(content.Truncated ? "File too large to display" : "Binary file")}
        </div>
      ) : (
        <ContextMenu
          onOpenChange={(open) => {
            if (open) setTextSelection(window.getSelection()?.toString() || "");
          }}
        >
          <ContextMenuTrigger asChild>
            <div
              ref={scroll}
              className={cn(
                "min-h-0 flex-1 overflow-auto py-2",
                wrap && "diff-wrap",
              )}
              aria-label={t("Changes")}
            >
              <div
                style={{
                  height: virtual.getTotalSize(),
                  position: "relative",
                  minWidth: wrap ? "100%" : "max-content",
                }}
              >
                {virtual.getVirtualItems().map((row) => (
                  <div
                    key={row.key}
                    data-index={row.index}
                    ref={virtual.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${row.start}px)`,
                    }}
                    className={layout === "split" ? "flex" : ""}
                  >
                    {layout === "split" ? (
                      <>
                        {lineCell(
                          split[row.index]?.left,
                          split[row.index]?.leftIndex,
                          "left",
                        )}
                        {lineCell(
                          split[row.index]?.right,
                          split[row.index]?.rightIndex,
                          "right",
                        )}
                      </>
                    ) : (
                      lineCell(lines[row.index], row.index)
                    )}
                  </div>
                ))}
              </div>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              disabled={!textSelection}
              onSelect={() => copy(textSelection)}
            >
              {t("Copy selection")}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => copy(content.Before)}>
              {t("Copy before")}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => copy(content.After)}>
              {t("Copy after")}
            </ContextMenuItem>
            {canStage && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem
                  onSelect={() =>
                    setSelected(
                      new Set(
                        lines.flatMap((line, i) =>
                          line.Kind === "context" ? [] : [i],
                        ),
                      ),
                    )
                  }
                >
                  {t("Select all changes")}
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={!selected.size || applying}
                  onSelect={() => apply()}
                >
                  {t(
                    request.Area === 1
                      ? "Unstage selected lines"
                      : "Stage selected lines",
                  )}
                </ContextMenuItem>
                {request.Area === 2 && (
                  <ContextMenuItem
                    className="text-destructive"
                    disabled={!selected.size || applying}
                    onSelect={() => setDiscard(true)}
                  >
                    {t("Discard selected lines")}
                  </ContextMenuItem>
                )}
              </>
            )}
          </ContextMenuContent>
        </ContextMenu>
      )}
      {canStage && changeCount > 0 && (
        <div className="flex h-10 shrink-0 items-center gap-2 border-t px-3">
          <button
            className="text-xs text-muted-foreground hover:text-primary"
            onClick={() =>
              setSelected(
                selected.size === changeCount
                  ? new Set()
                  : new Set(
                      lines.flatMap((line, i) =>
                        line.Kind === "context" ? [] : [i],
                      ),
                    ),
              )
            }
          >
            {selected.size} / {changeCount}
          </button>
          <div className="flex-1" />
          {request.Area === 2 && (
            <Button
              size="sm"
              variant="ghost"
              disabled={!selected.size || applying || !!w.busy}
              onClick={() => setDiscard(true)}
            >
              {t("Discard selected lines")}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={!selected.size || applying || !!w.busy}
            onClick={() => apply()}
          >
            {t(
              request.Area === 1
                ? "Unstage selected lines"
                : "Stage selected lines",
            )}
          </Button>
        </div>
      )}
      <Dialog open={discard} onOpenChange={setDiscard}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("Discard selected lines")}</DialogTitle>
            <DialogDescription>
              {t("Discarded changes cannot be restored by MyGit.")}
            </DialogDescription>
          </DialogHeader>
          <code className="break-all text-xs">{request.File}</code>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={applying}
              onClick={() => setDiscard(false)}
            >
              {t("Cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={applying}
              onClick={() => apply(true)}
            >
              {t("Confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
