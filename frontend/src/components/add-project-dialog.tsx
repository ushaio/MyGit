import { useEffect, useRef, useState } from "react";
import { Folder, FolderPlus, GitFork, Loader2 } from "lucide-react";
import { Events } from "@wailsio/runtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Desktop, Workspace } from "@/lib/api";
import { errorMessage } from "@/lib/utils";
import { useWorkbench } from "@/lib/workbench";
import { useT } from "@/lib/i18n";
import { ErrorNotice } from "./shared";

type Stage = "options" | "clone";
type Phase = "pick" | "url" | "running" | "done" | "error";

/**
 * AddProjectDialog replaces the plain "add folder" click with a two-option
 * popup: clone a repository from Git, or add a local folder. Cloning mirrors
 * the add-folder flow but inserts a choose-folder → enter URL → watch git →
 * done sequence.
 */
export function AddProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const w = useWorkbench(),
    t = useT();
  const [stage, setStage] = useState<Stage>("options");
  const [phase, setPhase] = useState<Phase>("pick");
  const [target, setTarget] = useState("");
  const [url, setUrl] = useState("");
  const [percent, setPercent] = useState(-1);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState("");
  const running = useRef(false);

  useEffect(() => {
    if (!open) {
      setStage("options");
      setPhase("pick");
      setTarget("");
      setUrl("");
      setPercent(-1);
      setLog([]);
      setError("");
      running.current = false;
    }
  }, [open]);

  // Stream git's progress to the log and bar while the dialog is open.
  useEffect(() => {
    if (!open) return;
    const off = Events.On("clone:progress", (event: unknown) => {
      const payload =
        (event as { data?: { line?: string; percent?: number } })?.data ??
        (event as { line?: string; percent?: number });
      if (typeof payload?.line === "string" && payload.line) {
        setLog((old) => [...old.slice(-199), payload.line as string]);
      }
      if (typeof payload?.percent === "number" && payload.percent >= 0) {
        const next = payload.percent as number;
        setPercent((old) => (old < 0 ? next : Math.max(old, next)));
      }
    });
    return () => {
      off();
    };
  }, [open]);

  const chooseTarget = async () => {
    const folder = await Desktop.ChooseFolder();
    if (!folder) return;
    setTarget(folder);
    if (phase === "pick") setPhase("url");
  };

  const startClone = async () => {
    if (!target || !url.trim() || running.current) return;
    running.current = true;
    setPhase("running");
    setLog([]);
    setPercent(-1);
    setError("");
    try {
      // Call the backend directly instead of a context helper: the dialog is
      // the only caller, and this keeps cloning independent of how the
      // workbench value is assembled (a stale helper used to throw
      // "w.cloneRepo is not a function").
      const result = await Workspace.Clone(url.trim(), target);
      await w.update(Promise.resolve(result.State));
      setPhase("done");
      setPercent(100);
    } catch (caught) {
      setError(errorMessage(caught));
      setPhase("error");
    } finally {
      running.current = false;
    }
  };

  const requestClose = (next: boolean) => {
    // Never drop the dialog (and its log) while a clone is in flight.
    if (!next && phase === "running") return;
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent className="sm:max-w-lg">
        {stage === "options" ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("Add project")}</DialogTitle>
              <DialogDescription>
                {t("Clone a repository from Git or add a local folder.")}
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setStage("clone");
                  void chooseTarget();
                }}
                className="flex flex-col items-center gap-2 rounded-lg border p-5 text-center transition-colors hover:border-primary hover:bg-accent focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              >
                <GitFork className="size-7 text-primary" />
                <span className="text-sm font-medium">{t("Clone from Git")}</span>
                <span className="text-xs text-muted-foreground">
                  {t("Clone a repository from a URL.")}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  void w.addFolder();
                  onOpenChange(false);
                }}
                className="flex flex-col items-center gap-2 rounded-lg border p-5 text-center transition-colors hover:border-primary hover:bg-accent focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              >
                <FolderPlus className="size-7 text-primary" />
                <span className="text-sm font-medium">{t("Add folder")}</span>
                <span className="text-xs text-muted-foreground">
                  {t("Add a local folder you already have.")}
                </span>
              </button>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                {t("Cancel")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t("Clone from Git")}</DialogTitle>
              <DialogDescription>
                {t("Choose where to clone, then enter the repository address.")}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <label className="grid gap-1.5 text-xs">
                {t("Target folder")}
                <div className="flex items-center gap-2">
                  <div
                    className={`flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border bg-muted/40 px-2 ${
                      target ? "" : "text-muted-foreground"
                    }`}
                  >
                    <Folder className="size-3.5 shrink-0" />
                    <span className="truncate" title={target}>
                      {target || t("No folder selected")}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void chooseTarget()}
                    disabled={phase === "running"}
                  >
                    {t("Browse…")}
                  </Button>
                </div>
              </label>
              {target && (
                <label className="grid gap-1.5 text-xs">
                  {t("Repository address")}
                  <div className="flex items-center gap-2">
                    <Input
                      aria-label={t("Repository address")}
                      placeholder="https://github.com/owner/repo.git"
                      value={url}
                      autoComplete="off"
                      spellCheck={false}
                      disabled={phase === "running" || phase === "done"}
                      onChange={(e) => setUrl(e.target.value)}
                    />
                    <Button
                      type="button"
                      onClick={() => void startClone()}
                      disabled={
                        !url.trim() || phase === "running" || phase === "done"
                      }
                    >
                      {phase === "running" && (
                        <Loader2 className="size-4 animate-spin" />
                      )}
                      {t("Confirm")}
                    </Button>
                  </div>
                </label>
              )}
              {(phase === "running" ||
                phase === "done" ||
                phase === "error") && (
                <div className="grid gap-2">
                  <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
                    <div
                      className={`h-full bg-primary transition-all ${
                        percent < 0 ? "animate-pulse" : ""
                      }`}
                      style={{ width: percent < 0 ? "100%" : `${percent}%` }}
                    />
                  </div>
                  <div
                    aria-label={t("Clone log")}
                    className="max-h-44 min-h-20 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap"
                  >
                    {log.length === 0 ? (
                      <span className="text-muted-foreground">
                        {phase === "done"
                          ? t("Repository cloned.")
                          : t("Cloning…")}
                      </span>
                    ) : (
                      log.map((line, index) => <div key={index}>{line}</div>)
                    )}
                  </div>
                  {phase === "error" && <ErrorNotice error={error} />}
                </div>
              )}
            </div>
            <DialogFooter>
              {phase === "done" ? (
                <Button type="button" onClick={() => onOpenChange(false)}>
                  {t("Done")}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  disabled={phase === "running"}
                  onClick={() => onOpenChange(false)}
                >
                  {t("Cancel")}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
