import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { basename } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { useWorkbench } from "@/lib/workbench";

/**
 * Offers to reopen the terminals that were open when the app last closed,
 * including their commands. The backend saves the layout on every change; this
 * dialog appears on launch whenever that saved layout has at least one tab.
 */
export function RestoreTerminalsDialog() {
  const w = useWorkbench(),
    t = useT();
  const layout = w.restorePrompt;
  if (!layout) return null;
  const tabs = layout.Tabs || [];
  return (
    <Dialog open onOpenChange={(value) => (!value ? w.dismissRestore() : undefined)}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t("Restore terminals")}</DialogTitle>
          <DialogDescription>
            {t(
              "MyGit was closed with these terminals open. Restore them, including their commands?",
            )}
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
          {tabs.map((tab, index) => (
            <li
              key={index}
              className="flex flex-col gap-1 rounded-md border px-2 py-1.5"
            >
              <span className="truncate font-medium">
                {tab.Label || basename(tab.Path || "")}
              </span>
              <span
                className="truncate text-xs text-muted-foreground"
                title={tab.Path}
              >
                {tab.Command ? (
                  <code className="font-mono">{tab.Command}</code>
                ) : (
                  tab.Path
                )}
              </span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={w.dismissRestore}>
            {t("Don't restore")}
          </Button>
          <Button onClick={() => void w.restoreTerminals()}>
            {t("Restore")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
