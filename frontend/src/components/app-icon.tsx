// AppIcon renders the real application brand mark for each "open project"
// method, so the toolbar/dropdown shows the target app's icon instead of a
// generic glyph. Rendered as inline SVG (no external asset fetches) so it works
// offline and inherits sizing from the className.
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { className?: string };

function base(className?: string): SVGProps<SVGSVGElement> {
  return {
    viewBox: "0 0 24 24",
    className: `size-3.5 shrink-0 ${className ?? ""}`.trim(),
    "aria-hidden": true,
    focusable: false,
  };
}

// VS Code — official logo mark.
export function VSCodeIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...base(className)} {...rest}>
      <path
        fill="#0065A9"
        d="M23.15 2.587 18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z"
      />
      <path
        fill="#007ACC"
        d="M18.004 17.448 10.826 12l7.178-5.448v10.896zM10.826 12 .326 8.74v4.617L7.066 12l-6.74-1.357v4.617L10.826 12z"
        opacity=".35"
      />
    </svg>
  );
}

// Windows File Explorer — the familiar yellow folder with the blue taskbar band.
export function FileExplorerIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...base(className)} {...rest}>
      <path
        fill="#FFD04B"
        d="M2 6.5A1.5 1.5 0 0 1 3.5 5h5.19a1.5 1.5 0 0 1 1.06.44l1.06 1.06H20.5A1.5 1.5 0 0 1 22 8v1H2V6.5z"
      />
      <path
        fill="#FFCE3A"
        d="M2 9h20v8.5A1.5 1.5 0 0 1 20.5 19h-17A1.5 1.5 0 0 1 2 17.5V9z"
      />
      <path
        fill="#1C9BF0"
        d="M2 13.5h20V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3.5z"
      />
      <path
        fill="#0F7BD8"
        d="M2 16h20v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1z"
        opacity=".55"
      />
    </svg>
  );
}

// Browser — Chromium-style tricolour globe.
export function BrowserIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...base(className)} {...rest}>
      <circle cx="12" cy="12" r="10" fill="#fff" />
      <path
        fill="#EA4335"
        d="M12 2a10 10 0 0 0-8.66 5H12a5 5 0 0 1 4.33 2.5l2.6-4.5A9.96 9.96 0 0 0 12 2z"
      />
      <path
        fill="#34A853"
        d="M21.66 7A10 10 0 0 1 12 22l.01 0 5-8.66A5 5 0 0 0 17 8.5l4.66-1.5z"
      />
      <path fill="#FBBC05" d="M2.34 7A10 10 0 0 0 12 22l-5-8.66A5 5 0 0 1 7 8.5L2.34 7z" />
      <circle cx="12" cy="12" r="4.2" fill="#4285F4" />
      <circle cx="12" cy="12" r="2.1" fill="#fff" opacity=".85" />
    </svg>
  );
}

// Terminal — Windows Terminal tile mark.
export function TerminalAppIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...base(className)} {...rest}>
      <rect x="2" y="4" width="20" height="16" rx="2.5" fill="#0C2D48" />
      <path
        fill="#2B9BF4"
        d="M6.2 8.1a.9.9 0 0 1 1.27.06l2.4 2.6a1 1 0 0 1 0 1.34l-2.4 2.6a.9.9 0 1 1-1.33-1.2L7.9 12 6.14 9.36a.9.9 0 0 1 .06-1.26z"
      />
      <rect x="11" y="13.6" width="6" height="1.8" rx=".9" fill="#E6EDF3" />
      <path
        stroke="#4FC3F7"
        strokeWidth=".6"
        fill="none"
        d="M2.6 4.6h18.8"
        opacity=".4"
      />
    </svg>
  );
}
