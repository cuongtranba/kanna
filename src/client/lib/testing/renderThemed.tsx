import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { TestThemeProvider } from "./TestThemeProvider"

export function renderThemed(node: ReactNode, dark = false): string {
  return renderToStaticMarkup(<TestThemeProvider dark={dark}>{node}</TestThemeProvider>)
}
