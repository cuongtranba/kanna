import type { AnyValue } from "../../../../shared/errors"
import type { EditorConfig, LexicalEditor, SerializedLexicalNode, Spread } from "lexical"
import type { ReactNode } from "react"
import { DecoratorNode, $applyNodeReplacement } from "lexical"
import type { DomPort } from "../../../ports/domPort"
import { domAdapter } from "../../../adapters/dom.adapter"
import { ThinkingBlock } from "../../messages/ThinkingBlock"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SerializedThinkingNode = Spread<
  { content: string },
  SerializedLexicalNode
>

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

export class ThinkingNode extends DecoratorNode<ReactNode> {
  readonly __content: string
  readonly __dom: DomPort

  constructor(content: string, key?: string, dom: DomPort = domAdapter) {
    super(key)
    this.__content = content
    this.__dom = dom
  }

  // ── Static interface ──────────────────────────────────────────────────────

  static getType(): string {
    return "kanna-thinking"
  }

  static clone(node: ThinkingNode): ThinkingNode {
    return new ThinkingNode(node.__content, node.__key, node.__dom)
  }

  static importJSON(serializedNode: SerializedThinkingNode): ThinkingNode {
    return $createThinkingNode(serializedNode.content)
  }

  // ── Serialization ─────────────────────────────────────────────────────────

  exportJSON(): SerializedThinkingNode {
    return {
      type: ThinkingNode.getType(),
      version: 1,
      content: this.__content,
    }
  }

  // ── DOM ───────────────────────────────────────────────────────────────────

  createDOM(_config: EditorConfig, _editor: LexicalEditor): HTMLElement {
    return this.__dom.createElement("div")
  }

  updateDOM(): boolean {
    return false
  }

  // ── Behaviour ─────────────────────────────────────────────────────────────

  isInline(): boolean {
    return false
  }

  getTextContent(): string {
    return this.__content
  }

  // ── Decorator ─────────────────────────────────────────────────────────────

  decorate(_editor: LexicalEditor, _config: EditorConfig): ReactNode {
    return <ThinkingBlock content={this.__content} />
  }
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

export function $createThinkingNode(content: string): ThinkingNode {
  return $applyNodeReplacement(new ThinkingNode(content))
}

export function $isThinkingNode(node: AnyValue): node is ThinkingNode {
  return node instanceof ThinkingNode
}
