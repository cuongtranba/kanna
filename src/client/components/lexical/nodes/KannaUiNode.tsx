import type { EditorConfig, LexicalEditor, LexicalNode, SerializedLexicalNode, Spread } from "lexical"
import type { ReactNode } from "react"
import { DecoratorNode, $applyNodeReplacement } from "lexical"
import type { DomPort } from "../../../ports/domPort"
import { domAdapter } from "../../../adapters/dom.adapter"
import { KannaUiBlock } from "../../genui/KannaUiBlock"
import { KannaUiIntentChip } from "../../genui/KannaUiIntentChip"

export type SerializedKannaUiNode = Spread<{ source: string; closed: boolean; intent: boolean }, SerializedLexicalNode>

export class KannaUiNode extends DecoratorNode<ReactNode> {
  readonly __source: string
  readonly __closed: boolean
  readonly __intent: boolean
  readonly __dom: DomPort

  constructor(source: string, closed: boolean, intent: boolean, key?: string, dom: DomPort = domAdapter) {
    super(key)
    this.__source = source
    this.__closed = closed
    this.__intent = intent
    this.__dom = dom
  }

  static getType(): string {
    return "kanna-ui"
  }

  static clone(node: KannaUiNode): KannaUiNode {
    return new KannaUiNode(node.__source, node.__closed, node.__intent, node.__key, node.__dom)
  }

  static importJSON(serializedNode: SerializedKannaUiNode): KannaUiNode {
    return $createKannaUiNode(serializedNode.source, serializedNode.closed, serializedNode.intent)
  }

  exportJSON(): SerializedKannaUiNode {
    return { type: KannaUiNode.getType(), version: 1, source: this.__source, closed: this.__closed, intent: this.__intent }
  }

  createDOM(_config: EditorConfig, _editor: LexicalEditor): HTMLElement {
    return this.__dom.createElement("div")
  }

  updateDOM(): boolean {
    return false
  }

  isInline(): boolean {
    return false
  }

  getTextContent(): string {
    return this.__source
  }

  isIntent(): boolean {
    return this.__intent
  }

  isClosed(): boolean {
    return this.__closed
  }

  decorate(_editor: LexicalEditor, _config: EditorConfig): ReactNode {
    if (this.__intent) return <KannaUiIntentChip source={this.__source} />
    return <KannaUiBlock source={this.__source} closed={this.__closed} />
  }
}

export function $createKannaUiNode(source: string, closed: boolean, intent: boolean): KannaUiNode {
  return $applyNodeReplacement(new KannaUiNode(source, closed, intent))
}

export function $isKannaUiNode(node: LexicalNode | null | undefined): node is KannaUiNode {
  return node instanceof KannaUiNode
}
