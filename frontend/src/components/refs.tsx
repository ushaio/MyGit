import { useState, type ReactNode } from "react";
import {
  Archive,
  CircleDot,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  Globe,
  Pin,
  Plus,
  Tag,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Desktop, Workspace, type Ref } from "@/lib/api";
import { copy, report, useWorkbench } from "@/lib/workbench";
import { basename } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { IconButton, Section } from "./shared";
import { WorkflowsBar } from "./workflows";

export type ViewSelection = {
  mode: "changes" | "history" | "stash" | "compare" | "workflows";
  ref?: string;
  file?: string;
  from?: string;
  to?: string;
  reflog?: boolean;
  workflow?: number;
};
export function RefsSidebar({
  view,
  onView,
}: {
  view: ViewSelection;
  onView: (value: ViewSelection) => void;
}) {
  const w = useWorkbench(),
    t = useT();
  const [query, setQuery] = useState("");
  const repo = w.repo;
  if (!repo) return null;
  const pinned = w.state?.PinnedRefs?.[w.project] || [];
  const filter = (refs: Ref[] | null) =>
    (refs || []).filter((ref) =>
      ref.Name.toLowerCase().includes(query.toLowerCase()),
    );
  function refRow(ref: Ref, kind: "branch" | "remote" | "tag") {
    const icon =
      kind === "tag" ? <Tag /> : kind === "remote" ? <Globe /> : <GitBranch />;
    const checkout = () => {
      const worktree =
        kind === "branch"
          ? repo?.Worktrees?.find(
              (wt) => wt.Branch === ref.Name && wt.Path !== w.path,
            )
          : undefined;
      if (worktree) {
        w.selectWorktree(worktree.Path);
        return;
      }
      w.request("Checkout", {
        Kind: "checkout",
        Ref: ref.Name,
        Mode: kind === "branch" ? "branch" : "",
        Name:
          kind === "remote" ? ref.Name.slice(ref.Name.indexOf("/") + 1) : "",
        Track: kind === "remote",
      });
    };
    return (
      <ContextMenu key={`${kind}:${ref.Name}`}>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            className="nav-row text-xs"
            title={ref.Name}
            data-active={view.mode === "history" && view.ref === ref.Name}
            onClick={() => onView({ mode: "history", ref: ref.Name })}
            onDoubleClick={checkout}
          >
            {icon}
            <span className="truncate">{ref.Name}</span>
            {repo?.Tracking.Branch === ref.Name && (
              <CircleDot className="ml-auto !size-3 text-primary" />
            )}
            {pinned.includes(ref.Name) && <Pin className="ml-auto !size-3" />}
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuItem onSelect={checkout}>{t("Checkout")}</ContextMenuItem>
          <ContextMenuItem
            onSelect={() =>
              w.request("Add worktree", {
                Kind: "worktree",
                Ref: ref.Name,
                Mode: kind === "branch" ? "branch" : "detached",
              })
            }
          >
            {t("Add worktree")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() =>
              w.request("Merge", { Kind: "merge", Ref: ref.Name })
            }
          >
            {t("Merge")}
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() =>
              w.request("Rebase", { Kind: "rebase", Ref: ref.Name })
            }
          >
            {t("Rebase")}
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() =>
              w.request("Interactive rebase", {
                Kind: "interactive-rebase",
                Ref: ref.Name,
              })
            }
          >
            {t("Interactive rebase")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() =>
              w.request("New branch", { Kind: "branch", Ref: ref.Name })
            }
          >
            {t("New branch")}
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() =>
              w.request("New tag", { Kind: "tag", Ref: ref.Name })
            }
          >
            {t("New tag")}
          </ContextMenuItem>
          {kind === "branch" && (
            <>
              <ContextMenuItem
                onSelect={() =>
                  w.request("Push", { Kind: "push", Ref: ref.Name })
                }
              >
                {t("Push")}
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() =>
                  w.request("Rename branch", {
                    Kind: "rename-branch",
                    Ref: ref.Name,
                    Name: ref.Name,
                  })
                }
              >
                {t("Rename branch")}
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() =>
                  w.request("Set upstream", { Kind: "track", Ref: ref.Name })
                }
              >
                {t("Set upstream")}
              </ContextMenuItem>
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() =>
              w.update(
                Workspace.PinRef(
                  w.project,
                  ref.Name,
                  !pinned.includes(ref.Name),
                ),
              )
            }
          >
            {t(pinned.includes(ref.Name) ? "Unpin" : "Pin")}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => copy(ref.Name)}>
            {t("Copy name")}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => copy(ref.Hash)}>
            {t("Copy hash")}
          </ContextMenuItem>
          {kind !== "remote" && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                className="text-destructive"
                onSelect={() =>
                  w.request(kind === "tag" ? "Delete tag" : "Delete branch", {
                    Kind: kind === "tag" ? "delete-tag" : "delete-branch",
                    Ref: ref.Name,
                  })
                }
              >
                {t(kind === "tag" ? "Delete tag" : "Delete branch")}
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
    );
  }
  const allRefs = [
    ...(repo.Refs.Branches || []),
    ...(repo.Refs.Remotes || []),
    ...(repo.Refs.Tags || []),
  ];
  return (
    <aside className="refs-sidebar" aria-label={t("Branches")}>
      {!repo.Bare && (
        <button
          className="nav-row"
          data-active={view.mode === "changes"}
          onClick={() => onView({ mode: "changes" })}
        >
          <CircleDot />
          <span>{t("Current changes")}</span>
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {repo.Changes.Files?.length || ""}
          </span>
        </button>
      )}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            className="nav-row"
            data-active={view.mode === "history" && !view.ref}
            onClick={() => onView({ mode: "history" })}
          >
            <GitCommitHorizontal />
            {t("All commits")}
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuCheckboxItem
            checked={view.reflog}
            onCheckedChange={(checked) =>
              onView({ mode: "history", reflog: checked })
            }
          >
            {t("Show lost commits")}
          </ContextMenuCheckboxItem>
        </ContextMenuContent>
      </ContextMenu>
      <Section
        title="Worktrees"
        count={repo.Worktrees?.length}
        defaultOpen={false}
        action={
          <IconButton
            label="Add worktree"
            onClick={() =>
              w.request("Add worktree", {
                Kind: "worktree",
                Ref: "HEAD",
                Mode: "detached",
              })
            }
          >
            <Plus className="size-3" />
          </IconButton>
        }
      >
        {(repo.Worktrees || []).map((wt) => (
          <ContextMenu key={wt.Path}>
            <ContextMenuTrigger asChild>
              <button
                className="nav-row text-xs"
                title={`${wt.Path}\n${wt.Branch}`}
                data-active={wt.Path === w.path}
                onDoubleClick={() => w.selectWorktree(wt.Path)}
              >
                <FolderGit2 />
                <span className="truncate">{basename(wt.Path)}</span>
                {wt.Locked && <span>●</span>}
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => w.selectWorktree(wt.Path)}>
                {t("Worktrees")}
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => report(Desktop.OpenPath(wt.Path))}
              >
                {t("Open folder")}
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => copy(wt.Path)}>
                {t("Copy path")}
              </ContextMenuItem>
              {!wt.Main && !wt.Locked && (
                <ContextMenuItem
                  className="text-destructive"
                  onSelect={() =>
                    w.request("Remove worktree", {
                      Kind: "remove-worktree",
                      Value: wt.Path,
                    })
                  }
                >
                  {t("Remove worktree")}
                </ContextMenuItem>
              )}
            </ContextMenuContent>
          </ContextMenu>
        ))}
      </Section>
      <Input
        className="my-2 h-7 text-xs"
        aria-label={t("Filter refs…")}
        placeholder={t("Filter refs…")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {pinned.length > 0 && (
        <Section title="Pinned" defaultOpen={false}>
          {allRefs
            .filter((ref) => pinned.includes(ref.Name))
            .map((ref) =>
              refRow(
                ref,
                repo.Refs.Branches?.some((b) => b.Name === ref.Name)
                  ? "branch"
                  : repo.Refs.Tags?.some((b) => b.Name === ref.Name)
                    ? "tag"
                    : "remote",
              ),
            )}
        </Section>
      )}
      <Section
        title="Branches"
        count={repo.Refs.Branches?.length || 0}
        defaultOpen={false}
        action={
          <IconButton
            label="New branch"
            onClick={() =>
              w.request("New branch", { Kind: "branch", Ref: "HEAD" })
            }
          >
            <Plus className="size-3" />
          </IconButton>
        }
      >
        {filter(repo.Refs.Branches).map((ref) => refRow(ref, "branch"))}
      </Section>
      <Section
        title="Remote branches"
        count={Object.keys(repo.Remotes || {}).length}
        defaultOpen={false}
        action={
          <IconButton
            label="Add remote"
            onClick={() =>
              w.request("Add remote", { Kind: "add-remote", Name: "origin" })
            }
          >
            <Plus className="size-3" />
          </IconButton>
        }
      >
        {Object.entries(repo.Remotes || {}).map(([name, url]) => (
          <ContextMenu key={name}>
            <ContextMenuTrigger asChild>
              <div>
                <Section title={name} defaultOpen={false}>
                  {filter(repo.Refs.Remotes)
                    .filter((ref) => ref.Name.startsWith(name + "/"))
                    .map((ref) => refRow(ref, "remote"))}
                </Section>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem
                onSelect={() =>
                  w.request("Fetch", { Kind: "fetch", Remote: name })
                }
              >
                {t("Fetch")}
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() =>
                  w.request("Edit remote", {
                    Kind: "edit-remote",
                    Ref: name,
                    Name: name,
                    Value: url || "",
                  })
                }
              >
                {t("Edit remote")}
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => copy(url || "")}>
                {t("Copy address")}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                className="text-destructive"
                onSelect={() =>
                  w.request("Delete remote", {
                    Kind: "delete-remote",
                    Ref: name,
                  })
                }
              >
                {t("Delete remote")}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}
      </Section>
      <Section
        title="Tags"
        count={repo.Refs.Tags?.length || 0}
        defaultOpen={false}
        action={
          <IconButton
            label="New tag"
            onClick={() => w.request("New tag", { Kind: "tag", Ref: "HEAD" })}
          >
            <Plus className="size-3" />
          </IconButton>
        }
      >
        {filter(repo.Refs.Tags).map((ref) => refRow(ref, "tag"))}
      </Section>
      {!!repo.Stashes?.length && (
        <Section title="Stashes" count={repo.Stashes.length} defaultOpen={false}>
          {repo.Stashes.map((stash) => (
            <ContextMenu key={stash.Hash}>
              <ContextMenuTrigger asChild>
                <button
                  className="nav-row text-xs"
                  data-active={view.mode === "stash" && view.ref === stash.Hash}
                  title={stash.Message}
                  onClick={() => onView({ mode: "stash", ref: stash.Hash })}
                  onDoubleClick={() =>
                    w.request("Apply stash", {
                      Kind: "apply-stash",
                      Ref: stash.Hash,
                    })
                  }
                >
                  <Archive />
                  <span className="truncate">{stash.Message}</span>
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem
                  onSelect={() =>
                    w.request("Apply stash", {
                      Kind: "apply-stash",
                      Ref: stash.Hash,
                    })
                  }
                >
                  {t("Apply stash")}
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() =>
                    w.request("Rename stash", {
                      Kind: "rename-stash",
                      Ref: stash.Hash,
                      Message: stash.Message,
                    })
                  }
                >
                  {t("Rename stash")}
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => copy(stash.Hash)}>
                  {t("Copy hash")}
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  className="text-destructive"
                  onSelect={() =>
                    w.request("Drop stash", {
                      Kind: "drop-stash",
                      Ref: stash.Hash,
                    })
                  }
                >
                  {t("Drop stash")}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
        </Section>
      )}
      <WorkflowsBar
        activeWorkflow={view.mode === "workflows" ? view.workflow ?? -1 : -1}
        onSelectWorkflow={(id) => onView({ mode: "workflows", workflow: id })}
      />
    </aside>
  );
}
