import { describe, expect, test } from "bun:test"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { CardDependencies, type BlockerCandidate } from "./CardDependencies"
import type { CardBlocker } from "../../../shared/boards/dependencies"
import type { ClientCommand } from "../../../shared/protocol"

const CANDIDATES: readonly BlockerCandidate[] = [
  { id: "card-1", title: "Regenerate the client" },
  { id: "card-2", title: "Ship the API schema" },
  { id: "card-3", title: "Update the docs" },
]

interface Harness {
  container: HTMLDivElement
  commands: ClientCommand[]
  errors: string[]
  changes: { count: number }
  unmount: () => void
}

async function mount(
  blockers: readonly CardBlocker[],
  options: { reject?: string } = {},
): Promise<Harness> {
  const commands: ClientCommand[] = []
  const errors: string[] = []
  const changes = { count: 0 }
  const socket = {
    command: <TResult,>(command: ClientCommand): Promise<TResult> => {
      commands.push(command)
      if (options.reject !== undefined) return Promise.reject(new Error(options.reject))
      return Promise.resolve(undefined as TResult)
    },
  }

  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <CardDependencies
        cardId="card-1"
        blockers={blockers}
        candidates={CANDIDATES}
        socket={socket}
        onChanged={() => {
          changes.count += 1
        }}
        onError={(message) => errors.push(message)}
      />,
    )
  })
  return {
    container,
    commands,
    errors,
    changes,
    unmount: () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

function removeButton(container: HTMLElement, title: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    `button[aria-label="Stop waiting on ${title}"]`,
  )
  if (!button) throw new Error(`no remove button for ${title} in: ${container.textContent ?? ""}`)
  return button
}

describe("CardDependencies", () => {
  test("lists each blocker, and marks a cleared one without relying on colour", async () => {
    const harness = await mount([
      { cardId: "card-2", title: "Ship the API schema", cleared: false },
      { cardId: "card-3", title: "Update the docs", cleared: true },
    ])
    expect(harness.container.textContent).toContain("Blocked by")
    expect(harness.container.textContent).toContain("Ship the API schema")
    expect(harness.container.textContent).toContain("Not done")
    expect(harness.container.textContent).toContain("Done")
    harness.unmount()
  })

  test("removing an edge sends unblock and reports the change", async () => {
    const harness = await mount([{ cardId: "card-2", title: "Ship the API schema", cleared: false }])
    await act(async () => {
      removeButton(harness.container, "Ship the API schema").click()
    })
    expect(harness.commands).toEqual([
      { type: "board.card.unblock", cardId: "card-1", blockedByCardId: "card-2" },
    ])
    expect(harness.changes.count).toBe(1)
    harness.unmount()
  })

  test("a refused write surfaces the server's own sentence", async () => {
    const harness = await mount([{ cardId: "card-2", title: "Ship the API schema", cleared: false }], {
      reject: 'that would make the work circular: "A" → "B" → "A"',
    })
    await act(async () => {
      removeButton(harness.container, "Ship the API schema").click()
    })
    expect(harness.errors).toEqual(['that would make the work circular: "A" → "B" → "A"'])
    expect(harness.changes.count).toBe(0)
    harness.unmount()
  })

  test("renders nothing when there is neither a blocker nor anything to offer", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <CardDependencies
          cardId="card-1"
          blockers={[]}
          candidates={[{ id: "card-1", title: "Regenerate the client" }]}
          socket={{ command: () => Promise.resolve(undefined as never) }}
          onChanged={() => undefined}
          onError={() => undefined}
        />,
      )
    })
    expect(container.textContent).toBe("")
    act(() => {
      root.unmount()
    })
    container.remove()
  })
})
