import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { useTheme } from "@/lib/theme";
import {
  action,
  Desktop,
  Git,
  Term,
  Workspace,
  type Action,
  type ProjectNode,
  type Repository,
  type LineSelection,
  type TerminalCommand,
  type TerminalProfile,
  type WorkspaceState,
} from "./api";
import { basename, errorMessage } from "./utils";

export function collectProjects(state: WorkspaceState | null): ProjectNode[] {
  const map = new Map<string, ProjectNode>();
  function visit(node: ProjectNode | null) {
    if (!node) return;
    if (node.Repository && !node.Removed) map.set(node.Path, node);
    for (const child of node.Children || []) visit(child);
  }
  for (const tree of state?.Trees || [])
    if (tree && state?.Roots?.includes(tree.Path)) visit(tree);
  return [...map.values()].sort((a, b) => a.Path.localeCompare(b.Path));
}

export type PendingAction = { title: string; value: Action };
export type TerminalTab = {
  id: string;
  path: string;
  project: string;
  label: string;
  profile: string;
  shell: string;
};
type Workbench = {
  state: WorkspaceState | null;
  projects: ProjectNode[];
  project: string;
  path: string;
  repo: Repository | null;
  loading: boolean;
  error: string;
  busy: string;
  background: string;
  version: number;
  pending: PendingAction | null;
  setPending: (value: PendingAction | null) => void;
  settings: boolean;
  setSettings: (value: boolean) => void;
  palette: boolean;
  setPalette: (value: boolean) => void;
  page: "git" | "terminal";
  setPage: (value: "git" | "terminal") => void;
  terminals: TerminalTab[];
  activeTerminal: string;
  profiles: TerminalProfile[] | null;
  commands: TerminalCommand[];
  terminalsFor: (project: string) => TerminalTab[];
  showTerminal: () => void;
  openTerminal: (
    project: string,
    profile?: string,
    command?: string,
    cwd?: string,
    label?: string,
  ) => void;
  runCommand: (command: TerminalCommand) => void;
  saveCommands: (commands: TerminalCommand[]) => Promise<boolean>;
  activateTerminal: (tab: TerminalTab) => void;
  closeTerminal: (id: string) => Promise<void>;
  closeOtherTerminals: (id: string) => Promise<void>;
  moveTerminal: (source: string, target: string) => void;
  update: (operation: Promise<WorkspaceState>) => Promise<void>;
  selectProject: (path: string) => void;
  selectWorktree: (path: string) => void;
  refresh: () => void;
  scan: () => Promise<void>;
  addFolder: () => Promise<void>;
  request: (title: string, value: Partial<Action> & { Kind: string }) => void;
  execute: (value: Action) => Promise<boolean>;
  applyLines: (selection: LineSelection) => Promise<boolean>;
  saveDraft: (path: string, message: string) => Promise<void>;
};
const Context = createContext<Workbench | null>(null);
export function useWorkbench() {
  const value = useContext(Context);
  if (!value) throw new Error("Missing workbench provider");
  return value;
}
export async function report(operation: Promise<unknown>) {
  try {
    await operation;
  } catch (error) {
    toast.error(errorMessage(error));
  }
}
export async function copy(text: string) {
  if (!text) return;
  await report(Desktop.CopyText(text));
}

// Writes reach the backend through one queue per worktree, so a fast click is
// ordered instead of rejected. Remote lane work (fetch, push) does not block
// local staging, which is what keeps the app usable during a slow network.
const REMOTE_KINDS = new Set([
  "fetch",
  "push",
  "push-tag",
  "delete-remote-branch",
  "delete-remote-tag",
]);
// Queueing must not replay an operation that is not idempotent.
const SERIAL_KINDS = new Set([
  "commit",
  "merge",
  "rebase",
  "interactive-rebase",
  "cherry-pick",
  "revert",
  "continue",
  "abort",
]);
type Stack = Map<string, string[]>;
function pushStack(stack: { current: Stack }, key: string, kind: string) {
  const list = stack.current.get(key) || [];
  list.push(kind);
  stack.current.set(key, list);
}
function popStack(stack: { current: Stack }, key: string, kind: string) {
  const list = stack.current.get(key);
  if (!list) return;
  const index = list.lastIndexOf(kind);
  if (index >= 0) list.splice(index, 1);
  if (!list.length) stack.current.delete(key);
}

export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [repo, setRepo] = useState<Repository | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [background, setBackground] = useState("");
  const [version, setVersion] = useState(0);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [settings, setSettings] = useState(false);
  const [palette, setPalette] = useState(false);
  const [page, setPage] = useState<"git" | "terminal">("git");
  const [terminals, setTerminals] = useState<TerminalTab[]>([]);
  const [activeTerminal, setActiveTerminal] = useState("");
  // Terminal tabs belong to a project, so the "active" tab is remembered per
  // project. Switching projects must swap the visible terminal set, not keep
  // showing the terminal of the project you just left.
  const activeByProject = useRef<Record<string, string>>({});
  const [profiles, setProfiles] = useState<TerminalProfile[] | null>(null);
  const [commands, setCommands] = useState<TerminalCommand[]>([]);
  const projects = useMemo(() => collectProjects(state), [state]);
  const project = projects.some((p) => p.Path === state?.Selected)
    ? state!.Selected
    : projects[0]?.Path || "";
  const path = state?.Worktrees?.[project] || project;
  const draftWrites = useRef(new Map<string, Promise<void>>());
  const activePath = useRef(path);
  activePath.current = path;
  const queues = useRef(new Map<string, Promise<unknown>>());
  const localWork = useRef<Stack>(new Map());
  const remoteWork = useRef<Stack>(new Map());
  const claims = useRef(new Set<string>());
  const refreshTimer = useRef<number | null>(null);
  const selectionGeneration = useRef(0);
  const terminalsRef = useRef<TerminalTab[]>(terminals);
  terminalsRef.current = terminals;
  const activeTerminalRef = useRef(activeTerminal);
  activeTerminalRef.current = activeTerminal;
  const startingTerminal = useRef(false);
  const { setTheme } = useTheme();
  useEffect(() => {
    if (state) setTheme(state.Preferences.Theme);
  }, [state?.Preferences.Theme, setTheme]);
  useEffect(() => {
    let alive = true;
    Term.Profiles()
      .then((value) => {
        if (alive) setProfiles(value || []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  // Shortcut commands are per project, so reload them whenever the selected
  // project changes and clear them until the new list arrives.
  useEffect(() => {
    if (!project) {
      setCommands([]);
      return;
    }
    let alive = true;
    setCommands([]);
    Term.Commands(project)
      .then((value) => {
        if (alive) setCommands(value || []);
      })
      .catch((error) => {
        if (alive) toast.error(errorMessage(error));
      });
    return () => {
      alive = false;
    };
  }, [project]);

  const update = useCallback(async (operation: Promise<WorkspaceState>) => {
    try {
      setState(await operation);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }, []);
  const scan = useCallback(async () => {
    try {
      setState(await Workspace.Refresh());
    } catch (error) {
      setState(await Workspace.State());
      toast.error(errorMessage(error));
    }
  }, []);
  useEffect(() => {
    let alive = true;
    Workspace.State()
      .then(async (value) => {
        if (!alive) return;
        setState(value);
        setLoading(false);
        if (value.Roots?.length) await scan();
      })
      .catch((error) => {
        if (alive) {
          setError(errorMessage(error));
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [scan]);
  useEffect(() => {
    if (!path) {
      setRepo(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError("");
    setRepo((previous) => (previous?.Path === path ? previous : null));
    Git.Snapshot(path)
      .then((value) => {
        if (alive) setRepo(value);
      })
      .catch((error) => {
        if (alive) setError(errorMessage(error));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [path, version]);

  const selectProject = useCallback((next: string) => {
    const generation = ++selectionGeneration.current;
    Workspace.Select(next, "")
      .then((value) => {
        if (generation === selectionGeneration.current) setState(value);
      })
      .catch((error) => toast.error(errorMessage(error)));
  }, []);
  const selectWorktree = useCallback(
    (next: string) => {
      const generation = ++selectionGeneration.current;
      Workspace.Select(project, next)
        .then((value) => {
          if (generation === selectionGeneration.current) setState(value);
        })
        .catch((error) => toast.error(errorMessage(error)));
    },
    [project],
  );
  const setTerminalActive = useCallback((projectPath: string, id: string) => {
    if (id) activeByProject.current[projectPath] = id;
    setActiveTerminal(id);
  }, []);
  // Keep the active terminal inside the selected project: when the project
  // changes, restore the tab that project had active (or its newest one). This
  // is what makes the terminal pane follow the project you switch to.
  useEffect(() => {
    const mine = terminals.filter((tab) => tab.project === project);
    const remembered = activeByProject.current[project];
    setActiveTerminal(
      remembered && mine.some((tab) => tab.id === remembered)
        ? remembered
        : mine.at(-1)?.id || "",
    );
  }, [project]);
  const openTerminal = useCallback(
    async (
      projectPath: string,
      profile = "",
      command = "",
      cwdOverride = "",
      labelOverride = "",
    ) => {
      if (!projectPath || startingTerminal.current) return;
      startingTerminal.current = true;
      try {
        const main =
          projectPath === project
            ? repo?.Worktrees?.find((worktree) => worktree.Main)?.Path
            : undefined;
        const cwd =
          cwdOverride || main || state?.Worktrees?.[projectPath] || projectPath;
        const shell = (profiles ?? []).find((item) =>
          profile ? item.ID === profile : item.Default && item.Available,
        );
        const id = await Term.Start(cwd, 100, 30, profile);
        setTerminals((old) => {
          // A shortcut terminal is named after its command; a plain terminal
          // after its folder. Keep labels unique within a project.
          const base = labelOverride.trim() || basename(cwd);
          const taken = new Set(
            old.filter((tab) => tab.project === projectPath).map((tab) => tab.label),
          );
          let label = base;
          for (let n = 2; taken.has(label); n += 1) label = `${base} ${n}`;
          return [
            ...old,
            {
              id,
              path: cwd,
              project: projectPath,
              label,
              profile: shell?.ID || profile,
              shell: shell?.Label || "",
            },
          ];
        });
        setTerminalActive(projectPath, id);
        setPage("terminal");
        if (projectPath !== project) selectProject(projectPath);
        if (command) void report(Term.Write(id, `${command}\r`));
      } catch (error) {
        toast.error(errorMessage(error));
      } finally {
        startingTerminal.current = false;
      }
    },
    [project, repo, state, selectProject, profiles, setTerminalActive],
  );
  const runCommand = useCallback(
    (command: TerminalCommand) => {
      void openTerminal(
        project,
        command.Profile,
        command.Command,
        command.Path,
        command.Label,
      );
    },
    [openTerminal, project],
  );
  const saveCommands = useCallback(
    async (next: TerminalCommand[]) => {
      if (!project) return false;
      try {
        setCommands((await Term.SaveCommands(project, next)) || []);
        return true;
      } catch (error) {
        toast.error(errorMessage(error));
        return false;
      }
    },
    [project],
  );
  const terminalsFor = useCallback(
    (projectPath: string) =>
      terminals.filter((tab) => tab.project === projectPath),
    [terminals],
  );
  const activateTerminal = useCallback(
    (tab: TerminalTab) => {
      setTerminalActive(tab.project, tab.id);
      setPage("terminal");
      if (tab.project !== project) selectProject(tab.project);
    },
    [project, selectProject, setTerminalActive],
  );
  const showTerminal = useCallback(() => {
    setPage("terminal");
    // Only auto-open a terminal when the current project has none; another
    // project's terminals must not leak into this project's view.
    if (!terminalsRef.current.some((tab) => tab.project === project))
      void openTerminal(project);
  }, [openTerminal, project]);
  const closeTerminal = useCallback(
    async (id: string) => {
      try {
        await Term.Close(id);
      } catch (error) {
        toast.error(errorMessage(error));
      }
      const next = terminalsRef.current.filter((tab) => tab.id !== id);
      setTerminals(next);
      if (activeTerminalRef.current === id) {
        // Fall back to the newest remaining terminal of the same project.
        const mine = next.filter((tab) => tab.project === project);
        setTerminalActive(project, mine.at(-1)?.id || "");
      }
    },
    [project, setTerminalActive],
  );
  // Ctrl/Cmd+W closes the active terminal tab while the terminal view is open.
  // Registered in the capture phase so xterm's hidden textarea never sees the
  // key (otherwise it would be sent to the shell as "delete word").
  useEffect(() => {
    if (page !== "terminal") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey)
        return;
      if (event.key.toLowerCase() !== "w") return;
      const target = event.target as HTMLElement | null;
      const inTerminal = !!target?.closest?.(".xterm");
      const editing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      // Form fields keep their native Ctrl+W (delete word); the terminal's
      // hidden textarea is the exception — there Ctrl+W must close the tab.
      if (editing && !inTerminal) return;
      event.preventDefault();
      event.stopPropagation();
      const id = activeTerminalRef.current;
      if (id) void closeTerminal(id);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [page, closeTerminal]);
  const closeOtherTerminals = useCallback(
    async (id: string) => {
      const target = terminalsRef.current.find((tab) => tab.id === id);
      if (!target) return;
      // "Close others" only affects siblings in the same project, because the
      // tab strip now shows just the selected project's terminals.
      const others = terminalsRef.current.filter(
        (tab) => tab.id !== id && tab.project === target.project,
      );
      for (const tab of others) {
        try {
          await Term.Close(tab.id);
        } catch (error) {
          toast.error(errorMessage(error));
        }
      }
      setTerminals((old) =>
        old.filter((tab) => tab.id === id || tab.project !== target.project),
      );
      setTerminalActive(target.project, id);
    },
    [setTerminalActive],
  );
  const moveTerminal = useCallback((source: string, target: string) => {
    setTerminals((old) => {
      const from = old.findIndex((tab) => tab.id === source);
      const to = old.findIndex((tab) => tab.id === target);
      if (from < 0 || to < 0 || from === to) return old;
      const next = [...old];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);
  const addFolder = useCallback(async () => {
    try {
      const folder = await Desktop.ChooseFolder();
      if (!folder) return;
      setState(await Workspace.AddFolder(folder));
      await scan();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }, [scan]);
  const saveDraft = useCallback((path: string, message: string) => {
    const queued = (draftWrites.current.get(path) || Promise.resolve())
      .catch(() => {})
      .then(async () => {
        await Workspace.SaveDraft(path, message);
        setState(
          (previous) =>
            previous && {
              ...previous,
              Drafts: { ...previous.Drafts, [path]: message },
            },
        );
      });
    draftWrites.current.set(path, queued);
    return queued;
  }, []);
  const refresh = useCallback(() => {
    if (refreshTimer.current !== null) {
      window.clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }
    setVersion((value) => value + 1);
  }, []);
  // Several writes often land together; one snapshot covers all of them.
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current !== null) return;
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      setVersion((value) => value + 1);
    }, 150);
  }, []);
  const syncBusy = useCallback(() => {
    const key = activePath.current;
    setBusy(localWork.current.get(key)?.[0] || "");
    setBackground(remoteWork.current.get(key)?.[0] || "");
  }, []);
  useEffect(() => syncBusy(), [path, syncBusy]);
  useEffect(
    () => () => {
      if (refreshTimer.current !== null)
        window.clearTimeout(refreshTimer.current);
    },
    [],
  );
  const enqueue = useCallback(
    <T,>(path: string, kind: string, run: () => Promise<T>): Promise<T> | null => {
      const remote = REMOTE_KINDS.has(kind);
      const claim = `${path}|${kind}`;
      if (!remote && SERIAL_KINDS.has(kind)) {
        if (claims.current.has(claim)) return null;
        claims.current.add(claim);
      }
      const stack = remote ? remoteWork : localWork;
      const previous = queues.current.get(path) || Promise.resolve();
      const task = previous
        .catch(() => {})
        .then(async () => {
          pushStack(stack, path, kind);
          if (path === activePath.current) syncBusy();
          try {
            return await run();
          } finally {
            popStack(stack, path, kind);
            if (path === activePath.current) syncBusy();
            if (!remote && SERIAL_KINDS.has(kind))
              claims.current.delete(claim);
          }
        });
      // The chain must survive a rejected write, but the caller still needs it.
      queues.current.set(
        path,
        task.catch(() => {}),
      );
      return task;
    },
    [syncBusy],
  );
  const request = useCallback(
    (title: string, value: Partial<Action> & { Kind: string }) => {
      setPending({ title, value: action(value.Kind, path, value) });
    },
    [path],
  );
  const execute = useCallback(
    async (value: Action) => {
      const task = enqueue(value.Path, value.Kind, async () => {
        await Git.Execute(value);
        return true;
      });
      // A queued duplicate of a non-idempotent action is dropped, not replayed.
      if (!task) return false;
      try {
        await task;
        setState(await Workspace.State());
        scheduleRefresh();
        return true;
      } catch (error) {
        toast.error(errorMessage(error), { duration: 8000 });
        return false;
      }
    },
    [enqueue, scheduleRefresh],
  );
  const applyLines = useCallback(
    async (selection: LineSelection) => {
      const task = enqueue(
        selection.Request.Request.Path,
        selection.Discard ? "discard" : "stage",
        async () => {
          await Git.ApplyLines(selection);
          return true;
        },
      );
      return task ?? false;
    },
    [enqueue],
  );
  const value: Workbench = {
    state,
    projects,
    project,
    path,
    repo,
    loading,
    error,
    busy,
    background,
    version,
    pending,
    setPending,
    settings,
    setSettings,
    palette,
    setPalette,
    page,
    setPage,
    terminals,
    activeTerminal,
    profiles,
    commands,
    terminalsFor,
    showTerminal,
    openTerminal,
    runCommand,
    saveCommands,
    activateTerminal,
    closeTerminal,
    closeOtherTerminals,
    moveTerminal,
    update,
    selectProject,
    selectWorktree,
    refresh,
    scan,
    addFolder,
    request,
    execute,
    applyLines,
    saveDraft,
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
