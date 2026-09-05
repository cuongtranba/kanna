
import { type HostBag, type LoadedModule } from "../shared/dynamic-module"
import { isRecord } from "../shared/errors"
import { createLazyLoader } from "../shared/lazyModule"
import type { MermaidParsePort, MermaidParseResult } from "../shared/mermaid-validation"

interface MermaidModule {
  initialize: (config: { startOnLoad: boolean; securityLevel: "strict" }) => void
  parse: (text: string) => Promise<void>
}

type GlobalBag = HostBag

function stubElement(): GlobalBag {
  return {
    setAttribute: () => undefined,
    appendChild: () => undefined,
    remove: () => undefined,
    style: {},
    content: { ownerDocument: { createElement: () => ({}) } },
  }
}

function stubDocument(): GlobalBag {
  const doc: GlobalBag = {
    nodeType: 9,
    createElement: stubElement,
    createElementNS: stubElement,
    createTextNode: () => ({}),
    documentElement: { attributes: [], namespaceURI: "http://www.w3.org/1999/xhtml" },
    body: { childNodes: [], appendChild: () => undefined, removeChild: () => undefined },
    querySelector: () => null,
    getElementById: () => null,
    addEventListener: () => undefined,
  }
  doc.implementation = { createHTMLDocument: () => doc }
  return doc
}

function shimValues(target: GlobalBag): GlobalBag {
  return {
    window: target,
    document: stubDocument(),
    Node: class {},
    Element: class {},
    HTMLElement: class {},
    HTMLTemplateElement: class {},
    HTMLFormElement: class {},
    DocumentFragment: class {},
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4, SHOW_PROCESSING_INSTRUCTION: 64, SHOW_COMMENT: 128 },
  }
}

export function installDomShim(target: GlobalBag): () => void {
  if (target.document !== undefined) return () => undefined

  const values = shimValues(target)
  const previous = new Map<string, { present: boolean; value: LoadedModule }>()

  for (const [key, value] of Object.entries(values)) {
    previous.set(key, { present: key in target, value: target[key] })
    target[key] = value
  }

  return () => {
    for (const [key, before] of previous) {
      if (before.present) target[key] = before.value
      else delete target[key]
    }
  }
}

function isMermaidModule(value: LoadedModule): value is MermaidModule {
  if (!isRecord(value)) return false
  return typeof value.initialize === "function" && typeof value.parse === "function"
}

const globalBag: GlobalBag = globalThis

const loadMermaid = createLazyLoader(async (): Promise<MermaidModule> => {
  const restore = installDomShim(globalBag)
  try {
    const mermaid = (await import("mermaid")).default
    if (!isMermaidModule(mermaid)) {
      throw new Error("the mermaid package no longer exports initialize/parse")
    }
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict" })
    return mermaid
  } finally {
    restore()
  }
})

export const parseMermaid: MermaidParsePort = async (source): Promise<MermaidParseResult> => {
  const mermaid = await loadMermaid()
  try {
    await mermaid.parse(source)
    return { ok: true }
  } catch (error) {
    return { ok: false, raw: error instanceof Error ? error.message : String(error) }
  }
}
