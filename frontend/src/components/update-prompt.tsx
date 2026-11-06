import { useEffect, useRef } from "react";
import { Download, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APP_VERSION } from "@/lib/app-info";
import { useT } from "@/lib/i18n";
import { checkForUpdates, dismissUpdate, startUpdate, useUpdate } from "@/lib/update";

/**
 * A small floating card shown once per launch when GitHub reports a newer
 * release. Downloading and launching the installer happen in place — the user
 * never has to leave MyGit for the GitHub download page.
 */
export function UpdatePrompt() {
  const t = useT();
  const update = useUpdate();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void checkForUpdates(true);
  }, []);

  const info = update.info;
  if (!info?.Available || update.dismissed) return null;
  const busy = update.phase === "downloading" || update.phase === "installing";
  const label =
    update.phase === "downloading"
      ? `${t("Downloading update…")}${update.percent > 0 ? ` ${update.percent}%` : ""}`
      : update.phase === "installing"
        ? t("Starting the installer…")
        : update.phase === "error"
          ? t("Retry")
          : t("Download and install");

  return (
    <aside
      role="status"
      aria-label={t("Software update")}
      className="fixed bottom-10 right-4 z-50 w-[21rem] overflow-hidden rounded-xl border bg-background shadow-2xl"
    >
      <div className="flex items-start gap-3 border-b bg-muted/40 px-4 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <Download className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{t("Update available")}</div>
          <div className="text-[11px] text-muted-foreground">
            {t("A new version is available:")}{" "}
            <span className="font-medium text-foreground">v{info.Latest}</span>
          </div>
        </div>
        <button
          type="button"
          aria-label={t("Later")}
          disabled={busy}
          onClick={dismissUpdate}
          className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="grid gap-2.5 px-4 py-3 text-xs">
        <span className="text-[11px] text-muted-foreground">
          {t("Your version")} v{info.Current || APP_VERSION}
        </span>
        {update.phase === "downloading" && (
          <div
            role="progressbar"
            aria-label={t("Downloading update…")}
            aria-valuenow={update.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full bg-primary transition-[width] duration-200"
              style={{ width: `${Math.max(update.percent, 2)}%` }}
            />
          </div>
        )}
        {update.phase === "installing" && (
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            {t("MyGit will restart to finish installing.")}
          </span>
        )}
        {update.phase === "error" && update.error && (
          <span role="alert" className="text-[11px] text-destructive">
            {update.error}
          </span>
        )}
        <div className="flex gap-2 pt-0.5">
          <Button
            type="button"
            size="sm"
            className="flex-1"
            disabled={busy}
            onClick={() => void startUpdate()}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
            {label}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={dismissUpdate}
          >
            {t("Later")}
          </Button>
        </div>
      </div>
    </aside>
  );
}
