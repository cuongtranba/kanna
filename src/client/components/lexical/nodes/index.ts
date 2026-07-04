import type { Klass, LexicalNode } from "lexical"
import { MentionNode } from "./MentionNode"
import { SlashCommandNode } from "./SlashCommandNode"
import { AttachmentNode } from "./AttachmentNode"
import { MermaidNode } from "./MermaidNode"
import { LocalFileLinkNode } from "./LocalFileLinkNode"
import { ThinkingNode } from "./ThinkingNode"

export * from "./MentionNode"
export * from "./SlashCommandNode"
export * from "./AttachmentNode"
export * from "./MermaidNode"
export * from "./LocalFileLinkNode"
export * from "./ThinkingNode"

// Composer-side nodes: the editable chat input registers these.
export const KANNA_COMPOSER_NODES: ReadonlyArray<Klass<LexicalNode>> = [
  MentionNode,
  SlashCommandNode,
  AttachmentNode,
]

// Message-render nodes: the read-only headless render registers these.
export const KANNA_MESSAGE_NODES: ReadonlyArray<Klass<LexicalNode>> = [
  MermaidNode,
  LocalFileLinkNode,
  ThinkingNode,
]
