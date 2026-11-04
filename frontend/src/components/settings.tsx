import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import {
  Code2,
  ExternalLink,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  Palette,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Desktop, Workspace, type Preferences } from "@/lib/api";
import { report, useWorkbench } from "@/lib/workbench";
import { useT } from "@/lib/i18n";
import { IconButton } from "./shared";

const sections: {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}[] = [
  { id: "general", label: "General", icon: Palette },
  { id: "editor", label: "Editor", icon: Code2 },
  { id: "ai", label: "AI", icon: Sparkles },
  { id: "folders", label: "Folders", icon: Folder },
];

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium">{label}</span>
      {children}
      {error ? (
        <span role="alert" className="text-[11px] text-destructive">
          {error}
        </span>
      ) : (
        hint && (
          <span className="text-[11px] text-muted-foreground">{hint}</span>
        )
      )}
    </div>
  );
}

export function SettingsDialog() {
  const w = useWorkbench(),
    t = useT();
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [saving, setSaving] = useState(false);
  const [section, setSection] = useState("general");
  const [reveal, setReveal] = useState(false);
  const [dataPath, setDataPath] = useState("");
  useEffect(() => {
    if (w.settings && w.state) {
      setPreferences({ ...w.state.Preferences });
      setSection("general");
      setReveal(false);
    }
  }, [w.settings]);
  useEffect(() => {
    if (!w.settings) return;
    let alive = true;
    Workspace.DataPath()
      .then((value) => alive && setDataPath(value))
      .catch(() => alive && setDataPath(""));
    return () => {
      alive = false;
    };
  }, [w.settings]);
  if (!preferences) return null;
  const address = (preferences.AIURL || "").trim();
  const addressError =
    address && !/^https?:\/\/[^/?#\s]+/i.test(address)
      ? t("Enter an http(s) address.")
      : "";
  function select(
    key: keyof Preferences,
    label: string,
    options: [string, string][],
  ) {
    return (
      <Field label={t(label)}>
        <Select
          value={String(preferences![key] || "none")}
          onValueChange={(value) =>
            setPreferences(
              (p) => p && { ...p, [key]: value === "none" ? "" : value },
            )
          }
        >
          <SelectTrigger className="w-full" aria-label={t(label)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map(([value, text]) => (
              <SelectItem key={value} value={value}>
                {t(text)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    );
  }
  function panel() {
    switch (section) {
      case "editor":
        return (
          <div className="grid gap-5">
            {select("Editor", "Editor", [
              ["none", "System"],
              ["code", "Visual Studio Code"],
              ["cursor", "Cursor"],
            ])}
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                aria-label={t("Wrap lines")}
                checked={preferences!.Wrap}
                onCheckedChange={(checked) =>
                  setPreferences((p) => p && { ...p, Wrap: !!checked })
                }
              />
              {t("Wrap lines")}
            </label>
          </div>
        );
      case "ai":
        return (
          <div className="grid gap-5">
            <p className="text-[11px] text-muted-foreground">
              {t("Set the address and key of the AI service MyGit calls.")}
            </p>
            <Field
              label={t("API URL")}
              hint={t("For example https://api.example.com/v1.")}
              error={addressError}
            >
              <Input
                aria-label={t("API URL")}
                autoComplete="off"
                spellCheck={false}
                placeholder="https://api.example.com/v1"
                value={preferences!.AIURL || ""}
                onChange={(e) =>
                  setPreferences(
                    (p) => p && { ...p, AIURL: e.target.value },
                  )
                }
              />
            </Field>
            <Field
              label={t("API Key")}
              hint={t("Stored only in this computer's workspace file.")}
            >
              <div className="flex items-center gap-2">
                <Input
                  aria-label={t("API Key")}
                  autoComplete="off"
                  spellCheck={false}
                  type={reveal ? "text" : "password"}
                  placeholder="sk-…"
                  value={preferences!.AIKey || ""}
                  onChange={(e) =>
                    setPreferences(
                      (p) => p && { ...p, AIKey: e.target.value },
                    )
                  }
                />
                <IconButton
                  label={reveal ? "Hide key" : "Show key"}
                  onClick={() => setReveal((value) => !value)}
                >
                  {reveal ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </IconButton>
              </div>
            </Field>
          </div>
        );
      case "folders":
        return (
          <div className="grid gap-3">
            <div className="flex items-center justify-between text-xs font-medium">
              {t("Folders")}
              <IconButton label="Add folder" onClick={w.addFolder}>
                <Plus className="size-4" />
              </IconButton>
            </div>
            <div className="grid gap-1">
              {(w.state?.Roots || []).map((root) => (
                <div
                  key={root}
                  className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1 text-xs"
                >
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                  <span
                    className="min-w-0 flex-1 truncate select-text"
                    title={root}
                  >
                    {root}
                  </span>
                  <IconButton
                    label="Remove folder"
                    onClick={() => w.update(Workspace.RemoveFolder(root))}
                  >
                    <X className="size-3" />
                  </IconButton>
                </div>
              ))}
            </div>
            <div className="grid gap-1.5 border-t pt-3">
              <button
                type="button"
                className="nav-row text-xs"
                aria-label={t("Open data location")}
                disabled={!dataPath}
                onClick={() => report(Desktop.OpenPath(dataPath))}
              >
                <FolderOpen />
                <span className="min-w-0 flex-1 truncate text-left">
                  {t("Open data location")}
                </span>
                <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
              </button>
              <span
                className="select-text break-all px-2 text-[11px] text-muted-foreground"
                title={dataPath}
              >
                {dataPath}
              </span>
            </div>
          </div>
        );
      default:
        return (
          <div className="grid gap-5">
            {select("Theme", "Appearance", [
              ["system", "System"],
              ["light", "Light"],
              ["dark", "Dark"],
            ])}
            {select("Language", "Language", [
              ["zh-CN", "简体中文"],
              ["en", "English"],
            ])}
          </div>
        );
    }
  }
  return (
    <Dialog open={w.settings} onOpenChange={w.setSettings}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>{t("Settings")}</DialogTitle>
          <DialogDescription>MyGit</DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={async (e) => {
            e.preventDefault();
            if (addressError) return setSection("ai");
            setSaving(true);
            try {
              await w.update(Workspace.SetPreferences(preferences));
              w.setSettings(false);
            } finally {
              setSaving(false);
            }
          }}
        >
          <div className="flex min-h-[340px] min-w-0">
            <nav
              aria-label={t("Settings")}
              className="flex w-40 shrink-0 flex-col gap-1 border-r bg-muted/30 p-2 text-xs"
            >
              {sections.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  className="nav-row"
                  data-active={section === id}
                  aria-current={section === id ? "page" : undefined}
                  onClick={() => setSection(id)}
                >
                  <Icon />
                  <span className="truncate">{t(label)}</span>
                </button>
              ))}
            </nav>
            <div className="min-w-0 flex-1 overflow-y-auto p-6">{panel()}</div>
          </div>
          <DialogFooter className="border-t px-6 py-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => w.setSettings(false)}
            >
              {t("Cancel")}
            </Button>
            <Button disabled={saving}>{t("Save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
