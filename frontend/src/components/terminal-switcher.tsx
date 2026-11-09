import { useRef, useState } from "react";
import { Check, Search, TerminalSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ShellIcon } from "@/components/shell-icon";
import { useT } from "@/lib/i18n";
import { basename, cn } from "@/lib/utils";
import { useWorkbench, type TerminalTab } from "@/lib/workbench";

export function TerminalSwitcher() {
  const w = useWorkbench(), t = useT();
  const [open, setOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const search = query.trim().toLowerCase();
  const terminalCount = t(w.terminals.length === 1 ? "1 open terminal" : "{count} open terminals").replace("{count}", String(w.terminals.length));
  const groups = new Map<string, TerminalTab[]>();
  for (const tab of w.terminals) {
    if (search && !tab.label.toLowerCase().includes(search)) continue;
    const group = groups.get(tab.project) || [];
    group.push(tab);
    groups.set(tab.project, group);
  }
  return (
    <Popover open={open} onOpenChange={(value) => { setOpen(value); setConfirmClose(null); setQuery(""); }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-5 shrink-0 gap-1 px-1.5 text-[10px]" aria-label={t("Open terminals")} aria-description={terminalCount} title={terminalCount}>
          <TerminalSquare className="size-3.5" />
          <span className="tabular-nums">{terminalCount}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        side="top" align="end" className="w-80 max-w-[calc(100vw-1rem)] p-0" aria-label={t("Open terminals")}
        onOpenAutoFocus={(event) => { event.preventDefault(); searchInput.current?.focus(); }}
        onInteractOutside={(event) => {
          // Switching to a terminal moves focus to xterm (and may switch the
          // project); keep this popover open so the user can pick another one.
          if (event.target instanceof Node && contentRef.current?.contains(event.target)) event.preventDefault();
          if (event.target instanceof Element && event.target.closest(".xterm")) event.preventDefault();
        }}
      >
        <div className="border-b px-3 py-2 text-xs font-semibold">{t("Open terminals")}<span className="ml-2 text-muted-foreground">{w.terminals.length}</span></div>
        <div className="border-b p-2">
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchInput}
              type="search"
              aria-label={t("Search terminals")}
              placeholder={t("Terminal command name…")}
              value={query}
              onChange={(event) => { setQuery(event.target.value); setConfirmClose(null); }}
              className="h-8 pl-8 text-xs md:text-xs"
            />
          </div>
        </div>
        <div className="max-h-80 overflow-y-auto p-1">
          {!groups.size && <p role="status" className="px-2 py-5 text-center text-xs text-muted-foreground">{t(w.terminals.length ? "No matching terminals" : "No open terminals")}</p>}
          {[...groups].map(([project, tabs]) => (
            <section key={project} aria-label={project || t("Other terminals")} className="mb-1 last:mb-0">
              <div className="px-2 pb-1 pt-2">
                <div className="truncate text-xs font-medium">{project ? basename(project) : t("Other terminals")}</div>
                {project && <div className="truncate text-[10px] text-muted-foreground" title={project}>{project}</div>}
              </div>
              {tabs.map(tab => (
                <div key={tab.id} className={cn("group flex items-center rounded-sm hover:bg-accent focus-within:bg-accent", w.project === tab.project && w.activeTerminal === tab.id && "bg-accent/60")}>
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-2 text-left" aria-label={`${t("Switch to terminal")}: ${tab.label}`} aria-current={w.project === tab.project && w.activeTerminal === tab.id ? "true" : undefined} title={`${tab.shell} — ${tab.path}${tab.command ? ` — ${tab.command}` : ""}`} onClick={() => { w.activateTerminal(tab); setConfirmClose(null); searchInput.current?.focus(); }}>
                    <ShellIcon profile={tab.profile} shell={tab.shell} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs">{tab.label}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">{tab.command || tab.path}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={cn("mr-1 rounded p-1 opacity-0 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100", confirmClose === tab.id && "bg-destructive/10 text-destructive opacity-100")}
                    aria-label={`${t(confirmClose === tab.id ? "Confirm close terminal" : "Close terminal")}: ${tab.label}`}
                    title={t(confirmClose === tab.id ? "Confirm close terminal" : "Close terminal")}
                    onBlur={() => setConfirmClose((current) => current === tab.id ? null : current)}
                    onClick={() => {
                      if (confirmClose !== tab.id) { setConfirmClose(tab.id); return; }
                      setConfirmClose(null);
                      void w.closeTerminal(tab.id);
                    }}
                  >
                    {confirmClose === tab.id ? <Check className="size-3.5" /> : <X className="size-3.5" />}
                  </button>
                </div>
              ))}
            </section>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
