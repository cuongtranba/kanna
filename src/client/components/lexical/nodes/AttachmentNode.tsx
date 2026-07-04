import { type ReactNode } from "react"
import {
  type EditorConfig,
  type LexicalEditor,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
  $applyNodeReplacement,
  $nodesOfType,
  DecoratorNode,
} from "lexical"
import type { ChatAttachment } from "../../../../shared/types"
import {
  AttachmentFileCard,
  AttachmentImageCard,
} from "../../messages/AttachmentCard"

// ─── Serialized shape ───────────────────────────────────────────────────────

export type SerializedAttachmentNode = Spread<
  { attachment: ChatAttachment },
  SerializedLexicalNode
>

// ─── Node ───────────────────────────────────────────────────────────────────

export class AttachmentNode extends DecoratorNode<ReactNode> {
  __attachment: ChatAttachment

  // ── Static API ────────────────────────────────────────────────────────────

  static getType(): string {
    return "kanna-attachment"
  }

  static clone(node: AttachmentNode): AttachmentNode {
    return new AttachmentNode(node.__attachment, node.__key)
  }

  static importJSON(serializedNode: SerializedAttachmentNode): AttachmentNode {
    return $createAttachmentNode(serializedNode.attachment)
  }

  // ── Constructor ───────────────────────────────────────────────────────────

  constructor(attachment: ChatAttachment, key?: NodeKey) {
    super(key)
    this.__attachment = attachment
  }

  // ── Instance API ──────────────────────────────────────────────────────────

  getAttachment(): ChatAttachment {
    return this.getLatest().__attachment
  }

  // ── Lexical behaviour ─────────────────────────────────────────────────────

  isInline(): boolean {
    return true
  }

  isKeyboardSelectable(): boolean {
    return true
  }

  /**
   * Attachments are not part of the wire text string. They are sent separately
   * via the `attachments[]` payload, so they must contribute empty text.
   */
  getTextContent(): string {
    return ""
  }

  // ── DOM ───────────────────────────────────────────────────────────────────

  createDOM(_config: EditorConfig, _editor: LexicalEditor): HTMLElement {
    const span = document.createElement("span")
    return span
  }

  updateDOM(): boolean {
    // Return false — Lexical will call decorate() again when the node changes
    // without unmounting / remounting the DOM container.
    return false
  }

  // ── Serialisation ─────────────────────────────────────────────────────────

  exportJSON(): SerializedAttachmentNode {
    return {
      type: AttachmentNode.getType(),
      version: 1,
      attachment: this.__attachment,
    }
  }

  // ── React decorator ───────────────────────────────────────────────────────

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

// ─── Factory helpers ─────────────────────────────────────────────────────────

export function $createAttachmentNode(attachment: ChatAttachment): AttachmentNode {
  return $applyNodeReplacement(new AttachmentNode(attachment))
}

export function $isAttachmentNode(
  node: unknown,
): node is AttachmentNode {
  return node instanceof AttachmentNode
}

/**
 * Returns all AttachmentNodes in the current editor root.
 * Must be called inside an editor.read() or editor.update() callback.
 */
export function $getAttachmentNodes(): AttachmentNode[] {
  return $nodesOfType(AttachmentNode)
}
