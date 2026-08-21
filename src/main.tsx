import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import "@fontsource-variable/bricolage-grotesque"
import { App } from "./client/app/App"
import { ThemeProvider } from "./client/hooks/useTheme"
import { TypographyProvider } from "./client/hooks/useTypography"
import "@xterm/xterm/css/xterm.css"
import "./index.css"

const container = document.getElementById("root")

if (!container) {
  throw new Error("Missing #root")
}

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <TypographyProvider>
          <App />
        </TypographyProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>
)
