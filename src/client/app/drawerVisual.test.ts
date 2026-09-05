import { describe, expect, test } from "bun:test"
import type { DomPort } from "../ports/domPort"
import type { TimerPort } from "../ports/timerPort"
import { makeFakeDomPort, makeFakeTimerPort } from "../lib/testing/fakePorts"
import { createDrawerVisual } from "./drawerVisual"


interface Recorded {
  dom: DomPort
  timer: TimerPort
  props: Array<[string, string]>
  classes: Array<[string, boolean]>
  runTimers(): void
}

function recordingPorts(options: { reduceMotion?: boolean } = {}): Recorded {
  const props: Array<[string, string]> = []
  const classes: Array<[string, boolean]> = []
  const timeouts: Array<() => void> = []

  const dom: DomPort = {
    ...makeFakeDomPort(),
    setDocumentElementStyleProperty: (property: string, value: string) => {
      props.push([property, value])
    },
    toggleDocumentElementClass: (className: string, force: boolean) => {
      classes.push([className, force])
    },
    matchesMediaQuery: () => options.reduceMotion === true,
  }

  const timer: TimerPort = {
    ...makeFakeTimerPort(),
    setTimeout: (handler: () => void) => {
      timeouts.push(handler)
      return timeouts.length
    },
  }

  return {
    dom,
    timer,
    props,
    classes,
    runTimers: () => {
      for (const handler of timeouts.splice(0)) handler()
    },
  }
}

describe("drawerVisual", () => {
  test("the first track arms the class, and progress rides a CSS variable", () => {
    const ports = recordingPorts()
    const visual = createDrawerVisual(ports.dom, ports.timer)

    visual.track(0.25)
    visual.track(0.5)

    expect(ports.classes).toEqual([["kanna-drawer-dragging", true]])
    expect(ports.props).toEqual([
      ["--kanna-drawer-progress", "0.25"],
      ["--kanna-drawer-progress", "0.5"],
    ])
  })

  test("settling reaches the target and releases the class", async () => {
    const ports = recordingPorts()
    const visual = createDrawerVisual(ports.dom, ports.timer)

    visual.track(0.6)
    const settled = visual.settle(1)
    ports.runTimers()
    await settled

    expect(ports.props.at(-1)).toEqual(["--kanna-drawer-progress", ""])
    expect(ports.classes.at(-1)).toEqual(["kanna-drawer-dragging", false])
  })

  test("reduced motion jumps to the end state in one write", async () => {
    const ports = recordingPorts({ reduceMotion: true })
    const visual = createDrawerVisual(ports.dom, ports.timer)

    visual.track(0.3)
    await visual.settle(1)

    const progressWrites = ports.props.filter(([, value]) => value !== "")
    expect(progressWrites).toEqual([
      ["--kanna-drawer-progress", "0.3"],
      ["--kanna-drawer-progress", "1"],
    ])
    expect(ports.classes.at(-1)).toEqual(["kanna-drawer-dragging", false])
  })

  test("a cancelled gesture releases without animating", () => {
    const ports = recordingPorts()
    const visual = createDrawerVisual(ports.dom, ports.timer)

    visual.track(0.4)
    visual.release()

    expect(ports.classes.at(-1)).toEqual(["kanna-drawer-dragging", false])
    expect(ports.props.at(-1)).toEqual(["--kanna-drawer-progress", ""])
  })

  test("releasing twice is harmless, and settling without a drag does nothing", async () => {
    const ports = recordingPorts()
    const visual = createDrawerVisual(ports.dom, ports.timer)

    visual.release()
    await visual.settle(1)
    expect(ports.classes).toEqual([])
    expect(ports.props).toEqual([])

    visual.track(0.4)
    visual.release()
    visual.release()
    expect(ports.classes.filter(([, force]) => !force)).toHaveLength(1)
  })
})
