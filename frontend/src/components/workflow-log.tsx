import { useMemo } from "react";
import { ChevronRight } from "lucide-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { parseWorkflowLog, type WorkflowLogEntry } from "@/lib/workflow-logs";

function LogEntries({ entries }: { entries: WorkflowLogEntry[] }) {
  return entries.map((entry) => {
    const line = (
      <>
        <span
          className="sticky left-0 w-12 shrink-0 select-none bg-[#0d1117] pr-3 text-right tabular-nums text-slate-500"
          aria-hidden="true"
        >
          {entry.number}
        </span>
        {entry.children && (
          <ChevronRight className="mt-1 size-3 shrink-0 text-slate-400" />
        )}
        <span
          title={entry.timestamp || undefined}
          className={cn(
            "whitespace-pre",
            entry.tone === "error" && "text-red-300",
            entry.tone === "warning" && "text-amber-200",
          )}
        >
          {entry.text || " "}
        </span>
      </>
    );
    return entry.children ? (
      <details key={entry.number} className="[&[open]>summary>svg]:rotate-90">
        <summary className="flex w-max min-w-full cursor-pointer list-none gap-1 pr-3 hover:bg-white/5 [&::-webkit-details-marker]:hidden">
          {line}
        </summary>
        <LogEntries entries={entry.children} />
      </details>
    ) : (
      <div
        key={entry.number}
        className="flex w-max min-w-full gap-1 pr-3 hover:bg-white/5"
      >
        {line}
      </div>
    );
  });
}

export function WorkflowLog({ content }: { content: string }) {
  const t = useT();
  const { entries, truncated } = useMemo(
    () => parseWorkflowLog(content),
    [content],
  );
  if (!entries.length)
    return (
      <p className="px-3 py-4 text-muted-foreground">
        {t("No log output for this step.")}
      </p>
    );
  return (
    <div
      className="min-w-0 overflow-x-auto rounded-b bg-[#0d1117] py-3 font-mono text-[11px] leading-5 text-slate-200"
      role="region"
      aria-label={t("Step logs")}
      tabIndex={0}
    >
      <LogEntries entries={entries} />
      {truncated && (
        <p className="sticky left-0 max-w-full whitespace-normal px-3 pt-3 text-amber-200">
          {t("Log display limited to 10,000 lines.")}
        </p>
      )}
    </div>
  );
}
