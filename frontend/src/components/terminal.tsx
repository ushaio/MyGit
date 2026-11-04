import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { useTheme } from "@/lib/theme";
import { Plus, TerminalSquare, X } from "lucide-react";
import { toast } from "sonner";
import "@xterm/xterm/css/xterm.css";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Desktop, Term } from "@/lib/api";
import { basename, cn, errorMessage } from "@/lib/utils";
import { report } from "@/lib/workbench";
import { useT } from "@/lib/i18n";
import { ErrorNotice, IconButton } from "./shared";

type Tab = { id: string; path: string; label: string };
export function TerminalPane({
  visible,
  path,
}: {
  visible: boolean;
  path: string;
}) {
  const t = useT();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState(""),
    [error, setError] = useState("");
  const starting = useRef(false),
    alive = useRef(true),
    dragged = useRef("");
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const add = useCallback(async () => {
    if (!path || starting.current) return;
    starting.current = true;
    setError("");
    try {
      const id = await Term.Start(path, 100, 30);
      if (!alive.current) {
        await Term.Close(id);
        return;
      }
      setTabs((old) => [...old, { id, path, label: basename(path) }]);
      setActive(id);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      starting.current = false;
    }
  }, [path]);
  useEffect(() => {
    if (visible && !tabs.length && !error) void add();
  }, [visible, path]);
  async function close(id: string) {
    try {
      await Term.Close(id);
    } catch (error) {
      toast.error(errorMessage(error));
    }
    setTabs((old) => {
      const next = old.filter((tab) => tab.id !== id);
      if (id === active) setActive(next.at(-1)?.id || "");
      return next;
    });
  }
  return (
    <section
      className={cn("min-h-0 flex-1 flex-col", visible ? "flex" : "hidden")}
      aria-label={t("Terminal")}
    >
      <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b bg-muted/40 px-2">
        {tabs.map((tab, index) => (
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
                  const source = dragged.current;
                  setTabs((old) => {
                    const from = old.findIndex((item) => item.id === source);
                    const to = old.findIndex((item) => item.id === tab.id);
                    if (from < 0 || to < 0) return old;
                    const next = [...old];
                    const [item] = next.splice(from, 1);
                    next.splice(to, 0, item);
                    return next;
                  });
                }}
                className={cn(
                  "flex h-8 shrink-0 items-center rounded-md border border-transparent px-2 text-xs",
                  active === tab.id && "border-border bg-background",
                )}
                title={tab.path}
              >
                <button
                  className="flex items-center gap-2"
                  onClick={() => setActive(tab.id)}
                >
                  <TerminalSquare className="size-3.5" />
                  {tab.label} {index + 1}
                </button>
                <button
                  className="ml-3 rounded p-1 hover:bg-muted"
                  aria-label={t("Close terminal")}
                  onClick={() => close(tab.id)}
                >
                  <X className="size-3" />
                </button>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => close(tab.id)}>
                {t("Close terminal")}
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => {
                  for (const other of tabs)
                    if (other.id !== tab.id) void close(other.id);
                }}
              >
                Close other terminals
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}
        <IconButton label="New terminal" onClick={add}>
          <Plus className="size-4" />
        </IconButton>
      </div>
      {error && <ErrorNotice error={error} retry={add} />}
      {!tabs.length && (
        <div className="flex flex-1 items-center justify-center">
          <Button variant="outline" onClick={add}>
            {t("New terminal")}
          </Button>
        </div>
      )}
      {tabs.map((tab) => (
        <TerminalViewport
          key={tab.id}
          id={tab.id}
          active={visible && active === tab.id}
        />
      ))}
    </section>
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
  return (
    <div
      ref={container}
      className={cn("min-h-0 flex-1 p-3", active ? "block" : "hidden")}
    />
  );
}
