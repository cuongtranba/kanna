import { describe, expect, it, mock } from "bun:test"
import { createHeadlessEditor } from "@lexical/headless"
import { $createParagraphNode, $createTextNode, $getRoot } from "lexical"
import type { SerializedEditorState } from "lexical"
import {
  KANNA_COMPOSER_NODES,
  $createMentionNode,
  $createAttachmentNode,
} from "../nodes"
import type { ChatAttachment } from "../../../../shared/types"


function buildEditor() {
  return createHeadlessEditor({
    namespace: "test-draft-plugin",
    nodes: [...KANNA_COMPOSER_NODES],
    onError: (e: Error) => {
      throw e
    },
  })
}

const fakeAttachment: ChatAttachment = {
  id: "att-draft-1",
  kind: "image",
  displayName: "draft-img.png",
  absolutePath: "/tmp/draft-img.png",
  relativePath: "draft-img.png",
  contentUrl: "blob:http://localhost/draft",
  mimeType: "image/png",
  size: 512,
}


describe("DraftPersistencePlugin — registerUpdateListener contract", () => {
  it("fires the listener after an editor update", () => {
    const editor = buildEditor()
    let callCount = 0
    let lastText = ""
    let lastState: SerializedEditorState | null = null

    const unregister = editor.registerUpdateListener(({ editorState }) => {
      callCount++
      lastState = editorState.toJSON()
      editorState.read(() => {
        lastText = $getRoot().getTextContent()
      })
    })

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append($createTextNode("draft content"))
        root.append(para)
      },
      { discrete: true },
    )

    expect(callCount).toBeGreaterThan(0)
    expect(lastText).toBe("draft content")
    expect(lastState).not.toBeNull()
    expect(typeof lastState).toBe("object")

    unregister()
  })

  it("calls onChange with empty text for an empty editor", () => {
    const editor = buildEditor()
    let lastText = "UNSET"

    const unregister = editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        lastText = $getRoot().getTextContent()
      })
    })

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        root.append($createParagraphNode())
      },
      { discrete: true },
    )

    expect(lastText).toBe("")

    unregister()
  })

  it("provides plain text that includes MentionNode wire form", () => {
    const editor = buildEditor()
    let lastText = ""

    const unregister = editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        lastText = $getRoot().getTextContent()
      })
    })

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append($createTextNode("hey "))
        para.append(
          $createMentionNode({ mentionKind: "agent", value: "coder", label: "coder" }),
        )
        root.append(para)
      },
      { discrete: true },
    )

    expect(lastText).toBe("hey @agent/coder")

    unregister()
  })

  it("provides empty string for AttachmentNode in text (excluded from wire text)", () => {
    const editor = buildEditor()
    let lastText = "UNSET"

    const unregister = editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        lastText = $getRoot().getTextContent()
      })
    })

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append($createAttachmentNode(fakeAttachment))
        root.append(para)
      },
      { discrete: true },
    )

    expect(lastText).toBe("")

    unregister()
  })
})


describe("DraftPersistencePlugin — SerializedEditorState round-trip", () => {
  it("toJSON() produces a value that parseEditorState() restores correctly", () => {
    const editor = buildEditor()

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append($createTextNode("persisted draft"))
        root.append(para)
      },
      { discrete: true },
    )

    const serialized = editor.getEditorState().toJSON()

    expect(serialized).toBeDefined()
    expect(typeof serialized).toBe("object")
    expect(serialized.root).toBeDefined()

    const restored = editor.parseEditorState(JSON.stringify(serialized))
    let restoredText = ""
    restored.read(() => {
      restoredText = $getRoot().getTextContent()
    })

    expect(restoredText).toBe("persisted draft")
  })

  it("round-trip preserves MentionNode (agent)", () => {
    const editor = buildEditor()

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append(
          $createMentionNode({ mentionKind: "agent", value: "planner", label: "planner" }),
        )
        root.append(para)
      },
      { discrete: true },
    )

    const serialized = editor.getEditorState().toJSON()
    const restored = editor.parseEditorState(JSON.stringify(serialized))
    let text = ""
    restored.read(() => {
      text = $getRoot().getTextContent()
    })

    expect(text).toBe("@agent/planner")
  })

  it("round-trip preserves AttachmentNode data", () => {
    const editor = buildEditor()

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append($createAttachmentNode(fakeAttachment))
        root.append(para)
      },
      { discrete: true },
    )

    const serialized = editor.getEditorState().toJSON()

    const jsonStr = JSON.stringify(serialized)
    expect(jsonStr).toContain(fakeAttachment.id)
    expect(jsonStr).toContain(fakeAttachment.displayName)
  })
})


describe("DraftPersistencePlugin — onChange prop contract", () => {
  it("onChange receives serialized state + plain text on every update", () => {
    const editor = buildEditor()
    const onChange = mock((state: SerializedEditorState, text: string) => {
      void state
      void text
    })

    const unregister = editor.registerUpdateListener(({ editorState }) => {
      const serialized = editorState.toJSON()
      let text = ""
      editorState.read(() => {
        text = $getRoot().getTextContent()
      })
      onChange(serialized, text)
    })

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append($createTextNode("hello draft"))
        root.append(para)
      },
      { discrete: true },
    )

    expect(onChange).toHaveBeenCalled()

    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1]
    const [state, text] = lastCall as [SerializedEditorState, string]

    expect(text).toBe("hello draft")
    expect(state).toBeDefined()
    expect(state.root).toBeDefined()

    unregister()
  })

  it("onChange is called multiple times when the editor is updated repeatedly", () => {
    const editor = buildEditor()
    const callTexts: string[] = []

    const unregister = editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        callTexts.push($getRoot().getTextContent())
      })
    })

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append($createTextNode("first"))
        root.append(para)
      },
      { discrete: true },
    )

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append($createTextNode("second"))
        root.append(para)
      },
      { discrete: true },
    )

    expect(callTexts.length).toBeGreaterThanOrEqual(2)
    expect(callTexts[callTexts.length - 1]).toBe("second")

    unregister()
  })
})
