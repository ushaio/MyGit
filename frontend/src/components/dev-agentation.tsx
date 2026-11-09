import { lazy, Suspense } from "react";

// Agentation is a development-only visual feedback toolbar. It is loaded lazily
// and only when Vite runs in dev mode; in a production build
// `import.meta.env.DEV` is statically false, so this resolves to null and the
// toolbar (and its chunk) is never loaded or rendered.
const Agentation = import.meta.env.DEV
  ? lazy(() => import("agentation").then((m) => ({ default: m.Agentation })))
  : null;

export function DevAgentation() {
  if (!Agentation) return null;
  return (
    <Suspense fallback={null}>
      <Agentation />
    </Suspense>
  );
}
