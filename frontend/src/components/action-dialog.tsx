import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Git, type Action, type RebaseCommit } from "@/lib/api";
import { errorMessage } from "@/lib/utils";
import { useWorkbench } from "@/lib/workbench";
import { useT } from "@/lib/i18n";
import { ErrorNotice, IconButton } from "./shared";

const fields: Record<string, [keyof Action, string, boolean?][]> = {
  branch: [
    ["Name", "Name", true],
    ["Ref", "Revision", true],
  ],
  tag: [
    ["Name", "Name", true],
    ["Ref", "Revision", true],
  ],
  checkout: [["Ref", "Revision", true]],
  worktree: [
    ["Ref", "Revision", true],
    ["Value", "Destination directory", true],
    ["Name", "New branch"],
  ],
  "rename-branch": [
    ["Ref", "Branch", true],
    ["Name", "New name", true],
  ],
  track: [
    ["Ref", "Branch", true],
    ["Value", "Upstream"],
  ],
  "add-remote": [
    ["Name", "Name", true],
    ["Value", "Remote URL", true],
  ],
  "edit-remote": [
    ["Ref", "Remote", true],
    ["Name", "New name", true],
    ["Value", "Remote URL", true],
  ],
  push: [
    ["Remote", "Remote"],
    ["Ref", "Branch"],
    ["Value", "Branch"],
  ],
  pull: [
    ["Remote", "Remote"],
    ["Ref", "Branch"],
  ],
  fetch: [["Remote", "Remote"]],
  merge: [["Ref", "Revision", true]],
  rebase: [["Ref", "Revision", true]],
  reset: [["Ref", "Revision", true]],
  "cherry-pick": [["Ref", "Revision", true]],
  revert: [["Ref", "Revision", true]],
  "push-tag": [
    ["Ref", "Name", true],
    ["Remote", "Remote", true],
  ],
};
export function ActionDialog() {
  const w = useWorkbench(),
    t = useT();
  const [value, setValue] = useState<Action | null>(null);
  const [planError, setPlanError] = useState("");
  const [planLoading, setPlanLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    if (!w.pending) {
      setValue(null);
      return;
    }
    const a = { ...w.pending.value };
    if (a.Kind === "reset" && !a.Mode) a.Mode = "mixed";
    if (a.Kind === "push" && !a.Remote)
      a.Remote = Object.keys(w.repo?.Remotes || {})[0] || "";
    setValue(a);
    setPlanError("");
    if (a.Kind !== "interactive-rebase") return;
    let alive = true;
    setPlanLoading(true);
    Git.RebasePlan(a.Path, a.Ref)
      .then((commits) => {
        if (alive)
          setValue(
            (v) =>
              v && {
                ...v,
                Plan: (commits || []).map((Commit) => ({
                  Commit,
                  Action: 0,
                  Message:
                    Commit.Subject + (Commit.Body ? "\n\n" + Commit.Body : ""),
                })),
              },
          );
      })
      .catch((error) => {
        if (alive) setPlanError(errorMessage(error));
      })
      .finally(() => {
        if (alive) setPlanLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [w.pending]);
  if (!value || !w.pending) return null;
  const kind = value.Kind;
  const change = (
    key: keyof Action,
    next: string | number | boolean | RebaseCommit[],
  ) => setValue((v) => v && { ...v, [key]: next });
  const check = (key: keyof Action, label: string) => (
    <label className="flex items-center gap-2 text-xs">
      <Checkbox
        checked={!!value[key]}
        onCheckedChange={(checked) => change(key, !!checked)}
      />
      {t(label)}
    </label>
  );
  const mode = (label: string, options: [string, string][]) => (
    <label className="grid gap-1.5 text-xs">
      {t(label)}
      <Select
        value={value.Mode || "default"}
        onValueChange={(next) => change("Mode", next === "default" ? "" : next)}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([key, label]) => (
            <SelectItem key={key} value={key}>
              {t(label)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
  const movePlan = (index: number, delta: number) => {
    const plan = [...(value.Plan || [])];
    [plan[index], plan[index + delta]] = [plan[index + delta], plan[index]];
    change("Plan", plan);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) w.setPending(null);
      }}
    >
      <DialogContent
        className={
          kind === "interactive-rebase" ? "sm:max-w-3xl" : "sm:max-w-lg"
        }
      >
        <DialogHeader>
          <DialogTitle>{t(w.pending.title)}</DialogTitle>
          <DialogDescription>
            {t(
              "This operation changes the repository. Review the target before confirming.",
            )}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid min-h-0 gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (submitting) return;
            setSubmitting(true);
            try {
              const success = await w.execute({ ...value, Confirm: true });
              if (success) w.setPending(null);
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <div className="rounded-md bg-muted px-3 py-2 text-xs break-all select-text">
            {value.Path}
            {value.Ref && (
              <div className="mt-1 font-mono text-primary">{value.Ref}</div>
            )}
            {value.Value && kind === "remove-worktree" && (
              <div className="mt-1">{value.Value}</div>
            )}
            {!!value.Files?.length && (
              <div className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap">
                {value.Files.join("\n")}
              </div>
            )}
          </div>
          {(fields[kind] || []).map(([key, label, required]) => (
            <label className="grid gap-1.5 text-xs" key={key}>
              {t(label)}
              <Input
                name={key}
                required={required}
                value={String(value[key] || "")}
                onChange={(e) => change(key, e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          ))}
          {kind === "checkout" && value.Mode !== "branch" && (
            <label className="grid gap-1.5 text-xs">
              {t("New branch")}
              <Input
                value={value.Name}
                onChange={(e) => change("Name", e.target.value)}
              />
            </label>
          )}
          {["stash", "stash-files", "rename-stash", "tag", "commit"].includes(
            kind,
          ) && (
            <label className="grid gap-1.5 text-xs">
              {t("Message")}
              <Textarea
                required={kind === "commit"}
                rows={3}
                value={value.Message}
                onChange={(e) => change("Message", e.target.value)}
              />
            </label>
          )}
          {kind === "reset" &&
            mode("Reset mode", [
              ["soft", "Soft"],
              ["mixed", "Mixed"],
              ["hard", "Hard"],
            ])}
          {kind === "merge" &&
            mode("Merge mode", [
              ["default", "Default"],
              ["no-ff", "Create merge commit"],
              ["squash", "Squash"],
            ])}
          {kind === "apply-stash" && check("Keep", "Keep stash after applying")}
          {kind === "stash" && check("Untracked", "Include untracked files")}
          {kind === "push" && (
            <>
              {check("Force", "Force with lease")}
              {check("Tags", "Push all tags")}
            </>
          )}
          {kind === "delete-branch" && check("Force", "Force deletion")}
          {[
            "pull",
            "merge",
            "rebase",
            "interactive-rebase",
            "checkout",
          ].includes(kind) && check("Autostash", "Autostash local changes")}
          {kind === "pull" && check("Rebase", "Rebase instead of merge")}
          {kind === "rebase" &&
            check("UpdateRefs", "Update dependent branches")}
          {kind === "checkout" &&
            value.Mode !== "branch" &&
            !!value.Name &&
            check("Track", "Track remote branch")}
          {["merge", "cherry-pick", "revert"].includes(kind) &&
            check("NoCommit", "Do not commit")}
          {["cherry-pick", "revert"].includes(kind) && (
            <label className="grid gap-1.5 text-xs">
              {t("Parents")}
              <Input
                type="number"
                min="0"
                max="20"
                value={value.Parent}
                onChange={(e) => change("Parent", Number(e.target.value))}
              />
            </label>
          )}
          {kind === "discard" && (
            <p className="text-xs text-destructive">
              {t("Discarded changes cannot be restored by MyGit.")}
            </p>
          )}
          {kind === "interactive-rebase" && (
            <div className="max-h-80 overflow-auto rounded-md border">
              {planLoading && <div className="p-4">{t("Loading…")}</div>}
              {planError && <ErrorNotice error={planError} />}
              {(value.Plan || []).map((item, index) => (
                <div
                  key={item.Commit.Hash}
                  className="flex flex-wrap items-center gap-2 border-b p-2 last:border-0"
                >
                  <Select
                    value={String(item.Action)}
                    onValueChange={(next) =>
                      change(
                        "Plan",
                        (value.Plan || []).map((row, i) =>
                          i === index ? { ...row, Action: Number(next) } : row,
                        ),
                      )
                    }
                  >
                    <SelectTrigger className="h-8 w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[
                        "Pick",
                        "Reword",
                        "Edit",
                        "Squash",
                        "Fixup",
                        "Drop",
                      ].map((label, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {t(label)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <code className="text-xs text-muted-foreground">
                    {item.Commit.Short}
                  </code>
                  <span className="min-w-0 flex-1 truncate text-xs">
                    {item.Commit.Subject}
                  </span>
                  <IconButton
                    label="Move up"
                    disabled={index === 0}
                    onClick={() => movePlan(index, -1)}
                  >
                    <ArrowUp className="size-3" />
                  </IconButton>
                  <IconButton
                    label="Move down"
                    disabled={index === (value.Plan?.length || 0) - 1}
                    onClick={() => movePlan(index, 1)}
                  >
                    <ArrowDown className="size-3" />
                  </IconButton>
                  {item.Action === 1 && (
                    <Textarea
                      className="w-full"
                      aria-label={t("Message")}
                      value={item.Message}
                      onChange={(e) =>
                        change(
                          "Plan",
                          (value.Plan || []).map((row, i) =>
                            i === index
                              ? { ...row, Message: e.target.value }
                              : row,
                          ),
                        )
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => w.setPending(null)}
            >
              {t("Cancel")}
            </Button>
            <Button
              type="submit"
              disabled={
                submitting ||
                !!w.busy ||
                planLoading ||
                !!planError ||
                (kind === "interactive-rebase" && !value.Plan?.length)
              }
            >
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {t("Confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
