import type { AnyValue } from "../../../../shared/errors"
import type { EditorConfig, LexicalEditor, SerializedLexicalNode, Spread } from "lexical"
import type { ReactNode } from "react"
import { DecoratorNode, $applyNodeReplacement } from "lexical"
import { MermaidDiagram } from "../../messages/MermaidDiagram"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SerializedMermaidNode = Spread<
  { source: string },
  SerializedLexicalNode
>

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

export class MermaidNode extends DecoratorNode<ReactNode> {
  readonly __source: string

  constructor(source: string, key?: string) {
    super(key)
    this.__source = source
  }

  // ── Static interface ──────────────────────────────────────────────────────

  static getType(): string {
    return "kanna-mermaid"
  }

  static clone(node: MermaidNode): MermaidNode {
    return new MermaidNode(node.__source, node.__key)
  }

  static importJSON(serializedNode: SerializedMermaidNode): MermaidNode {
    return $createMermaidNode(serializedNode.source)
  }

  // ── Serialization ─────────────────────────────────────────────────────────

  exportJSON(): SerializedMermaidNode {
    return {
      type: MermaidNode.getType(),
      version: 1,
      source: this.__source,
    }
  }

  // ── DOM ───────────────────────────────────────────────────────────────────

  createDOM(_config: EditorConfig, _editor: LexicalEditor): HTMLElement {
    return document.createElement("div")
  }

  updateDOM(): boolean {
    return false
  }

  // ── Behaviour ─────────────────────────────────────────────────────────────

  isInline(): boolean {
    return false
  }

  getTextContent(): string {
    return this.__source
  }

  // ── Decorator ─────────────────────────────────────────────────────────────

  decorate(_editor: LexicalEditor, _config: EditorConfig): ReactNode {
    return <MermaidDiagram source={this.__source} />
  }
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

export function $createMermaidNode(source: string): MermaidNode {
  return $applyNodeReplacement(new MermaidNode(source))
}

export function $isMermaidNode(node: AnyValue): node is MermaidNode {
  return node instanceof MermaidNode
}
