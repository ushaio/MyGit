import { useRef, useState } from "react";
import {
  Folder,
  FolderOpen,
  GitFork,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ChevronRight,
  Github,
  TerminalSquare,
} from "lucide-react";
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Desktop, Workspace, type ProjectNode } from "@/lib/api";
import { basename } from "@/lib/utils";
import { copy, report, useWorkbench } from "@/lib/workbench";
import { useT } from "@/lib/i18n";
import { IconButton, Section } from "./shared";
import { ShellIcon } from "./shell-icon";
import { AddProjectDialog } from "./add-project-dialog";

// orderProjects applies the manual drag order saved for one sidebar section.
// Projects that were never ranked keep their incoming (alphabetical) order and
// follow the ranked ones, so a newly added project lands at the end.
function orderProjects(
  list: ProjectNode[],
  scope: string,
  order: Record<string, string[] | null | undefined> | null | undefined,
): ProjectNode[] {
  const sequence = order?.[scope];
  if (!sequence || !sequence.length) return list;
  const rank = new Map(sequence.map((path, index) => [path, index] as const));
  const ranked = list
    .filter((node) => rank.has(node.Path))
    .sort((a, b) => rank.get(a.Path)! - rank.get(b.Path)!);
  return [...ranked, ...list.filter((node) => !rank.has(node.Path))];
}

export function ProjectSidebar() {
  const w = useWorkbench(),
    t = useT();
  const [group, setGroup] = useState<{ id: string; name: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [dragPath, setDragPath] = useState("");
  const [dropPath, setDropPath] = useState("");
  const dragSource = useRef<{ path: string; scope: string } | null>(null);
  const filtered = w.projects.filter((p) =>
    `${basename(p.Path)} ${p.Path}`.toLowerCase().includes(query.toLowerCase()),
  );
  const pinnedProjects = orderProjects(
    w.projects.filter((p) => p.Pinned),
    "pinned",
    w.state?.ProjectOrder,
  );
  const newGroup = () => setGroup({ id: crypto.randomUUID(), name: "" });

  function clearDrag() {
    dragSource.current = null;
    setDragPath("");
    setDropPath("");
  }
  function dropOn(scope: string, paths: string[], target: string) {
    const source = dragSource.current;
    clearDrag();
    if (!source || source.scope !== scope || source.path === target) return;
    const from = paths.indexOf(source.path);
    const to = paths.indexOf(target);
    if (from < 0 || to < 0) return;
    const next = [...paths];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    void w.update(Workspace.SetProjectOrder(scope, next));
  }

  function projectRow(
    node: ProjectNode,
    reorder?: { scope: string; paths: string[] },
  ) {
    const terminals = w.terminalsFor(node.Path);
    const open = !!expanded[node.Path];
    const dragProps = reorder
      ? {
          draggable: true,
          onDragStart: (event: React.DragEvent) => {
            dragSource.current = { path: node.Path, scope: reorder.scope };
            setDragPath(node.Path);
            if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
          },
          onDragEnd: clearDrag,
          onDragOver: (event: React.DragEvent) => {
            const source = dragSource.current;
            if (
              !source ||
              source.scope !== reorder.scope ||
              source.path === node.Path
            )
              return;
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
            setDropPath(node.Path);
          },
          onDragLeave: () =>
            setDropPath((current) => (current === node.Path ? "" : current)),
          onDrop: (event: React.DragEvent) => {
            event.preventDefault();
            dropOn(reorder.scope, reorder.paths, node.Path);
          },
        }
      : {};
    return (
      <div
        key={node.Path}
        className="nav-row-wrap"
        data-draggable={reorder ? "true" : undefined}
        data-dragging={dragPath === node.Path ? "true" : undefined}
        data-drop={dropPath === node.Path ? "true" : undefined}
        {...dragProps}
      >
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              className="nav-row"
              data-active={w.project === node.Path}
              title={node.Path}
            >
              <button
                type="button"
                className="nav-project"
                onClick={() => w.selectProject(node.Path)}
              >
                {node.Source === "github" ? <Github /> : <GitFork />}
                <span className="truncate">{basename(node.Path)}</span>
              </button>
              {node.Pinned && (
                <Pin className="!size-3 shrink-0 text-muted-foreground" />
              )}
              {!!terminals.length && (
                <button
                  type="button"
                  className="nav-terminal-toggle"
                  data-open={open}
                  aria-expanded={open}
                  aria-label={`${t("Show terminals")} (${terminals.length})`}
                  title={t("Show terminals")}
                  onClick={() =>
                    setExpanded((old) => ({
                      ...old,
                      [node.Path]: !old[node.Path],
                    }))
                  }
                >
                  <TerminalSquare />
                  <span className="nav-terminal-count">
                    {terminals.length}
                  </span>
                  <ChevronRight className="nav-terminal-caret" />
                </button>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-52">
            <ContextMenuItem onSelect={() => report(Desktop.OpenPath(node.Path))}>
              {t("Open folder")}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => copy(node.Path)}>
              {t("Copy path")}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => void w.openTerminal(node.Path)}>
              {t("New terminal")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              onSelect={() =>
                w.update(
                  Workspace.UpdateProject(
                    node.Path,
                    "pinned",
                    String(!node.Pinned),
                  ),
                )
              }
            >
              {t(node.Pinned ? "Unpin" : "Pin")}
            </ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                {t("Move to group")}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem
                  onSelect={() =>
                    w.update(Workspace.UpdateProject(node.Path, "group", ""))
                  }
                >
                  {t("Ungrouped")}
                </ContextMenuItem>
                {(w.state?.Groups || []).map((g) => (
                  <ContextMenuItem
                    key={g.ID}
                    onSelect={() =>
                      w.update(
                        Workspace.UpdateProject(node.Path, "group", g.ID),
                      )
                    }
                  >
                    {g.Name}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
            <ContextMenuItem
              className="text-destructive"
              onSelect={() =>
                w.update(Workspace.UpdateProject(node.Path, "removed", "true"))
              }
            >
              {t("Remove project")}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        {open && !!terminals.length && (
          <div className="terminal-list">
            {terminals.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className="terminal-item"
                aria-label={`${t("Terminal")}: ${tab.label}`}
                data-active={
                  w.page === "terminal" && w.activeTerminal === tab.id
                }
                title={tab.path}
                onClick={() => w.activateTerminal(tab)}
              >
                <ShellIcon profile={tab.profile} shell={tab.shell} />
                <span className="truncate">{tab.label}</span>
                {basename(tab.path) !== tab.label && (
                  <span className="ml-auto truncate text-[10px] opacity-70">
                    {basename(tab.path)}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  function treeRow(node: ProjectNode, root = false): React.ReactNode {
    if (node.Removed) return null;
    if (node.Repository)
      return node.Pinned || node.Group ? null : projectRow(node);
    const children = (node.Children || []).filter((n): n is ProjectNode => !!n);
    return (
      <div key={node.Path}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button
              type="button"
              className="nav-row"
              onClick={() =>
                w.update(
                  Workspace.UpdateProject(
                    node.Path,
                    "open",
                    String(!node.Open),
                  ),
                )
              }
            >
              <ChevronRight
                className={`!size-3 transition-transform ${node.Open ? "rotate-90" : ""}`}
              />
              {node.Open ? <FolderOpen /> : <Folder />}
              <span className="truncate" title={node.Path}>
                {basename(node.Path)}
              </span>
            </button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              onSelect={() => report(Desktop.OpenPath(node.Path))}
            >
              {t("Open folder")}
            </ContextMenuItem>
            {root && (
              <>
                <ContextMenuItem onSelect={w.addFolder}>
                  {t("Add folder")}
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() => w.update(Workspace.RestoreProjects())}
                >
                  {t("Restore removed projects")}
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  onSelect={() => w.update(Workspace.RemoveFolder(node.Path))}
                >
                  {t("Remove folder")}
                </ContextMenuItem>
              </>
            )}
          </ContextMenuContent>
        </ContextMenu>
        {node.Open && (
          <div className="ml-3 border-l pl-1">
            {children.map((child) => treeRow(child))}
          </div>
        )}
      </div>
    );
  }
  return (
    <aside className="project-sidebar" aria-label={t("Projects")}>
      <div className="flex h-12 shrink-0 items-center gap-2 px-4">
        <GitFork className="size-5 text-primary" />
        <strong className="text-base font-semibold tracking-tight">
          MyGit
        </strong>
        <div className="ml-auto">
          <IconButton label="Add folder" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" />
          </IconButton>
        </div>
      </div>
      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={() => w.setPalette(true)}
          className="flex h-8 w-full items-center gap-2 rounded-md border bg-background/70 px-2 text-xs text-muted-foreground"
        >
          <Search className="size-3.5" />
          {t("Search projects")}
          <kbd className="ml-auto text-[10px]">⌘ K</kbd>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {query ? (
          <>{filtered.map((p) => projectRow(p))}</>
        ) : (
          <>
            <Section title="Pinned" count={pinnedProjects.length}>
              {pinnedProjects.map((p) =>
                projectRow(p, {
                  scope: "pinned",
                  paths: pinnedProjects.map((node) => node.Path),
                }),
              )}
            </Section>
            <Section
              title="Repositories"
              count={w.projects.length}
              defaultOpen={false}
            >
              {w.projects.map((p) => projectRow(p))}
            </Section>
            {(w.state?.Groups || []).map((g) => {
              const members = orderProjects(
                w.projects.filter((p) => p.Group === g.ID && !p.Pinned),
                g.ID,
                w.state?.ProjectOrder,
              );
              const paths = members.map((node) => node.Path);
              return (
                <ContextMenu key={g.ID}>
                  <ContextMenuTrigger asChild>
                    <div>
                      <Section title={g.Name} count={members.length}>
                        {members.map((p) =>
                          projectRow(p, { scope: g.ID, paths }),
                        )}
                      </Section>
                    </div>
                  </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onSelect={newGroup}>
                    {t("New group")}
                  </ContextMenuItem>
                  <ContextMenuItem
                    onSelect={() => setGroup({ id: g.ID, name: g.Name })}
                  >
                    {t("Rename group")}
                  </ContextMenuItem>
                  <ContextMenuItem
                    onSelect={() => w.update(Workspace.SetGroup(g.ID, ""))}
                  >
                    {t("Delete group")}
                  </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
            <Section
              title="Ungrouped projects"
              action={
                <IconButton label="New group" onClick={newGroup}>
                  <Plus className="size-3" />
                </IconButton>
              }
            >
              {(w.state?.Trees || [])
                .filter(
                  (n): n is ProjectNode =>
                    !!n && !!w.state?.Roots?.includes(n.Path),
                )
                .map((n) => treeRow(n, true))}
            </Section>
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 border-t px-3 py-2">
        <Input
          aria-label={t("Filter refs…")}
          className="h-7 flex-1 border-0 bg-transparent px-1 text-xs shadow-none"
          placeholder={t("Search projects")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <IconButton label="Refresh" onClick={() => report(w.scan())}>
          <RefreshCw className="size-3.5" />
        </IconButton>
        <IconButton label="Settings" onClick={() => w.setSettings(true)}>
          <Settings className="size-3.5" />
        </IconButton>
      </div>
      <AddProjectDialog open={addOpen} onOpenChange={setAddOpen} />
      <Dialog
        open={!!group}
        onOpenChange={(open) => {
          if (!open) setGroup(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("Group name")}</DialogTitle>
            <DialogDescription>{t("Projects")}</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!group?.name.trim()) return;
              await w.update(Workspace.SetGroup(group.id, group.name.trim()));
              setGroup(null);
            }}
          >
            <Input
              autoFocus
              aria-label={t("Group name")}
              value={group?.name || ""}
              onChange={(e) =>
                setGroup((g) => g && { ...g, name: e.target.value })
              }
            />
            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setGroup(null)}
              >
                {t("Cancel")}
              </Button>
              <Button disabled={!group?.name.trim()}>{t("Save")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </aside>
  );
}

export function ProjectPalette() {
  const w = useWorkbench(),
    t = useT();
  const choose = (fn: () => void) => {
    w.setPalette(false);
    fn();
  };
  return (
    <CommandDialog
      open={w.palette}
      onOpenChange={w.setPalette}
      title={t("Search projects")}
      description={t("Search repositories and commands…")}
    >
      <CommandInput placeholder={t("Search repositories and commands…")} />
      <CommandList>
        <CommandEmpty>{t("No matching projects")}</CommandEmpty>
        <CommandGroup heading={t("Repositories")}>
          {w.projects.map((p) => (
            <CommandItem
              key={p.Path}
              value={`${basename(p.Path)} ${p.Path}`}
              onSelect={() => choose(() => w.selectProject(p.Path))}
            >
              <GitFork />
              <span>{basename(p.Path)}</span>
              <span className="ml-auto max-w-64 truncate text-xs text-muted-foreground">
                {p.Path}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup>
          <CommandItem onSelect={() => choose(w.addFolder)}>
            <Plus />
            {t("Add folder")}
          </CommandItem>
          <CommandItem onSelect={() => choose(() => w.setSettings(true))}>
            <Settings />
            {t("Settings")}
          </CommandItem>
          <CommandItem
            onSelect={() =>
              choose(() => {
                void w.update(Workspace.RestoreProjects());
              })
            }
          >
            {t("Restore removed projects")}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
