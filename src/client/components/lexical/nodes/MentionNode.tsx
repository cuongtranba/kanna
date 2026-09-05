import type { EditorConfig, LexicalEditor, LexicalNode, SerializedLexicalNode, Spread } from "lexical"
import type { ReactNode } from "react"
import { DecoratorNode, $applyNodeReplacement } from "lexical"
import type { DomPort } from "../../../ports/domPort"
import { domAdapter } from "../../../adapters/dom.adapter"
import { cn } from "../../../lib/utils"


export type MentionKind = "agent" | "path"

export type SerializedMentionNode = Spread<
  {
    mentionKind: MentionKind
    value: string
    label: string
  },
  SerializedLexicalNode
>


export class MentionNode extends DecoratorNode<ReactNode> {
  readonly __mentionKind: MentionKind
  readonly __value: string
  readonly __label: string
  readonly __dom: DomPort

  constructor(
    mentionKind: MentionKind,
    value: string,
    label: string,
    key?: string,
    dom: DomPort = domAdapter,
  ) {
    super(key)
    this.__mentionKind = mentionKind
    this.__value = value
    this.__label = label
    this.__dom = dom
  }


  static getType(): string {
    return "kanna-mention"
  }

  static clone(node: MentionNode): MentionNode {
    return new MentionNode(
      node.__mentionKind,
      node.__value,
      node.__label,
      node.__key,
      node.__dom,
    )
  }

  static importJSON(serializedNode: SerializedMentionNode): MentionNode {
    return $createMentionNode({
      mentionKind: serializedNode.mentionKind,
      value: serializedNode.value,
      label: serializedNode.label,
    })
  }


  exportJSON(): SerializedMentionNode {
    return {
      type: MentionNode.getType(),
      version: 1,
      mentionKind: this.__mentionKind,
      value: this.__value,
      label: this.__label,
    }
  }


  createDOM(_config: EditorConfig, _editor: LexicalEditor): HTMLElement {
    const span = this.__dom.createElement("span")
    span.dataset.lexicalDecorator = "true"
    return span
  }

  updateDOM(): boolean {
    return false
  }


  isInline(): boolean {
    return true
  }

  isKeyboardSelectable(): boolean {
    return true
  }

  getTextContent(): string {
    if (this.__mentionKind === "agent") {
      return `@agent/${this.__value}`
    }
    return `@${this.__value}`
  }


  decorate(_editor: LexicalEditor, _config: EditorConfig): ReactNode {
    const label = this.__label

    if (this.__mentionKind === "agent") {
      return (
        <span
          className={cn(
            "inline-flex items-center rounded px-1 text-sm",
            "bg-primary/10 text-primary border border-primary/20",
          )}
        >
          {label}
        </span>
      )
    }

    return (
      <span
        className={cn(
          "inline-flex items-center rounded px-1 text-sm",
          "bg-muted text-muted-foreground border border-border",
        )}
      >
        {label}
      </span>
    )
  }
}


export interface CreateMentionNodeArgs {
  mentionKind: MentionKind
  value: string
  label: string
}

export function $createMentionNode(args: CreateMentionNodeArgs): MentionNode {
  return $applyNodeReplacement(new MentionNode(args.mentionKind, args.value, args.label))
}

export function $isMentionNode(node: LexicalNode | null | undefined): node is MentionNode {
  return node instanceof MentionNode
}
