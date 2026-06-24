import type { LexicalEditor, LexicalNode } from "lexical"
import {
  $getRoot,
  $isElementNode,
  $isTextNode,
  $isLineBreakNode,
} from "lexical"
import type { ChatAttachment } from "../../../../shared/types"
import { $getAttachmentNodes } from "../nodes/AttachmentNode"

// ---------------------------------------------------------------------------
// Wire contract
// ---------------------------------------------------------------------------

export interface WirePayload {
  text: string
  attachments: ChatAttachment[]
}

// ---------------------------------------------------------------------------
// Block-level serializer
// ---------------------------------------------------------------------------

/**
 * Collect the plain-text content of a single block element (paragraph,
 * heading, list-item, quote, code block, …).  Inline nodes are walked via
 * their getTextContent() so:
 *   – TextNode            → raw text
 *   – MentionNode (agent) → @agent/<value>
 *   – MentionNode (path)  → @<value>
 *   – SlashCommandNode    → /<name> or /<name> (trailing space when hasArg)
 *   – AttachmentNode      → "" (sent separately)
 *   – LineBreakNode       → "\n"
 */
function serializeBlockText(node: LexicalNode): string {
  if ($isTextNode(node)) {
    return node.getTextContent()
  }

  if ($isLineBreakNode(node)) {
    return "\n"
  }

  // For any element node (paragraph, heading, list-item, quote, code…)
  // walk its children recursively.
  if ($isElementNode(node)) {
    let result = ""
    const children = node.getChildren()
    for (const child of children) {
      result += serializeBlockText(child)
    }
    return result
  }

  // Decorator nodes (MentionNode, SlashCommandNode, AttachmentNode) are NOT
  // element nodes — call getTextContent() directly.
  return node.getTextContent()
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Serialize the current Lexical editor state back to the legacy `chat.send`
 * wire format: a plain string + a separate ChatAttachment array.
 *
 * Wire-form mapping:
 *   TextNode text              → verbatim text
 *   MentionNode (agent)        → @agent/<value>
 *   MentionNode (path)         → @<value>
 *   SlashCommandNode (no arg)  → /<name>
 *   SlashCommandNode (has arg) → /<name> (trailing space)
 *   AttachmentNode             → "" (excluded from text; returned in attachments[])
 *   LineBreakNode              → \n
 *   Multiple block elements    → joined with \n
 *
 * Trailing whitespace/newlines are trimmed (mirrors legacy textarea submit).
 */
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

    // Join blocks with a single newline (the legacy textarea held raw text;
    // a single \n between paragraphs matches what Shift+Enter would produce
    // in a plain textarea composed paragraph-by-paragraph).
    text = blockTexts.join("\n")

    // Trim trailing newlines/spaces, matching trimTrailingPastedNewlines.
    text = text.replace(/(?:\r\n|\r|\n)+$/, "").trimEnd()

    // Collect attachments from dedicated AttachmentNodes.
    attachments = $getAttachmentNodes().map((n) => n.getAttachment())
  })

  return { text, attachments }
}
