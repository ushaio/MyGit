import { useEffect, useId, useRef, useState } from "react";
import { GitBranch, Loader2, Play } from "lucide-react";
import {
  Workflow,
  type WorkflowInfo,
  type WorkflowInput,
  type WorkflowTarget,
} from "@/lib/api";
import { useT } from "@/lib/i18n";
import { errorMessage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function WorkflowRunPopover({
  target,
  workflow,
  branches,
  initialRef,
  disabled,
  onDispatched,
}: {
  target: WorkflowTarget;
  workflow: WorkflowInfo;
  branches: string[];
  initialRef: string;
  disabled?: boolean;
  onDispatched: () => void;
}) {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [refValue, setRefValue] = useState(initialRef);
  const [definitions, setDefinitions] = useState<WorkflowInput[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [retry, setRetry] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    setSubmitError("");
    Workflow.Inputs(target, workflow.Path, refValue)
      .then((result) => {
        if (cancelled) return;
        const defs = result ?? [];
        const defaults: Record<string, string> = {};
        for (const def of defs) {
          defaults[def.Name] = def.Default || (
            def.Type === "boolean" ? "false" :
            def.Type === "choice" ? def.Options?.[0] ?? "" : ""
          );
        }
        setDefinitions(defs);
        setValues(defaults);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(errorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, refValue, retry, target, workflow.Path]);

  function changeOpen(next: boolean) {
    if (submittingRef.current) return;
    if (next) {
      setLoading(true);
      setLoadError("");
      setSubmitError("");
      setDefinitions([]);
      setValues({});
    }
    setOpen(next);
  }

  function changeRef(ref: string) {
    setLoading(true);
    setLoadError("");
    setSubmitError("");
    setRefValue(ref);
  }

  async function submit() {
    if (!open || loading || loadError || submittingRef.current) return;
    const missing = definitions.find((def) => def.Required && !(values[def.Name] ?? "").trim());
    if (missing) {
      setSubmitError(`${t("Required")}: ${missing.Name}`);
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError("");
    try {
      await Workflow.Dispatch(target, workflow.ID, refValue, definitions.map((def) => ({
        ...def,
        Default: values[def.Name] ?? "",
      })));
      if (!mounted.current) return;
      setOpen(false);
      onDispatched();
    } catch (error) {
      if (mounted.current) setSubmitError(errorMessage(error));
    } finally {
      submittingRef.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  const refs = Array.from(new Set([refValue, ...branches].filter(Boolean)));

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" disabled={disabled || submitting} aria-label={t("Run workflow")}>
          <Play className="size-3" />
          {t("Run workflow")}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label={t("Run workflow")}
        className="flex max-h-[min(36rem,var(--radix-popover-content-available-height))] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden p-0"
        onEscapeKeyDown={(event) => { if (submitting) event.preventDefault(); }}
        onInteractOutside={(event) => { if (submitting) event.preventDefault(); }}
      >
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => { event.preventDefault(); void submit(); }}
        >
          <div className="shrink-0 border-b px-4 py-3">
            <p className="truncate text-xs font-semibold">{workflow.Name}</p>
          </div>
          <div className="min-h-0 space-y-4 overflow-y-auto px-4 py-4 text-xs">
            <div className="grid gap-1.5">
              <label htmlFor={`${id}-ref`} className="font-medium">{t("Use workflow from")}</label>
              <Select value={refValue} onValueChange={changeRef} disabled={submitting}>
                <SelectTrigger id={`${id}-ref`} aria-label={t("Ref")} className="w-full text-xs">
                  <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {refs.map((ref) => <SelectItem key={ref} value={ref}>{ref}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div aria-busy={loading} className="space-y-4">
              {loading ? (
                <p role="status" className="flex items-center gap-2 py-2 text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  {t("Loading workflow inputs…")}
                </p>
              ) : loadError ? (
                <div className="space-y-2">
                  <p role="alert" className="break-words text-destructive">{loadError}</p>
                  <Button type="button" size="xs" variant="outline" onClick={() => {
                    setLoading(true);
                    setRetry((previous) => previous + 1);
                  }}>{t("Retry")}</Button>
                </div>
              ) : definitions.length === 0 ? (
                <p className="text-muted-foreground">{t("This workflow has no inputs.")}</p>
              ) : definitions.map((def) => {
                const fieldID = `${id}-${def.Name}`;
                const label = (
                  <label htmlFor={fieldID} className="font-medium leading-relaxed">
                    {def.Description || def.Name}
                    {def.Required && <span className="ml-1 text-destructive" aria-label={t("Required")}>*</span>}
                  </label>
                );
                return (
                  <div key={def.Name} className="grid gap-1.5">
                    {def.Type === "boolean" ? (
                      <div className="flex items-start gap-2">
                        <Checkbox
                          id={fieldID}
                          aria-label={def.Name}
                          className="mt-0.5"
                          disabled={submitting}
                          checked={values[def.Name] === "true"}
                          onCheckedChange={(checked) => setValues((previous) => ({
                            ...previous, [def.Name]: checked === true ? "true" : "false",
                          }))}
                        />
                        {label}
                      </div>
                    ) : (
                      <>
                        {label}
                        {def.Type === "choice" ? (
                          <Select value={values[def.Name] ?? ""} disabled={submitting}
                            onValueChange={(value) => setValues((previous) => ({ ...previous, [def.Name]: value }))}>
                            <SelectTrigger id={fieldID} aria-label={def.Name} className="w-full text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(def.Options ?? []).map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            id={fieldID}
                            aria-label={def.Name}
                            aria-required={def.Required}
                            type={def.Type === "number" ? "number" : "text"}
                            step={def.Type === "number" ? "any" : undefined}
                            className="text-xs"
                            disabled={submitting}
                            value={values[def.Name] ?? ""}
                            onChange={(event) => setValues((previous) => ({ ...previous, [def.Name]: event.target.value }))}
                          />
                        )}
                      </>
                    )}
                    {def.Description && <p className="text-[11px] text-muted-foreground">{def.Name}</p>}
                  </div>
                );
              })}
            </div>
            {submitError && <p role="alert" className="break-words text-destructive">{submitError}</p>}
          </div>
          <div className="flex shrink-0 justify-end gap-2 border-t px-4 py-3">
            <Button type="button" size="sm" variant="ghost" disabled={submitting} onClick={() => changeOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={loading || !!loadError || submitting}>
              {submitting ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
              {t("Start run")}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
