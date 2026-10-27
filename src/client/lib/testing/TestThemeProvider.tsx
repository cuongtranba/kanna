import type { ReactNode } from "react"
import { makeFakeDomPort } from "../../adapters/testing/makeFakePorts"
import type { DomPort } from "../../ports/domPort"
import { ThemeProvider } from "../../hooks/useTheme"

const LIGHT_DOM: DomPort = { ...makeFakeDomPort(), matchesMediaQuery: () => false }
const DARK_DOM: DomPort = { ...makeFakeDomPort(), matchesMediaQuery: () => true }

export function TestThemeProvider({ dark = false, children }: { dark?: boolean; children: ReactNode }) {
  return <ThemeProvider dom={dark ? DARK_DOM : LIGHT_DOM}>{children}</ThemeProvider>
}
