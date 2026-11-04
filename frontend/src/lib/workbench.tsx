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
  Workspace,
  type Action,
  type ProjectNode,
  type Repository,
  type WorkspaceState,
} from "./api";
import { errorMessage } from "./utils";

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
type Workbench = {
  state: WorkspaceState | null;
  projects: ProjectNode[];
  project: string;
  path: string;
  repo: Repository | null;
  loading: boolean;
  error: string;
  busy: string;
  version: number;
  pending: PendingAction | null;
  setPending: (value: PendingAction | null) => void;
  settings: boolean;
  setSettings: (value: boolean) => void;
  palette: boolean;
  setPalette: (value: boolean) => void;
  update: (operation: Promise<WorkspaceState>) => Promise<void>;
  selectProject: (path: string) => void;
  selectWorktree: (path: string) => void;
  refresh: () => void;
  scan: () => Promise<void>;
  addFolder: () => Promise<void>;
  request: (title: string, value: Partial<Action> & { Kind: string }) => void;
  execute: (value: Action) => Promise<boolean>;
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

export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [repo, setRepo] = useState<Repository | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [version, setVersion] = useState(0);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [settings, setSettings] = useState(false);
  const [palette, setPalette] = useState(false);
  const projects = useMemo(() => collectProjects(state), [state]);
  const project = projects.some((p) => p.Path === state?.Selected)
    ? state!.Selected
    : projects[0]?.Path || "";
  const path = state?.Worktrees?.[project] || project;
  const draftWrites = useRef(new Map<string, Promise<void>>());
  const activePath = useRef(path);
  activePath.current = path;
  const writes = useRef(new Set<string>());
  const selectionGeneration = useRef(0);
  const { setTheme } = useTheme();
  useEffect(() => {
    if (state) setTheme(state.Preferences.Theme);
  }, [state?.Preferences.Theme, setTheme]);

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
  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  const request = useCallback(
    (title: string, value: Partial<Action> & { Kind: string }) => {
      setPending({ title, value: action(value.Kind, path, value) });
    },
    [path],
  );
  const execute = useCallback(
    async (value: Action) => {
      if (writes.current.has(value.Path)) return false;
      writes.current.add(value.Path);
      setBusy(value.Kind);
      let success = false;
      try {
        await Git.Execute(value);
        success = true;
        setState(await Workspace.State());
      } catch (error) {
        toast.error(errorMessage(error), { duration: 8000 });
      } finally {
        writes.current.delete(value.Path);
        setBusy("");
        if (activePath.current === value.Path) refresh();
      }
      return success;
    },
    [refresh],
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
    version,
    pending,
    setPending,
    settings,
    setSettings,
    palette,
    setPalette,
    update,
    selectProject,
    selectWorktree,
    refresh,
    scan,
    addFolder,
    request,
    execute,
    saveDraft,
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
