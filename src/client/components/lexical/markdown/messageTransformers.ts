/**
 * Message-render transformer set for Kanna's headless markdown renderer.
 *
 * Extends KANNA_BUILTIN_TRANSFORMERS with custom transformers:
 *  - MERMAID_FENCE: ```mermaid fenced code blocks → MermaidNode (block)
 *  - LOCAL_FILE_LINK: links whose href is an absolute local file path → LocalFileLinkNode (inline)
 *
 * MERMAID_FENCE must be placed before the built-in CODE transformer so that
 * mermaid fences are intercepted before they become plain CodeNodes.
 *
 * LOCAL_FILE_LINK must be placed before the built-in LINK transformer so that
 * local-file links are intercepted before they become standard LinkNodes.
 */

import type {
  MultilineElementTransformer,
  TextMatchTransformer,
  Transformer,
} from "@lexical/markdown"
import { type ElementNode, type LexicalNode, type TextNode } from "lexical"
import {
  $createMermaidNode,
  $createLocalFileLinkNode,
  MermaidNode,
  LocalFileLinkNode,
} from "../nodes"
import { isAbsoluteLocalFilePath, parseLocalFileLink } from "../../../lib/pathUtils"
import { KANNA_BUILTIN_TRANSFORMERS } from "./gfmTransformers"

// ---------------------------------------------------------------------------
// MERMAID_FENCE: MultilineElementTransformer
// ---------------------------------------------------------------------------
// Matches a ```mermaid fenced code block and produces a MermaidNode.
// The regex matches the opening fence line: ```mermaid (with optional spaces).
// We intercept this BEFORE the built-in CODE transformer handles it.
// ---------------------------------------------------------------------------

const MERMAID_FENCE_START_REGEX = /^[ \t]*(`{3,})[ \t]*mermaid[ \t]*$/i
const MERMAID_FENCE_END_REGEX = /^[ \t]*`{3,}[ \t]*$/

export const MERMAID_FENCE: MultilineElementTransformer = {
  type: "multiline-element",
  dependencies: [MermaidNode],

  regExpStart: MERMAID_FENCE_START_REGEX,

  regExpEnd: {
    optional: true,
    regExp: MERMAID_FENCE_END_REGEX,
  },

  handleImportAfterStartMatch({ lines, rootNode, startLineIndex, startMatch }) {
    const fence = startMatch[1] ?? "```"
    const fenceLength = fence.length
    const endRegex = new RegExp(`^[ \\t]\`{${fenceLength},}[ \\t]*$`)

    // Collect lines between the opening and closing fence
    const bodyLines: string[] = []
    let lastLineIndex = startLineIndex

    for (let i = startLineIndex + 1; i < lines.length; i++) {
      const line = lines[i]
      if (line === undefined) break
      if (MERMAID_FENCE_END_REGEX.test(line) || endRegex.test(line)) {
        lastLineIndex = i
        break
      }
      bodyLines.push(line)
      lastLineIndex = i
    }

    const source = bodyLines.join("\n")
    const mermaidNode = $createMermaidNode(source)
    rootNode.append(mermaidNode)

    return [true, lastLineIndex]
  },

  replace(
    _rootNode: ElementNode,
    _children: Array<LexicalNode> | null,
    _startMatch: Array<string>,
    _endMatch: Array<string> | null,
    _linesInBetween: Array<string> | null,
    _isImport: boolean,
  ): boolean | void {
    // Not used — handleImportAfterStartMatch handles everything
    return false
  },

  export(node: LexicalNode): string | null {
    if (!(node instanceof MermaidNode)) return null
    const source = node.getTextContent()
    return `\`\`\`mermaid\n${  source  }\n\`\`\``
  },
}

// ---------------------------------------------------------------------------
// LOCAL_FILE_LINK: TextMatchTransformer
// ---------------------------------------------------------------------------
// Matches markdown links [text](href) where href is an absolute local file
// path (e.g. /Users/..., /home/..., file://...) and replaces the matched
// text node with a LocalFileLinkNode.
//
// The importRegExp is NARROW: it only matches links whose href begins with a
// known local file prefix (file://, /Users/, /home/, /private/, /tmp/, /var/,
// /opt/, /root/). This prevents pre-empting the built-in LINK transformer for
// external https:// links, which would otherwise leave them un-linkified.
//
// Detection: uses `parseLocalFileLink` from pathUtils to parse the href and
// extract optional line/column from path#LN or path:line:col notation.
// ---------------------------------------------------------------------------

// Matches [text](href) where href is a local file URL:
//   - file:// scheme, OR
//   - absolute path starting with known local prefixes
const LOCAL_FILE_PREFIXES = "(?:file://|/(?:Users|home|private|tmp|var|opt|root)/)"

// importRegExp: narrow, matches only local-path links
const LOCAL_FILE_LINK_IMPORT_REGEXP = new RegExp(
  `\\[(.+?)\\]\\((${LOCAL_FILE_PREFIXES}[^)\\s]*)\\)`,
)

// regExp: used for shortcut/typing path (less critical but consistent)
const LOCAL_FILE_LINK_REGEXP = new RegExp(
  `\\[([^[\\]]+)\\]\\((${LOCAL_FILE_PREFIXES}[^)\\s]*)\\)$`,
)

export const LOCAL_FILE_LINK: TextMatchTransformer = {
  type: "text-match",
  dependencies: [LocalFileLinkNode],

  importRegExp: LOCAL_FILE_LINK_IMPORT_REGEXP,
  regExp: LOCAL_FILE_LINK_REGEXP,
  trigger: ")",

  replace(textNode: TextNode, match: RegExpMatchArray): void | TextNode {
    const rawHref = match[2]
    if (!rawHref) return

    // Parse the href to extract path + optional line/column
    const parsed = parseLocalFileLink(rawHref)
    if (!parsed) return

    // Extra guard: only local paths (belt-and-suspenders)
    if (!isAbsoluteLocalFilePath(parsed.path) && !rawHref.startsWith("/")) {
      return
    }

    const localFileLinkNode = $createLocalFileLinkNode({
      path: parsed.path,
      line: parsed.line,
      column: parsed.column,
    })
    textNode.replace(localFileLinkNode)
  },

  export(node: LexicalNode): string | null {
    if (!(node instanceof LocalFileLinkNode)) return null
    const path = node.getTextContent()
    return `[${path}](${path})`
  },
}

// ---------------------------------------------------------------------------
// Exported transformer list
// ---------------------------------------------------------------------------

/**
 * Full message-render transformer set for Kanna.
 * Extends KANNA_BUILTIN_TRANSFORMERS with:
 *  - MERMAID_FENCE (prepended, before CODE, to intercept mermaid fences first)
 *  - LOCAL_FILE_LINK (prepended before the built-in LINK transformer)
 */
export const KANNA_MESSAGE_TRANSFORMERS: Array<Transformer> = [
  MERMAID_FENCE,
  LOCAL_FILE_LINK,
  ...KANNA_BUILTIN_TRANSFORMERS,
]
