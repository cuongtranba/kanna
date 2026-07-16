import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { useAppSettingsStore } from "../stores/appSettingsStore"
import type { DomPort } from "../ports/domPort"
import { domAdapter } from "../adapters/dom.adapter"

export type ThemePreference = "light" | "dark" | "system"

interface ThemeContextValue {
  theme: ThemePreference
  resolvedTheme: "light" | "dark"
  setTheme: (theme: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

const isValidTheme = (value: string | null): value is ThemePreference => {
  return value === "light" || value === "dark" || value === "system"
}

export function getAppleMobileWebAppStatusBarStyle(theme: "light" | "dark") {
  return theme === "dark" ? "black-translucent" : "default"
}

function upsertHeadMeta(name: string, content: string, dom: DomPort) {
  dom.upsertHeadMeta(name, content)
}

export function syncThemeMetadata(theme: "light" | "dark", dom: DomPort = domAdapter) {
  const backgroundColor = dom.getComputedBackgroundColor()
  if (backgroundColor) {
    upsertHeadMeta("theme-color", backgroundColor, dom)
  }
  upsertHeadMeta("apple-mobile-web-app-status-bar-style", getAppleMobileWebAppStatusBarStyle(theme), dom)
  dom.setDocumentElementColorScheme(theme)
}

const getSystemTheme = (dom: DomPort = domAdapter): "light" | "dark" => {
  return dom.matchesMediaQuery("(prefers-color-scheme: dark)") ? "dark" : "light"
}

const applyThemeClass = (preference: ThemePreference, dom: DomPort = domAdapter) => {
  const resolved = preference === "system" ? getSystemTheme(dom) : preference
  dom.toggleDocumentElementClass("dark", resolved === "dark")
}

const getInitialTheme = (): ThemePreference => {
  const stored = useAppSettingsStore.getState().settings?.theme
  return stored && isValidTheme(stored) ? stored : "system"
}

export function ThemeProvider({ children, dom = domAdapter }: { children: ReactNode; dom?: DomPort }) {
  const settingsTheme = useAppSettingsStore((store) => store.settings?.theme)
  const applyOptimisticPatch = useAppSettingsStore((store) => store.applyOptimisticPatch)
  const [theme, setTheme] = useState<ThemePreference>(getInitialTheme)

  useEffect(() => {
    if (!settingsTheme || settingsTheme === theme) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(settingsTheme)
  }, [settingsTheme, theme])

  useEffect(() => {
    applyThemeClass(theme, dom)
  }, [theme, dom])

  useEffect(() => {
    const resolvedTheme = theme === "system" ? getSystemTheme(dom) : theme
    syncThemeMetadata(resolvedTheme, dom)
  }, [theme, dom])

  useEffect(() => {
    if (theme !== "system") return
    return dom.addMediaQueryListener("(prefers-color-scheme: dark)", () => {
      applyThemeClass("system", dom)
      syncThemeMetadata(getSystemTheme(dom), dom)
    })
  }, [theme, dom])

  const value = useMemo<ThemeContextValue>(() => {
    const resolvedTheme = theme === "system" ? getSystemTheme(dom) : theme
    return {
      theme,
      resolvedTheme,
      setTheme: (nextTheme) => {
        setTheme(nextTheme)
        applyOptimisticPatch({ theme: nextTheme })
      },
    }
  }, [applyOptimisticPatch, theme, dom])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider")
  }
  return context
}
