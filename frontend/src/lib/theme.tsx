import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react"

type Theme = "light" | "dark" | "system"
type ThemeState = { theme: Theme; resolvedTheme: "light" | "dark"; setTheme: (theme: string) => void }
const Context = createContext<ThemeState>({ theme: "system", resolvedTheme: "light", setTheme() {} })

// A client-only theme provider: desktop WebViews do not hydrate server HTML.
export function ThemeProvider({ children, forcedTheme }: { children: ReactNode; forcedTheme?: Theme; attribute?: string; defaultTheme?: string; enableSystem?: boolean; disableTransitionOnChange?: boolean }) {
  const [theme, updateTheme] = useState<Theme>("system")
  const [system, setSystem] = useState<"light" | "dark">(() => window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
  const effective = forcedTheme || theme
  const resolvedTheme = effective === "system" ? system : effective
  const setTheme = useCallback((value: string) => { if (value === "light" || value === "dark" || value === "system") updateTheme(value) }, [])
  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const update = () => setSystem(media.matches ? "dark" : "light")
    media.addEventListener("change", update); update()
    return () => media.removeEventListener("change", update)
  }, [])
  useLayoutEffect(() => { document.documentElement.classList.toggle("dark", resolvedTheme === "dark"); document.documentElement.style.colorScheme = resolvedTheme }, [resolvedTheme])
  const value = useMemo(() => ({ theme: effective, resolvedTheme, setTheme }), [effective, resolvedTheme, setTheme])
  return <Context.Provider value={value}>{children}</Context.Provider>
}
export function useTheme() { return useContext(Context) }
