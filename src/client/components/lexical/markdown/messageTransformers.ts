
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
import {
  MERMAID_FENCE_END_REGEX,
  MERMAID_FENCE_START_REGEX,
  scanFenceBody,
} from "../../../../shared/mermaid-fences"
import { KANNA_BUILTIN_TRANSFORMERS } from "./gfmTransformers"


export const MERMAID_FENCE: MultilineElementTransformer = {
  type: "multiline-element",
  dependencies: [MermaidNode],

  regExpStart: MERMAID_FENCE_START_REGEX,

  regExpEnd: {
    optional: true,
    regExp: MERMAID_FENCE_END_REGEX,
  },

  handleImportAfterStartMatch({ lines, rootNode, startLineIndex, startMatch }) {
    const { source, lastLineIndex } = scanFenceBody(lines, startLineIndex, startMatch[1] ?? "```")
    rootNode.append($createMermaidNode(source))
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
    return false
  },

  export(node: LexicalNode): string | null {
    if (!(node instanceof MermaidNode)) return null
    const source = node.getTextContent()
    return `\`\`\`mermaid\n${  source  }\n\`\`\``
  },
}


const LOCAL_FILE_PREFIXES = "(?:file://|/(?:Users|home|private|tmp|var|opt|root)/)"

const LOCAL_FILE_LINK_IMPORT_REGEXP = new RegExp(
  `\\[(.+?)\\]\\((${LOCAL_FILE_PREFIXES}[^)\\s]*)\\)`,
)

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

    const parsed = parseLocalFileLink(rawHref)
    if (!parsed) return

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


export const KANNA_MESSAGE_TRANSFORMERS: Array<Transformer> = [
  MERMAID_FENCE,
  LOCAL_FILE_LINK,
  ...KANNA_BUILTIN_TRANSFORMERS,
]
