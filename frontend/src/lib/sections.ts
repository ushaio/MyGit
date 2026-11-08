// Sidebar sections remember whether the user left them open. The state is pure
// UI layout, so it lives in localStorage beside the WebView profile instead of
// the workspace file: sections start collapsed on a fresh install and reopen the
// way they were left after a restart.
const prefix = "mygit:section:";

export function storedSectionOpen(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(prefix + key);
    return value === null ? fallback : value === "open";
  } catch {
    return fallback;
  }
}

export function rememberSectionOpen(key: string, open: boolean) {
  try {
    window.localStorage.setItem(prefix + key, open ? "open" : "closed");
  } catch {
    // A locked or private profile only loses the remembered layout.
  }
}
