import { lazy, Suspense, useEffect, useState } from "react";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Code2,
  Download,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  Globe,
  Loader2,
  RefreshCw,
  TerminalSquare,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Desktop, action, changeRequest } from "@/lib/api";
import { basename, cn } from "@/lib/utils";
import { LanguageProvider, useT } from "@/lib/i18n";
import { report, useWorkbench } from "@/lib/workbench";
import { ProjectPalette, ProjectSidebar } from "@/components/projects";
import { RefsSidebar, type ViewSelection } from "@/components/refs";
import { HistoryView } from "@/components/history";
import { FileBrowser } from "@/components/files";
import { ErrorNotice, IconButton, Loading } from "@/components/shared";

const TerminalPane = lazy(() => import("@/components/terminal").then(m => ({ default: m.TerminalPane })));
const ActionDialog = lazy(() => import("@/components/action-dialog").then(m => ({ default: m.ActionDialog })));
const SettingsDialog = lazy(() => import("@/components/settings").then(m => ({ default: m.SettingsDialog })));

export default function App() {
  const w = useWorkbench();
  return (
    <LanguageProvider language={w.state?.Preferences.Language || "zh-CN"}>
      <WorkspaceWindow />
    </LanguageProvider>
  );
}

function WorkspaceWindow() {
  const w = useWorkbench(),
    t = useT();
  const [page, setPage] = useState<"git" | "terminal">("git");
  const [hasTerminal, setHasTerminal] = useState(false);
  useEffect(() => { if (page === "terminal") setHasTerminal(true); }, [page]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        w.setPalette(true);
      } else if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        w.refresh();
      } else if (e.key === ",") {
        e.preventDefault();
        w.setSettings(true);
      } else if (
        e.key.toLowerCase() === "f" &&
        !(
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement
        )
      ) {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>(
          "[data-history-search]",
        );
        if (input && page === "git") input.focus();
        else w.setPalette(true);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [w.setPalette, w.setSettings, w.refresh, page]);
  const branch = w.repo?.Tracking.Branch;
  const urls = w.repo?.Remotes || {};
  const remote = urls.origin || Object.values(urls)[0] || "";
  const webURL =
    remote.startsWith("https://") || remote.startsWith("http://")
      ? remote.replace(/\.git$/, "")
      : /^git@[^:]+:/.test(remote)
        ? "https://" +
          remote
            .replace(/^git@/, "")
            .replace(":", "/")
            .replace(/\.git$/, "")
        : "";
  const disabled = !w.repo || !!w.busy;
  return (
    <div className="workspace">
      <div className="workspace-body">
        <ProjectSidebar />
        <main className="repository-shell">
          <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-muted/30 px-4">
            <div className="min-w-24 flex-1 truncate" title={w.path}>
              <span className="text-sm font-semibold">
                {w.project ? basename(w.project) : ""}
              </span>
              {branch && (
                <span className="ml-3 inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <GitBranch className="size-3" />
                  {branch}
                </span>
              )}
            </div>
            {w.project && (
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  disabled={disabled || !Object.keys(urls).length}
                  onClick={() => w.execute(action("fetch", w.path))}
                >
                  {w.busy === "fetch" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Download className="size-3.5" />
                  )}
                  {t("Fetch")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  disabled={
                    disabled || w.repo?.Bare || !Object.keys(urls).length
                  }
                  onClick={() => w.request("Pull", { Kind: "pull" })}
                >
                  <ArrowDown className="size-3.5" />
                  {t("Pull")}
                  {!!w.repo?.Tracking.Behind && (
                    <span className="tabular-nums text-primary">
                      {w.repo.Tracking.Behind}
                    </span>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  disabled={disabled || w.repo?.Bare}
                  onClick={() =>
                    w.request("Push", { Kind: "push", Ref: branch || "" })
                  }
                >
                  <ArrowUp className="size-3.5" />
                  {t("Push")}
                  {!!w.repo?.Tracking.Ahead && (
                    <span className="tabular-nums text-primary">
                      {w.repo.Tracking.Ahead}
                    </span>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  disabled={disabled || !w.repo?.Changes.Files?.length}
                  onClick={() => w.request("Stash", { Kind: "stash" })}
                >
                  <Archive className="size-3.5" />
                  {t("Stash")}
                </Button>
              </div>
            )}
            {w.project && (
              <div className="ml-auto flex shrink-0 items-center gap-1 border-l pl-3">
                <div className="mr-2 flex rounded-md bg-secondary/60 p-0.5">
                  <button
                    className={cn(
                      "rounded px-2 py-1 text-xs",
                      page === "git" && "bg-background shadow-xs",
                    )}
                    onClick={() => setPage("git")}
                  >
                    <GitCommitHorizontal className="inline size-3.5" /> Git
                  </button>
                  <button
                    className={cn(
                      "rounded px-2 py-1 text-xs",
                      page === "terminal" && "bg-background shadow-xs",
                    )}
                    onClick={() => setPage("terminal")}
                  >
                    {t("Terminal")}
                  </button>
                </div>
                <IconButton
                  label="Refresh"
                  disabled={!!w.busy}
                  onClick={w.refresh}
                >
                  <RefreshCw
                    className={cn("size-3.5", w.loading && "animate-spin")}
                  />
                </IconButton>
                <IconButton
                  label="Open folder"
                  onClick={() => report(Desktop.OpenPath(w.path))}
                >
                  <FolderOpen className="size-3.5" />
                </IconButton>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={t("Terminal")}
                    >
                      <TerminalSquare className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onSelect={() => setPage("terminal")}>
                      {t("Terminal")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        report(Desktop.OpenTool(w.path, "terminal"))
                      }
                    >
                      System terminal
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <IconButton
                  label="Editor"
                  onClick={() =>
                    report(
                      w.state?.Preferences.Editor
                        ? Desktop.OpenTool(w.path, w.state.Preferences.Editor)
                        : Desktop.OpenPath(w.path),
                    )
                  }
                >
                  <Code2 className="size-3.5" />
                </IconButton>
                {webURL && (
                  <IconButton
                    label="Open in browser"
                    onClick={() => report(Desktop.OpenURL(webURL))}
                  >
                    <Globe className="size-3.5" />
                  </IconButton>
                )}
              </div>
            )}
          </header>
          {w.error && <ErrorNotice error={w.error} retry={w.refresh} />}
          <div
            className={cn(
              "min-h-0 flex-1 flex-col",
              page === "git" ? "flex" : "hidden",
            )}
          >
            {w.repo ? (
              <RepositoryContent key={w.path} />
            ) : w.loading ? (
              <Loading />
            ) : (
              <div className="flex-1" />
            )}
          </div>
          {hasTerminal && <Suspense fallback={<Loading />}><TerminalPane
            visible={page === "terminal"}
            path={w.repo?.Worktrees?.find((wt) => wt.Main)?.Path || w.project}
          /></Suspense>}
        </main>
      </div>
      <footer className="flex h-6 shrink-0 items-center gap-3 border-t bg-muted/50 px-3 text-[10px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate select-text" title={w.path}>
          {w.path}
        </span>
        {w.busy ? (
          <span role="status" className="flex items-center gap-1">
            <Loader2 className="size-3 animate-spin" />
            {t(w.busy)}
          </span>
        ) : (
          w.repo && (
            <span>
              {w.repo.Bare
                ? t("Bare repository")
                : `${w.repo.Changes.Files?.length || 0} ${t("Changes")}`}
            </span>
          )
        )}
      </footer>
      <ProjectPalette />
      {w.pending && <Suspense fallback={null}><ActionDialog /></Suspense>}
      {w.settings && <Suspense fallback={null}><SettingsDialog /></Suspense>}
    </div>
  );
}

function RepositoryContent() {
  const w = useWorkbench(),
    t = useT();
  const [view, setView] = useState<ViewSelection>({
    mode: w.repo?.Changes.Files?.length && !w.repo.Bare ? "changes" : "history",
  });
  return (
    <>
      {!!w.repo?.Operation.Kind && (
        <div className="flex min-h-10 shrink-0 items-center gap-2 border-b bg-amber-500/10 px-4 text-xs">
          <span className="flex-1">
            {t("This worktree has an unfinished Git operation.")}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={!!w.busy}
            onClick={() => w.request("Continue", { Kind: "continue" })}
          >
            {t("Continue")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!!w.busy}
            onClick={() => w.request("Abort", { Kind: "abort" })}
          >
            {t("Abort")}
          </Button>
        </div>
      )}
      <div className="repository-body">
        <RefsSidebar view={view} onView={setView} />
        <div className="main-content">
          {view.mode === "history" ? (
            <HistoryView view={view} onView={setView} />
          ) : view.mode === "compare" ? (
            <>
              <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3 text-xs">
                <span>{t("Compare commits")}</span>
                <code className="truncate text-muted-foreground">
                  {view.from?.slice(0, 8)} →{" "}
                  {view.to?.slice(0, 8) || t("Worktrees")}
                </code>
                <div className="flex-1" />
                <IconButton
                  label="Close"
                  onClick={() => setView({ mode: "history" })}
                >
                  <X className="size-3" />
                </IconButton>
              </div>
              <FileBrowser
                request={changeRequest(w.path, "compare", "", {
                  From: view.from || "HEAD",
                  To: view.to || "",
                })}
                onHistory={(file) => setView({ mode: "history", file })}
              />
            </>
          ) : (
            <FileBrowser
              request={changeRequest(
                w.path,
                view.mode === "stash" ? "stash" : "changes",
                view.ref || "",
              )}
              onHistory={(file) => setView({ mode: "history", file })}
            />
          )}
        </div>
      </div>
    </>
  );
}
