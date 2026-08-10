import { describe, expect, test } from "bun:test"
import { createMermaidGuard, type MermaidGuardDeps } from "./mermaid-guard"
import type { MermaidParsePort } from "../shared/mermaid-validation"

const BROKEN = 'flowchart TD\n  A --> B[/opt/app/current symlink]'
const FIXED = 'flowchart TD\n  A --> B["/opt/app/current symlink"]'
/** Repairable by the client's link pass, so the reader sees a diagram anyway. */
const DOTTED = "flowchart LR\n  A[a] -.x B[b]"

const fence = (source: string) => `Here you go:\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`

/** Rejects the `[/`-shaped label and the short dotted link, accepts the rest. */
const fakeParse: MermaidParsePort = (source) => {
  if (/\[\/[^\]]*[^/\\]\]/.test(source)) {
    return Promise.resolve({ ok: false, raw: "Lexical error on line 2. Unrecognized text.\n...\n---^" })
  }
  if (source.includes("-.x")) {
    return Promise.resolve({ ok: false, raw: "Parse error on line 2:\n...\n---^\nExpecting 'PIPE'" })
  }
  return Promise.resolve({ ok: true })
}

interface Harness {
  deps: MermaidGuardDeps
  sent: { chatId: string; content: string; scheduleId: string | undefined }[]
}

function harness(over: Partial<MermaidGuardDeps> = {}): Harness {
  const sent: Harness["sent"] = []
  const deps: MermaidGuardDeps = {
    enabled: true,
    parse: fakeParse,
    // Mirrors the client's link repair: `-.x` becomes `-.-x`, nothing else.
    repair: (source) =>
      source.includes("-.x")
        ? { source: source.replaceAll("-.x", "-.-x"), repaired: true }
        : { source, repaired: false },
    hasQueuedMessage: () => false,
    enqueueMessage: (chatId, content, options) => {
      sent.push({ chatId, content, scheduleId: options?.autoContinue?.scheduleId })
      return Promise.resolve()
    },
    ...over,
  }
  return { deps, sent }
}

describe("createMermaidGuard", () => {
  test("says nothing when every diagram parses", async () => {
    const { deps, sent } = harness()
    await createMermaidGuard(deps).check("c1", [fence(FIXED)])
    expect(sent).toEqual([])
  })

  test("says nothing when the message has no mermaid fence", async () => {
    const { deps, sent } = harness()
    await createMermaidGuard(deps).check("c1", ["prose\n```ts\nconst a = 1\n```"])
    expect(sent).toEqual([])
  })

  test("asks the model to fix a diagram that will not render", async () => {
    const { deps, sent } = harness()
    await createMermaidGuard(deps).check("c1", [fence(BROKEN)])

    expect(sent).toHaveLength(1)
    expect(sent[0]?.chatId).toBe("c1")
    expect(sent[0]?.content).toContain("1 mermaid diagram")
    expect(sent[0]?.content).toContain("parallelogram")
    expect(sent[0]?.scheduleId).toBeTruthy()
  })

  // The client rewrites `-.x` to `-.-x` and renders the diagram with an honest
  // correction banner, so the reader already has a diagram. Spending a whole
  // turn on it would be pure cost.
  test("spends no turn on a diagram the client's repair already saves", async () => {
    const { deps, sent } = harness()
    await createMermaidGuard(deps).check("c1", [fence(DOTTED)])
    expect(sent).toEqual([])
  })

  test("puts every failing diagram from a turn in one message", async () => {
    const { deps, sent } = harness()
    await createMermaidGuard(deps).check("c1", [
      fence(BROKEN),
      `${fence(FIXED)}\n${fence(BROKEN.replace("app", "other"))}`,
    ])

    expect(sent).toHaveLength(1)
    expect(sent[0]?.content).toContain("2 mermaid diagrams")
  })

  // A model that cannot fix its own diagram would otherwise be asked forever.
  test("retries a given diagram exactly once", async () => {
    const { deps, sent } = harness()
    const guard = createMermaidGuard(deps)

    await guard.check("c1", [fence(BROKEN)])
    await guard.check("c1", [fence(BROKEN)])

    expect(sent).toHaveLength(1)
  })

  test("remembers per chat, so another chat still gets its correction", async () => {
    const { deps, sent } = harness()
    const guard = createMermaidGuard(deps)

    await guard.check("c1", [fence(BROKEN)])
    await guard.check("c2", [fence(BROKEN)])

    expect(sent.map((s) => s.chatId)).toEqual(["c1", "c2"])
  })

  // The user's own message must not wait behind a housekeeping correction.
  test("stands aside when a user message is already queued", async () => {
    const { deps, sent } = harness({ hasQueuedMessage: () => true })
    await createMermaidGuard(deps).check("c1", [fence(BROKEN)])
    expect(sent).toEqual([])
  })

  test("does nothing at all when disabled", async () => {
    const { deps, sent } = harness({ enabled: false })
    await createMermaidGuard(deps).check("c1", [fence(BROKEN)])
    expect(sent).toEqual([])
  })

  // A cosmetic guard must never take a turn down with it.
  test("swallows a parser failure rather than failing the turn", async () => {
    const { deps, sent } = harness({ parse: () => Promise.reject(new Error("boom")) })
    await createMermaidGuard(deps).check("c1", [fence(BROKEN)])
    expect(sent).toEqual([])
  })

  test("swallows an enqueue failure", async () => {
    const { deps } = harness({ enqueueMessage: () => Promise.reject(new Error("boom")) })
    await createMermaidGuard(deps).check("c1", [fence(BROKEN)])
  })
})
