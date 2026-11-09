import { useEffect, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  BrowserIcon,
  FileExplorerIcon,
  TerminalAppIcon,
  VSCodeIcon,
} from "@/components/app-icon";
import { Desktop } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { report } from "@/lib/workbench";

type OpenMethod = "folder" | "browser" | "terminal" | "code";
const methods = [
  { id: "browser", label: "Open in browser", icon: BrowserIcon },
  { id: "folder", label: "Open in File Explorer", icon: FileExplorerIcon },
  { id: "terminal", label: "Open in terminal", icon: TerminalAppIcon },
  { id: "code", label: "Open in VS Code", icon: VSCodeIcon },
] as const;

export function ProjectTools({ path, webURL }: { path: string; webURL: string }) {
  const t = useT();
  const [selected, setSelected] = useState<OpenMethod>("folder");
  const [codeAvailable, setCodeAvailable] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    Desktop.ToolAvailable("code").then(value => {
      if (alive) setCodeAvailable(value);
    }).catch(() => { if (alive) setCodeAvailable(false); });
    return () => { alive = false; };
  }, [open]);
  const available = (id: OpenMethod) => id === "browser" ? !!webURL : id === "code" ? codeAvailable === true : !!path;
  const method = methods.find(item => item.id === selected)!;
  const Icon = method.icon;
  const launch = () => {
    if (!available(selected)) return;
    if (selected === "browser") void report(Desktop.OpenURL(webURL));
    else if (selected === "folder") void report(Desktop.OpenPath(path));
    else void report(Desktop.OpenTool(path, selected));
  };
  return (
    <div className="flex shrink-0 items-center" role="group" aria-label={t("Open project")}>
      <Button variant="outline" size="sm" className="h-7 gap-1.5 rounded-r-none border-r-0 px-2 text-xs" disabled={!available(selected)} aria-label={t(method.label)} title={t(method.label)} onClick={launch}>
        <Icon className="size-3.5" /><span className="max-[1100px]:hidden">{t(method.label)}</span>
      </Button>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" className="h-7 w-6 rounded-l-none" aria-label={t("Choose how to open project")}>
            <ChevronDown className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          {methods.map(item => (
            <DropdownMenuItem key={item.id} disabled={!available(item.id)} onSelect={() => setSelected(item.id)}>
              <item.icon className="size-3.5" />
              <span className="flex-1">{t(item.label)}{item.id === "code" && codeAvailable === false ? ` (${t("Not installed")})` : ""}</span>
              {item.id === selected && <Check className="size-3.5" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
