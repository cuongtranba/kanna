import type { AnyValue } from "../../../../shared/errors"
import type { DomPort } from "../../../ports/domPort"
import type { EditorConfig, LexicalEditor, SerializedLexicalNode, Spread } from "lexical"
import type { ReactNode } from "react"
import { DecoratorNode, $applyNodeReplacement } from "lexical"
import { domAdapter } from "../../../adapters/dom.adapter"
import { LocalFileLinkCard } from "../../messages/LocalFileLinkCard"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateLocalFileLinkNodeArgs {
  path: string
  line?: number
  column?: number
}

export type SerializedLocalFileLinkNode = Spread<
  CreateLocalFileLinkNodeArgs,
  SerializedLexicalNode
>

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

export class LocalFileLinkNode extends DecoratorNode<ReactNode> {
  readonly __path: string
  readonly __line: number | undefined
  readonly __column: number | undefined
  readonly __dom: DomPort

  constructor(
    path: string,
    line?: number,
    column?: number,
    key?: string,
    dom: DomPort = domAdapter,
  ) {
    super(key)
    this.__path = path
    this.__line = line
    this.__column = column
    this.__dom = dom
  }

  // ── Static interface ──────────────────────────────────────────────────────

  static getType(): string {
    return "kanna-local-file-link"
  }

  static clone(node: LocalFileLinkNode): LocalFileLinkNode {
    return new LocalFileLinkNode(
      node.__path,
      node.__line,
      node.__column,
      node.__key,
      node.__dom,
    )
  }

  static importJSON(serializedNode: SerializedLocalFileLinkNode): LocalFileLinkNode {
    return $createLocalFileLinkNode({
      path: serializedNode.path,
      line: serializedNode.line,
      column: serializedNode.column,
    })
  }

  // ── Serialization ─────────────────────────────────────────────────────────

  exportJSON(): SerializedLocalFileLinkNode {
    const json: SerializedLocalFileLinkNode = {
      type: LocalFileLinkNode.getType(),
      version: 1,
      path: this.__path,
    }
    if (this.__line !== undefined) {
      json.line = this.__line
    }
    if (this.__column !== undefined) {
      json.column = this.__column
    }
    return json
  }

  // ── DOM ───────────────────────────────────────────────────────────────────

  createDOM(_config: EditorConfig, _editor: LexicalEditor): HTMLElement {
    return this.__dom.createElement("span")
  }

  updateDOM(): boolean {
    return false
  }

  // ── Behaviour ─────────────────────────────────────────────────────────────

  isInline(): boolean {
    return true
  }

  getTextContent(): string {
    return this.__path
  }

  // ── Decorator ─────────────────────────────────────────────────────────────

  decorate(_editor: LexicalEditor, _config: EditorConfig): ReactNode {
    const linkText =
      this.__line !== undefined
        ? `${this.__path}:${this.__line}${this.__column !== undefined ? `:${this.__column}` : ""}`
        : undefined

    return <LocalFileLinkCard path={this.__path} linkText={linkText} />
  }
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

export function $createLocalFileLinkNode(
  args: CreateLocalFileLinkNodeArgs,
): LocalFileLinkNode {
  return $applyNodeReplacement(
    new LocalFileLinkNode(args.path, args.line, args.column),
  )
}

export function $isLocalFileLinkNode(node: AnyValue): node is LocalFileLinkNode {
  return node instanceof LocalFileLinkNode
}
