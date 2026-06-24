import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import type { SerializedEditorState } from "lexical"
import { $getRoot } from "lexical"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DraftPersistencePluginProps {
  /**
   * Called on every editor change with the serialized editor state and the
   * derived plain-text string.  The parent wires this to the draft store;
   * the plugin itself is store-agnostic.
   */
  onChange: (state: SerializedEditorState, text: string) => void
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * An OnChangePlugin-style plugin that fires `props.onChange` on every editor
 * state change, providing:
 *   – `state`  – the full `SerializedEditorState` (safe to JSON-stringify and
 *                restore via `editor.setEditorState(editor.parseEditorState(…))`)
 *   – `text`   – the plain-text representation of the editor content (suitable
 *                for display or length checks)
 *
 * The plugin is intentionally store-agnostic; no draft store is imported here.
 * The parent component owns persistence.
 */
export function DraftPersistencePlugin({ onChange }: DraftPersistencePluginProps): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      const serialized = editorState.toJSON()

      let text = ""
      editorState.read(() => {
        text = $getRoot().getTextContent()
      })

      onChange(serialized, text)
    })
  }, [editor, onChange])

  return null
}
