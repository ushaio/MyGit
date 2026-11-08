import { useEffect, useState } from "react";
import { Events, Window } from "@wailsio/runtime";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Lifecycle } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { report, useWorkbench } from "@/lib/workbench";

/**
 * Asks what the window close button should do. The Go close hook cancels the
 * close and emits "app:close-request" while the reminder is on; the choice made
 * here is applied through Lifecycle.ResolveClose, which also persists it when
 * "remember" is ticked.
 */
export function CloseConfirmDialog() {
  const w = useWorkbench(),
    t = useT();
  const [open, setOpen] = useState(false);
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    const off = Events.On("app:close-request", () => {
      setRemember(false);
      setOpen(true);
    });
    return typeof off === "function" ? off : undefined;
  }, []);

  const resolve = async (action: "minimize" | "exit") => {
    setOpen(false);
    const updated = await w.update(Lifecycle.ResolveClose(action, remember));
    if (updated && action === "exit") await report(Window.Close());
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t("Close MyGit")}</DialogTitle>
          <DialogDescription>
            {t("Do you want to minimize MyGit to the system tray, or quit the app?")}
          </DialogDescription>
        </DialogHeader>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={remember}
            onCheckedChange={(value) => setRemember(value === true)}
            aria-label={t("Remember my choice")}
          />
          <span>{t("Remember my choice")}</span>
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={() => resolve("minimize")}>
            {t("Minimize to tray")}
          </Button>
          <Button variant="destructive" onClick={() => resolve("exit")}>
            {t("Quit app")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
