import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import type { SerializedEditorState } from "lexical"
import { $getRoot } from "lexical"


export interface DraftPersistencePluginProps {
  onChange: (state: SerializedEditorState, text: string) => void
}


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
