import { expect, test } from "vite-plus/test"
import { renderToStaticMarkup } from "react-dom/server"
import { AutoResumeToggleSection } from "./AutoResumeToggleSection"
import { usePreferencesStore } from "../stores/preferences"

test("AutoResumeToggleSection renders checked and unchecked based on props", () => {
  usePreferencesStore.setState({ autoResumeOnRateLimit: false })
  const stateOff = usePreferencesStore.getState()
  const htmlUnchecked = renderToStaticMarkup(
    <AutoResumeToggleSection
      checked={stateOff.autoResumeOnRateLimit}
      onChange={() => {}}
    />
  )
  expect(htmlUnchecked).toContain("Enabled")
  expect(htmlUnchecked).toContain('type="checkbox"')
  expect(htmlUnchecked).not.toContain("checked")

  usePreferencesStore.setState({ autoResumeOnRateLimit: true })
  const stateOn = usePreferencesStore.getState()
  const htmlChecked = renderToStaticMarkup(
    <AutoResumeToggleSection
      checked={stateOn.autoResumeOnRateLimit}
      onChange={() => {}}
    />
  )
  expect(htmlChecked).toContain("Enabled")
  expect(htmlChecked).toContain('type="checkbox"')
  expect(htmlChecked).toContain("checked")
})
