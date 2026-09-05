import type { EditorConfig, LexicalEditor, LexicalNode, SerializedLexicalNode, Spread } from "lexical"
import type { ReactNode } from "react"
import { DecoratorNode, $applyNodeReplacement } from "lexical"
import type { DomPort } from "../../../ports/domPort"
import { domAdapter } from "../../../adapters/dom.adapter"
import { MermaidDiagram } from "../../messages/MermaidDiagram"


export type SerializedMermaidNode = Spread<
  { source: string },
  SerializedLexicalNode
>


export class MermaidNode extends DecoratorNode<ReactNode> {
  readonly __source: string
  readonly __dom: DomPort

  constructor(source: string, key?: string, dom: DomPort = domAdapter) {
    super(key)
    this.__source = source
    this.__dom = dom
  }


  static getType(): string {
    return "kanna-mermaid"
  }

  static clone(node: MermaidNode): MermaidNode {
    return new MermaidNode(node.__source, node.__key, node.__dom)
  }

  static importJSON(serializedNode: SerializedMermaidNode): MermaidNode {
    return $createMermaidNode(serializedNode.source)
  }


  exportJSON(): SerializedMermaidNode {
    return {
      type: MermaidNode.getType(),
      version: 1,
      source: this.__source,
    }
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


  decorate(_editor: LexicalEditor, _config: EditorConfig): ReactNode {
    return <MermaidDiagram source={this.__source} />
  }
}


export function $createMermaidNode(source: string): MermaidNode {
  return $applyNodeReplacement(new MermaidNode(source))
}

export function $isMermaidNode(node: LexicalNode | null | undefined): node is MermaidNode {
  return node instanceof MermaidNode
}
