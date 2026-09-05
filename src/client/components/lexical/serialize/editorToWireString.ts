import type { LexicalEditor, LexicalNode } from "lexical"
import {
  $getRoot,
  $isElementNode,
  $isTextNode,
  $isLineBreakNode,
} from "lexical"
import type { ChatAttachment } from "../../../../shared/types"
import { $getAttachmentNodes } from "../nodes/AttachmentNode"


export interface WirePayload {
  text: string
  attachments: ChatAttachment[]
}


function serializeBlockText(node: LexicalNode): string {
  if ($isTextNode(node)) {
    return node.getTextContent()
  }

  if ($isLineBreakNode(node)) {
    return "\n"
  }

  if ($isElementNode(node)) {
    let result = ""
    const children = node.getChildren()
    for (const child of children) {
      result += serializeBlockText(child)
    }
    return result
  }

  return node.getTextContent()
}


export function serializeEditorToWire(editor: LexicalEditor): WirePayload {
  let text = ""
  let attachments: ChatAttachment[] = []

  editor.getEditorState().read(() => {
    const root = $getRoot()
    const blocks = root.getChildren()

    const blockTexts: string[] = []
    for (const block of blocks) {
      blockTexts.push(serializeBlockText(block))
    }

    text = blockTexts.join("\n")

    text = text.replace(/(?:\r\n|\r|\n)+$/, "").trimEnd()

    attachments = $getAttachmentNodes().map((n) => n.getAttachment())
  })

  return { text, attachments }
}
