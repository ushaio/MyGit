export type DiffLine = {
  kind: "context" | "add" | "delete";
  old?: number;
  new?: number;
  text: string;
};

export type Change = {
  path: string;
  status: "M" | "A" | "D";
  staged: boolean;
  added: number;
  deleted: number;
  diff: DiffLine[];
};

export type Worktree = {
  id: string;
  name: string;
  branch: string;
  path: string;
  changes: Change[];
};

export type CommitFile = {
  path: string;
  status: "M" | "A" | "D";
  added: number;
  deleted: number;
};

export type Commit = {
  hash: string;
  short: string;
  subject: string;
  body?: string;
  author: string;
  email: string;
  date: string;
  fullDate: string;
  parents: string[];
  refs: string[];
  files?: CommitFile[];
};

export type QuickCommand = {
  id: string;
  label: string;
  shell: string;
  command: string;
  path: string;
};

export type TerminalSegment = {
  text: string;
  tone?: "dim" | "green" | "blue" | "orange" | "red" | "bold";
};

export type TerminalTab = {
  id: string;
  label: string;
  kind: "shell" | "command";
  lines: TerminalSegment[];
};

export type Repo = {
  id: string;
  name: string;
  icon: "git" | "github";
  group: "pinned" | "repos" | "github";
  worktrees: Worktree[];
  commits: Commit[];
  branches: string[];
  remotes: { remote: string; branches: string[] }[];
  tags: string[];
  stashes: string[];
  commands: QuickCommand[];
  terminals: TerminalTab[];
};

/** Build diff lines from a marker-prefixed block: " " context, "+" add, "-" delete. */
function d(startOld: number, startNew: number, block: string): DiffLine[] {
  let old = startOld;
  let next = startNew;
  return block
    .replace(/^\n/, "")
    .replace(/\n$/, "")
    .split("\n")
    .map((raw) => {
      const marker = raw[0];
      const text = raw.slice(1);
      const kind: DiffLine["kind"] =
        marker === "+" ? "add" : marker === "-" ? "delete" : "context";
      const line: DiffLine = { kind, text };
      if (kind !== "add") line.old = old++;
      if (kind !== "delete") line.new = next++;
      return line;
    });
}

/* ------------------------------------------------------------------ */
/*  pulse — habit & focus tracker                                      */
/* ------------------------------------------------------------------ */

const pulseLandingDiff = d(
  1,
  1,
  `
-import { Hero } from "./Hero";
+import { DemoClip } from "../components/DemoClip";
+import { WorktreeTimeline } from "../components/WorktreeTimeline";
 
 export function Landing() {
   return (
     <main className="landing">
-      <Hero />
+      <section className="hero">
+        <h1>Focus on what moves you.</h1>
+        <p>Habits, sessions and streaks in one quiet window.</p>
+        <DemoClip />
+      </section>
+      <WorktreeTimeline />
     </main>
   );
 }`,
);

const demoClipDiff = d(
  1,
  1,
  `
+import { useEffect, useRef, useState } from "react";
+
+export function DemoClip() {
+  const [playing, setPlaying] = useState(false);
+  const [step, setStep] = useState(0);
+  const timer = useRef<number | null>(null);
+
+  useEffect(() => {
+    if (!playing) return;
+    timer.current = window.setInterval(() => {
+      setStep((value) => (value + 1) % 4);
+    }, 1200);
+    return () => window.clearInterval(timer.current ?? undefined);
+  }, [playing]);
+
+  return (
+    <figure className="demo-clip" data-playing={playing} data-step={step}>
+      <button type="button" onClick={() => setPlaying((value) => !value)}>
+        {playing ? "Pause" : "Play"}
+      </button>
+      <figcaption>45 seconds, no audio.</figcaption>
+    </figure>
+  );
+}`,
);

const tokensDiff = d(
  12,
  12,
  `
 :root {
-  --bg: #f7f5f0;
-  --ink: #1d1c1a;
-  --accent: #e4572e;
+  --bg: #fbfaf7;
+  --ink: #171614;
+  --accent: #c2410c;
+  --accent-soft: #ffedd5;
+  --ring: rgb(194 65 12 / 0.35);
 }
 
 .button {
-  background: var(--accent);
+  background: var(--accent);
+  box-shadow: 0 0 0 3px transparent;
+  transition: box-shadow 160ms ease;
+}
+
+.button:focus-visible {
+  box-shadow: 0 0 0 3px var(--ring);
 }`,
);

const pulse: Repo = {
  id: "pulse",
  name: "pulse",
  icon: "git",
  group: "pinned",
  worktrees: [
    {
      id: "pulse-main",
      name: "pulse",
      branch: "main",
      path: "~/Projects/pulse",
      changes: [],
    },
    {
      id: "pulse-web",
      name: "pulse-web",
      branch: "feat/landing",
      path: "~/Projects/pulse-web",
      changes: [
        {
          path: "web/src/pages/Landing.tsx",
          status: "M",
          staged: true,
          added: 46,
          deleted: 8,
          diff: pulseLandingDiff,
        },
        {
          path: "web/src/components/DemoClip.tsx",
          status: "A",
          staged: true,
          added: 128,
          deleted: 0,
          diff: demoClipDiff,
        },
        {
          path: "web/src/styles/tokens.css",
          status: "M",
          staged: false,
          added: 24,
          deleted: 6,
          diff: tokensDiff,
        },
      ],
    },
    {
      id: "pulse-sync",
      name: "pulse-sync",
      branch: "fix/sync-queue",
      path: "~/Projects/pulse-sync",
      changes: [],
    },
  ],
  commits: [
    {
      hash: "a1e9f20c4d7b3a91e5f6082b",
      short: "a1e9f20",
      subject: "feat(web): add interactive landing demo",
      body: "把落地页的静态截图换成可操作的 45 秒循环演示。\n\n只在浏览器里播放，不请求任何后端。",
      author: "Rin",
      email: "rin@pulse.app",
      date: "2026-11-06 16:42",
      fullDate: "2026-11-06 16:42:11 +0800",
      parents: ["5c7b1d8e2a4f6079c3b8d1"],
      refs: ["HEAD -> feat/landing", "origin/feat/landing"],
      files: [
        { path: "web/src/components/DemoClip.tsx", status: "A", added: 128, deleted: 0 },
        { path: "web/src/pages/Landing.tsx", status: "M", added: 46, deleted: 8 },
      ],
    },
    {
      hash: "5c7b1d8e2a4f6079c3b8d1",
      short: "5c7b1d8",
      subject: "feat(web): worktree timeline section",
      author: "Rin",
      email: "rin@pulse.app",
      date: "2026-11-06 15:21",
      fullDate: "2026-11-06 15:21:04 +0800",
      parents: ["e2a44c1f90d3b7a16c5e2f"],
      refs: [],
      files: [
        { path: "web/src/components/WorktreeTimeline.tsx", status: "A", added: 96, deleted: 0 },
      ],
    },
    {
      hash: "e2a44c1f90d3b7a16c5e2f",
      short: "e2a44c1",
      subject: "fix(editor): align selection after soft wrap",
      author: "momo",
      email: "momo@pulse.app",
      date: "2026-11-06 14:02",
      fullDate: "2026-11-06 14:02:37 +0800",
      parents: ["9d0b7f3c81e6a42b57d9c0"],
      refs: [],
      files: [
        { path: "src/editor/selection.rs", status: "M", added: 14, deleted: 9 },
      ],
    },
    {
      hash: "9d0b7f3c81e6a42b57d9c0",
      short: "9d0b7f3",
      subject: "feat(ai): model catalogue in settings",
      author: "Rin",
      email: "rin@pulse.app",
      date: "2026-11-05 22:40",
      fullDate: "2026-11-05 22:40:19 +0800",
      parents: ["3f6a2b9d47c1e85a02b6f3"],
      refs: [],
      files: [
        { path: "web/src/pages/settings/Models.tsx", status: "A", added: 71, deleted: 0 },
        { path: "src/ai/catalogue.rs", status: "M", added: 22, deleted: 4 },
      ],
    },
    {
      hash: "3f6a2b9d47c1e85a02b6f3",
      short: "3f6a2b9",
      subject: "chore: initialize Tauri v2 shell",
      author: "momo",
      email: "momo@pulse.app",
      date: "2026-11-05 18:10",
      fullDate: "2026-11-05 18:10:56 +0800",
      parents: ["b84c0e76a1d9f32c85e4b7"],
      refs: [],
      files: [
        { path: "src-tauri/tauri.conf.json", status: "A", added: 41, deleted: 0 },
        { path: "src-tauri/src/main.rs", status: "A", added: 26, deleted: 0 },
      ],
    },
    {
      hash: "b84c0e76a1d9f32c85e4b7",
      short: "b84c0e7",
      subject: "docs: rewrite onboarding guide",
      author: "Rin",
      email: "rin@pulse.app",
      date: "2026-11-04 11:26",
      fullDate: "2026-11-04 11:26:03 +0800",
      parents: ["6a1d5c2f80b3e7a419d6c5"],
      refs: [],
      files: [{ path: "docs/onboarding.md", status: "M", added: 58, deleted: 31 }],
    },
    {
      hash: "6a1d5c2f80b3e7a419d6c5",
      short: "6a1d5c2",
      subject: "feat(sync): queue offline mutations",
      body: "断网时把变更写进本地队列，恢复连接后按顺序重放。",
      author: "Kai",
      email: "kai@pulse.app",
      date: "2026-11-04 09:12",
      fullDate: "2026-11-04 09:12:44 +0800",
      parents: ["2a9c6e4d17b8f05a3c9e1d"],
      refs: [],
      files: [
        { path: "src/sync/queue.rs", status: "A", added: 143, deleted: 0 },
        { path: "src/sync/mod.rs", status: "M", added: 18, deleted: 6 },
      ],
    },
    {
      hash: "2a9c6e4d17b8f05a3c9e1d",
      short: "2a9c6e4",
      subject: "Merge pull request #212 from rin/feat-sync",
      author: "Rin",
      email: "rin@pulse.app",
      date: "2026-11-03 20:31",
      fullDate: "2026-11-03 20:31:57 +0800",
      parents: ["7b2e8d4a90c3f61b28e5d0", "d3b7a908f2e6c41a75b9e3"],
      refs: [],
      files: [],
    },
    {
      hash: "7b2e8d4a90c3f61b28e5d0",
      short: "7b2e8d4",
      subject: "refactor(store): split workspace state",
      author: "momo",
      email: "momo@pulse.app",
      date: "2026-11-03 17:48",
      fullDate: "2026-11-03 17:48:22 +0800",
      parents: ["c05e93a61d8f4b27e0a3c9"],
      refs: [],
      files: [
        { path: "src/store/workspace.rs", status: "M", added: 64, deleted: 52 },
        { path: "src/store/mod.rs", status: "M", added: 12, deleted: 9 },
      ],
    },
    {
      hash: "d3b7a908f2e6c41a75b9e3",
      short: "d3b7a90",
      subject: "feat(sync): conflict banner",
      author: "Kai",
      email: "kai@pulse.app",
      date: "2026-11-03 16:05",
      fullDate: "2026-11-03 16:05:10 +0800",
      parents: ["c05e93a61d8f4b27e0a3c9"],
      refs: [],
      files: [{ path: "web/src/components/SyncBanner.tsx", status: "A", added: 57, deleted: 0 }],
    },
    {
      hash: "c05e93a61d8f4b27e0a3c9",
      short: "c05e93a",
      subject: "test(sync): cover conflict resolution",
      author: "Kai",
      email: "kai@pulse.app",
      date: "2026-11-02 21:14",
      fullDate: "2026-11-02 21:14:39 +0800",
      parents: ["f19a6c0d73b5e28a41c6f9"],
      refs: [],
      files: [{ path: "src/sync/conflict_test.rs", status: "A", added: 88, deleted: 0 }],
    },
    {
      hash: "f19a6c0d73b5e28a41c6f9",
      short: "f19a6c0",
      subject: "chore(release): v0.3.0",
      author: "Rin",
      email: "rin@pulse.app",
      date: "2026-11-02 10:02",
      fullDate: "2026-11-02 10:02:18 +0800",
      parents: ["4d8b2a6e19c7f03b58d4e1"],
      refs: ["tag: v0.3.0"],
      files: [{ path: "CHANGELOG.md", status: "M", added: 19, deleted: 0 }],
    },
    {
      hash: "4d8b2a6e19c7f03b58d4e1",
      short: "4d8b2a6",
      subject: "feat: command palette",
      author: "momo",
      email: "momo@pulse.app",
      date: "2026-11-01 19:37",
      fullDate: "2026-11-01 19:37:05 +0800",
      parents: ["e70c1f52b8d4a90c63e7b1"],
      refs: [],
      files: [{ path: "web/src/components/Palette.tsx", status: "A", added: 112, deleted: 0 }],
    },
    {
      hash: "e70c1f52b8d4a90c63e7b1",
      short: "e70c1f5",
      subject: "chore: initial commit",
      author: "Rin",
      email: "rin@pulse.app",
      date: "2026-10-31 09:00",
      fullDate: "2026-10-31 09:00:00 +0800",
      parents: [],
      refs: [],
      files: [{ path: "README.md", status: "A", added: 34, deleted: 0 }],
    },
  ],
  branches: ["main", "feat/landing", "feat/terminal", "fix/sync-queue"],
  remotes: [
    { remote: "origin", branches: ["main", "feat/landing", "feat/terminal"] },
  ],
  tags: ["v0.2.0", "v0.3.0"],
  stashes: ["WIP: focus ring"],
  commands: [
    {
      id: "pulse-check",
      label: "前端检查",
      shell: "pwsh",
      command: "npm run check",
      path: "~/Projects/pulse-web",
    },
    {
      id: "pulse-test",
      label: "Rust 测试",
      shell: "pwsh",
      command: "cargo test",
      path: "~/Projects/pulse",
    },
    {
      id: "pulse-dev",
      label: "开发服务器",
      shell: "pwsh",
      command: "npm run dev",
      path: "~/Projects/pulse-web",
    },
  ],
  terminals: [
    {
      id: "pulse-shell",
      label: "pwsh",
      kind: "shell",
      lines: [
        { text: "PS D:\\Projects\\pulse-web> ", tone: "dim" },
        { text: "git status -sb", tone: "bold" },
        { text: "## feat/landing...origin/feat/landing", tone: "dim" },
        { text: " M web/src/styles/tokens.css", tone: "orange" },
        { text: "A  web/src/components/DemoClip.tsx", tone: "green" },
      ],
    },
    {
      id: "pulse-dev",
      label: "dev",
      kind: "command",
      lines: [
        { text: "$ npm run dev", tone: "bold" },
        { text: "> vite", tone: "dim" },
        { text: "  VITE v7.1.0  ready in 412 ms", tone: "green" },
        { text: "  ➜  Local: http://localhost:9245/", tone: "blue" },
      ],
    },
  ],
};

/* ------------------------------------------------------------------ */
/*  atlas-cli — note import tool                                       */
/* ------------------------------------------------------------------ */

const atlasImportDiff = d(
  18,
  18,
  `
 func Import(root string) error {
 	entries, err := os.ReadDir(root)
 	if err != nil {
 		return fmt.Errorf("read %s: %w", root, err)
 	}
 	for _, entry := range entries {
-		if !entry.IsDir() {
+		if entry.IsDir() {
+			if err := Import(filepath.Join(root, entry.Name())); err != nil {
+				return err
+			}
 			continue
 		}
+		if strings.HasPrefix(entry.Name(), ".") {
+			continue
+		}
 		if err := importFile(filepath.Join(root, entry.Name())); err != nil {
 			return err
 		}
 	}
 	return nil
 }`,
);

const atlasReadmeDiff = d(
  1,
  1,
  `
 # atlas
 
-A small CLI for importing notes into Atlas.
+A small CLI for importing notes into Atlas.
+
+## Import
+
+\`\`\`sh
+atlas import ~/Notes --recursive
+\`\`\`
+
+Hidden files are skipped unless \`--all\` is passed.`,
);

const atlasCli: Repo = {
  id: "atlas-cli",
  name: "atlas-cli",
  icon: "github",
  group: "pinned",
  worktrees: [
    {
      id: "atlas-main",
      name: "atlas-cli",
      branch: "feat/import",
      path: "~/Projects/atlas-cli",
      changes: [
        {
          path: "cmd/import.go",
          status: "M",
          staged: true,
          added: 18,
          deleted: 3,
          diff: atlasImportDiff,
        },
        {
          path: "README.md",
          status: "M",
          staged: false,
          added: 9,
          deleted: 2,
          diff: atlasReadmeDiff,
        },
      ],
    },
  ],
  commits: [
    {
      hash: "8f2c1a4b7e9d30c5f16a8b",
      short: "8f2c1a4",
      subject: "feat(import): accept nested folders",
      author: "momo",
      email: "momo@pulse.app",
      date: "2026-11-05 13:27",
      fullDate: "2026-11-05 13:27:42 +0800",
      parents: ["1c9d0e7a3f5b82c04e6d9a"],
      refs: ["HEAD -> feat/import", "origin/feat/import"],
      files: [
        { path: "cmd/import.go", status: "M", added: 18, deleted: 3 },
        { path: "README.md", status: "M", added: 9, deleted: 2 },
      ],
    },
    {
      hash: "1c9d0e7a3f5b82c04e6d9a",
      short: "1c9d0e7",
      subject: "fix(import): skip hidden files",
      author: "Rin",
      email: "rin@pulse.app",
      date: "2026-11-04 16:08",
      fullDate: "2026-11-04 16:08:11 +0800",
      parents: ["6b3f8a29d1e47c05a2f8b3"],
      refs: [],
      files: [{ path: "cmd/import.go", status: "M", added: 7, deleted: 1 }],
    },
    {
      hash: "6b3f8a29d1e47c05a2f8b3",
      short: "6b3f8a2",
      subject: "docs: document import flags",
      author: "Rin",
      email: "rin@pulse.app",
      date: "2026-11-02 10:15",
      fullDate: "2026-11-02 10:15:33 +0800",
      parents: ["e5a71c0f82b6d39e54a7c1"],
      refs: [],
      files: [{ path: "docs/flags.md", status: "A", added: 41, deleted: 0 }],
    },
    {
      hash: "e5a71c0f82b6d39e54a7c1",
      short: "e5a71c0",
      subject: "chore: bump v0.4.0",
      author: "momo",
      email: "momo@pulse.app",
      date: "2026-10-30 18:52",
      fullDate: "2026-10-30 18:52:07 +0800",
      parents: [],
      refs: ["tag: v0.4.0"],
      files: [{ path: "CHANGELOG.md", status: "M", added: 8, deleted: 0 }],
    },
  ],
  branches: ["main", "feat/import"],
  remotes: [{ remote: "origin", branches: ["main", "feat/import"] }],
  tags: ["v0.4.0"],
  stashes: [],
  commands: [
    {
      id: "atlas-test",
      label: "运行测试",
      shell: "pwsh",
      command: "go test ./...",
      path: "~/Projects/atlas-cli",
    },
  ],
  terminals: [
    {
      id: "atlas-shell",
      label: "pwsh",
      kind: "shell",
      lines: [
        { text: "PS D:\\Projects\\atlas-cli> ", tone: "dim" },
        { text: "go test ./...", tone: "bold" },
        { text: "ok   atlas/cmd/import   0.42s", tone: "green" },
      ],
    },
  ],
};

/* ------------------------------------------------------------------ */
/*  kite — markdown notes                                              */
/* ------------------------------------------------------------------ */

const kite: Repo = {
  id: "kite",
  name: "kite",
  icon: "git",
  group: "repos",
  worktrees: [
    {
      id: "kite-main",
      name: "kite",
      branch: "main",
      path: "~/Projects/kite",
      changes: [],
    },
  ],
  commits: [
    {
      hash: "2d7f9b3e81c4a05d6f2e7b",
      short: "2d7f9b3",
      subject: "feat(editor): slash commands",
      author: "Rin",
      email: "rin@pulse.app",
      date: "2026-11-04 20:33",
      fullDate: "2026-11-04 20:33:15 +0800",
      parents: ["9c1e6a8d52b7f04c31e8a9"],
      refs: ["HEAD -> main", "origin/main", "tag: v1.2.0"],
      files: [{ path: "src/editor/commands.ts", status: "A", added: 94, deleted: 0 }],
    },
    {
      hash: "9c1e6a8d52b7f04c31e8a9",
      short: "9c1e6a8",
      subject: "fix(editor): keep caret after paste",
      author: "momo",
      email: "momo@pulse.app",
      date: "2026-11-03 14:12",
      fullDate: "2026-11-03 14:12:48 +0800",
      parents: ["4b8d2f1a96e0c37b25d8f4"],
      refs: [],
      files: [{ path: "src/editor/caret.ts", status: "M", added: 11, deleted: 6 }],
    },
    {
      hash: "4b8d2f1a96e0c37b25d8f4",
      short: "4b8d2f1",
      subject: "perf(index): debounce full-text scan",
      author: "Kai",
      email: "kai@pulse.app",
      date: "2026-11-01 22:06",
      fullDate: "2026-11-01 22:06:29 +0800",
      parents: ["a3c6e05d17b2f98a40c6e3"],
      refs: [],
      files: [{ path: "src/index/scan.ts", status: "M", added: 27, deleted: 19 }],
    },
    {
      hash: "a3c6e05d17b2f98a40c6e3",
      short: "a3c6e05",
      subject: "chore: initial release",
      author: "Rin",
      email: "rin@pulse.app",
      date: "2026-10-28 11:40",
      fullDate: "2026-10-28 11:40:02 +0800",
      parents: [],
      refs: [],
      files: [{ path: "package.json", status: "A", added: 32, deleted: 0 }],
    },
  ],
  branches: ["main"],
  remotes: [{ remote: "origin", branches: ["main"] }],
  tags: ["v1.2.0"],
  stashes: [],
  commands: [
    {
      id: "kite-check",
      label: "单元测试",
      shell: "pwsh",
      command: "npm test",
      path: "~/Projects/kite",
    },
  ],
  terminals: [
    {
      id: "kite-shell",
      label: "pwsh",
      kind: "shell",
      lines: [
        { text: "PS D:\\Projects\\kite> ", tone: "dim" },
        { text: "git status", tone: "bold" },
        { text: "nothing to commit, working tree clean", tone: "dim" },
      ],
    },
  ],
};

/* ------------------------------------------------------------------ */
/*  driftlog — travel journal                                          */
/* ------------------------------------------------------------------ */

const driftlogZhDiff = d(
  1,
  1,
  `
-# Driftlog
+# Driftlog
+
+把每一次出发，记成一条可以回看的轨迹。
+
+## 功能
+
+- 离线地图与轨迹记录
+- 按天分组的照片时间线
+- 导出 GPX 与 Markdown 日记`,
);

const driftlog: Repo = {
  id: "driftlog",
  name: "driftlog",
  icon: "git",
  group: "repos",
  worktrees: [
    {
      id: "driftlog-main",
      name: "driftlog",
      branch: "main",
      path: "~/Projects/driftlog",
      changes: [],
    },
    {
      id: "driftlog-zh",
      name: "driftlog-zh",
      branch: "i18n/zh",
      path: "~/Projects/driftlog-zh",
      changes: [
        {
          path: "README.zh.md",
          status: "M",
          staged: false,
          added: 9,
          deleted: 1,
          diff: driftlogZhDiff,
        },
      ],
    },
  ],
  commits: [
    {
      hash: "7a1c4e9d02b6f85a31e7c4",
      short: "7a1c4e9",
      subject: "feat(i18n): add zh-CN copy",
      author: "Rin",
      email: "rin@pulse.app",
      date: "2026-11-02 17:55",
      fullDate: "2026-11-02 17:55:31 +0800",
      parents: ["3e5b8d2a61c9f04e75b2d8"],
      refs: ["HEAD -> i18n/zh", "origin/i18n/zh"],
      files: [{ path: "README.zh.md", status: "M", added: 9, deleted: 1 }],
    },
    {
      hash: "3e5b8d2a61c9f04e75b2d8",
      short: "3e5b8d2",
      subject: "feat(map): offline tile cache",
      author: "Kai",
      email: "kai@pulse.app",
      date: "2026-11-01 09:18",
      fullDate: "2026-11-01 09:18:44 +0800",
      parents: ["c9f2a160d84b37e2a5f9c6"],
      refs: [],
      files: [{ path: "src/map/tiles.ts", status: "A", added: 118, deleted: 0 }],
    },
    {
      hash: "c9f2a160d84b37e2a5f9c6",
      short: "c9f2a16",
      subject: "fix(map): clamp zoom on resize",
      author: "momo",
      email: "momo@pulse.app",
      date: "2026-10-30 15:42",
      fullDate: "2026-10-30 15:42:09 +0800",
      parents: ["5d8e0b4f27a1c96e83d5b0"],
      refs: [],
      files: [{ path: "src/map/viewport.ts", status: "M", added: 8, deleted: 3 }],
    },
    {
      hash: "5d8e0b4f27a1c96e83d5b0",
      short: "5d8e0b4",
      subject: "chore: scaffold app",
      author: "Rin",
      email: "rin@pulse.app",
      date: "2026-10-26 10:05",
      fullDate: "2026-10-26 10:05:51 +0800",
      parents: [],
      refs: [],
      files: [{ path: "package.json", status: "A", added: 28, deleted: 0 }],
    },
  ],
  branches: ["main", "i18n/zh"],
  remotes: [{ remote: "origin", branches: ["main", "i18n/zh"] }],
  tags: [],
  stashes: [],
  commands: [
    {
      id: "driftlog-dev",
      label: "开发",
      shell: "pwsh",
      command: "npm run tauri dev",
      path: "~/Projects/driftlog-zh",
    },
  ],
  terminals: [
    {
      id: "driftlog-shell",
      label: "pwsh",
      kind: "shell",
      lines: [
        { text: "PS D:\\Projects\\driftlog-zh> ", tone: "dim" },
        { text: "git status -sb", tone: "bold" },
        { text: "## i18n/zh...origin/i18n/zh", tone: "dim" },
        { text: " M README.zh.md", tone: "orange" },
      ],
    },
  ],
};

/* ------------------------------------------------------------------ */
/*  nimbus — weather widget                                            */
/* ------------------------------------------------------------------ */

const nimbusWidgetDiff = d(
  14,
  14,
  `
 export function HourlyStrip({ hours }: Props) {
   return (
-    <div className="strip">
-      {hours.map((hour) => (
-        <span key={hour.time}>{hour.temp}°</span>
-      ))}
+    <div className="strip" role="list">
+      {hours.map((hour) => (
+        <span key={hour.time} role="listitem">
+          <em>{hour.time}</em>
+          <strong>{hour.temp}°</strong>
+        </span>
+      ))}
     </div>
   );
 }`,
);

const nimbusApiDiff = d(
  41,
  41,
  `
-const response = await fetch(url);
-if (!response.ok) throw new Error("weather request failed");
+let response = await fetch(url);
+for (let attempt = 0; attempt < 3 && response.status === 429; attempt++) {
+  await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
+  response = await fetch(url);
+}
+if (!response.ok) throw new Error(\`weather request failed: \${response.status}\`);`,
);

const nimbus: Repo = {
  id: "nimbus",
  name: "nimbus",
  icon: "git",
  group: "repos",
  worktrees: [
    {
      id: "nimbus-main",
      name: "nimbus",
      branch: "main",
      path: "~/Projects/nimbus",
      changes: [
        {
          path: "src/components/HourlyStrip.tsx",
          status: "M",
          staged: true,
          added: 13,
          deleted: 7,
          diff: nimbusWidgetDiff,
        },
        {
          path: "src/api/weather.ts",
          status: "M",
          staged: false,
          added: 8,
          deleted: 2,
          diff: nimbusApiDiff,
        },
      ],
    },
  ],
  commits: [
    {
      hash: "b4e2d71c95a0f38e62d7b1",
      short: "b4e2d71",
      subject: "feat(widget): hourly forecast strip",
      author: "momo",
      email: "momo@pulse.app",
      date: "2026-11-05 08:44",
      fullDate: "2026-11-05 08:44:26 +0800",
      parents: ["0f7a3c9e58d2b17a46c9e0"],
      refs: ["HEAD -> main", "origin/main"],
      files: [
        { path: "src/components/HourlyStrip.tsx", status: "M", added: 13, deleted: 7 },
        { path: "src/styles/strip.css", status: "A", added: 26, deleted: 0 },
      ],
    },
    {
      hash: "0f7a3c9e58d2b17a46c9e0",
      short: "0f7a3c9",
      subject: "fix(api): retry on 429",
      author: "Kai",
      email: "kai@pulse.app",
      date: "2026-11-03 12:37",
      fullDate: "2026-11-03 12:37:58 +0800",
      parents: ["d6c1b58a03e7f92c51b8d4"],
      refs: [],
      files: [{ path: "src/api/weather.ts", status: "M", added: 8, deleted: 2 }],
    },
    {
      hash: "d6c1b58a03e7f92c51b8d4",
      short: "d6c1b58",
      subject: "feat(api): cache geocoding",
      author: "Rin",
      email: "rin@pulse.app",
      date: "2026-11-01 16:20",
      fullDate: "2026-11-01 16:20:13 +0800",
      parents: ["2e9f4a0b71c5d38e64a2f9"],
      refs: [],
      files: [{ path: "src/api/geocode.ts", status: "M", added: 31, deleted: 12 }],
    },
    {
      hash: "2e9f4a0b71c5d38e64a2f9",
      short: "2e9f4a0",
      subject: "chore: initial commit",
      author: "momo",
      email: "momo@pulse.app",
      date: "2026-10-27 09:30",
      fullDate: "2026-10-27 09:30:00 +0800",
      parents: [],
      refs: [],
      files: [{ path: "README.md", status: "A", added: 21, deleted: 0 }],
    },
  ],
  branches: ["main"],
  remotes: [{ remote: "origin", branches: ["main"] }],
  tags: [],
  stashes: [],
  commands: [
    {
      id: "nimbus-check",
      label: "类型检查",
      shell: "pwsh",
      command: "npm run typecheck",
      path: "~/Projects/nimbus",
    },
  ],
  terminals: [
    {
      id: "nimbus-shell",
      label: "pwsh",
      kind: "shell",
      lines: [
        { text: "PS D:\\Projects\\nimbus> ", tone: "dim" },
        { text: "npm run typecheck", tone: "bold" },
        { text: "tsc --noEmit  ✓", tone: "green" },
      ],
    },
  ],
};

/* ------------------------------------------------------------------ */
/*  quarry — dataset tooling                                           */
/* ------------------------------------------------------------------ */

const quarry: Repo = {
  id: "quarry",
  name: "quarry",
  icon: "github",
  group: "github",
  worktrees: [
    {
      id: "quarry-main",
      name: "quarry",
      branch: "main",
      path: "~/Projects/quarry",
      changes: [],
    },
  ],
  commits: [
    {
      hash: "c3a8f52d71b9e04a26c8f5",
      short: "c3a8f52",
      subject: "feat(export): parquet writer",
      author: "Kai",
      email: "kai@pulse.app",
      date: "2026-11-04 13:05",
      fullDate: "2026-11-04 13:05:47 +0800",
      parents: ["6d1b9e4a82c5f07d31b9e6"],
      refs: ["HEAD -> main", "origin/main"],
      files: [{ path: "src/export/parquet.rs", status: "A", added: 156, deleted: 0 }],
    },
    {
      hash: "6d1b9e4a82c5f07d31b9e6",
      short: "6d1b9e4",
      subject: "docs: schema migration notes",
      author: "Rin",
      email: "rin@pulse.app",
      date: "2026-11-01 11:22",
      fullDate: "2026-11-01 11:22:36 +0800",
      parents: ["8e4c2a7f39d6b15c04e8a2"],
      refs: [],
      files: [{ path: "docs/schema.md", status: "A", added: 64, deleted: 0 }],
    },
    {
      hash: "8e4c2a7f39d6b15c04e8a2",
      short: "8e4c2a7",
      subject: "chore: bootstrap",
      author: "momo",
      email: "momo@pulse.app",
      date: "2026-10-25 17:48",
      fullDate: "2026-10-25 17:48:09 +0800",
      parents: [],
      refs: [],
      files: [{ path: "Cargo.toml", status: "A", added: 24, deleted: 0 }],
    },
  ],
  branches: ["main"],
  remotes: [{ remote: "origin", branches: ["main"] }],
  tags: [],
  stashes: [],
  commands: [
    {
      id: "quarry-test",
      label: "运行测试",
      shell: "pwsh",
      command: "cargo test",
      path: "~/Projects/quarry",
    },
  ],
  terminals: [
    {
      id: "quarry-shell",
      label: "pwsh",
      kind: "shell",
      lines: [
        { text: "PS D:\\Projects\\quarry> ", tone: "dim" },
        { text: "cargo test", tone: "bold" },
        { text: "test result: ok. 24 passed", tone: "green" },
      ],
    },
  ],
};

export const repos: Repo[] = [pulse, atlasCli, kite, driftlog, nimbus, quarry];

export const groups: {
  id: Repo["group"];
  label: string;
}[] = [
  { id: "pinned", label: "已固定" },
  { id: "repos", label: "仓库" },
  { id: "github", label: "Github" },
];

export const graphColors = [
  "#4f7acb",
  "#b47e35",
  "#8a67bf",
  "#3c997e",
  "#c8687e",
  "#6093a6",
  "#a19442",
];
