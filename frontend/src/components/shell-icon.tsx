import {
  GitBranch,
  Monitor,
  Shell,
  SquareChevronRight,
  SquareTerminal,
  Terminal as TerminalIcon,
  TerminalSquare,
} from "lucide-react";

// SHELL_ICONS maps a profile id or shell label to the glyph that represents it,
// so a terminal shows the same icon in the sidebar list as it does in the tab
// strip. Keys are lower-cased; both the profile ID ("pwsh") and the human label
// ("PowerShell 7") are looked up.
const SHELL_ICONS: Record<string, typeof TerminalSquare> = {
  powershell: SquareChevronRight,
  "windows powershell": SquareChevronRight,
  pwsh: SquareChevronRight,
  "powershell 7": SquareChevronRight,
  gitbash: GitBranch,
  "git bash": GitBranch,
  wsl: Monitor,
  cmd: SquareTerminal,
  "command prompt": SquareTerminal,
  bash: TerminalIcon,
  zsh: Shell,
};

export function ShellIcon({
  profile,
  shell,
}: {
  profile: string;
  shell: string;
}) {
  const Icon =
    SHELL_ICONS[(profile || "").toLowerCase()] ||
    SHELL_ICONS[(shell || "").toLowerCase()] ||
    TerminalSquare;
  return <Icon className="size-3.5 shrink-0" aria-hidden />;
}
