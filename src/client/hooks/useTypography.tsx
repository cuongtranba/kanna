// Applies the resolved typography scale to the document as CSS custom
// properties, and caches the server-provided default for pre-paint reads.
//
// Deliberately a SEPARATE module from useTheme.tsx: ~10 component tests
// `mock.module` the theme hook wholesale (e.g. TextMessage.test.tsx), and
// widening ThemeContextValue to carry typography would break every one of
// them. See docs/tribe/planning/typography-scale-preference-plan.md, Task 8.

import { useEffect, type ReactNode } from "react"
import { useAppSettingsStore } from "../stores/appSettingsStore"
import { usePreferencesStore } from "../stores/preferences"
import { resolveEffectiveScaleStep, resolveTypographyVars } from "../../shared/design/typography"
import type { DomPort } from "../ports/domPort"
import { domAdapter } from "../adapters/dom.adapter"

export function TypographyProvider({ children, dom = domAdapter }: { children: ReactNode; dom?: DomPort }) {
  const serverDefault = useAppSettingsStore((s) => s.settings?.typography?.scale)
  const deviceOverride = usePreferencesStore((s) => s.typographyOverride)
  const cacheTypographyServerDefault = usePreferencesStore((s) => s.cacheTypographyServerDefault)
  const step = resolveEffectiveScaleStep(deviceOverride, serverDefault)

  useEffect(() => {
    for (const [property, value] of Object.entries(resolveTypographyVars({ scale: step }))) {
      dom.setDocumentElementStyleProperty(property, value)
    }
  }, [step, dom])

  useEffect(() => {
    if (serverDefault !== undefined) {
      cacheTypographyServerDefault(serverDefault)
    }
  }, [serverDefault, cacheTypographyServerDefault])

  return <>{children}</>
}
