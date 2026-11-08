import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Code2,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  GitBranch,
  Github,
  Info,
  Loader2,
  MessageSquare,
  Palette,
  Plus,
  RefreshCw,
  Scale,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AI,
  Desktop,
  Workspace,
  type AIModel,
  type Preferences,
} from "@/lib/api";
import {
  APP_ISSUES,
  APP_LICENSE_URL,
  APP_NAME,
  APP_REPOSITORY,
  APP_VERSION,
} from "@/lib/app-info";
import { report, useWorkbench } from "@/lib/workbench";
import { useT } from "@/lib/i18n";
import { checkForUpdates, startUpdate, useUpdate } from "@/lib/update";
import { errorMessage } from "@/lib/utils";
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
  { id: "about", label: "About", icon: Info },
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
  const [models, setModels] = useState<AIModel[]>([]);
  const [modelsStamp, setModelsStamp] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState("");
  const [defaultPrompt, setDefaultPrompt] = useState("");
  const update = useUpdate();
  const loadingRef = useRef(false);
  const stampRef = useRef("");
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
  // The built-in prompt is shown verbatim: an empty field means "use this", so
  // the user edits from a known baseline instead of an empty box.
  useEffect(() => {
    if (!w.settings) return;
    let alive = true;
    AI.DefaultCommitPrompt()
      .then((value) => alive && setDefaultPrompt(value || ""))
      .catch(() => alive && setDefaultPrompt(""));
    return () => {
      alive = false;
    };
  }, [w.settings]);
  // loadModels asks the endpoint for its catalogue. The result is stamped with
  // the address and key it was fetched for, so editing either field drops the
  // stale list instead of offering models the endpoint never advertised.
  async function loadModels(url: string, key: string, force = false) {
    const target = `${url}\n${key}`;
    if (loadingRef.current || (!force && stampRef.current === target)) return;
    loadingRef.current = true;
    stampRef.current = target;
    setLoadingModels(true);
    setModelError("");
    try {
      const list = (await AI.Models(url, key)) || [];
      setModels(list);
      setModelsStamp(target);
      if (!list.length) setModelError(t("The service returned no models."));
    } catch (error) {
      setModels([]);
      setModelsStamp("");
      stampRef.current = "";
      setModelError(errorMessage(error));
    } finally {
      loadingRef.current = false;
      setLoadingModels(false);
    }
  }
  const autoAddress = (preferences?.AIURL || "").trim();
  const autoKey = (preferences?.AIKey || "").trim();
  useEffect(() => {
    if (!w.settings || section !== "ai") return;
    if (!/^https?:\/\/[^/?#\s]+/i.test(autoAddress)) return;
    if (stampRef.current === `${autoAddress}\n${autoKey}`) return;
    const timer = setTimeout(() => void loadModels(autoAddress, autoKey), 700);
    return () => clearTimeout(timer);
    // The catalogue is fetched once per address/key pair; typing only restarts
    // the debounce timer, so the deps deliberately track the raw values.
  }, [w.settings, section, autoAddress, autoKey]);
  if (!preferences) return null;
  const address = (preferences.AIURL || "").trim();
  const addressError =
    address && !/^https?:\/\/[^/?#\s]+/i.test(address)
      ? t("Enter an http(s) address.")
      : "";
  const endpoint =
    address && !addressError
      ? `${address.replace(/\/+$/, "").replace(/\/models$/i, "")}/models`
      : "";
  const chosenModel = (preferences.AIModel || "").trim();
  const shownModels =
    modelsStamp && modelsStamp === `${address}\n${autoKey}` ? models : [];
  function select(
    key: keyof Preferences,
    label: string,
    options: [string, string][],
    hint?: string,
  ) {
    return (
      <Field label={t(label)} hint={hint ? t(hint) : undefined}>
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
            <div className="grid gap-1.5">
              <p className="text-[11px] text-muted-foreground">
                {t(
                  "Point MyGit at any OpenAI-compatible endpoint, fetch its model list, then pick the model to use.",
                )}
              </p>
              {endpoint && (
                <p className="select-text break-all font-mono text-[11px] text-muted-foreground/80">
                  {t("Model list")}: {endpoint}
                </p>
              )}
            </div>
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
              <div className="relative">
                <Input
                  aria-label={t("API Key")}
                  className="pr-10"
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
                <div className="absolute top-1/2 right-1 -translate-y-1/2">
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
              </div>
            </Field>
            <Field
              label={t("Model")}
              hint={t("Leave it empty to use the endpoint default.")}
            >
              <div className="relative">
                {shownModels.length ? (
                  <Select
                    value={chosenModel || "__none__"}
                    onValueChange={(value) =>
                      setPreferences(
                        (p) =>
                          p && {
                            ...p,
                            AIModel: value === "__none__" ? "" : value,
                          },
                      )
                    }
                  >
                    <SelectTrigger
                      className="w-full pr-10"
                      aria-label={t("Model")}
                    >
                      <SelectValue placeholder={t("Choose a model")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">
                        {t("Endpoint default")}
                      </SelectItem>
                      {shownModels.map((model) => (
                        <SelectItem key={model.ID} value={model.ID}>
                          {model.ID}
                        </SelectItem>
                      ))}
                      {chosenModel &&
                        !shownModels.some((m) => m.ID === chosenModel) && (
                          <SelectItem value={chosenModel}>
                            {chosenModel}
                          </SelectItem>
                        )}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    aria-label={t("Model")}
                    className="pr-10"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={t("For example deepseek-chat.")}
                    value={preferences!.AIModel || ""}
                    onChange={(e) =>
                      setPreferences(
                        (p) => p && { ...p, AIModel: e.target.value },
                      )
                    }
                  />
                )}
                <div className="absolute top-1/2 right-1 -translate-y-1/2">
                  <IconButton
                    label="Fetch models"
                    disabled={loadingModels || !address || !!addressError}
                    onClick={() => void loadModels(address, autoKey, true)}
                  >
                    {loadingModels ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                  </IconButton>
                </div>
              </div>
              <div className="min-h-4 text-[11px]" aria-live="polite">
                {loadingModels ? (
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" />
                    {t("Loading models…")}
                  </span>
                ) : modelError ? (
                  <span role="alert" className="text-destructive">
                    {modelError}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    {shownModels.length
                      ? `${shownModels.length} ${t("models available")}`
                      : t(
                          "Fetch the list to choose a model instead of typing its identifier.",
                        )}
                  </span>
                )}
              </div>
            </Field>
            <Field
              label={t("Commit message prompt")}
              hint={t(
                "Leave it empty to use the built-in prompt, which asks for English.",
              )}
            >
              <Textarea
                aria-label={t("Commit message prompt")}
                className="h-28 resize-none overflow-y-auto font-mono text-[11px]"
                style={{ fieldSizing: "fixed" } as CSSProperties}
                spellCheck={false}
                placeholder={t("Write the prompt in the language and style you want.")}
                value={preferences!.AICommitPrompt || ""}
                onChange={(e) =>
                  setPreferences(
                    (p) => p && { ...p, AICommitPrompt: e.target.value },
                  )
                }
              />
              <div className="grid gap-1">
                {defaultPrompt && (
                  <details className="text-[11px] text-muted-foreground">
                    <summary className="w-fit cursor-pointer select-none">
                      {t("Show the built-in prompt")}
                    </summary>
                    <p className="mt-1 whitespace-pre-wrap select-text">
                      {defaultPrompt}
                    </p>
                  </details>
                )}
                {(preferences!.AICommitPrompt || "").trim() !== "" && (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto w-fit px-0 text-[11px]"
                    onClick={() =>
                      setPreferences((p) => p && { ...p, AICommitPrompt: "" })
                    }
                  >
                    {t("Restore the built-in prompt")}
                  </Button>
                )}
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
      case "about":
        return (
          <div className="grid gap-4 text-xs">
            <div className="flex items-center gap-3">
              <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <GitBranch className="size-7" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{APP_NAME}</span>
                  <span className="rounded-full border px-1.5 py-px text-[10px] text-muted-foreground">
                    v{APP_VERSION}
                  </span>
                </div>
              </div>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {t(
                "Manage several repositories and all of their worktrees in one window: browse history and refs, review diffs and blame, run Git operations, and keep multi-tab terminals side by side.",
              )}
            </p>
            <div className="grid gap-2 border-t pt-3">
              <Button
                type="button"
                className="w-full"
                disabled={update.checking}
                onClick={() => void checkForUpdates(false)}
              >
                {update.checking ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                {update.checking
                  ? t("Checking for updates…")
                  : t("Check for updates")}
              </Button>
              {update.info &&
                (update.manual || update.info.Available) && (
                <div
                  role="status"
                  className="grid gap-2 rounded-md border bg-muted/30 px-3 py-2 text-[11px]"
                >
                  {update.info.Available ? (
                    <>
                      <span>
                        {t("A new version is available:")}{" "}
                        <span className="select-text font-medium">
                          v{update.info.Latest}
                        </span>
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
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <Loader2 className="size-3 animate-spin" />
                          {t("MyGit will restart to finish installing.")}
                        </span>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        className="w-full"
                        disabled={
                          update.phase === "downloading" ||
                          update.phase === "installing"
                        }
                        onClick={() => void startUpdate()}
                      >
                        {update.phase === "downloading" ||
                        update.phase === "installing" ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Download className="size-4" />
                        )}
                        {update.phase === "downloading"
                          ? `${t("Downloading update…")}${update.percent > 0 ? ` ${update.percent}%` : ""}`
                          : update.phase === "installing"
                            ? t("Starting the installer…")
                            : update.phase === "error"
                              ? t("Retry")
                              : t("Download and install")}
                      </Button>
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      {t("You're running the latest version.")}{" "}
                      <span className="select-text">
                        v{update.info.Current || APP_VERSION}
                      </span>
                    </span>
                  )}
                </div>
              )}
              {update.error && (
                <span role="alert" className="text-[11px] text-destructive">
                  {update.error}
                </span>
              )}
              <div className="grid gap-1 pt-1">
                <button
                  type="button"
                  className="nav-row text-xs"
                  aria-label={t("Project homepage")}
                  onClick={() => report(Desktop.OpenURL(APP_REPOSITORY))}
                >
                  <Github />
                  <span className="min-w-0 flex-1 truncate text-left">
                    {t("Project homepage")}
                  </span>
                  <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                </button>
                <button
                  type="button"
                  className="nav-row text-xs"
                  aria-label={t("Report an issue")}
                  onClick={() => report(Desktop.OpenURL(APP_ISSUES))}
                >
                  <MessageSquare />
                  <span className="min-w-0 flex-1 truncate text-left">
                    {t("Report an issue")}
                  </span>
                  <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                </button>
                <button
                  type="button"
                  className="nav-row text-xs"
                  aria-label={t("MIT License")}
                  onClick={() => report(Desktop.OpenURL(APP_LICENSE_URL))}
                >
                  <Scale />
                  <span className="min-w-0 flex-1 truncate text-left">
                    {t("MIT License")}
                  </span>
                  <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                </button>
              </div>
              <span className="select-text break-all px-1 text-[10px] text-muted-foreground">
                {APP_REPOSITORY}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {t("Copyright 2026 MyGit contributors.")}
            </p>
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
            {select(
              "DefaultView",
              "Default view",
              [
                ["git", "Git"],
                ["terminal", "Terminal"],
              ],
              "Choose which tab MyGit opens with.",
            )}
            <label className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
              <Checkbox
                className="mt-0.5"
                aria-label={t("Quit reminder")}
                checked={preferences!.CloseConfirm}
                onCheckedChange={(value) =>
                  setPreferences((p) => p && { ...p, CloseConfirm: value === true })
                }
              />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{t("Quit reminder")}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {t("Ask what to do when closing the window.")}
                </span>
              </span>
            </label>
          </div>
        );
    }
  }
  return (
    <Dialog open={w.settings} onOpenChange={w.setSettings}>
      <DialogContent className="grid-rows-[auto_minmax(0,1fr)] h-[34rem] max-h-[calc(100vh-2rem)] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>{t("Settings")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
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
          <div className="flex min-h-0 min-w-0 flex-1">
            <nav
              aria-label={t("Settings")}
              className="flex w-40 shrink-0 flex-col gap-1 overflow-y-auto border-r bg-muted/30 p-2 text-xs"
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
            <div className="min-w-0 flex-1 overflow-y-auto p-6 [scrollbar-gutter:stable]">{panel()}</div>
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
