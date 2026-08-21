import { beforeEach, describe, expect, test } from "bun:test"
import { migratePreferencesState, usePreferencesStore } from "./preferences"

describe("usePreferencesStore", () => {
  beforeEach(() => {
    usePreferencesStore.setState({
      autoResumeOnRateLimit: false,
      typographyOverride: undefined,
      typographyServerDefaultCache: undefined,
    })
  })

  test("autoResumeOnRateLimit defaults to false", () => {
    expect(usePreferencesStore.getState().autoResumeOnRateLimit).toBe(false)
  })

  test("setAutoResumeOnRateLimit updates state", () => {
    usePreferencesStore.getState().setAutoResumeOnRateLimit(true)
    expect(usePreferencesStore.getState().autoResumeOnRateLimit).toBe(true)
  })

  test("typographyOverride defaults to undefined", () => {
    expect(usePreferencesStore.getState().typographyOverride).toBeUndefined()
  })

  test("typographyServerDefaultCache defaults to undefined", () => {
    expect(usePreferencesStore.getState().typographyServerDefaultCache).toBeUndefined()
  })

  test("setTypographyOverride sets the device override", () => {
    usePreferencesStore.getState().setTypographyOverride("xl")
    expect(usePreferencesStore.getState().typographyOverride).toBe("xl")
  })

  test("clearTypographyOverride clears the device override", () => {
    usePreferencesStore.getState().setTypographyOverride("xl")
    usePreferencesStore.getState().clearTypographyOverride()
    expect(usePreferencesStore.getState().typographyOverride).toBeUndefined()
  })

  test("cacheTypographyServerDefault caches the server default", () => {
    usePreferencesStore.getState().cacheTypographyServerDefault("lg")
    expect(usePreferencesStore.getState().typographyServerDefaultCache).toBe("lg")
  })
})

describe("migratePreferencesState", () => {
  test("a v1 blob survives to v2 with autoResumeOnRateLimit intact and typography fields undefined", () => {
    const migrated = migratePreferencesState({ autoResumeOnRateLimit: true })

    expect(migrated.autoResumeOnRateLimit).toBe(true)
    expect(migrated.typographyOverride).toBeUndefined()
    expect(migrated.typographyServerDefaultCache).toBeUndefined()
  })

  test("garbage typography values are dropped to undefined while autoResumeOnRateLimit survives", () => {
    // biome-ignore lint/suspicious/noExplicitAny: simulating untrusted/hand-edited localStorage JSON
    const migrated = migratePreferencesState({
      autoResumeOnRateLimit: true,
      typographyOverride: "huge" as any,
      typographyServerDefaultCache: 12345 as any,
    })

    expect(migrated.autoResumeOnRateLimit).toBe(true)
    expect(migrated.typographyOverride).toBeUndefined()
    expect(migrated.typographyServerDefaultCache).toBeUndefined()
  })
})
