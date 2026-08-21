import { afterEach, describe, expect, test } from "bun:test"
import { renderClientMarkup } from "../lib/testing/renderClientMarkup"
import { renderForLoopCheck } from "../lib/testing/renderForLoopCheck"
import { makeFakeDomPort } from "../adapters/testing/makeFakePorts"
import { useAppSettingsStore } from "../stores/appSettingsStore"
import { usePreferencesStore } from "../stores/preferences"
import type { AppSettingsSnapshot } from "../../shared/types"
import { TypographyProvider } from "./useTypography"

function setServerScale(scale: string): void {
  useAppSettingsStore.setState({
    settings: { typography: { scale } } as unknown as AppSettingsSnapshot,
  })
}

afterEach(() => {
  useAppSettingsStore.setState({ settings: null })
  usePreferencesStore.setState({ typographyOverride: undefined, typographyServerDefaultCache: undefined })
})

describe("TypographyProvider", () => {
  test("defaults --kanna-font-scale to 1 with no override and no server default", async () => {
    const dom = makeFakeDomPort()
    const { cleanup } = await renderClientMarkup(
      <TypographyProvider dom={dom}>
        <div />
      </TypographyProvider>,
    )
    await cleanup()

    expect(dom.documentElementStyles.get("--kanna-font-scale")).toBe("1")
  })

  test("applies the server default alone", async () => {
    setServerScale("lg")
    const dom = makeFakeDomPort()
    const { cleanup } = await renderClientMarkup(
      <TypographyProvider dom={dom}>
        <div />
      </TypographyProvider>,
    )
    await cleanup()

    expect(dom.documentElementStyles.get("--kanna-font-scale")).toBe("1.125")
  })

  test("a device override wins over the server default", async () => {
    setServerScale("lg")
    usePreferencesStore.setState({ typographyOverride: "xxl" })
    const dom = makeFakeDomPort()
    const { cleanup } = await renderClientMarkup(
      <TypographyProvider dom={dom}>
        <div />
      </TypographyProvider>,
    )
    await cleanup()

    expect(dom.documentElementStyles.get("--kanna-font-scale")).toBe("1.5")
  })

  test("clearing the override falls back to the server value", async () => {
    setServerScale("lg")
    usePreferencesStore.setState({ typographyOverride: "xxl" })
    const dom = makeFakeDomPort()

    const first = await renderClientMarkup(
      <TypographyProvider dom={dom}>
        <div />
      </TypographyProvider>,
    )
    await first.cleanup()
    expect(dom.documentElementStyles.get("--kanna-font-scale")).toBe("1.5")

    usePreferencesStore.getState().clearTypographyOverride()
    const second = await renderClientMarkup(
      <TypographyProvider dom={dom}>
        <div />
      </TypographyProvider>,
    )
    await second.cleanup()

    expect(dom.documentElementStyles.get("--kanna-font-scale")).toBe("1.125")
  })

  test("caches the server default for pre-paint reads only when one is present", async () => {
    const dom = makeFakeDomPort()

    const noServer = await renderClientMarkup(
      <TypographyProvider dom={dom}>
        <div />
      </TypographyProvider>,
    )
    await noServer.cleanup()
    expect(usePreferencesStore.getState().typographyServerDefaultCache).toBeUndefined()

    setServerScale("xl")
    const withServer = await renderClientMarkup(
      <TypographyProvider dom={dom}>
        <div />
      </TypographyProvider>,
    )
    await withServer.cleanup()
    expect(usePreferencesStore.getState().typographyServerDefaultCache).toBe("xl")
  })

  test("mounts without triggering an update-depth loop", async () => {
    setServerScale("md")
    const dom = makeFakeDomPort()
    const result = await renderForLoopCheck(
      <TypographyProvider dom={dom}>
        <div />
      </TypographyProvider>,
    )
    try {
      expect(result.loopWarnings).toEqual([])
    } finally {
      await result.cleanup()
    }
  })
})
