import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import { defaultAppSettingsSnapshot } from "../../server/app-settings"
import { DISABLED_SERVICE_BUS_STATUS, SERVICE_BUS_PUBLIC_DEFAULTS, type ServiceBusSettingsPublic, type ServiceBusStatus } from "../../shared/service-bus/jetstream-config"
import type { AppSettingsPatch } from "../../shared/types"
import { renderClientMarkup } from "../lib/testing/renderClientMarkup"
import { renderForLoopCheck } from "../lib/testing/renderForLoopCheck"
import { selectServiceBusSettings, useAppSettingsStore } from "../stores/appSettingsStore"
import { useServiceBusSectionStore } from "../stores/serviceBusSectionStore"
import { selectServiceBusStatus, useServiceBusStore } from "../stores/serviceBusStore"
import { ServiceBusSection } from "./ServiceBusSection"

const APP_SETTINGS_INITIAL = useAppSettingsStore.getInitialState()
const SECTION_INITIAL = useServiceBusSectionStore.getInitialState()
const STATUS_INITIAL = useServiceBusStore.getInitialState()

afterEach(() => {
  useAppSettingsStore.setState(APP_SETTINGS_INITIAL)
  useServiceBusSectionStore.setState(SECTION_INITIAL)
  useServiceBusStore.setState(STATUS_INITIAL)
})

function seed(serviceBus: Partial<ServiceBusSettingsPublic>, status: Partial<ServiceBusStatus> = {}) {
  useAppSettingsStore.getState().setFromServer({
    ...defaultAppSettingsSnapshot(),
    serviceBus: { ...SERVICE_BUS_PUBLIC_DEFAULTS, ...serviceBus },
  })
  useServiceBusStore.getState().setStatus({ ...DISABLED_SERVICE_BUS_STATUS, ...status })
}

function recordingState() {
  const patches: AppSettingsPatch[] = []
  return {
    patches,
    state: {
      handleWriteAppSettings: async (patch: AppSettingsPatch) => {
        patches.push(patch)
      },
    },
  }
}

function buttonWithText(container: HTMLElement, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === text)
  if (!found) throw new Error(`no button "${text}"`)
  return found
}

async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition was not reached")
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 5))
    })
  }
}

describe("ServiceBusSection", () => {
  test("a disabled embedded bus explains the download and offers to install and start", async () => {
    seed({})
    const rendered = await renderClientMarkup(<ServiceBusSection state={recordingState().state} />)

    expect(rendered.html).toContain("downloads nats-server v2.15.1")
    expect(rendered.html).toContain("Disabled")
    expect(rendered.html).toContain("Install &amp; start")
    expect(rendered.html).not.toContain("Server URL")
    expect(rendered.html).toContain("Embedded server")
    await rendered.cleanup()
  })

  test("a connected bus shows the stream facts with grouped numbers and no start button", async () => {
    seed(
      { enabled: true },
      {
        state: "connected",
        published: 12,
        stream: { name: "KANNA", messages: 1234, bytes: 2_621_440, firstSeq: 1, lastSeq: 1234 },
        serverVersion: "2.15.1",
        port: 50555,
      },
    )
    const rendered = await renderClientMarkup(<ServiceBusSection state={recordingState().state} />)

    expect(rendered.html).toContain("Connected")
    expect(rendered.html).toContain("1,234")
    expect(rendered.html).toContain("2.5 MB")
    expect(rendered.html).toContain("v2.15.1 · :50555")
    expect(rendered.html).not.toContain("Install &amp; start")
    expect(rendered.html).toContain("tabular-nums")
    await rendered.cleanup()
  })

  test("an errored embedded bus shows the reason and a retry", async () => {
    seed({ enabled: true }, { state: "error", lastError: "download failed" })
    const rendered = await renderClientMarkup(<ServiceBusSection state={recordingState().state} />)

    expect(rendered.html).toContain("download failed")
    expect(buttonWithText(rendered.container, "Retry")).toBeTruthy()
    await rendered.cleanup()
  })

  test("external mode asks for the server url and shows only the token hint", async () => {
    seed({ enabled: true, mode: "external", url: "nats://bus.local:4222", tokenHint: "wxyz" })
    const rendered = await renderClientMarkup(<ServiceBusSection state={recordingState().state} />)

    expect(rendered.html).toContain("Server URL")
    expect(rendered.html).toContain("nats://bus.local:4222")
    expect(rendered.html).toContain("ending in wxyz")
    expect(rendered.html).not.toContain("Embedded server")
    await rendered.cleanup()
  })

  test("the stream group warns about recreating and lowering limits", async () => {
    seed({})
    const rendered = await renderClientMarkup(<ServiceBusSection state={recordingState().state} />)

    expect(rendered.html).toContain("Changing this requires recreating the stream")
    expect(rendered.html).toContain("Lowering this drops older messages")
    await rendered.cleanup()
  })

  test("lists configured consumers with their live backlog", async () => {
    seed(
      {
        enabled: true,
        consumers: [{ durableName: "billing", filterSubject: "kanna.chat.>", ackPolicy: "explicit", deliverPolicy: "new", maxAckPending: 10, ackWaitSec: 30 }],
      },
      { state: "connected", consumers: [{ name: "billing", pending: 7, ackPending: 2 }] },
    )
    const rendered = await renderClientMarkup(<ServiceBusSection state={recordingState().state} />)

    expect(rendered.html).toContain("billing")
    expect(rendered.html).toContain("kanna.chat.&gt;")
    expect(rendered.html).toContain("7 pending")
    expect(rendered.html).toContain("2 ack pending")
    await rendered.cleanup()
  })

  test("install and start writes enabled: true", async () => {
    seed({})
    const { patches, state } = recordingState()
    const rendered = await renderClientMarkup(<ServiceBusSection state={state} />)

    await act(async () => {
      buttonWithText(rendered.container, "Install & start").click()
    })
    await until(() => patches.length === 1)

    expect(patches).toEqual([{ serviceBus: { enabled: true } }])
    await rendered.cleanup()
  })

  test("adding a consumer with a duplicate name shows the validation message and blocks saving", async () => {
    seed({
      consumers: [{ durableName: "reader", filterSubject: "kanna.>", ackPolicy: "explicit", deliverPolicy: "all", maxAckPending: 10, ackWaitSec: 30 }],
    })
    const { patches, state } = recordingState()
    const rendered = await renderClientMarkup(<ServiceBusSection state={state} />)

    await act(async () => {
      buttonWithText(rendered.container, "Add consumer").click()
    })
    const name = rendered.container.querySelector<HTMLInputElement>("input[aria-label='Durable name']")
    if (!name) throw new Error("no name field")
    await act(async () => {
      useServiceBusSectionStore.getState().editConsumer({ durableName: "reader" })
    })

    expect(rendered.container.textContent).toContain("used twice")
    expect(buttonWithText(rendered.container, "Save consumer").disabled).toBe(true)
    expect(patches).toEqual([])
    await rendered.cleanup()
  })

  test("saving a valid new consumer appends it to the saved list", async () => {
    seed({})
    const { patches, state } = recordingState()
    const rendered = await renderClientMarkup(<ServiceBusSection state={state} />)

    await act(async () => {
      buttonWithText(rendered.container, "Add consumer").click()
    })
    await act(async () => {
      useServiceBusSectionStore.getState().editConsumer({ durableName: "audit" })
    })
    await act(async () => {
      buttonWithText(rendered.container, "Save consumer").click()
    })
    await until(() => patches.length === 1)

    expect(patches[0]?.serviceBus?.consumers).toEqual([
      { durableName: "audit", filterSubject: "kanna.>", ackPolicy: "explicit", deliverPolicy: "all", maxAckPending: 1000, ackWaitSec: 30 },
    ])
    await rendered.cleanup()
  })

  test("an out-of-range stream value shows an inline message and disables saving", async () => {
    seed({})
    const rendered = await renderClientMarkup(<ServiceBusSection state={recordingState().state} />)

    await act(async () => {
      useServiceBusSectionStore.getState().editStream(
        { name: "KANNA", subjectPrefix: "kanna", extraSubjects: "", retention: "limits", storage: "file", maxAgeDays: "30", maxBytesMb: "512", maxMsgs: "-1", discard: "old", duplicateWindowSec: "120", replicas: "1" },
        { replicas: "9" },
      )
    })

    expect(rendered.container.textContent).toContain("Replicas must be 1–5")
    expect(buttonWithText(rendered.container, "Save stream").disabled).toBe(true)
    await rendered.cleanup()
  })

  test("reset store asks for confirmation before offering the destructive action", async () => {
    seed({ enabled: true })
    const rendered = await renderClientMarkup(<ServiceBusSection state={recordingState().state} />)
    expect(rendered.container.textContent).not.toContain("Delete the store")

    await act(async () => {
      buttonWithText(rendered.container, "Reset store").click()
    })

    expect(buttonWithText(rendered.container, "Delete the store")).toBeTruthy()
    await rendered.cleanup()
  })

  test("mounting reads only stable selectors and does not loop", async () => {
    seed({ enabled: true }, { state: "connected" })
    const result = await renderForLoopCheck(<ServiceBusSection state={recordingState().state} />)

    expect(result.loopWarnings).toEqual([])
    expect(result.thrown).toBeNull()
    await result.cleanup()
  })
})

describe("service bus selectors", () => {
  test("return the same reference until the store changes", () => {
    const first = selectServiceBusStatus(useServiceBusStore.getState())
    const second = selectServiceBusStatus(useServiceBusStore.getState())
    expect(second).toBe(first)
    expect(selectServiceBusSettings(useAppSettingsStore.getState())).toBe(selectServiceBusSettings(useAppSettingsStore.getState()))
  })
})
