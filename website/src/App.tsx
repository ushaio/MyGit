import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Columns2,
  Copy,
  FileCode2,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  Github,
  Globe,
  MousePointer2,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  TerminalSquare,
  WrapText,
} from "lucide-react";
import { AppDemo } from "./demo/AppDemo";
import { buildGraph, graphWidth, GraphCell } from "./demo/graph";
import { repos } from "./demo/data";
import "./site.css";

const REPO_URL = "https://github.com/ushaio/MyGit";
const RELEASES_URL = "https://github.com/ushaio/MyGit/releases";
const ISSUES_URL = "https://github.com/ushaio/MyGit/issues";
const CHANGELOG_URL = "https://github.com/ushaio/MyGit/blob/main/CHANGELOG.md";

const navItems = [
  { id: "demo", label: "界面演示" },
  { id: "workspace", label: "工作区" },
  { id: "history", label: "历史" },
  { id: "diff", label: "差异" },
  { id: "terminal", label: "终端" },
  { id: "ai", label: "AI 提交" },
  { id: "download", label: "下载" },
];

const demoRepo = repos[0];

function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      className="mark"
    >
      <rect width="32" height="32" rx="7" fill="currentColor" />
      <path
        d="M11 10.5v7.8a3.7 3.7 0 0 0 3.7 3.7H21"
        fill="none"
        stroke="#FCFCFD"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M21 10.5v7.2"
        fill="none"
        stroke="#FCFCFD"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="11" cy="8.6" r="2.7" fill="#5C8DFF" />
      <circle cx="21" cy="8.6" r="2.4" fill="#FCFCFD" />
      <circle cx="21" cy="19.4" r="2.4" fill="#FCFCFD" />
    </svg>
  );
}

function Marker({ hash, label }: { hash: string; label: string }) {
  return (
    <p className="marker">
      <span className="marker-dot" aria-hidden="true" />
      <span className="marker-hash">{hash}</span>
      <span className="marker-label">{label}</span>
      <span className="marker-rule" aria-hidden="true" />
    </p>
  );
}

function SiteHeader({ active }: { active: string }) {
  return (
    <header className="site-head">
      <div className="wrap site-head-in">
        <a className="brand" href="#top" aria-label="MyGit 首页">
          <Mark size={30} />
          <span className="brand-name">MyGit</span>
          <span className="brand-tag">桌面 Git 客户端</span>
        </a>

        <nav className="head-nav" aria-label="页面导航">
          {navItems.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className={active === item.id ? "is-active" : undefined}
              aria-current={active === item.id ? "true" : undefined}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="head-actions">
          <a
            className="head-gh"
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="在 GitHub 上查看 MyGit"
          >
            <Github size={18} />
          </a>
          <a
            className="btn btn-primary btn-sm"
            href={RELEASES_URL}
            target="_blank"
            rel="noreferrer"
          >
            <ArrowDownToLine size={15} />
            下载
          </a>
        </div>
      </div>
    </header>
  );
}

function Flow() {
  return (
    <figure className="flow" aria-label="多个仓库汇聚到一个 MyGit 窗口">
      <div className="flow-grid">
        <div className="flow-repos">
          <div className="repo-tile is-live">
            <span className="repo-name">
              <FolderGit2 size={12} />
              pulse
            </span>
            <span className="repo-meta">feat/landing · 3 更改</span>
          </div>
          <div className="repo-tile">
            <span className="repo-name">
              <FolderGit2 size={12} />
              atlas-cli
            </span>
            <span className="repo-meta">main · 干净</span>
          </div>
          <div className="repo-tile">
            <span className="repo-name">
              <FolderGit2 size={12} />
              kite
            </span>
            <span className="repo-meta">feat/telemetry</span>
          </div>
        </div>

        <svg
          className="flow-lines"
          viewBox="0 0 40 200"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d="M0 34 C22 34 18 100 40 100" />
          <path d="M0 100 H40" />
          <path d="M0 166 C22 166 18 100 40 100" />
          <circle cx="39" cy="100" r="2.6" />
        </svg>

        <div className="flow-window">
          <div className="fw-bar">
            <Mark size={12} />
            <span>MyGit</span>
            <em>1 个窗口</em>
          </div>
          <div className="fw-tabs">
            <span className="is-on">pulse-web</span>
            <span>atlas-cli</span>
            <span className="fw-plus">+</span>
          </div>
          <div className="fw-body">
            <div className="fw-row is-head">
              <span className="fw-node" aria-hidden="true" />
              <span className="fw-text">feat(web): add interactive landing demo</span>
            </div>
            <div className="fw-row">
              <span className="fw-node" aria-hidden="true" />
              <span className="fw-text">feat(web): worktree timeline section</span>
            </div>
            <div className="fw-row">
              <span className="fw-node" aria-hidden="true" />
              <span className="fw-text">fix(editor): align selection after soft wrap</span>
            </div>
            <div className="fw-row">
              <span className="fw-node" aria-hidden="true" />
              <span className="fw-text">feat(ai): model catalogue in settings</span>
            </div>
            <div className="fw-row is-faint">
              <span className="fw-node" aria-hidden="true" />
              <span className="fw-text">chore: initialize Tauri v2 shell</span>
            </div>
          </div>
          <div className="fw-foot">
            <span>feat/landing</span>
            <span>3 更改</span>
          </div>
        </div>
      </div>
      <figcaption>
        <span>一个进程</span>
        <span>一个窗口</span>
        <span>每个 worktree 独立标签</span>
      </figcaption>
    </figure>
  );
}

function HistorySpec() {
  const graph = useMemo(() => buildGraph(demoRepo.commits), []);
  const rows = demoRepo.commits.slice(0, 7);
  const gWidth = graphWidth(graph);

  return (
    <div className="panel spec">
      <div className="spec-bar">
        <GitCommitHorizontal size={14} />
        <span className="spec-title">历史</span>
        <span className="spec-search">
          <Search size={12} />
          搜索历史…
        </span>
        <span className="spec-chip">所有提交</span>
      </div>
      <div
        className="spec-history"
        style={{ "--graph-w": `${gWidth}px` } as CSSProperties}
      >
        {rows.map((commit, index) => (
          <div
            className={`h-row ${index === 0 ? "is-active" : ""}`}
            key={commit.hash}
          >
            <GraphCell row={graph[index]} width={gWidth} height={32} />
            <span className="h-subject">
              {index === 0 && !commit.refs.some((ref) => ref.startsWith("HEAD")) && (
                <span className="h-ref is-head">
                  <GitBranch size={9} />
                  HEAD
                </span>
              )}
              {commit.refs.slice(0, 2).map((ref) => {
                const head = ref.startsWith("HEAD");
                const label = ref.startsWith("HEAD -> ")
                  ? ref.slice(8)
                  : ref;
                return (
                  <span
                    className={`h-ref ${head ? "is-head" : ""}`}
                    key={ref}
                  >
                    {head && <GitBranch size={9} />}
                    {label}
                  </span>
                );
              })}
              <span className="h-text">{commit.subject}</span>
            </span>
            <span className="h-meta">
              <span>{commit.author}</span>
              <span>{commit.date}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="spec-foot">
        <span>14 条提交</span>
        <span>4 条分支</span>
        <span>v0.3.0</span>
      </div>
    </div>
  );
}

const blameLines = [
  {
    sha: "3f6a2b9",
    n: 118,
    code: "func (s *Store) Load() error {",
    who: "momo",
    when: "3 周前",
  },
  {
    sha: "2a9c6e4",
    n: 119,
    code: "\tdata, err := os.ReadFile(s.path)",
    who: "You",
    when: "昨天",
  },
  {
    sha: "2a9c6e4",
    n: 120,
    code: "\tif err != nil {",
    who: "You",
    when: "昨天",
  },
  {
    sha: "b84c0e7",
    n: 121,
    code: '\t\treturn fmt.Errorf("load workspace: %w", err)',
    who: "momo",
    when: "5 天前",
  },
  {
    sha: "3f6a2b9",
    n: 122,
    code: "\t}",
    who: "momo",
    when: "3 周前",
  },
  {
    sha: "9d0b7f3",
    n: 123,
    code: "\treturn json.Unmarshal(data, &s.state)",
    who: "You",
    when: "6 天前",
  },
];

function BlameSpec() {
  return (
    <div className="panel spec blame-panel">
      <div className="spec-bar">
        <FileCode2 size={14} />
        <span className="spec-title">逐行追溯</span>
        <span className="spec-chip">blame</span>
      </div>
      <div className="blame-code">
        {blameLines.map((line) => (
          <div className="blame-line" key={`${line.sha}-${line.n}`}>
            <span className="blame-sha">{line.sha}</span>
            <span className="blame-num">{line.n}</span>
            <code>{line.code}</code>
            <span className="blame-who">
              {line.who}
              <small>{line.when}</small>
            </span>
          </div>
        ))}
      </div>
      <div className="spec-foot">
        <span>internal/workspace/store.go</span>
        <span>按行定位作者与提交</span>
      </div>
    </div>
  );
}

function DiffSpec() {
  const change = demoRepo.worktrees.find((w) => w.id === "pulse-web")!
    .changes[0];
  const lines = change.diff.slice(0, 20);
  const [selected, setSelected] = useState<number[]>([]);
  const [staged, setStaged] = useState(false);

  const toggle = (index: number) => {
    setStaged(false);
    setSelected((current) =>
      current.includes(index)
        ? current.filter((item) => item !== index)
        : [...current, index],
    );
  };

  return (
    <div className="panel diff-spec">
      <div className="diff-spec-bar">
        <span className="diff-path">{change.path}</span>
        <span className="diff-stats">
          <span>+{change.added}</span>
          <span>−{change.deleted}</span>
        </span>
        <span className="diff-views">
          <span className="is-on">
            <Columns2 size={11} />
            统一
          </span>
          <span>并排</span>
        </span>
      </div>

      <div className="diff-spec-lines">
        {lines.map((line, index) => (
          <button
            type="button"
            key={`${line.old ?? "x"}-${line.new ?? "y"}-${index}`}
            className={`dline ${line.kind} ${
              selected.includes(index) ? "is-selected" : ""
            }`}
            onClick={() => toggle(index)}
            aria-pressed={selected.includes(index)}
            aria-label={`选择第 ${index + 1} 行`}
          >
            <span className="dn">{line.old ?? ""}</span>
            <span className="dn">{line.new ?? ""}</span>
            <span className="dsign">
              {line.kind === "add" ? "+" : line.kind === "delete" ? "−" : " "}
            </span>
            <code>{line.text || " "}</code>
          </button>
        ))}
      </div>

      <div className="diff-spec-foot">
        <MousePointer2 size={12} />
        {selected.length === 0 ? (
          <span>点击行选择，再暂存这几行</span>
        ) : staged ? (
          <span className="diff-ok">
            <Check size={12} />
            已暂存 {selected.length} 行（仅演示）
          </span>
        ) : (
          <span>已选 {selected.length} 行</span>
        )}
        <span className="diff-foot-actions">
          <span className="diff-count">
            {selected.length} / {lines.length}
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-xs"
            disabled={selected.length === 0 || staged}
            onClick={() => setStaged(true)}
          >
            暂存选中
          </button>
        </span>
      </div>
    </div>
  );
}

const worktreeFeatures = [
  {
    icon: FolderGit2,
    title: "一份对象库",
    body: "所有 worktree 共享同一个 .git，不必为每个分支重复 clone 一份仓库。",
    meta: "shared .git",
  },
  {
    icon: GitBranch,
    title: "一条独立轨道",
    body: "每个 worktree 有自己的分支、索引与工作区文件，改动互不踩脚。",
    meta: "own index",
  },
  {
    icon: SquareTerminal,
    title: "一个窗口",
    body: "标签一换，历史、diff 与终端都跟着当前 worktree 走，不用重开窗口。",
    meta: "one window",
  },
];

const operations = [
  {
    group: "提交",
    items: [
      ["stage / unstage", "暂存或取消"],
      ["commit", "提交已暂存内容"],
      ["amend", "修改上次提交"],
      ["stage selected lines", "逐行暂存"],
    ],
  },
  {
    group: "同步",
    items: [
      ["fetch", "获取远端"],
      ["pull", "拉取并整合"],
      ["push", "推送提交"],
      ["push tag", "推送标签"],
    ],
  },
  {
    group: "分支与整合",
    items: [
      ["merge", "合并分支"],
      ["rebase", "变基"],
      ["cherry-pick", "挑选提交"],
      ["revert", "撤销提交"],
    ],
  },
  {
    group: "整理",
    items: [
      ["stash / pop", "贮藏与恢复"],
      ["tag", "创建标签"],
      ["worktree add", "新建工作树"],
      ["conflict continue / abort", "冲突继续或中止"],
    ],
  },
];

const quickCommands = [
  {
    label: "前端检查",
    shell: "pwsh",
    command: "npm run check",
    path: "~/Projects/pulse-web",
  },
  {
    label: "Go 测试",
    shell: "pwsh",
    command: "go test ./...",
    path: "~/Projects/atlas-cli",
  },
  {
    label: "开发服务器",
    shell: "pwsh",
    command: "task dev",
    path: "~/Projects/pulse-web",
  },
];

const faqs = [
  {
    q: "需要单独安装 Git 吗？",
    a: "需要。MyGit 调用本机的 git CLI，所有仓库操作都是真实的 Git 命令；没有 Git 时界面会直接报错，而不是假装成功。",
  },
  {
    q: "工作区数据存在哪里？",
    a: "默认在 %USERPROFILE%\\.mygit-wails3，可以用 MYGIT_WAILS3_DATA_DIR 覆盖。workspace.json 保存根目录、当前选择、草稿与偏好。",
  },
  {
    q: "AI 提交信息会把代码发到哪里？",
    a: "只把你配置的 OpenAI 兼容端点需要的已暂存 diff 发出去。不配置端点就不会启用，生成结果也留在可编辑的输入框里。",
  },
  {
    q: "支持哪些平台？",
    a: "Windows、macOS 与 Linux。安装包、校验信息与系统要求以 GitHub Releases 为准；也可以从源码构建。",
  },
  {
    q: "会取代命令行吗？",
    a: "不会。终端是 PTY 里的真实 shell，快捷命令只是把它常用的一行存下来。破坏性操作会先确认，终端里的命令由你自己负责。",
  },
];

function WorktreePanel() {
  return (
    <div className="panel wt-panel">
      <div className="wt-head">
        <span>
          <GitBranch size={13} />
          pulse / .git
        </span>
        <span>共享对象库 · 3 个工作树</span>
      </div>
      {demoRepo.worktrees.map((worktree, index) => (
        <div
          className={`wt-row ${index === 1 ? "is-active" : ""}`}
          key={worktree.id}
        >
          <span className="wt-name">
            <code>{worktree.name}</code>
            {index === 1 && <span className="wt-badge">当前标签</span>}
          </span>
          <span className="wt-branch">
            <GitBranch size={11} />
            {worktree.branch}
          </span>
          <span className="wt-path">{worktree.path}</span>
          <span className="wt-changes">
            {worktree.changes.length > 0
              ? `${worktree.changes.length} 个更改`
              : "干净"}
          </span>
        </div>
      ))}
    </div>
  );
}

function TerminalBlock() {
  return (
    <div className="term">
      <div className="term-bar">
        <span className="term-tab is-on">
          <SquareTerminal size={12} />
          pwsh
        </span>
        <span className="term-tab">dev</span>
        <span className="term-tab">git</span>
        <span className="term-plus">+</span>
        <span className="term-meta">PowerShell 7 · PTY</span>
      </div>
      <div className="term-body">
        <p className="t-dim">~/Projects/pulse-web&nbsp;&nbsp;feat/landing</p>
        <p>
          <span className="t-green">$</span> npm run check
        </p>
        <p className="t-dim">&gt; tsc --noEmit &amp;&amp; vite build</p>
        <p className="t-green">✓ built in 3.42s</p>
        <p>&nbsp;</p>
        <p>
          <span className="t-green">$</span> git status -sb
        </p>
        <p className="t-dim">## feat/landing...origin/feat/landing</p>
        <p>
          <span className="t-warm"> M</span> web/src/pages/Landing.tsx
        </p>
        <p>
          <span className="t-green">A</span> web/src/components/DemoClip.tsx
        </p>
        <p>&nbsp;</p>
        <p>
          <span className="t-green">$</span>
          <span className="term-cursor" aria-hidden="true" />
        </p>
      </div>
    </div>
  );
}

function AiCard() {
  return (
    <div className="panel ai-card">
      <div className="ai-card-bar">
        <span className="ai-title">
          <Sparkles size={14} />
          提交信息
        </span>
        <span className="ai-mode">
          <span className="ai-dot" aria-hidden="true" />
          OpenAI 兼容
        </span>
      </div>
      <div className="ai-card-body">
        <span className="ai-label">消息</span>
        <div className="ai-message">
          <strong>feat(web): 落地页加入可交互演示</strong>
          <p>首屏直接复用应用界面，切换项目与 worktree</p>
          <p>暂存单个文件后生成提交信息</p>
          <span className="ai-cursor" aria-hidden="true" />
        </div>
        <div className="ai-meta">
          <span>
            模型 <code>gpt-4.1-mini</code>
          </span>
          <span>
            端点 <code>https://api.example.com/v1</code>
          </span>
          <span className="ai-ok">已连接</span>
        </div>
        <div className="ai-actions">
          <span className="ai-privacy">
            <ShieldCheck size={13} />
            只读取已暂存的文件
          </span>
          <span className="btn btn-secondary btn-xs">
            <Sparkles size={12} />
            重新生成
          </span>
        </div>
      </div>
      <div className="ai-card-foot">
        <span>修改上次提交</span>
        <span className="ai-switch" aria-hidden="true">
          <i />
        </span>
        <span className="ai-foot-hint">生成后可继续改写</span>
      </div>
    </div>
  );
}

function Site() {
  const [active, setActive] = useState("demo");

  useEffect(() => {
    const sections = navItems
      .map((item) => document.getElementById(item.id))
      .filter((node): node is HTMLElement => Boolean(node));

    let frame = 0;

    const resolve = () => {
      frame = 0;
      const line = window.scrollY + 140;
      let current = navItems[0].id;

      for (const section of sections) {
        const top = section.getBoundingClientRect().top + window.scrollY;
        if (top <= line) current = section.id;
      }

      if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 8) {
        current = navItems[navItems.length - 1].id;
      }

      setActive(current);
    };

    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(resolve);
    };

    resolve();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <>
      <a className="skip-link" href="#main">
        跳到正文
      </a>
      <SiteHeader active={active} />

      <main id="main">
        <section className="hero" id="top">
          <div className="wrap hero-grid">
            <div className="hero-copy">
              <p className="kicker">
                <span className="kicker-dot" aria-hidden="true" />
                桌面 Git 客户端 · Wails v3
              </p>
              <h1>
                多仓库，多工作树，
                <br />
                <span className="h1-accent">一个窗口。</span>
              </h1>
              <p className="lede">
                MyGit 把磁盘上的多个仓库收进一个工作区，每个 worktree
                一条独立标签。历史、逐行差异、终端和提交，都在同一个窗口里完成。
              </p>
              <div className="actions">
                <a
                  className="btn btn-primary"
                  href={RELEASES_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ArrowDownToLine size={16} />
                  下载 MyGit
                </a>
                <a
                  className="btn btn-secondary"
                  href={REPO_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  查看源码
                  <ArrowUpRight size={15} />
                </a>
              </div>
              <p className="hero-note">
                安装包与版本说明在 GitHub Releases。看完首屏，可以直接点下面的界面。
              </p>
            </div>

            <Flow />
          </div>

          <div className="wrap">
            <dl className="facts-strip">
              <div>
                <dt>最新版本</dt>
                <dd>0.2.0</dd>
              </div>
              <div>
                <dt>平台</dt>
                <dd>Windows · macOS · Linux</dd>
              </div>
              <div>
                <dt>许可</dt>
                <dd>MIT</dd>
              </div>
              <div>
                <dt>技术栈</dt>
                <dd>Go · React 19 · Wails v3</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="band demo-band" id="demo">
          <div className="wrap">
            <div className="shead demo-shead">
              <div>
                <Marker hash="a1e9f20" label="feat(web): interactive landing demo" />
                <h2>不用装，先点两下。</h2>
              </div>
              <div className="shead-side">
                <p>
                  这是应用界面的可交互复刻。切换项目、暂存一个文件、生成一条提交信息，或者打开终端跑一条快捷命令。数据只存在这个页面里，不会写入任何仓库。
                </p>
                <p className="demo-tip">
                  试试「pulse-sync」标签，或者勾选未暂存的 tokens.css。
                </p>
              </div>
            </div>
            <AppDemo />
          </div>
        </section>

        <section className="band band-muted" id="workspace">
          <div className="wrap">
            <div className="shead">
              <div>
                <Marker hash="e2a44c1" label="feat(editor): soft wrap" />
                <h2>
                  每个工作树，
                  <br />
                  自己一条轨道。
                </h2>
              </div>
              <div className="shead-side">
                <p>
                  同一个仓库可以同时检出多个分支。MyGit 把每个 worktree
                  当成一条独立轨道：分支、索引、文件、终端各自归位，但共享同一份 Git
                  对象库。
                </p>
                <a className="text-link" href="#demo">
                  在演示里切换工作树
                  <ArrowRight size={14} />
                </a>
              </div>
            </div>

            <div className="feature-grid">
              {worktreeFeatures.map((feature) => {
                const Icon = feature.icon;
                return (
                  <article className="feature-card" key={feature.title}>
                    <span className="feature-icon">
                      <Icon size={18} />
                    </span>
                    <h3>{feature.title}</h3>
                    <p>{feature.body}</p>
                    <span className="feature-meta">{feature.meta}</span>
                  </article>
                );
              })}
            </div>

            <WorktreePanel />
          </div>
        </section>

        <section className="band" id="history">
          <div className="wrap split is-history">
            <div className="split-copy">
              <Marker hash="9d0b7f3" label="refactor(store)" />
              <h2>
                历史不是表格，
                <br />
                是线路图。
              </h2>
              <p className="lede">
                提交图按父子关系分列绘制，合并、分叉、标签和远端引用都落在同一行里。搜索能按信息、作者、路径或内容过滤；选中提交，详情与改动就在下方展开。
              </p>
              <ul className="rule-list">
                <li>
                  <h3>分叉</h3>
                  <p>每条颜色对应一条泳道，合并提交有两个父提交。</p>
                </li>
                <li>
                  <h3>引用</h3>
                  <p>本地分支、远端分支、HEAD 与标签直接贴在提交行上。</p>
                </li>
                <li>
                  <h3>追溯</h3>
                  <p>打开文件的逐行 blame，作者、提交与时间一列排开。</p>
                </li>
              </ul>
            </div>
            <div className="split-figure">
              <HistorySpec />
            </div>
          </div>
        </section>

        <section className="band band-muted" id="diff">
          <div className="wrap">
            <div className="shead">
              <div>
                <Marker hash="3f6a2b9" label="feat(diff)" />
                <h2>
                  读到哪一行，
                  <br />
                  就改到哪一行。
                </h2>
              </div>
              <div className="shead-side">
                <p>
                  统一或并排视图、自动换行、逐行暂存与丢弃。Diff
                  不是只读的截图——你可以把某几行送进暂存区，再只提交它们。
                </p>
                <p className="tag-row">
                  <span>
                    <Columns2 size={12} />
                    统一 / 并排
                  </span>
                  <span>
                    <WrapText size={12} />
                    自动换行
                  </span>
                  <span>
                    <Copy size={12} />
                    复制 / 补丁
                  </span>
                </p>
              </div>
            </div>

            <div className="split split-tight">
              <div className="split-figure">
                <DiffSpec />
              </div>
              <div className="split-copy">
                <h3 className="subhead">行级操作</h3>
                <ul className="rule-list is-compact">
                  <li>
                    <h3>只带走需要的行</h3>
                    <p>选中之后暂存或丢弃，不必把整个文件一起提交。</p>
                  </li>
                  <li>
                    <h3>看得清</h3>
                    <p>行号、增删统计、路径与换行开关都在工具栏上。</p>
                  </li>
                  <li>
                    <h3>带得走</h3>
                    <p>复制文本，或者把改动保存成补丁。</p>
                  </li>
                </ul>
                <BlameSpec />
              </div>
            </div>
          </div>
        </section>

        <section className="band band-dark" id="terminal">
          <div className="wrap">
            <div className="shead">
              <div>
                <Marker hash="b84c0e7" label="feat(terminal)" />
                <h2>
                  命令在项目里，
                  <br />
                  不在记忆里。
                </h2>
              </div>
              <div className="shead-side">
                <p>
                  每个项目都能保存自己的快捷命令：一条命令、一个 Shell、一个工作目录。终端基于
                  PTY，多标签并行；点一下命令卡，就在当前 worktree 里跑起来。
                </p>
              </div>
            </div>

            <div className="term-grid">
              <TerminalBlock />
              <aside className="commands">
                <div className="commands-head">
                  <span>终端命令</span>
                  <Plus size={13} />
                </div>
                {quickCommands.map((command) => (
                  <div className="command" key={command.label}>
                    <div className="command-top">
                      <span>{command.label}</span>
                      <span className="command-shell">{command.shell}</span>
                    </div>
                    <code>{command.command}</code>
                    <span className="command-path">{command.path}</span>
                  </div>
                ))}
              </aside>
            </div>

            <div className="dark-facts">
              <div>
                <h3>多标签 PTY</h3>
                <p>开几条终端都行，标签跟着项目走。</p>
              </div>
              <div>
                <h3>按项目保存</h3>
                <p>命令、Shell 与工作目录写进工作区，下次直接点。</p>
              </div>
              <div>
                <h3>目录自由</h3>
                <p>同一条命令可以换一个目录运行，不绑定仓库根。</p>
              </div>
            </div>
          </div>
        </section>

        <section className="band" id="ai">
          <div className="wrap split">
            <div className="split-copy">
              <Marker hash="6a1d5c2" label="feat(ai)" />
              <h2>
                提交信息，
                <br />
                先让模型读 diff。
              </h2>
              <p className="lede">
                把已暂存的改动交给任意 OpenAI 兼容端点，生成一条符合仓库语气的提交信息。模型列表从端点拉取，提示词可以按团队习惯改写。
              </p>
              <ul className="rule-list">
                <li>
                  <h3>端点自己填</h3>
                  <p>兼容 OpenAI 的接口即可，模型列表从端点读取。</p>
                </li>
                <li>
                  <h3>提示词自己写</h3>
                  <p>把团队的语气、语言与格式要求写进 prompt。</p>
                </li>
                <li>
                  <h3>内容自己改</h3>
                  <p>生成只是起点，光标永远留在可编辑的输入框里。</p>
                </li>
              </ul>
              <p className="privacy">
                <ShieldCheck size={14} />
                只发送已暂存的 diff，不读取未跟踪文件。
              </p>
            </div>
            <div className="split-figure">
              <AiCard />
            </div>
          </div>
        </section>

        <section className="band band-muted ops" id="ops">
          <div className="wrap">
            <div className="shead">
              <div>
                <Marker hash="2a9c6e4" label="feat(git): 破坏性操作统一确认" />
                <h2>该有的 Git 操作，都在。</h2>
              </div>
              <div className="shead-side">
                <p>
                  日常操作不必退回命令行；破坏性操作会先停下来问一句。标记
                  <span className="op-mark">*</span>
                  的操作需要确认。
                </p>
              </div>
            </div>

            <div className="ops-grid">
              {operations.map((column) => (
                <div className="ops-col" key={column.group}>
                  <h3>{column.group}</h3>
                  {column.items.map(([command, label]) => {
                    const risky =
                      command.includes("revert") ||
                      command.includes("rebase") ||
                      command.includes("conflict") ||
                      command.includes("cherry");
                    return (
                      <div
                        className={`op ${risky ? "is-risky" : ""}`}
                        key={command}
                      >
                        <code>{command}</code>
                        <span>{label}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <p className="ops-note">
              <span className="op-mark">*</span>
              合并、变基、挑选、撤销与冲突处理都会在真正执行前弹确认；终端里的命令由你自己负责。
            </p>

            <div className="faq">
              <h3 className="subhead">安装之前，先回答几个问题。</h3>
              {faqs.map((item) => (
                <details key={item.q}>
                  <summary>
                    <span>{item.q}</span>
                    <span className="faq-plus" aria-hidden="true">
                      +
                    </span>
                  </summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="download" id="download">
          <div className="wrap">
            <div className="download-grid">
              <div className="download-copy">
                <Marker hash="v0.2.0" label="2026-11-06 · MIT" />
                <h2>
                  把它放进
                  <br />
                  你的工作区。
                </h2>
                <p>
                  下载对应平台的安装包，添加一个工作区根目录，MyGit
                  会把下面的仓库和 worktree 扫出来。需要本机已安装 Git；AI
                  提交信息是可选项。
                </p>
                <div className="actions">
                  <a
                    className="btn btn-invert"
                    href={RELEASES_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ArrowDownToLine size={16} />
                    前往 Releases
                  </a>
                  <a
                    className="btn btn-ghost"
                    href={REPO_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    阅读 README
                    <ArrowUpRight size={15} />
                  </a>
                </div>
                <p className="download-note">
                  安装包、校验信息与系统要求以 Releases 页面为准。
                </p>
              </div>

              <div className="download-side">
                <div className="platform-list">
                  {[
                    ["Windows", "NSIS / MSIX 构建"],
                    ["macOS", "DMG 安装包"],
                    ["Linux", "AppImage / deb"],
                  ].map(([os, note]) => (
                    <a
                      className="platform"
                      href={RELEASES_URL}
                      target="_blank"
                      rel="noreferrer"
                      key={os}
                    >
                      <span className="platform-os">{os}</span>
                      <span className="platform-note">{note}</span>
                      <span className="platform-go">
                        安装包
                        <ChevronRight size={13} />
                      </span>
                    </a>
                  ))}
                </div>

                <p className="side-foot">
                  <Globe size={13} />
                  系统托盘、单实例与应用内更新
                </p>
              </div>
            </div>

            <ol className="steps">
              <li>
                <span className="step-num">01</span>
                <strong>下载安装包</strong>
                <p>在 Releases 里选当前平台的最新版本。</p>
              </li>
              <li>
                <span className="step-num">02</span>
                <strong>添加工作区根目录</strong>
                <p>指向一个放着多个仓库的文件夹，或直接选单个仓库。</p>
              </li>
              <li>
                <span className="step-num">03</span>
                <strong>从 worktree 开始</strong>
                <p>选一个仓库，切到已有 worktree 或新建一条。</p>
              </li>
            </ol>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap footer-inner">
          <div className="footer-brand">
            <Mark size={24} />
            <div>
              <strong>MyGit</strong>
              <span>以工作树为中心</span>
            </div>
          </div>
          <nav className="footer-links" aria-label="页脚链接">
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              GitHub
            </a>
            <a href={RELEASES_URL} target="_blank" rel="noreferrer">
              下载
            </a>
            <a href={ISSUES_URL} target="_blank" rel="noreferrer">
              反馈
            </a>
            <a href={CHANGELOG_URL} target="_blank" rel="noreferrer">
              更新日志
            </a>
          </nav>
          <p className="footer-meta">
            Go · React 19 · Wails v3
            <span>© 2026 MyGit · MIT</span>
          </p>
        </div>
      </footer>
    </>
  );
}

export default function App() {
  return <Site />;
}
