import type { EditorConfig, LexicalEditor, LexicalNode, SerializedLexicalNode, Spread } from "lexical"
import type { ReactNode } from "react"
import { DecoratorNode, $applyNodeReplacement } from "lexical"
import type { DomPort } from "../../../ports/domPort"
import { domAdapter } from "../../../adapters/dom.adapter"
import { ThinkingBlock } from "../../messages/ThinkingBlock"


export type SerializedThinkingNode = Spread<
  { content: string },
  SerializedLexicalNode
>


export class ThinkingNode extends DecoratorNode<ReactNode> {
  readonly __content: string
  readonly __dom: DomPort

  constructor(content: string, key?: string, dom: DomPort = domAdapter) {
    super(key)
    this.__content = content
    this.__dom = dom
  }


  static getType(): string {
    return "kanna-thinking"
  }

  static clone(node: ThinkingNode): ThinkingNode {
    return new ThinkingNode(node.__content, node.__key, node.__dom)
  }

  static importJSON(serializedNode: SerializedThinkingNode): ThinkingNode {
    return $createThinkingNode(serializedNode.content)
  }


  exportJSON(): SerializedThinkingNode {
    return {
      type: ThinkingNode.getType(),
      version: 1,
      content: this.__content,
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
    return this.__content
  }


  decorate(_editor: LexicalEditor, _config: EditorConfig): ReactNode {
    return <ThinkingBlock content={this.__content} />
  }
}


export function $createThinkingNode(content: string): ThinkingNode {
  return $applyNodeReplacement(new ThinkingNode(content))
}

export function $isThinkingNode(node: LexicalNode | null | undefined): node is ThinkingNode {
  return node instanceof ThinkingNode
}
