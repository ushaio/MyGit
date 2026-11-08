import { useState, type ReactNode } from "react";
import { AlertCircle, Loader2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useT } from "@/lib/i18n";
import { rememberSectionOpen, storedSectionOpen } from "@/lib/sections";

export function IconButton({
  label,
  children,
  onClick,
  disabled,
  className = "",
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const t = useT();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          aria-label={t(label)}
          variant="ghost"
          size="icon"
          className={`size-7 shrink-0 ${className}`}
          onClick={onClick}
          disabled={disabled}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t(label)}</TooltipContent>
    </Tooltip>
  );
}
export function ErrorNotice({
  error,
  retry,
}: {
  error: string;
  retry?: () => void;
}) {
  const t = useT();
  return (
    <div
      role="alert"
      className="m-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
      <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words font-sans">
        {error}
      </pre>
      {retry && (
        <Button variant="outline" size="sm" onClick={retry}>
          {t("Retry")}
        </Button>
      )}
    </div>
  );
}
export function Loading() {
  const t = useT();
  return (
    <div
      role="status"
      className="flex h-full min-h-20 items-center justify-center gap-2 text-xs text-muted-foreground"
    >
      <Loader2 className="size-4 animate-spin" />
      {t("Loading…")}
    </div>
  );
}
export function Section({
  title,
  count,
  children,
  action,
  icon,
  defaultOpen = true,
  storageKey,
}: {
  title: string;
  count?: number;
  children: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  defaultOpen?: boolean;
  // storageKey remembers the open state across restarts; without it the
  // section is uncontrolled and only follows defaultOpen.
  storageKey?: string;
}) {
  const t = useT();
  const [initialOpen] = useState(() =>
    storageKey ? storedSectionOpen(storageKey, defaultOpen) : defaultOpen,
  );
  return (
    <Collapsible
      defaultOpen={initialOpen}
      onOpenChange={(open) => {
        if (storageKey) rememberSectionOpen(storageKey, open);
      }}
      className="group/section"
    >
      <div className="section-title">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1 text-left">
          <ChevronRight className="size-3 shrink-0 transition-transform group-data-[state=open]/section:rotate-90" />
          {icon}
          <span className="truncate">{t(title)}</span>
          {count !== undefined && (
            <span className="ml-auto text-[10px] font-normal tabular-nums">
              {count}
            </span>
          )}
        </CollapsibleTrigger>
        {action}
      </div>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}
