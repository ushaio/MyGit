import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Columns2,
  Copy,
  Download,
  File as FileIcon,
  FolderGit2,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  GitFork,
  Github,
  Globe,
  Minus,
  Pin,
  Plus,
  RefreshCw,
  Rows3,
  Search,
  Settings,
  Sparkles,
  Square,
  SquareTerminal,
  Tag,
  WrapText,
  X,
} from "lucide-react";
import {
  graphColors,
  GraphCell,
  buildGraph,
  graphWidth,
} from "./graph";
import "./demo.css";
import {
  groups,
  repos as seedRepos,
  type Change,
  type Commit,
  type DiffLine,
  type QuickCommand,
  type Repo,
  type TerminalSegment,
  type TerminalTab,
  type Worktree,
} from "./data";

type Theme = "light" | "dark";
type Pane = "history" | "changes";
type Mode = "git" | "terminal";

/* ------------------------------------------------------------------ */
/*  Shell                                                              */
/* ------------------------------------------------------------------ */

export function AppDemo() {
  const [theme, setTheme] = useState<Theme>("light");
  const [resetToken, setResetToken] = useState(0);

  return (
    <div className="demo">
      <div className="demo-toolbar">
        <div className="demo-live">
          <span className="demo-live-dot" aria-hidden="true" />
          可交互演示 · 所有操作只发生在内存里
        </div>
        <div className="demo-toolbar-right">
          <span className="demo-theme-label">窗口主题</span>
          <div className="aw-seg" role="group" aria-label="演示窗口主题">
            <button
              type="button"
              aria-pressed={theme === "light"}
              onClick={() => setTheme("light")}
            >
              浅色
            </button>
            <button
              type="button"
              aria-pressed={theme === "dark"}
              onClick={() => setTheme("dark")}
            >
              深色
            </button>
          </div>
          <button
            type="button"
            className="demo-reset"
            onClick={() => setResetToken((value) => value + 1)}
          >
            <RefreshCw size={12} aria-hidden="true" />
            重置
          </button>
        </div>
      </div>

      <div
        className="app-viewport"
        role="region"
        aria-label="MyGit 应用模拟演示，可键盘滚动"
        tabIndex={0}
      >
        <DemoWindow key={resetToken} theme={theme} />
      </div>
      <p className="demo-scroll-hint">窗口较宽，可左右拖动查看完整界面</p>
    </div>
  );
}

function DemoWindow({ theme }: { theme: Theme }) {
  const [workspace, setWorkspace] = useState<Repo[]>(seedRepos);
  const [repoId, setRepoId] = useState("pulse");
  const [worktreeId, setWorktreeId] = useState("pulse-web");
  const [mode, setMode] = useState<Mode>("git");
  const [pane, setPane] = useState<Pane>("history");
  const [commitHash, setCommitHash] = useState<string | null>(
    seedRepos[0].commits[0].hash,
  );
  const [detailTab, setDetailTab] = useState<"details" | "changes">("details");
  const [filePath, setFilePath] = useState<string | null>(
    seedRepos[0].worktrees[1].changes[0]?.path ?? null,
  );
  const [message, setMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [refFilter, setRefFilter] = useState("");
  const [fileQuery, setFileQuery] = useState("");
  const [wrapLines, setWrapLines] = useState(true);
  const [splitView, setSplitView] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [menu, setMenu] = useState<"commit" | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const repo =
    workspace.find((item) => item.id === repoId) ?? workspace[0];
  const worktree =
    repo.worktrees.find((item) => item.id === worktreeId) ??
    repo.worktrees[0];
  const change = worktree.changes.find((item) => item.path === filePath) ?? null;
  const selected = repo.commits.find((item) => item.hash === commitHash) ?? null;
  const staged = worktree.changes.filter((item) => item.staged);
  const unstaged = worktree.changes.filter((item) => !item.staged);
  const canCommit = staged.length > 0 && message.trim().length > 0;

  const filteredCommits = useMemo(() => {
    const query = historyQuery.trim().toLowerCase();
    if (!query) return repo.commits;
    return repo.commits.filter((commit) =>
      `${commit.subject} ${commit.author} ${commit.short} ${commit.body ?? ""}`
        .toLowerCase()
        .includes(query),
    );
  }, [repo.commits, historyQuery]);

  const graph = useMemo(() => buildGraph(filteredCommits), [filteredCommits]);
  const gWidth = useMemo(() => graphWidth(graph), [graph]);

  function notify(text: string) {
    window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text });
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }

  useEffect(() => {
    return () => window.clearTimeout(toastTimer.current);
  }, []);

  function pickRepo(next: Repo) {
    const target =
      next.worktrees.find((item) => item.changes.length > 0) ??
      next.worktrees[0];
    setRepoId(next.id);
    setWorktreeId(target.id);
    setMode("git");
    setPane("history");
    setCommitHash(next.commits[0]?.hash ?? null);
    setDetailTab("details");
    setFilePath(target.changes[0]?.path ?? null);
    setHistoryQuery("");
    setRefFilter("");
    setFileQuery("");
    setMessage("");
    setAmend(false);
    setMenu(null);
  }

  function pickWorktree(id: string) {
    const target = repo.worktrees.find((item) => item.id === id);
    if (!target) return;
    setWorktreeId(target.id);
    setFilePath(target.changes[0]?.path ?? null);
    setMessage("");
    setFileQuery("");
    setCommitHash(repo.commits[0]?.hash ?? null);
  }

  function pickBranch(branch: string) {
    const target = repo.worktrees.find((item) => item.branch === branch);
    if (target) {
      pickWorktree(target.id);
      notify(`已切换到工作树 ${target.name}`);
    } else {
      notify("这个分支还没有工作树（演示）");
    }
  }

  function patchWorktree(fn: (worktree: Worktree) => Worktree) {
    setWorkspace((current) =>
      current.map((item) =>
        item.id !== repo.id
          ? item
          : {
              ...item,
              worktrees: item.worktrees.map((wt) =>
                wt.id !== worktree.id ? wt : fn(wt),
              ),
            },
      ),
    );
  }

  function toggleStage(path: string) {
    patchWorktree((wt) => ({
      ...wt,
      changes: wt.changes.map((item) =>
        item.path === path ? { ...item, staged: !item.staged } : item,
      ),
    }));
  }

  function setAllStaged(value: boolean) {
    patchWorktree((wt) => ({
      ...wt,
      changes: wt.changes.map((item) => ({ ...item, staged: value })),
    }));
  }

  function runRemote(key: string, done: string) {
    if (busy) return;
    setBusy(key);
    window.setTimeout(() => {
      setBusy(null);
      notify(done);
    }, 700);
  }

  function generateMessage() {
    if (generating || staged.length === 0) return;
    setGenerating(true);
    window.setTimeout(() => {
      const names = staged.slice(0, 3).map((item) => item.path.split("/").pop());
      setMessage(
        [
          "feat(website): 完善工作区演示与首屏",
          "",
          `- 添加 ${names.join("、")} 等 ${staged.length} 个文件的改动`,
          "- 调整窗口主题与交互状态",
        ].join("\n"),
      );
      setGenerating(false);
    }, 800);
  }

  function randomHash() {
    let hash = "";
    for (let index = 0; index < 12; index++)
      hash += "0123456789abcdef"[Math.floor(Math.random() * 16)];
    return hash;
  }

  function commit(push = false) {
    if (!canCommit) return;
    const [subject, ...rest] = message.trim().split("\n");
    const body = rest.join("\n").trim();
    const hash = randomHash();
    const newCommit: Commit = {
      hash,
      short: hash.slice(0, 7),
      subject,
      body: body || undefined,
      author: "You",
      email: "you@local",
      date: "刚刚",
      fullDate: "刚刚",
      parents: amend
        ? (repo.commits[0]?.parents ?? [])
        : [repo.commits[0]?.hash].filter(Boolean),
      refs: [`HEAD -> ${worktree.branch}`],
      files: staged.map((item) => ({
        path: item.path,
        status: item.status,
        added: item.added,
        deleted: item.deleted,
      })),
    };
    const remaining = worktree.changes.filter((item) => !item.staged);

    setWorkspace((current) =>
      current.map((item) => {
        if (item.id !== repo.id) return item;
        const base = amend ? item.commits.slice(1) : item.commits;
        return {
          ...item,
          commits: [
            newCommit,
            ...base.map((old) => ({
              ...old,
              refs: old.refs.filter((ref) => !ref.startsWith("HEAD ->")),
            })),
          ],
          worktrees: item.worktrees.map((wt) =>
            wt.id !== worktree.id
              ? wt
              : {
                  ...wt,
                  changes: amend
                    ? []
                    : wt.changes.filter((entry) => !entry.staged),
                },
          ),
        };
      }),
    );

    setCommitHash(hash);
    setDetailTab("details");
    setPane("history");
    setMessage("");
    setAmend(false);
    setMenu(null);
    setFilePath(remaining[0]?.path ?? null);
    notify(
      push
        ? `已提交并推送 ${newCommit.short}（演示）`
        : `已提交 ${newCommit.short}（演示）`,
    );
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify(`已复制${label}`);
    } catch {
      notify("当前浏览器不允许写入剪贴板");
    }
  }

  return (
    <div className="app-window" data-theme={theme}>
      <div className="aw-titlebar">
        <div className="aw-titlebar-left">
          <img src="/favicon.svg" alt="" width={16} height={16} />
          <span className="aw-titlebar-app">MyGit</span>
          <span className="aw-titlebar-sep">/</span>
          <span className="aw-titlebar-repo">{repo.name}</span>
        </div>
        <div className="aw-titlebar-controls">
          <button type="button" aria-label="最小化（演示）" onClick={() => notify("窗口控件在官网演示中不可用")}>
            <Minus size={12} />
          </button>
          <button type="button" aria-label="最大化（演示）" onClick={() => notify("窗口控件在官网演示中不可用")}>
            <Square size={9} />
          </button>
          <button type="button" className="aw-close" aria-label="关闭（演示）" onClick={() => notify("窗口控件在官网演示中不可用")}>
            <X size={12} />
          </button>
        </div>
      </div>

      <div className="aw-body">
        <ProjectSidebar
          workspace={workspace}
          activeId={repo.id}
          onPick={pickRepo}
        />

        <div className="aw-repo">
          <header className="aw-header">
            <div className="aw-header-repo">
              <span className="aw-header-name">{repo.name}</span>
              <span className="aw-header-branch">
                <GitBranch size={13} />
                {worktree.branch}
              </span>
            </div>

            <div className="aw-header-actions">
              <button
                type="button"
                className="aw-ghost"
                disabled={busy !== null}
                onClick={() => runRemote("fetch", "已获取 origin：0 个新提交（演示）")}
              >
                <Download size={13} className={busy === "fetch" ? "aw-spin" : ""} />
                获取
              </button>
              <button
                type="button"
                className="aw-ghost"
                disabled={busy !== null}
                onClick={() => runRemote("pull", "已是最新（演示）")}
              >
                <ArrowDownToLine size={13} className={busy === "pull" ? "aw-spin" : ""} />
                拉取
              </button>
              <button
                type="button"
                className="aw-ghost"
                disabled={busy !== null}
                onClick={() => runRemote("push", `已推送 ${worktree.branch}（演示）`)}
              >
                <ArrowUpFromLine size={13} className={busy === "push" ? "aw-spin" : ""} />
                推送
              </button>
              <button
                type="button"
                className="aw-ghost"
                disabled={busy !== null}
                onClick={() => runRemote("stash", "已贮藏 1 个更改（演示）")}
              >
                <Archive size={13} className={busy === "stash" ? "aw-spin" : ""} />
                贮藏更改
              </button>
            </div>

            <div className="aw-header-tools">
              <div className="aw-seg" role="group" aria-label="Git 或终端">
                <button
                  type="button"
                  aria-pressed={mode === "git"}
                  onClick={() => setMode("git")}
                >
                  <GitBranch size={12} />
                  Git
                </button>
                <button
                  type="button"
                  aria-pressed={mode === "terminal"}
                  onClick={() => setMode("terminal")}
                >
                  <SquareTerminal size={12} />
                  终端
                </button>
              </div>
              <button
                type="button"
                className="aw-icon"
                title="刷新"
                aria-label="刷新"
                onClick={() => notify("已刷新工作区（演示）")}
              >
                <RefreshCw size={13} />
              </button>
              <button
                type="button"
                className="aw-icon"
                title="打开文件夹"
                aria-label="打开文件夹"
                onClick={() => notify(`打开 ${worktree.path}（演示）`)}
              >
                <FolderOpen size={14} />
              </button>
              <button
                type="button"
                className="aw-icon"
                title="终端"
                aria-label="终端"
                onClick={() => setMode("terminal")}
              >
                <SquareTerminal size={14} />
              </button>
              <button
                type="button"
                className="aw-icon"
                title="在编辑器中打开"
                aria-label="在编辑器中打开"
                onClick={() => notify("在编辑器中打开（演示）")}
              >
                <Braces size={14} />
              </button>
              <button
                type="button"
                className="aw-icon"
                title="在浏览器中打开仓库"
                aria-label="在浏览器中打开仓库"
                onClick={() => notify("在浏览器中打开仓库（演示）")}
              >
                <Globe size={14} />
              </button>
            </div>
          </header>

          {mode === "git" ? (
            <>
              <div className="aw-tabs">
                <div className="aw-tab-scroll" role="tablist" aria-label="工作树">
                  {repo.worktrees.map((item) => (
                    <div
                      key={item.id}
                      className={`aw-tab ${item.id === worktree.id ? "active" : ""}`}
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={item.id === worktree.id}
                        className="aw-tab-main"
                        onClick={() => pickWorktree(item.id)}
                      >
                        <FolderGit2 size={12} />
                        <span>{item.name}</span>
                      </button>
                      <button
                        type="button"
                        className="aw-tab-x"
                        aria-label={`关闭 ${item.name}（演示）`}
                        onClick={() => notify("演示中保留所有工作树")}
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="aw-icon"
                  title="新建工作树"
                  aria-label="新建工作树"
                  onClick={() => notify("新建工作树对话框（演示）")}
                >
                  <Plus size={14} />
                </button>
                <span className="aw-tabs-note">
                  {repo.worktrees.length} 个工作树
                </span>
              </div>

              <div className="aw-main">
                <RefsSidebar
                  repo={repo}
                  worktree={worktree}
                  pane={pane}
                  onPane={setPane}
                  onWorktree={pickWorktree}
                  onBranch={pickBranch}
                  filter={refFilter}
                  onFilter={setRefFilter}
                  onNotify={notify}
                />

                <div className="aw-page">
                  {pane === "history" ? (
                    <div
                      className="aw-history"
                      style={{ "--graph-w": `${gWidth}px` } as CSSProperties}
                    >
                      <div className="aw-history-bar">
                        <div className="aw-search">
                          <Search size={13} />
                          <input
                            value={historyQuery}
                            onChange={(event) => setHistoryQuery(event.target.value)}
                            placeholder="搜索历史…"
                            aria-label="搜索提交历史"
                          />
                          {historyQuery && (
                            <button
                              type="button"
                              className="aw-input-clear"
                              aria-label="清空搜索"
                              onClick={() => setHistoryQuery("")}
                            >
                              <X size={11} />
                            </button>
                          )}
                        </div>
                        <select className="aw-select" aria-label="搜索范围" defaultValue="message">
                          <option value="message">信息</option>
                          <option value="author">作者</option>
                          <option value="path">路径</option>
                          <option value="content">内容</option>
                        </select>
                        <span className="aw-history-note">所有提交</span>
                      </div>

                      <div className="aw-history-head">
                        <span>消息</span>
                        <span>作者</span>
                        <span>哈希</span>
                        <span>日期</span>
                      </div>

                      <div className="aw-history-list" role="list">
                        {filteredCommits.length === 0 && (
                          <p className="aw-empty-line">没有匹配的提交</p>
                        )}
                        {filteredCommits.map((commit, index) => (
                          <HistoryRow
                            key={commit.hash}
                            commit={commit}
                            row={graph[index]}
                            width={gWidth}
                            active={commit.hash === commitHash}
                            onSelect={() => {
                              setCommitHash(commit.hash);
                              setDetailTab("details");
                            }}
                          />
                        ))}
                      </div>

                      {selected && (
                        <CommitDetails
                          commit={selected}
                          tab={detailTab}
                          onTab={setDetailTab}
                          onClose={() => setCommitHash(null)}
                          onCopy={() => copyText(selected.hash, "提交哈希")}
                        />
                      )}
                    </div>
                  ) : (
                    <ChangesPane
                      repo={repo}
                      worktree={worktree}
                      change={change}
                      onSelect={setFilePath}
                      onToggleStage={toggleStage}
                      onStageAll={setAllStaged}
                      filter={fileQuery}
                      onFilter={setFileQuery}
                      message={message}
                      onMessage={setMessage}
                      amend={amend}
                      onAmend={setAmend}
                      generating={generating}
                      onGenerate={generateMessage}
                      canCommit={canCommit}
                      menu={menu}
                      onMenu={setMenu}
                      onCommit={commit}
                      wrap={wrapLines}
                      onWrap={setWrapLines}
                      split={splitView}
                      onSplit={setSplitView}
                      onCopy={() => change && copyText(change.diff.map((line) => line.text).join("\n"), "差异内容")}
                      onNotify={notify}
                    />
                  )}
                </div>
              </div>
            </>
          ) : (
            <TerminalPane
              key={repo.id}
              repo={repo}
              worktree={worktree}
              onNotify={notify}
            />
          )}

          <footer className="aw-status">
            <span className="aw-status-path">{worktree.path}</span>
            <span className="aw-status-right">
              {mode === "terminal"
                ? "UTF-8 · PowerShell"
                : `${worktree.changes.length} 更改`}
            </span>
          </footer>
        </div>
      </div>

      {toast && (
        <div className="aw-toast" role="status" key={toast.id}>
          <Check size={13} />
          {toast.text}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Project sidebar                                                    */
/* ------------------------------------------------------------------ */

function ProjectSidebar({
  workspace,
  activeId,
  onPick,
}: {
  workspace: Repo[];
  activeId: string;
  onPick: (repo: Repo) => void;
}) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const input = useRef<HTMLInputElement>(null);
  const normalized = query.trim().toLowerCase();

  const toggle = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <aside className="aw-sidebar">
      <div className="aw-sidebar-top">
        <div className="aw-brand">
          <GitFork size={19} className="aw-brand-icon" />
          <span>MyGit</span>
        </div>
        <button
          type="button"
          className="aw-icon"
          aria-label="添加目录"
          title="添加目录"
          onClick={() => void 0}
        >
          <Plus size={15} />
        </button>
      </div>

      <div className="aw-project-search">
        <Search size={13} />
        <input
          ref={input}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索项目"
          aria-label="搜索项目"
        />
        <kbd>⌘K</kbd>
      </div>

      <div className="aw-project-groups">
        {groups.map((group) => {
          const items = workspace.filter(
            (repo) =>
              repo.group === group.id &&
              (!normalized || repo.name.toLowerCase().includes(normalized)),
          );
          if (normalized && items.length === 0) return null;
          const open = !collapsed.has(group.id);
          return (
            <section key={group.id} className="aw-group">
              <button
                type="button"
                className="aw-group-title"
                onClick={() => toggle(group.id)}
                aria-expanded={open}
              >
                <ChevronRight
                  size={11}
                  className={open ? "aw-chev" : ""}
                  aria-hidden="true"
                />
                <span>{group.label}</span>
                <span className="aw-count">
                  {workspace.filter((repo) => repo.group === group.id).length}
                </span>
              </button>
              {open && (
                <div className="aw-group-list">
                  {items.map((repo) => (
                    <button
                      key={repo.id}
                      type="button"
                      className={`aw-project ${repo.id === activeId ? "active" : ""}`}
                      onClick={() => onPick(repo)}
                    >
                      {repo.group === "pinned" && <Pin size={10} className="aw-pin" />}
                      {repo.icon === "github" ? (
                        <Github size={13} className="aw-project-icon" />
                      ) : (
                        <GitFork size={13} className="aw-project-icon" />
                      )}
                      <span className="aw-project-name">{repo.name}</span>
                      {repo.terminals.length > 1 && (
                        <span className="aw-project-count">
                          {repo.terminals.length - 1}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <div className="aw-sidebar-foot">
        <button
          type="button"
          className="aw-foot-button"
          onClick={() => input.current?.focus()}
        >
          <Search size={13} />
          搜索项目
        </button>
        <button
          type="button"
          className="aw-icon"
          title="刷新"
          aria-label="刷新"
        >
          <RefreshCw size={13} />
        </button>
        <button
          type="button"
          className="aw-icon"
          title="设置"
          aria-label="设置"
        >
          <Settings size={14} />
        </button>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/*  Refs sidebar                                                       */
/* ------------------------------------------------------------------ */

function RefsSidebar({
  repo,
  worktree,
  pane,
  onPane,
  onWorktree,
  onBranch,
  filter,
  onFilter,
  onNotify,
}: {
  repo: Repo;
  worktree: Worktree;
  pane: Pane;
  onPane: (pane: Pane) => void;
  onWorktree: (id: string) => void;
  onBranch: (branch: string) => void;
  filter: string;
  onFilter: (value: string) => void;
  onNotify: (text: string) => void;
}) {
  const query = filter.trim().toLowerCase();
  const match = (value: string) => !query || value.toLowerCase().includes(query);
  const branches = repo.branches.filter(match);
  const tags = repo.tags.filter(match);
  const stashes = repo.stashes.filter(match);

  return (
    <aside className="aw-refs">
      <div className="aw-refs-top">
        <button
          type="button"
          className={`aw-refs-link ${pane === "changes" ? "active" : ""}`}
          onClick={() => onPane("changes")}
        >
          <CircleDot size={13} />
          <span>当前更改</span>
          {repo.worktrees.some((item) => item.changes.length > 0) && (
            <span className="aw-ref-count">{worktree.changes.length}</span>
          )}
        </button>
        <button
          type="button"
          className={`aw-refs-link ${pane === "history" ? "active" : ""}`}
          onClick={() => onPane("history")}
        >
          <GitCommitHorizontal size={13} />
          <span>所有提交</span>
        </button>
      </div>

      <div className="aw-refs-section">
        <div className="aw-section-title">
          <FolderGit2 size={12} />
          <span>工作树</span>
          <button
            type="button"
            className="aw-micro"
            title="新建工作树"
            aria-label="新建工作树"
            onClick={() => onNotify("新建工作树对话框（演示）")}
          >
            <Plus size={11} />
          </button>
        </div>
        <div className="aw-worktrees">
          {repo.worktrees.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`aw-worktree ${item.id === worktree.id ? "active" : ""}`}
              onClick={() => onWorktree(item.id)}
              title={item.path}
            >
              <span className="aw-worktree-name">{item.name}</span>
              <span className="aw-worktree-branch">
                <GitBranch size={9} />
                {item.branch}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="aw-refs-filter">
        <input
          value={filter}
          onChange={(event) => onFilter(event.target.value)}
          placeholder="筛选引用…"
          aria-label="筛选引用"
        />
      </div>

      <div className="aw-refs-scroll">
        <RefSection title="本地分支" icon={<GitBranch size={12} />} count={repo.branches.length}>
          {branches.map((branch) => (
            <button
              key={branch}
              type="button"
              className="aw-ref-row"
              onClick={() => onBranch(branch)}
              title={branch}
            >
              <span className="aw-ref-name">{branch}</span>
              {branch === worktree.branch && (
                <CircleDot size={11} className="aw-current" />
              )}
            </button>
          ))}
          {branches.length === 0 && <p className="aw-empty-line">没有匹配的分支</p>}
        </RefSection>

        <RefSection title="远端分支" icon={<Globe size={12} />}>
          {repo.remotes.map((remote) => (
            <div key={remote.remote} className="aw-remote">
              <div className="aw-remote-name">{remote.remote}</div>
              {remote.branches
                .filter(match)
                .map((branch) => (
                  <button
                    key={branch}
                    type="button"
                    className="aw-ref-row aw-ref-nested"
                    onClick={() => onNotify(`已获取 ${remote.remote}/${branch}（演示）`)}
                  >
                    <span className="aw-ref-name">{branch}</span>
                  </button>
                ))}
            </div>
          ))}
        </RefSection>

        {repo.tags.length > 0 && (
          <RefSection title="标签" icon={<Tag size={12} />} count={repo.tags.length}>
            {tags.map((tag) => (
              <button key={tag} type="button" className="aw-ref-row">
                <span className="aw-ref-name">{tag}</span>
              </button>
            ))}
          </RefSection>
        )}

        {repo.stashes.length > 0 && (
          <RefSection title="暂存栈" icon={<Archive size={12} />} count={repo.stashes.length}>
            {stashes.map((stash) => (
              <button key={stash} type="button" className="aw-ref-row">
                <span className="aw-ref-name">{stash}</span>
              </button>
            ))}
          </RefSection>
        )}
      </div>
    </aside>
  );
}

function RefSection({
  title,
  icon,
  count,
  children,
}: {
  title: string;
  icon: ReactNode;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="aw-refs-section">
      <div className="aw-section-title">
        {icon}
        <span>{title}</span>
        {typeof count === "number" && <span className="aw-count">{count}</span>}
      </div>
      <div>{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  History                                                            */
/* ------------------------------------------------------------------ */

function refBadges(commit: Commit) {
  const badges: { label: string; kind: string }[] = [];
  for (const ref of commit.refs) {
    if (ref.startsWith("HEAD -> ")) {
      badges.push({ label: "HEAD", kind: "head" });
      badges.push({ label: ref.slice(8), kind: "branch" });
    } else if (ref.startsWith("tag: ")) {
      badges.push({ label: ref.slice(5), kind: "tag" });
    } else if (ref.includes("/")) {
      badges.push({ label: ref, kind: "remote" });
    } else {
      badges.push({ label: ref, kind: "branch" });
    }
  }
  return badges;
}

function HistoryRow({
  commit,
  row,
  width,
  active,
  onSelect,
}: {
  commit: Commit;
  row: ReturnType<typeof buildGraph>[number];
  width: number;
  active: boolean;
  onSelect: () => void;
}) {
  const badges = refBadges(commit);
  return (
    <button
      type="button"
      role="listitem"
      className={`aw-commit-row ${active ? "active" : ""}`}
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
    >
      <span className="aw-commit-graph">
        <GraphCell row={row} width={width} />
      </span>
      <span className="aw-commit-message">
        <span className="aw-ref-badges">
          {badges.slice(0, 3).map((badge, index) => (
            <span key={`${badge.label}-${index}`} className={`aw-ref aw-ref-${badge.kind}`}>
              {badge.kind === "tag" && <Tag size={8} />}
              {badge.kind === "remote" && <Globe size={8} />}
              {badge.label}
            </span>
          ))}
          {badges.length > 3 && <span className="aw-ref aw-ref-more">+{badges.length - 3}</span>}
        </span>
        <span className="aw-subject">{commit.subject}</span>
      </span>
      <span className="aw-author">
        <span className="aw-avatar">{commit.author.slice(0, 1).toUpperCase()}</span>
        {commit.author}
      </span>
      <span className="aw-hash">{commit.short}</span>
      <span className="aw-date">{commit.date}</span>
    </button>
  );
}

function CommitDetails({
  commit,
  tab,
  onTab,
  onClose,
  onCopy,
}: {
  commit: Commit;
  tab: "details" | "changes";
  onTab: (tab: "details" | "changes") => void;
  onClose: () => void;
  onCopy: () => void;
}) {
  return (
    <section className="aw-details" aria-label="提交详情">
      <div className="aw-details-bar">
        <div className="aw-details-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "details"}
            className={tab === "details" ? "active" : ""}
            onClick={() => onTab("details")}
          >
            详情
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "changes"}
            className={tab === "changes" ? "active" : ""}
            onClick={() => onTab("changes")}
          >
            变更
            {commit.files?.length ? <span>{commit.files.length}</span> : null}
          </button>
        </div>
        <div className="aw-details-meta">
          <code>{commit.short}</code>
          <button type="button" className="aw-icon" title="复制哈希" aria-label="复制哈希" onClick={onCopy}>
            <Copy size={12} />
          </button>
          <button type="button" className="aw-icon" title="关闭详情" aria-label="关闭详情" onClick={onClose}>
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="aw-details-body">
        {tab === "details" ? (
          <div className="aw-detail-grid">
            <h3>{commit.subject}</h3>
            <dl>
              <div>
                <dt>作者</dt>
                <dd>
                  <span className="aw-avatar">{commit.author.slice(0, 1).toUpperCase()}</span>
                  {commit.author} <span className="aw-dim">&lt;{commit.email}&gt;</span>
                </dd>
              </div>
              <div>
                <dt>日期</dt>
                <dd>{commit.fullDate}</dd>
              </div>
              <div>
                <dt>哈希</dt>
                <dd><code>{commit.hash}</code></dd>
              </div>
              <div>
                <dt>父提交</dt>
                <dd>
                  {commit.parents.length
                    ? commit.parents.map((parent) => <code key={parent}>{parent.slice(0, 7)}</code>)
                    : <span className="aw-dim">首个提交</span>}
                </dd>
              </div>
            </dl>
            {commit.body && (
              <div className="aw-detail-body">
                {commit.body.split("\n").map((line, index) => (
                  <p key={index}>{line || "\u00a0"}</p>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="aw-commit-files">
            {commit.files?.length ? (
              commit.files.map((file) => (
                <div key={file.path} className="aw-commit-file">
                  <FileIcon size={12} />
                  <span className="aw-commit-file-path">{file.path}</span>
                  <span className={`aw-status-letter ${file.status === "A" ? "add" : file.status === "D" ? "del" : ""}`}>
                    {file.status}
                  </span>
                  <span className="aw-stat-add">+{file.added}</span>
                  <span className="aw-stat-del">−{file.deleted}</span>
                </div>
              ))
            ) : (
              <p className="aw-empty-line">这条提交没有附带文件列表。</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Changes                                                            */
/* ------------------------------------------------------------------ */

function ChangesPane({
  repo,
  worktree,
  change,
  onSelect,
  onToggleStage,
  onStageAll,
  filter,
  onFilter,
  message,
  onMessage,
  amend,
  onAmend,
  generating,
  onGenerate,
  canCommit,
  menu,
  onMenu,
  onCommit,
  wrap,
  onWrap,
  split,
  onSplit,
  onCopy,
  onNotify,
}: {
  repo: Repo;
  worktree: Worktree;
  change: Change | null;
  onSelect: (path: string) => void;
  onToggleStage: (path: string) => void;
  onStageAll: (staged: boolean) => void;
  filter: string;
  onFilter: (value: string) => void;
  message: string;
  onMessage: (value: string) => void;
  amend: boolean;
  onAmend: (value: boolean) => void;
  generating: boolean;
  onGenerate: () => void;
  canCommit: boolean;
  menu: "commit" | null;
  onMenu: (menu: "commit" | null) => void;
  onCommit: (push?: boolean) => void;
  wrap: boolean;
  onWrap: (value: boolean) => void;
  split: boolean;
  onSplit: (value: boolean) => void;
  onCopy: () => void;
  onNotify: (text: string) => void;
}) {
  const query = filter.trim().toLowerCase();
  const match = (file: Change) => !query || file.path.toLowerCase().includes(query);
  const staged = worktree.changes.filter((file) => file.staged && match(file));
  const unstaged = worktree.changes.filter((file) => !file.staged && match(file));

  return (
    <div className="aw-changes">
      <aside className="aw-files">
        <div className="aw-search aw-files-search">
          <Search size={12} />
          <input
            value={filter}
            onChange={(event) => onFilter(event.target.value)}
            placeholder="筛选文件…"
            aria-label="筛选文件"
          />
          {filter && (
            <button type="button" className="aw-input-clear" aria-label="清空文件筛选" onClick={() => onFilter("")}>
              <X size={10} />
            </button>
          )}
        </div>

        <div className="aw-files-scroll">
          <FileGroup
            label="已暂存"
            files={staged}
            activePath={change?.path ?? null}
            onSelect={onSelect}
            onToggle={onToggleStage}
            action="unstage"
            onAll={() => onStageAll(false)}
          />
          <FileGroup
            label="未暂存"
            files={unstaged}
            activePath={change?.path ?? null}
            onSelect={onSelect}
            onToggle={onToggleStage}
            action="stage"
            onAll={() => onStageAll(true)}
          />
          {worktree.changes.length === 0 && (
            <div className="aw-files-empty">
              <Check size={16} />
              <p>工作区是干净的</p>
              <span>在 {worktree.branch} 上没有未提交的更改。</span>
            </div>
          )}
        </div>

        <div className="aw-commit-form">
          <div className="aw-commit-label">
            <label htmlFor="aw-commit-message">提交信息</label>
            {amend && <span className="aw-amend-note">将替换上一次提交</span>}
          </div>
          <div className="aw-textarea-wrap">
            <textarea
              id="aw-commit-message"
              value={message}
              onChange={(event) => onMessage(event.target.value)}
              placeholder="摘要和可选的详细描述"
              rows={4}
            />
            <button
              type="button"
              className="aw-ai"
              title="用 AI 生成提交信息（演示）"
              aria-label="用 AI 生成提交信息"
              disabled={generating || staged.length === 0}
              onClick={onGenerate}
            >
              <Sparkles size={12} className={generating ? "aw-pulse" : ""} />
            </button>
          </div>
          <label className="aw-check-label">
            <input
              type="checkbox"
              checked={amend}
              onChange={(event) => onAmend(event.target.checked)}
            />
            修改上次提交
          </label>
          <div className="aw-form-row">
            <div className="aw-commit-split">
              <button
                type="button"
                className="aw-primary"
                disabled={!canCommit}
                onClick={() => onCommit(false)}
              >
                <GitCommitHorizontal size={13} />
                提交
              </button>
              <button
                type="button"
                className="aw-primary aw-primary-caret"
                disabled={!canCommit}
                aria-label="更多提交选项"
                aria-expanded={menu === "commit"}
                onClick={() => onMenu(menu === "commit" ? null : "commit")}
              >
                <ChevronDown size={12} />
              </button>
              {menu === "commit" && (
                <div className="aw-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => onCommit(false)}>
                    提交
                  </button>
                  <button type="button" role="menuitem" onClick={() => onCommit(true)}>
                    提交并推送
                  </button>
                </div>
              )}
            </div>
            <span className="aw-staged-hint">
              {staged.length} / {worktree.changes.length} 已暂存
            </span>
          </div>
        </div>
      </aside>

      <section className="aw-diff">
        {change ? (
          <>
            <div className="aw-diff-bar">
              <span className="aw-diff-path" title={change.path}>{change.path}</span>
              <span className="aw-diff-stats">
                <span className="aw-stat-add">+{change.added}</span>
                <span className="aw-stat-del">−{change.deleted}</span>
              </span>
              <div className="aw-diff-tools">
                <div className="aw-seg aw-seg-tiny" role="group" aria-label="差异视图">
                  <button type="button" aria-pressed={!split} onClick={() => onSplit(false)}>
                    <Rows3 size={11} />合并
                  </button>
                  <button type="button" aria-pressed={split} onClick={() => onSplit(true)}>
                    <Columns2 size={11} />左右
                  </button>
                </div>
                <button
                  type="button"
                  className={`aw-icon ${wrap ? "active" : ""}`}
                  title="自动换行"
                  aria-label="自动换行"
                  aria-pressed={wrap}
                  onClick={() => onWrap(!wrap)}
                >
                  <WrapText size={13} />
                </button>
                <button
                  type="button"
                  className="aw-icon"
                  title="复制差异内容"
                  aria-label="复制差异内容"
                  onClick={onCopy}
                >
                  <Copy size={13} />
                </button>
              </div>
            </div>
            <div className={`aw-diff-body ${wrap ? "wrap" : ""}`}>
              {split ? (
                <SplitDiff lines={change.diff} />
              ) : (
                <UnifiedDiff lines={change.diff} />
              )}
            </div>
            <div className="aw-diff-foot">
              <span>
                {change.staged ? "这些更改已在索引中" : "这些更改还没有暂存"}
              </span>
              <div className="aw-diff-foot-actions">
                <button
                  type="button"
                  className="aw-small-button"
                  onClick={() => onToggleStage(change.path)}
                >
                  {change.staged ? "取消暂存" : "暂存文件"}
                </button>
                <button
                  type="button"
                  className="aw-small-button ghost"
                  onClick={() => onNotify("丢弃更改需要确认（演示）")}
                >
                  丢弃
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="aw-diff-empty">
            <FileIcon size={20} />
            <p>{worktree.changes.length ? "选择一个文件查看差异" : "没有未提交的更改"}</p>
            <span>
              {worktree.changes.length
                ? `${repo.name} · ${worktree.branch}`
                : "在左侧工作树中切换分支，或修改文件后再回来。"}
            </span>
          </div>
        )}
      </section>
    </div>
  );
}

function FileGroup({
  label,
  files,
  activePath,
  onSelect,
  onToggle,
  action,
  onAll,
}: {
  label: string;
  files: Change[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
  action: "stage" | "unstage";
  onAll: () => void;
}) {
  if (!files.length) return null;
  const added = files.reduce((sum, file) => sum + file.added, 0);
  const deleted = files.reduce((sum, file) => sum + file.deleted, 0);
  return (
    <section className="aw-file-group">
      <div className="aw-file-group-head">
        <span>{label}</span>
        <span className="aw-file-group-count">{files.length}</span>
        <span className="aw-file-group-stats">
          <span className="aw-stat-add">+{added}</span>
          <span className="aw-stat-del">−{deleted}</span>
        </span>
        <button
          type="button"
          className="aw-micro"
          title={action === "stage" ? "全部暂存" : "全部取消暂存"}
          aria-label={action === "stage" ? "全部暂存" : "全部取消暂存"}
          onClick={onAll}
        >
          {action === "stage" ? <Plus size={11} /> : <Minus size={11} />}
        </button>
      </div>
      {files.map((file) => (
        <div
          key={file.path}
          className={`aw-file ${activePath === file.path ? "active" : ""}`}
        >
          <button
            type="button"
            className={`aw-check ${file.staged ? "checked" : ""}`}
            role="checkbox"
            aria-checked={file.staged}
            aria-label={`${file.staged ? "取消暂存" : "暂存"} ${file.path}`}
            onClick={() => onToggle(file.path)}
          >
            {file.staged && <Check size={9} />}
          </button>
          <button
            type="button"
            className="aw-file-main"
            onClick={() => onSelect(file.path)}
            title={file.path}
          >
            <FileIcon size={12} className="aw-file-icon" />
            <span className="aw-file-name">{file.path.split("/").pop()}</span>
            <span className="aw-file-dir">
              {file.path.includes("/")
                ? file.path.slice(0, file.path.lastIndexOf("/"))
                : ""}
            </span>
          </button>
          <span
            className={`aw-status-letter ${
              file.status === "A" ? "add" : file.status === "D" ? "del" : ""
            }`}
          >
            {file.status}
          </span>
        </div>
      ))}
    </section>
  );
}

function UnifiedDiff({ lines }: { lines: DiffLine[] }) {
  return (
    <div className="aw-diff-lines">
      {lines.map((line, index) => (
        <div key={index} className={`aw-diff-line ${line.kind}`}>
          <span className="aw-ln">{line.old ?? ""}</span>
          <span className="aw-ln">{line.new ?? ""}</span>
          <span className="aw-sign">
            {line.kind === "add" ? "+" : line.kind === "delete" ? "−" : ""}
          </span>
          <code>{line.text || "\u00a0"}</code>
        </div>
      ))}
    </div>
  );
}

type SplitPair = {
  left?: DiffLine;
  right?: DiffLine;
};

function pairLines(lines: DiffLine[]): SplitPair[] {
  const pairs: SplitPair[] = [];
  for (let index = 0; index < lines.length; ) {
    if (lines[index].kind === "context") {
      pairs.push({ left: lines[index], right: lines[index] });
      index++;
      continue;
    }
    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    while (index < lines.length && lines[index].kind !== "context") {
      (lines[index].kind === "delete" ? removed : added).push(lines[index]);
      index++;
    }
    for (let row = 0; row < Math.max(removed.length, added.length); row++) {
      pairs.push({ left: removed[row], right: added[row] });
    }
  }
  return pairs;
}

function SplitDiff({ lines }: { lines: DiffLine[] }) {
  return (
    <div className="aw-split">
      {pairLines(lines).map((pair, index) => (
        <div className="aw-split-row" key={index}>
          <div className={`aw-split-cell ${pair.left?.kind ?? "empty"}`}>
            <span className="aw-ln">{pair.left?.old ?? ""}</span>
            <span className="aw-sign">
              {pair.left?.kind === "delete" ? "−" : ""}
            </span>
            <code>{pair.left?.text || "\u00a0"}</code>
          </div>
          <div className={`aw-split-cell ${pair.right?.kind ?? "empty"}`}>
            <span className="aw-ln">{pair.right?.new ?? ""}</span>
            <span className="aw-sign">
              {pair.right?.kind === "add" ? "+" : ""}
            </span>
            <code>{pair.right?.text || "\u00a0"}</code>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Terminal                                                           */
/* ------------------------------------------------------------------ */

function TerminalPane({
  repo,
  worktree,
  onNotify,
}: {
  repo: Repo;
  worktree: Worktree;
  onNotify: (text: string) => void;
}) {
  const [tabs, setTabs] = useState<TerminalTab[]>(repo.terminals);
  const [activeId, setActiveId] = useState(repo.terminals[0]?.id ?? "");
  const [counter, setCounter] = useState(1);
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  function runCommand(command: QuickCommand) {
    const existing = tabs.find((tab) => tab.id === `cmd-${command.id}`);
    if (existing) {
      setActiveId(existing.id);
      return;
    }
    const tab: TerminalTab = {
      id: `cmd-${command.id}`,
      label: command.command,
      kind: "command",
      lines: commandOutput(command, worktree.changes.length),
    };
    setTabs((current) => [...current, tab]);
    setActiveId(tab.id);
  }

  function addTerminal() {
    const id = `shell-${counter}`;
    setCounter((value) => value + 1);
    const next: TerminalTab = {
      id,
      label: `PowerShell ${counter + 1}`,
      kind: "shell",
      lines: [{ text: `PS ${worktree.path}> `, tone: "dim" }],
    };
    setTabs((current) => [...current, next]);
    setActiveId(id);
  }

  function closeTerminal(id: string) {
    if (tabs.length === 1) {
      onNotify("至少保留一个终端标签");
      return;
    }
    const next = tabs.filter((tab) => tab.id !== id);
    setTabs(next);
    if (activeId === id) setActiveId(next[0]?.id ?? "");
  }

  return (
    <div className="aw-terminal-page">
      <div className="aw-tabs">
        <div className="aw-tab-scroll" role="tablist" aria-label="终端">
          {tabs.map((tab) => (
            <div key={tab.id} className={`aw-tab ${tab.id === active?.id ? "active" : ""}`}>
              <button
                type="button"
                role="tab"
                aria-selected={tab.id === active?.id}
                className="aw-tab-main"
                onClick={() => setActiveId(tab.id)}
              >
                <SquareTerminal size={12} />
                <span>{tab.label}</span>
              </button>
              <button
                type="button"
                className="aw-tab-x"
                aria-label={`关闭 ${tab.label}`}
                onClick={() => closeTerminal(tab.id)}
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="aw-icon"
          title="新建终端"
          aria-label="新建终端"
          onClick={addTerminal}
        >
          <Plus size={14} />
        </button>
        <span className="aw-tabs-note">{worktree.branch}</span>
      </div>

      <div className="aw-term-body">
        <div className="aw-terminal" aria-label="终端输出">
          {active ? <TerminalLines lines={active.lines} /> : null}
          <span className="aw-cursor" aria-hidden="true" />
        </div>

        <aside className="aw-commands">
          <div className="aw-commands-head">
            <span>终端命令</span>
            <button
              type="button"
              className="aw-micro"
              aria-label="新建命令"
              title="新建命令"
              onClick={() => onNotify("新建命令对话框（演示）")}
            >
              <Plus size={11} />
            </button>
          </div>
          <div className="aw-commands-list">
            {repo.commands.map((command) => (
              <button
                key={command.id}
                type="button"
                className="aw-command"
                onClick={() => runCommand(command)}
                title={`在 ${command.path} 运行`}
              >
                <span className="aw-command-top">
                  <span className="aw-command-label">{command.label}</span>
                  <span className="aw-shell">{command.shell}</span>
                </span>
                <code>{command.command}</code>
                <span className="aw-command-path">{command.path}</span>
              </button>
            ))}
            {repo.commands.length === 0 && (
              <p className="aw-empty-line">还没有快捷命令，点击 + 添加。</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function commandOutput(
  command: QuickCommand,
  changeCount: number,
): TerminalSegment[] {
  const prompt: TerminalSegment[] = [
    { text: `PS ${command.path}> `, tone: "dim" },
    { text: command.command, tone: "bold" },
    { text: "" },
  ];
  const cmd = command.command.toLowerCase();
  let rest: TerminalSegment[];

  if (cmd.includes("npm run dev") || cmd === "task dev") {
    rest = [
      { text: "  VITE v8.2.4  ready in 284 ms", tone: "green" },
      { text: "" },
      { text: "  ➜  Local:   http://127.0.0.1:5174/", tone: "blue" },
      { text: "  ➜  press h + enter to show help", tone: "dim" },
    ];
  } else if (cmd.includes("build")) {
    rest = [
      { text: "vite v8.2.4 building for production...", tone: "dim" },
      { text: "✓ 142 modules transformed.", tone: "green" },
      { text: "dist/index.html                   1.24 kB", tone: "dim" },
      { text: "dist/assets/index-C8d2f1.js     192.41 kB │ gzip: 61.08 kB", tone: "dim" },
      { text: "✓ built in 1.42s", tone: "green" },
    ];
  } else if (cmd.includes("task check")) {
    rest = [
      { text: "task: [check] go vet ./...", tone: "dim" },
      { text: "task: [check] npm run check", tone: "dim" },
      { text: "task: [check] npm test", tone: "dim" },
      { text: "✓ go vet", tone: "green" },
      { text: "✓ tsc --noEmit", tone: "green" },
      { text: "✓ 42 tests passed", tone: "green" },
    ];
  } else if (cmd.includes("go test")) {
    rest = [
      { text: "ok   atlas/pkg/import   2.14s", tone: "green" },
      { text: "ok   atlas/pkg/index    4.02s", tone: "green" },
      { text: "ok   atlas/pkg/store    0.88s", tone: "green" },
    ];
  } else if (cmd.includes("git status")) {
    rest = [
      {
        text: changeCount
          ? `${changeCount} 个文件有未提交的更改`
          : "nothing to commit, working tree clean",
        tone: changeCount ? "orange" : "dim",
      },
    ];
  } else if (cmd.includes("npm test")) {
    rest = [
      { text: "✓ 42 color tests", tone: "green" },
      { text: "✓ 8 snapshot tests", tone: "green" },
    ];
  } else {
    rest = [{ text: `✓ ${command.command} 完成`, tone: "green" }];
  }

  return [...prompt, ...rest];
}

function TerminalLines({ lines }: { lines: TerminalSegment[] }) {
  const output: ReactNode[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const next = lines[index + 1];
    if (
      line.tone === "dim" &&
      line.text.startsWith("PS ") &&
      next?.tone === "bold"
    ) {
      output.push(
        <div className="aw-term-line" key={index}>
          <span className="aw-t-dim">{line.text}</span>
          <span className="aw-t-bold">{next.text}</span>
        </div>,
      );
      index++;
      continue;
    }
    if (!line.text) {
      output.push(<div className="aw-term-line" key={index}>&nbsp;</div>);
      continue;
    }
    output.push(
      <div className={`aw-term-line aw-t-${line.tone ?? "normal"}`} key={index}>
        {line.text}
      </div>,
    );
  }
  return <>{output}</>;
}
