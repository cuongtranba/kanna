import { describe, expect, test } from "bun:test"
import { EMPTY_CHAT_ACTIVITY, type ChatActivity } from "./types"
import {
  EMPTY_STACK_ACTIVITY,
  aggregateStackActivity,
  formatStackActivity,
} from "./stack-activity"

function activity(overrides: Partial<ChatActivity> = {}): ChatActivity {
  return { ...EMPTY_CHAT_ACTIVITY, ...overrides }
}

describe("aggregateStackActivity", () => {
  test("an empty stack rolls up to nothing", () => {
    expect(aggregateStackActivity([])).toEqual(EMPTY_STACK_ACTIVITY)
  })

  test("idle chats contribute nothing", () => {
    expect(aggregateStackActivity([activity(), activity()])).toEqual(EMPTY_STACK_ACTIVITY)
  })

  test("sums the countable dimensions and counts the per-chat ones", () => {
    const rolled = aggregateStackActivity([
      activity({ agents: 2, backgroundTasks: 1 }),
      activity({ agents: 1, loop: { done: 3, total: 10 } }),
      activity({ workflow: { name: "review", agentCount: 4 }, awaitingAnswer: true }),
      activity(),
    ])
    expect(rolled).toEqual({
      activeChats: 3,
      agents: 3,
      loops: 1,
      workflows: 1,
      backgroundTasks: 1,
      awaitingAnswer: 1,
      failing: 0,
    })
  })

  test("counts a failing chat", () => {
    const rolled = aggregateStackActivity([activity({ lastRunFailure: { code: null } })])
    expect(rolled.failing).toBe(1)
    expect(rolled.activeChats).toBe(1)
  })
})

describe("formatStackActivity", () => {
  test("returns null when nothing is happening", () => {
    expect(formatStackActivity(EMPTY_STACK_ACTIVITY)).toBeNull()
  })

  test("singularises counts of one", () => {
    expect(formatStackActivity({ ...EMPTY_STACK_ACTIVITY, activeChats: 1, agents: 1 }))
      .toBe("1 agent")
    expect(formatStackActivity({ ...EMPTY_STACK_ACTIVITY, activeChats: 2, agents: 2 }))
      .toBe("2 agents")
  })

  test("leads with what blocks the user", () => {
    const label = formatStackActivity({
      activeChats: 3,
      agents: 4,
      loops: 1,
      workflows: 0,
      backgroundTasks: 0,
      awaitingAnswer: 1,
      failing: 1,
    })
    expect(label).toBe("1 awaiting, 1 failing, 4 agents, 1 loop")
  })
})
