import type { AnyValue } from "../../../../shared/errors"
import type { EditorConfig, LexicalEditor, SerializedLexicalNode, Spread } from "lexical"
import type { ReactNode } from "react"
import { DecoratorNode, $applyNodeReplacement } from "lexical"
import type { DomPort } from "../../../ports/domPort"
import { domAdapter } from "../../../adapters/dom.adapter"
import { cn } from "../../../lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SerializedSlashCommandNode = Spread<
  {
    commandName: string
    hasArgument: boolean
  },
  SerializedLexicalNode
>

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

export class SlashCommandNode extends DecoratorNode<ReactNode> {
  readonly __commandName: string
  readonly __hasArgument: boolean
  readonly __dom: DomPort

  constructor(
    commandName: string,
    hasArgument: boolean,
    key?: string,
    dom: DomPort = domAdapter,
  ) {
    super(key)
    this.__commandName = commandName
    this.__hasArgument = hasArgument
    this.__dom = dom
  }

  // ── Static interface ──────────────────────────────────────────────────────

  static getType(): string {
    return "kanna-slash-command"
  }

  static clone(node: SlashCommandNode): SlashCommandNode {
    return new SlashCommandNode(node.__commandName, node.__hasArgument, node.__key, node.__dom)
  }

  static importJSON(serializedNode: SerializedSlashCommandNode): SlashCommandNode {
    return $createSlashCommandNode({
      commandName: serializedNode.commandName,
      hasArgument: serializedNode.hasArgument,
    })
  }

  // ── Serialization ─────────────────────────────────────────────────────────

  exportJSON(): SerializedSlashCommandNode {
    return {
      type: SlashCommandNode.getType(),
      version: 1,
      commandName: this.__commandName,
      hasArgument: this.__hasArgument,
    }
  }

  // ── DOM ───────────────────────────────────────────────────────────────────

  createDOM(_config: EditorConfig, _editor: LexicalEditor): HTMLElement {
    const span = this.__dom.createElement("span")
    span.dataset.lexicalDecorator = "true"
    return span
  }

  updateDOM(): boolean {
    return false
  }

  // ── Behaviour ─────────────────────────────────────────────────────────────

  isInline(): boolean {
    return true
  }

  isKeyboardSelectable(): boolean {
    return true
  }

  /**
   * Wire form used when serializing composer content back to the legacy
   * chat.send string:
   *   with argument    →  /<name> (trailing space)
   *   without argument →  /<name>
   */
  getTextContent(): string {
    return this.__hasArgument ? `/${this.__commandName} ` : `/${this.__commandName}`
  }

  // ── Decorator ─────────────────────────────────────────────────────────────

  decorate(_editor: LexicalEditor, _config: EditorConfig): ReactNode {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded px-1 text-sm font-mono",
          "bg-muted text-muted-foreground border border-border",
        )}
      >
        {`/${this.__commandName}`}
      </span>
    )
  }
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

export interface CreateSlashCommandNodeArgs {
  commandName: string
  hasArgument: boolean
}

export function $createSlashCommandNode(args: CreateSlashCommandNodeArgs): SlashCommandNode {
  return $applyNodeReplacement(new SlashCommandNode(args.commandName, args.hasArgument))
}

export function $isSlashCommandNode(node: AnyValue): node is SlashCommandNode {
  return node instanceof SlashCommandNode
}
