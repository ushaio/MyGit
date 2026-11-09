import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { useTheme } from "@/lib/theme";
import { Plus, TerminalSquare, X } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Desktop, Term, type TerminalCommand, type TerminalProfile } from "@/lib/api";
import { cn, errorMessage } from "@/lib/utils";
import { report, useWorkbench } from "@/lib/workbench";
import { useT } from "@/lib/i18n";
import { IconButton } from "./shared";
import { ShellIcon } from "./shell-icon";

export function TerminalPane({ visible }: { visible: boolean }) {
  const w = useWorkbench(),
    t = useT();
  const dragged = useRef("");
  const [form, setForm] = useState<{
    initial: TerminalCommand | null;
    common: boolean;
  } | null>(null);
  const tabs = w.terminalsFor(w.project);
  return (
    <section
      className={cn("min-h-0 flex-1", visible ? "flex" : "hidden")}
      aria-label={t("Terminal")}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b bg-muted/40 px-2">
          {tabs.map((tab) => (
            <ContextMenu key={tab.id}>
              <ContextMenuTrigger asChild>
                <div
                  draggable
                  onDragStart={() => {
                    dragged.current = tab.id;
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    w.moveTerminal(dragged.current, tab.id);
                  }}
                  className={cn(
                    "flex h-8 shrink-0 items-center rounded-md border border-transparent px-2 text-xs",
                    w.activeTerminal === tab.id && "border-border bg-background",
                  )}
                  title={`${tab.command ? `${tab.command} — ` : ""}${
                    tab.shell ? `${tab.shell} — ${tab.path}` : tab.path
                  }`}
                >
                  <button
                    className="flex items-center gap-2"
                    aria-label={
                      tab.shell
                        ? `${tab.label} — ${t(tab.shell)}`
                        : tab.label
                    }
                    onClick={() => w.activateTerminal(tab)}
                  >
                    <ShellIcon profile={tab.profile} shell={tab.shell} />
                    {tab.label}
                  </button>
                  <button
                    className="ml-3 rounded p-1 hover:bg-muted"
                    aria-label={t("Close terminal")}
                    onClick={() => void w.closeTerminal(tab.id)}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={() => void w.closeTerminal(tab.id)}>
                  {t("Close terminal")}
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() => void w.closeOtherTerminals(tab.id)}
                >
                  {t("Close other terminals")}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
          <IconButton
            label={t("New terminal")}
            onClick={() => w.openTerminal(w.project)}
          >
            <Plus className="size-4" />
          </IconButton>
        </div>
        {!tabs.length && (
          <div className="flex flex-1 items-center justify-center">
            <Button variant="outline" onClick={() => w.openTerminal(w.project)}>
              {t("New terminal")}
            </Button>
          </div>
        )}
        {tabs.map((tab) => (
          <TerminalViewport
            key={tab.id}
            id={tab.id}
            active={visible && w.activeTerminal === tab.id}
          />
        ))}
      </div>
      <aside
        className="terminal-profiles"
        aria-label={t("Terminal commands")}
      >
        <section className="terminal-profiles-section">
          <div className="terminal-profiles-title">
            <span>{t("Terminal commands")}</span>
            <IconButton
              label={t("New command")}
              onClick={() => setForm({ initial: null, common: false })}
            >
              <Plus className="size-3.5" />
            </IconButton>
          </div>
          <CommandList
            commands={w.commands}
            profiles={w.profiles}
            currentPath={w.path}
            onRun={w.runCommand}
            onEdit={(command) => setForm({ initial: command, common: false })}
            onMove={(command) => void w.moveCommand(command.ID, true)}
            moveLabel={t("Move to general commands")}
            onDelete={(command) =>
              void w.saveCommands(
                w.commands.filter((item) => item.ID !== command.ID),
              )
            }
            emptyLabel={t("No commands yet. Add one with +.")}
          />
        </section>
        <section
          className="terminal-profiles-section terminal-profiles-common"
          aria-label={t("General commands")}
        >
          <div className="terminal-profiles-title">
            <span>{t("General commands")}</span>
            <IconButton
              label={t("New general command")}
              onClick={() => setForm({ initial: null, common: true })}
            >
              <Plus className="size-3.5" />
            </IconButton>
          </div>
          <CommandList
            commands={w.commonCommands}
            profiles={w.profiles}
            currentPath={w.path}
            onRun={w.runCommand}
            onEdit={(command) => setForm({ initial: command, common: true })}
            onMove={(command) => void w.moveCommand(command.ID, false)}
            moveLabel={t("Move to project commands")}
            onDelete={(command) =>
              void w.saveCommonCommands(
                w.commonCommands.filter((item) => item.ID !== command.ID),
              )
            }
            emptyLabel={t("No general commands yet. Add one with +.")}
            showPath={false}
          />
        </section>
      </aside>
      <CommandDialog
        key={
          form
            ? `${form.common ? "common" : "project"}-${form.initial?.ID || "new"}`
            : "closed"
        }
        open={form !== null}
        initial={form?.initial || null}
        common={form?.common || false}
        profiles={w.profiles}
        defaultPath={form?.common ? "" : w.path}
        onClose={() => setForm(null)}
        onSave={async (command) => {
          if (form?.common) {
            const next = command.ID
              ? w.commonCommands.map((item) =>
                  item.ID === command.ID ? command : item,
                )
              : [...w.commonCommands, command];
            return w.saveCommonCommands(next);
          }
          const next = command.ID
            ? w.commands.map((item) =>
                item.ID === command.ID ? command : item,
              )
            : [...w.commands, command];
          return w.saveCommands(next);
        }}
      />
    </section>
  );
}

function CommandList({
  commands,
  profiles,
  currentPath,
  onRun,
  onEdit,
  onMove,
  onDelete,
  moveLabel,
  emptyLabel,
  showPath = true,
}: {
  commands: TerminalCommand[];
  profiles: TerminalProfile[] | null;
  currentPath: string;
  onRun: (command: TerminalCommand) => void;
  onEdit: (command: TerminalCommand) => void;
  onMove: (command: TerminalCommand) => void;
  onDelete: (command: TerminalCommand) => void;
  moveLabel: string;
  emptyLabel: string;
  showPath?: boolean;
}) {
  const t = useT();
  return (
    <div className="terminal-profiles-list">
      {commands.map((command) => (
        <ContextMenu key={command.ID}>
          <ContextMenuTrigger asChild>
            <button
              type="button"
              className="terminal-profile"
              title={`${command.Label} — ${command.Command}${
                showPath && command.Path ? ` @ ${command.Path}` : ""
              }`}
              onClick={() => onRun(command)}
            >
              <TerminalSquare className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate">{command.Label}</span>
                  <span className="terminal-command-shell">
                    {t(shellLabel(profiles, command.Profile))}
                  </span>
                </span>
                <span className="terminal-profile-detail">
                  {command.Command}
                </span>
                {showPath &&
                  command.Path &&
                  command.Path !== currentPath && (
                    <span className="terminal-profile-detail">
                      {command.Path}
                    </span>
                  )}
              </span>
            </button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => onEdit(command)}>
              {t("Edit command")}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => onMove(command)}>
              {moveLabel}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => onDelete(command)}>
              {t("Delete command")}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ))}
      {!commands.length && (
        <div className="terminal-profile-empty">{emptyLabel}</div>
      )}
    </div>
  );
}

function shellLabel(profiles: TerminalProfile[] | null, id: string) {
  const profile = (profiles || []).find((item) => item.ID === id);
  if (profile) return profile.Label;
  const fallback = (profiles || []).find(
    (item) => item.Default && item.Available,
  );
  return fallback?.Label || "Default shell";
}

function CommandDialog({
  open,
  initial,
  common,
  profiles,
  defaultPath,
  onClose,
  onSave,
}: {
  open: boolean;
  initial: TerminalCommand | null;
  common: boolean;
  profiles: TerminalProfile[] | null;
  defaultPath: string;
  onClose: () => void;
  onSave: (command: TerminalCommand) => Promise<boolean>;
}) {
  const t = useT();
  const [label, setLabel] = useState(initial?.Label || "");
  const [line, setLine] = useState(initial?.Command || "");
  const [profile, setProfile] = useState(initial?.Profile || "");
  const [path, setPath] = useState(initial?.Path || defaultPath);
  const [saving, setSaving] = useState(false);
  const fallback = (profiles || []).find(
    (item) => item.Default && item.Available,
  );
  const shell = profile || fallback?.ID || "";
  const valid = label.trim() !== "" && line.trim() !== "";
  async function browse() {
    try {
      const folder = await Desktop.ChooseFolder();
      if (folder) setPath(folder);
    } catch {
      // Cancelled or unavailable; keep the current path.
    }
  }
  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    const saved = await onSave({
      ID: initial?.ID || "",
      Label: label.trim(),
      Command: line.trim(),
      Profile: shell,
      Path: path.trim(),
    });
    setSaving(false);
    if (saved) onClose();
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t(initial ? "Edit command" : "New command")}</DialogTitle>
          <DialogDescription>
            {t(
              common
                ? "General commands are shown in every project; the working directory defaults to the project folder."
                : "Commands run in the chosen shell inside the working directory — the project folder by default.",
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            {t("Command name")}
            <Input
              aria-label={t("Command name")}
              autoFocus
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={t("For example: Dev server")}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            {t("Command")}
            <Input
              aria-label={t("Command")}
              className="font-mono"
              value={line}
              onChange={(event) => setLine(event.target.value)}
              placeholder="npm run dev"
            />
          </label>
          <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            {t("Working directory")}
            <div className="flex gap-1.5">
              <Input
                aria-label={t("Working directory")}
                className="font-mono"
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder={defaultPath || t("Project folder")}
              />
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                onClick={() => void browse()}
              >
                {t("Browse…")}
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            {t("Terminal type")}
            <Select value={shell} onValueChange={setProfile}>
              <SelectTrigger className="w-full" aria-label={t("Terminal type")}>
                <SelectValue placeholder={t("Default shell")} />
              </SelectTrigger>
              <SelectContent>
                {(profiles || []).map((item) => (
                  <SelectItem
                    key={item.ID}
                    value={item.ID}
                    disabled={!item.Available}
                  >
                    {t(item.Label)}
                    {!item.Available && ` — ${t("Not installed")}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={!valid || saving}>
            {t("Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TerminalViewport({ id, active }: { id: string; active: boolean }) {
  const container = useRef<HTMLDivElement>(null),
    terminalRef = useRef<Terminal | null>(null),
    fitRef = useRef<FitAddon | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const { resolvedTheme } = useTheme();
  const t = useT();
  useEffect(() => {
    if (!container.current) return;
    const terminal = new Terminal({
      fontFamily: '"Cascadia Code", "SFMono-Regular", Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: false,
    });
    const fit = new FitAddon();
    fitRef.current = fit;
    terminalRef.current = terminal;
    terminal.loadAddon(fit);
    terminal.loadAddon(
      new WebLinksAddon((_event, address) => {
        void report(Desktop.OpenURL(address));
      }),
    );
    terminal.open(container.current);
    // Ctrl+Shift+C copies the current selection; Ctrl+Shift+V pastes from the
    // clipboard. Plain Ctrl+C is left untouched so it still reaches the shell
    // as SIGINT. Returning false tells xterm we handled the key.
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      if (!event.ctrlKey || !event.shiftKey) return true;
      const key = event.key.toLowerCase();
      if (key === "c") {
        if (event.metaKey || event.altKey) return true;
        const selection = terminal.getSelection();
        if (selection) void navigator.clipboard?.writeText(selection);
        return false;
      }
      if (key === "v") {
        if (event.metaKey || event.altKey) return true;
        void navigator.clipboard
          ?.readText()
          .then((text) => {
            if (text) void report(Term.Write(id, text));
          })
          .catch(() => {});
        return false;
      }
      return true;
    });
    const input = terminal.onData((data) => {
      void report(Term.Write(id, data));
    });
    let stopped = false,
      offset = 0,
      timer: ReturnType<typeof setTimeout>,
      frame = 0;
    const resize = () => {
      if (!activeRef.current || !container.current?.clientWidth) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        try {
          fit.fit();
          void report(Term.Resize(id, terminal.cols, terminal.rows));
        } catch {}
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container.current);
    resize();
    async function read() {
      try {
        const output = await Term.Read(id, offset);
        if (stopped) return;
        offset = output.Offset;
        if (output.Reset) terminal.write("\r\n[Earlier output omitted]\r\n");
        if (output.Data)
          terminal.write(
            Uint8Array.from(atob(output.Data), (char) => char.charCodeAt(0)),
          );
        if (output.Closed) {
          terminal.write(`\r\n[${t("Terminal session ended")}]\r\n`);
          return;
        }
        timer = setTimeout(read, activeRef.current ? 80 : 500);
      } catch (error) {
        if (!stopped) terminal.write(`\r\n${errorMessage(error)}\r\n`);
      }
    }
    void read();
    return () => {
      stopped = true;
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      observer.disconnect();
      input.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [id]);
  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal)
      terminal.options.theme =
        resolvedTheme === "dark"
          ? {
              background: "#18212f",
              foreground: "#e1e8f2",
              cursor: "#7da5f0",
              selectionBackground: "#3c5680",
            }
          : {
              background: "#ffffff",
              foreground: "#18263a",
              cursor: "#3569c8",
              selectionBackground: "#c7d9f7",
            };
  }, [resolvedTheme]);
  useEffect(() => {
    if (active) {
      const timer = setTimeout(() => {
        fitRef.current?.fit();
        const terminal = terminalRef.current;
        if (terminal) {
          terminal.focus();
          void report(Term.Resize(id, terminal.cols, terminal.rows));
        }
      }, 30);
      return () => clearTimeout(timer);
    }
  }, [active, id]);
  const copy = () => {
    const selection = terminalRef.current?.getSelection();
    if (selection) void navigator.clipboard?.writeText(selection);
  };
  const paste = () => {
    void navigator.clipboard
      ?.readText()
      .then((text) => {
        if (text) void report(Term.Write(id, text));
        terminalRef.current?.focus();
      })
      .catch(() => {});
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={container}
          className={cn("min-h-0 flex-1 p-3", active ? "block" : "hidden")}
        />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={copy}>{t("Copy")}</ContextMenuItem>
        <ContextMenuItem onSelect={paste}>{t("Paste")}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
