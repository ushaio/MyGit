import { useSyncExternalStore } from "react";
import { Events } from "@wailsio/runtime";
import { Lifecycle, type UpdateInfo } from "@/lib/api";
import { errorMessage } from "@/lib/utils";

/**
 * A tiny shared store for the update flow. The floating prompt and the About
 * page both read from it, so a download started in either place shows the same
 * progress and never runs twice.
 */
export type UpdatePhase = "idle" | "available" | "downloading" | "installing" | "error";

export type UpdateState = {
  phase: UpdatePhase;
  info: UpdateInfo | null;
  percent: number;
  error: string;
  dismissed: boolean;
  checking: boolean;
  manual: boolean;
};

let state: UpdateState = {
  phase: "idle",
  info: null,
  percent: 0,
  error: "",
  dismissed: false,
  checking: false,
  manual: false,
};

const listeners = new Set<() => void>();

function setState(patch: Partial<UpdateState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot() {
  return state;
}

export function useUpdate(): UpdateState {
  return useSyncExternalStore(subscribe, snapshot);
}

let watchingProgress = false;
function watchProgress() {
  if (watchingProgress) return;
  watchingProgress = true;
  Events.On("update:progress", (event: unknown) => {
    const payload = (event as { data?: { percent?: number } })?.data ?? (event as { percent?: number });
    const percent = typeof payload?.percent === "number" ? payload.percent : 0;
    if (percent >= 0) setState({ percent });
  });
}

let pending: Promise<UpdateInfo | null> | null = null;

/** Checks GitHub for a newer release. Auto-start passes silent=true so a
 * transient network error does not open the prompt; the About page shows it. */
export function checkForUpdates(silent = false): Promise<UpdateInfo | null> {
  watchProgress();
  if (pending) return pending;
  setState({ checking: true, error: silent ? state.error : "" });
  pending = (async () => {
    try {
      const info = await Lifecycle.CheckUpdate();
      setState({
        info,
        phase: info.Available ? "available" : "idle",
        error: "",
        dismissed: false,
        manual: !silent,
      });
      return info;
    } catch (error) {
      if (!silent) setState({ phase: "error", error: errorMessage(error) });
      return null;
    } finally {
      setState({ checking: false });
    }
  })().finally(() => {
    pending = null;
  });
  return pending;
}

export function dismissUpdate() {
  setState({ dismissed: true });
}

export async function startUpdate() {
  if (state.phase === "downloading" || state.phase === "installing") return;
  setState({ phase: "downloading", percent: 0, error: "", dismissed: false });
  try {
    const path = await Lifecycle.DownloadUpdate();
    setState({ phase: "installing" });
    await Lifecycle.InstallUpdate(path);
  } catch (error) {
    setState({ phase: "error", error: errorMessage(error) });
  }
}
