/**
 * The only place mermaid is loaded server-side.
 *
 * mermaid is a browser library: importing it evaluates DOMPurify, which needs
 * a `window` to hook onto, and `mermaid.initialize` walks a `document`. It
 * needs far less of one than a full DOM implementation, though — the surface
 * below is the measured minimum, and with it `mermaid.parse` answers in ~9 ms
 * for every diagram type.
 *
 * Rejected alternatives:
 *  - promote happy-dom to a production dependency: it replaces the process's
 *    `fetch`/`FormData`/`Blob` (see scripts/test-preload.ts, which has to undo
 *    exactly that), which is far too much blast radius for a parse;
 *  - shell out to a child process: ~200 ms of spawn for a 9 ms parse.
 *
 * The shim is installed only around the import and torn down immediately, so
 * nothing downstream can sniff `window` and take a browser code path.
 */

import { isRecord, type AnyValue } from "../shared/errors"
import { createLazyLoader } from "../shared/lazyModule"
import type { MermaidParsePort, MermaidParseResult } from "../shared/mermaid-validation"

interface MermaidModule {
  initialize: (config: { startOnLoad: boolean; securityLevel: "strict" }) => void
  parse: (text: string) => Promise<unknown>
}

type GlobalBag = Record<string, unknown>

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

/**
 * Install the minimum DOM surface mermaid needs on `target`, returning a
 * function that puts `target` back exactly as it was.
 *
 * A real `document` (a browser, or the happy-dom the test preload registers
 * process-wide) means we stand down: clobbering it would break every other
 * consumer sharing the process, and mermaid works fine with the real one.
 */
export function installDomShim(target: GlobalBag): () => void {
  if (target.document !== undefined) return () => undefined

  const values = shimValues(target)
  const previous = new Map<string, { present: boolean; value: AnyValue }>()

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

function isMermaidModule(value: AnyValue): value is MermaidModule {
  if (!isRecord(value)) return false
  return typeof value.initialize === "function" && typeof value.parse === "function"
}

/** `globalThis` viewed as the string-keyed bag the shim writes into. */
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
