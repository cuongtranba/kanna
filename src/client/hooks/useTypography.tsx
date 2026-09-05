
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
