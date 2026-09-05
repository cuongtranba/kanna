import { type ReactNode } from "react"
import {
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
  $applyNodeReplacement,
  $nodesOfType,
  DecoratorNode,
} from "lexical"
import type { ChatAttachment } from "../../../../shared/types"
import type { DomPort } from "../../../ports/domPort"
import { domAdapter } from "../../../adapters/dom.adapter"
import {
  AttachmentFileCard,
  AttachmentImageCard,
} from "../../messages/AttachmentCard"


export type SerializedAttachmentNode = Spread<
  { attachment: ChatAttachment },
  SerializedLexicalNode
>


export class AttachmentNode extends DecoratorNode<ReactNode> {
  __attachment: ChatAttachment
  readonly __dom: DomPort


  static getType(): string {
    return "kanna-attachment"
  }

  static clone(node: AttachmentNode): AttachmentNode {
    return new AttachmentNode(node.__attachment, node.__key, node.__dom)
  }

  static importJSON(serializedNode: SerializedAttachmentNode): AttachmentNode {
    return $createAttachmentNode(serializedNode.attachment)
  }


  constructor(attachment: ChatAttachment, key?: NodeKey, dom: DomPort = domAdapter) {
    super(key)
    this.__attachment = attachment
    this.__dom = dom
  }


  getAttachment(): ChatAttachment {
    return this.getLatest().__attachment
  }


  isInline(): boolean {
    return true
  }

  isKeyboardSelectable(): boolean {
    return true
  }

  getTextContent(): string {
    return ""
  }


  createDOM(_config: EditorConfig, _editor: LexicalEditor): HTMLElement {
    const span = this.__dom.createElement("span")
    return span
  }

  updateDOM(): boolean {
    return false
  }


  exportJSON(): SerializedAttachmentNode {
    return {
      type: AttachmentNode.getType(),
      version: 1,
      attachment: this.__attachment,
    }
  }


  decorate(_editor: LexicalEditor, _config: EditorConfig): ReactNode {
    const attachment = this.getLatest().__attachment

    if (attachment.kind === "image" && attachment.contentUrl) {
      return (
        <AttachmentImageCard
          attachment={attachment}
          size="composer"
        />
      )
    }

    return <AttachmentFileCard attachment={attachment} />
  }
}


export function $createAttachmentNode(attachment: ChatAttachment): AttachmentNode {
  return $applyNodeReplacement(new AttachmentNode(attachment))
}

export function $isAttachmentNode(
  node: LexicalNode | null | undefined,
): node is AttachmentNode {
  return node instanceof AttachmentNode
}

export function $getAttachmentNodes(): AttachmentNode[] {
  return $nodesOfType(AttachmentNode)
}
