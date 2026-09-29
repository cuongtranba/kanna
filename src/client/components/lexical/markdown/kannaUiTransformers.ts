import type { LexicalNode } from "lexical"
import type { MultilineElementTransformer } from "@lexical/markdown"
import { MERMAID_FENCE_END_REGEX, scanFenceBody } from "../../../../shared/mermaid-fences"
import { KANNA_UI_FENCE_START_REGEX, KANNA_UI_INTENT_FENCE_START_REGEX } from "../../../../shared/genui/fences"
import { $createKannaUiNode, KannaUiNode } from "../nodes/KannaUiNode"

function kannaUiFence(startRegex: RegExp, intent: boolean): MultilineElementTransformer {
  return {
    type: "multiline-element",
    dependencies: [KannaUiNode],
    regExpStart: startRegex,
    regExpEnd: { optional: true, regExp: MERMAID_FENCE_END_REGEX },
    handleImportAfterStartMatch({ lines, rootNode, startLineIndex, startMatch }) {
      const { source, lastLineIndex, closed } = scanFenceBody(lines, startLineIndex, startMatch[1] ?? "```")
      rootNode.append($createKannaUiNode(source, closed, intent))
      return [true, lastLineIndex]
    },
    replace(): boolean | void {
      return false
    },
    export(node: LexicalNode): string | null {
      if (!(node instanceof KannaUiNode) || node.isIntent() !== intent) return null
      return `\`\`\`${intent ? "kanna-ui-intent" : "kanna-ui"}\n${node.getTextContent()}\n\`\`\``
    },
  }
}

export const KANNA_UI_FENCE = kannaUiFence(KANNA_UI_FENCE_START_REGEX, false)

export const KANNA_UI_INTENT_FENCE = kannaUiFence(KANNA_UI_INTENT_FENCE_START_REGEX, true)
