import { describe, expect, test, mock, beforeEach } from "bun:test"
import { act } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { OAuthTokenPoolCard } from "./OAuthTokenPoolCard"
import { renderClientMarkup } from "../../lib/testing/renderClientMarkup"
import { useOAuthTokenPoolCardStore } from "../../stores/oauthTokenPoolCardStore"
import type { ClaudeAuthSettings, OAuthTokenEntry } from "../../../shared/types"

function makeToken(overrides: Partial<OAuthTokenEntry> = {}): OAuthTokenEntry {
  return {
    id: "t1",
    label: "primary",
    token: "sk-ant-abcdefghijklmnopqrstuvwxyz",
    status: "active",
    limitedUntil: null,
    lastUsedAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
    addedAt: 0,
    ...overrides,
  }
}

describe("OAuthTokenPoolCard", () => {
  test("renders empty state with the inline add form", () => {
    const html = renderToStaticMarkup(
      <OAuthTokenPoolCard
        concurrencyDefault={1}
        tokens={[]}
        onWrite={async () => {}}
        onTest={async () => ({ ok: true, error: null })}
      />,
    )
    expect(html).toContain("Add token")
    expect(html).toContain('placeholder="e.g. personal"')
    expect(html).toContain('placeholder="sk-ant-..."')
  })

  test("renders one row per token with masked value and label", () => {
    const html = renderToStaticMarkup(
      <OAuthTokenPoolCard
        concurrencyDefault={1}
        tokens={[makeToken()]}
        onWrite={async () => {}}
        onTest={async () => ({ ok: true, error: null })}
      />,
    )
    expect(html).toContain("primary")
    expect(html).toContain("sk-ant-…wxyz")
  })

  test("renders Active pill for active tokens", () => {
    const html = renderToStaticMarkup(
      <OAuthTokenPoolCard
        concurrencyDefault={1}
        tokens={[makeToken({ status: "active" })]}
        onWrite={async () => {}}
        onTest={async () => ({ ok: true, error: null })}
      />,
    )
    expect(html).toContain("Active")
  })

  test("renders Limited pill with countdown for limited tokens", () => {
    const limited = makeToken({ status: "limited", limitedUntil: 60_000 })
    const html = renderToStaticMarkup(
      <OAuthTokenPoolCard
        concurrencyDefault={1}
        tokens={[limited]}
        now={0}
        onWrite={async () => {}}
        onTest={async () => ({ ok: true, error: null })}
      />,
    )
    expect(html).toContain("Limited")
    expect(html).toContain("reset in 1m 00s")
  })

  test("renders Error pill for error tokens", () => {
    const errToken = makeToken({ status: "error", lastErrorMessage: "rate limit exceeded" })
    const html = renderToStaticMarkup(
      <OAuthTokenPoolCard
        concurrencyDefault={1}
        tokens={[errToken]}
        onWrite={async () => {}}
        onTest={async () => ({ ok: true, error: null })}
      />,
    )
    expect(html).toContain("Error")
    expect(html).toContain("rate limit exceeded")
  })

  test("Add button is present and disabled when inputs are blank", () => {
    const html = renderToStaticMarkup(
      <OAuthTokenPoolCard
        concurrencyDefault={1}
        tokens={[]}
        onWrite={async () => {}}
        onTest={async () => ({ ok: true, error: null })}
      />,
    )
    expect(html).toContain("Add token")
    expect(html).toContain("disabled")
  })

  test("renders Test and Remove buttons for each token row", () => {
    const html = renderToStaticMarkup(
      <OAuthTokenPoolCard
        concurrencyDefault={1}
        tokens={[makeToken()]}
        onWrite={async () => {}}
        onTest={async () => ({ ok: true, error: null })}
      />,
    )
    expect(html).toContain("Test")
    expect(html).toContain("Remove")
  })

  test("concurrency inputs carry a minimum but no upper bound", () => {
    const html = renderToStaticMarkup(
      <OAuthTokenPoolCard
        concurrencyDefault={12}
        tokens={[makeToken({ maxConcurrent: 30 })]}
        onWrite={async () => {}}
        onTest={async () => ({ ok: true, error: null })}
      />,
    )
    expect(html).toContain('value="12"')
    expect(html).toContain('value="30"')
    expect(html).toContain('min="1"')
    expect(html).not.toContain("max=")
  })

  test("renders multiple tokens in order", () => {
    const tokens = [
      makeToken({ id: "a", label: "alpha" }),
      makeToken({ id: "b", label: "beta" }),
      makeToken({ id: "c", label: "gamma" }),
    ]
    const html = renderToStaticMarkup(
      <OAuthTokenPoolCard
        concurrencyDefault={1}
        tokens={tokens}
        onWrite={async () => {}}
        onTest={async () => ({ ok: true, error: null })}
      />,
    )
    const alphaIdx = html.indexOf("alpha")
    const betaIdx = html.indexOf("beta")
    const gammaIdx = html.indexOf("gamma")
    expect(alphaIdx).toBeLessThan(betaIdx)
    expect(betaIdx).toBeLessThan(gammaIdx)
  })

  test("Add button calls onWrite with appended token", async () => {
    const calls: Array<Partial<{ tokens: OAuthTokenEntry[] }>> = []
    const onWrite = async (patch: Partial<{ tokens: OAuthTokenEntry[] }>) => {
      calls.push(patch)
    }
    const html = renderToStaticMarkup(
      <OAuthTokenPoolCard
        concurrencyDefault={1}
        tokens={[]}
        onWrite={onWrite}
        onTest={async () => ({ ok: true, error: null })}
      />,
    )
    expect(html).toContain("Add token")
  })

  test("Remove button renders for each token", () => {
    const onWrite = mock(async () => {})
    const html = renderToStaticMarkup(
      <OAuthTokenPoolCard
        concurrencyDefault={1}
        tokens={[makeToken({ id: "a" }), makeToken({ id: "b", label: "other" })]}
        onWrite={onWrite}
        onTest={async () => ({ ok: true, error: null })}
      />,
    )
    const removeCount = (html.match(/aria-label="Remove"/g) ?? []).length
    expect(removeCount).toBe(2)
  })

  test("marks token with highest lastUsedAt as In use", () => {
    const tokens = [
      makeToken({ id: "a", label: "alpha", lastUsedAt: 100 }),
      makeToken({ id: "b", label: "beta", lastUsedAt: 500 }),
      makeToken({ id: "c", label: "gamma", lastUsedAt: 200 }),
    ]
    const html = renderToStaticMarkup(
      <OAuthTokenPoolCard
        concurrencyDefault={1}
        tokens={tokens}
        onWrite={async () => {}}
        onTest={async () => ({ ok: true, error: null })}
      />,
    )
    expect(html).toContain("In use")
    const inUseIdx = html.indexOf("In use")
    const betaIdx = html.indexOf("beta")
    const alphaIdx = html.indexOf("alpha")
    const gammaIdx = html.indexOf("gamma")
    expect(inUseIdx).toBeGreaterThan(betaIdx)
    expect(inUseIdx).toBeLessThan(gammaIdx)
    expect(html.slice(alphaIdx, betaIdx)).not.toContain("In use")
    expect(html.slice(gammaIdx)).not.toContain("In use")
  })

  test("no In use badge when all tokens have null lastUsedAt", () => {
    const tokens = [makeToken({ id: "a" }), makeToken({ id: "b", label: "other" })]
    const html = renderToStaticMarkup(
      <OAuthTokenPoolCard
        concurrencyDefault={1}
        tokens={tokens}
        onWrite={async () => {}}
        onTest={async () => ({ ok: true, error: null })}
      />,
    )
    expect(html).not.toContain("In use")
  })

  test("tabular-nums class applied to countdown", () => {
    const limited = makeToken({ status: "limited", limitedUntil: 60_000 })
    const html = renderToStaticMarkup(
      <OAuthTokenPoolCard
        concurrencyDefault={1}
        tokens={[limited]}
        now={0}
        onWrite={async () => {}}
        onTest={async () => ({ ok: true, error: null })}
      />,
    )
    expect(html).toContain("tabular-nums")
  })

  test("renders Disabled pill for disabled tokens", () => {
    const html = renderToStaticMarkup(
      <OAuthTokenPoolCard
        concurrencyDefault={1}
        tokens={[makeToken({ status: "disabled" })]}
        onWrite={async () => {}}
        onTest={async () => ({ ok: true, error: null })}
      />,
    )
    expect(html).toContain("Disabled")
  })

  test("renders the token's base URL, and an empty field when it has none", () => {
    const html = renderToStaticMarkup(
      <OAuthTokenPoolCard
        concurrencyDefault={1}
        tokens={[
          makeToken({ id: "a", label: "proxied", baseUrl: "https://proxy.example" }),
          makeToken({ id: "b", label: "direct" }),
        ]}
        onWrite={async () => {}}
        onTest={async () => ({ ok: true, error: null })}
      />,
    )
    expect(html).toContain('value="https://proxy.example"')
    expect(html).toContain('placeholder="(default)"')
    expect(html).not.toContain("Must start with")
  })

  test("renders Enable button for disabled, Disable button for active", () => {
    const disabledHtml = renderToStaticMarkup(
      <OAuthTokenPoolCard
        concurrencyDefault={1}
        tokens={[makeToken({ status: "disabled" })]}
        onWrite={async () => {}}
        onTest={async () => ({ ok: true, error: null })}
      />,
    )
    expect(disabledHtml).toContain('aria-label="Enable"')

    const activeHtml = renderToStaticMarkup(
      <OAuthTokenPoolCard
        concurrencyDefault={1}
        tokens={[makeToken({ status: "active" })]}
        onWrite={async () => {}}
        onTest={async () => ({ ok: true, error: null })}
      />,
    )
    expect(activeHtml).toContain('aria-label="Disable"')
  })
})


function type(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  setter?.call(el, value)
  el.dispatchEvent(new Event("input", { bubbles: true }))
}

describe("OAuthTokenPoolCard base URL editing", () => {
  beforeEach(() => {
    useOAuthTokenPoolCardStore.setState({ baseUrlDrafts: {}, addBaseUrl: "" })
  })

  async function renderWithToken(entry: OAuthTokenEntry) {
    const writes: Array<Partial<ClaudeAuthSettings>> = []
    const rendered = await renderClientMarkup(
      <OAuthTokenPoolCard
        concurrencyDefault={1}
        tokens={[entry]}
        onWrite={async (patch) => { writes.push(patch) }}
        onTest={async () => ({ ok: true, error: null })}
      />,
    )
    const input = rendered.container.querySelector<HTMLInputElement>(
      `input[aria-label="Anthropic base URL for ${entry.label}"]`,
    )
    expect(input).not.toBeNull()
    return { writes, rendered, input: input! }
  }

  test("writes the normalized base URL on blur, not on every keystroke", async () => {
    const { writes, rendered, input } = await renderWithToken(makeToken())
    await act(async () => { type(input, "https://proxy.example/") })
    expect(writes).toHaveLength(0)

    await act(async () => { input.dispatchEvent(new Event("focusout", { bubbles: true })) })
    expect(writes).toHaveLength(1)
    expect(writes[0]?.tokens?.[0]?.baseUrl).toBe("https://proxy.example")
    await rendered.cleanup()
  })

  test("an invalid URL keeps the draft, shows a hint, and writes nothing", async () => {
    const { writes, rendered, input } = await renderWithToken(makeToken())
    await act(async () => { type(input, "proxy.example") })
    await act(async () => { input.dispatchEvent(new Event("focusout", { bubbles: true })) })

    expect(writes).toHaveLength(0)
    expect(input.value).toBe("proxy.example")
    expect(rendered.container.innerHTML).toContain("Must start with")
    await rendered.cleanup()
  })

  test("clearing the field removes baseUrl from the entry entirely", async () => {
    const entry = makeToken({ baseUrl: "https://proxy.example" })
    const { writes, rendered, input } = await renderWithToken(entry)
    await act(async () => { type(input, "") })
    await act(async () => { input.dispatchEvent(new Event("focusout", { bubbles: true })) })

    expect(writes).toHaveLength(1)
    expect(writes[0]?.tokens?.[0]).not.toHaveProperty("baseUrl")
    await rendered.cleanup()
  })

  test("an unchanged value writes nothing", async () => {
    const entry = makeToken({ baseUrl: "https://proxy.example" })
    const { writes, rendered, input } = await renderWithToken(entry)
    await act(async () => { input.dispatchEvent(new Event("focusout", { bubbles: true })) })
    expect(writes).toHaveLength(0)
    await rendered.cleanup()
  })

  test("Test passes the token's endpoint so a proxy credential is probed correctly", async () => {
    const onTest = mock(async () => ({ ok: true, error: null }))
    const rendered = await renderClientMarkup(
      <OAuthTokenPoolCard
        concurrencyDefault={1}
        tokens={[makeToken({ baseUrl: "https://proxy.example" })]}
        onWrite={async () => {}}
        onTest={onTest}
      />,
    )
    const testButton = rendered.container.querySelector<HTMLButtonElement>('button[aria-label="Test"]')
    await act(async () => { testButton?.click() })

    expect(onTest).toHaveBeenCalledWith("sk-ant-abcdefghijklmnopqrstuvwxyz", "https://proxy.example")
    await rendered.cleanup()
  })
})
