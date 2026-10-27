import { useEffect } from "react"
import {
  UPLOAD_DEFAULTS,
  UPLOAD_MAX_FILE_SIZE_MB_MAX,
  UPLOAD_MAX_FILE_SIZE_MB_MIN,
} from "../../shared/types"
import { DEFAULT_TAB_MIN_WIDTH, MAX_TAB_WIDTH, MIN_TAB_WIDTH, clampTabMinWidth } from "../../shared/pane-tab-width"
import { SettingsRow } from "../components/settings/SettingsList"
import { resolveNumberCommit } from "../lib/numberDraft"
import { selectMinColumnWidth, selectScrollbackLines, useAppSettingsStore } from "../stores/appSettingsStore"
import { useGeneralSettingsStore, type GeneralSettingsDrafts } from "../stores/generalSettingsStore"
import { usePreferencesStore } from "../stores/preferences"
import {
  DEFAULT_TERMINAL_MIN_COLUMN_WIDTH,
  DEFAULT_TERMINAL_SCROLLBACK,
  MAX_TERMINAL_MIN_COLUMN_WIDTH,
  MAX_TERMINAL_SCROLLBACK,
  MIN_TERMINAL_MIN_COLUMN_WIDTH,
  MIN_TERMINAL_SCROLLBACK,
  useTerminalPreferencesStore,
} from "../stores/terminalPreferencesStore"
import { AutoResumeToggleSection } from "./AutoResumeToggleSection"
import { SettingsNumberRow } from "./SettingsNumberRow"
import type { KannaState } from "./useKannaState"
import { useAppSettingsWriter } from "./useAppSettingsWriter"

type NumericDraftKey = keyof Pick<GeneralSettingsDrafts, "scrollback" | "minColumnWidth" | "tabMinWidth">

function useNumericDraft(key: NumericDraftKey, current: number) {
  const draft = useGeneralSettingsStore((s) => s.drafts[key])
  const patchDrafts = useGeneralSettingsStore((s) => s.patchDrafts)
  useEffect(() => {
    patchDrafts({ [key]: String(current) })
  }, [key, current, patchDrafts])
  return {
    draft,
    setDraft: (value: string) => patchDrafts({ [key]: value }),
    parsed: (): number | null => {
      const value = Number(draft)
      return Number.isFinite(value) ? value : null
    },
    reset: () => patchDrafts({ [key]: String(current) }),
  }
}

function ScrollbackRow({ state }: { state: Pick<KannaState, "handleWriteAppSettings"> }) {
  const { write } = useAppSettingsWriter(state)
  const scrollbackLines = useAppSettingsStore(selectScrollbackLines)
  const setScrollbackLines = useTerminalPreferencesStore((store) => store.setScrollbackLines)
  const field = useNumericDraft("scrollback", scrollbackLines)

  function commit() {
    const nextValue = field.parsed()
    if (nextValue === null) {
      field.reset()
      return
    }
    setScrollbackLines(nextValue)
    write({ terminal: { scrollbackLines: nextValue } })
  }

  return (
    <SettingsNumberRow
      title="Terminal Scrollback"
      description="Lines retained for embedded terminal history"
      min={MIN_TERMINAL_SCROLLBACK}
      max={MAX_TERMINAL_SCROLLBACK}
      step={100}
      value={field.draft}
      onValueChange={field.setDraft}
      onCommit={commit}
      hint={
        <>
          {MIN_TERMINAL_SCROLLBACK}-{MAX_TERMINAL_SCROLLBACK} lines
          {scrollbackLines === DEFAULT_TERMINAL_SCROLLBACK ? " (default)" : ""}
        </>
      }
    />
  )
}

function MinColumnWidthRow({ state }: { state: Pick<KannaState, "handleWriteAppSettings"> }) {
  const { write } = useAppSettingsWriter(state)
  const minColumnWidth = useAppSettingsStore(selectMinColumnWidth)
  const setMinColumnWidth = useTerminalPreferencesStore((store) => store.setMinColumnWidth)
  const field = useNumericDraft("minColumnWidth", minColumnWidth)

  function commit() {
    const nextValue = field.parsed()
    if (nextValue === null) {
      field.reset()
      return
    }
    setMinColumnWidth(nextValue)
    write({ terminal: { minColumnWidth: nextValue } })
  }

  return (
    <SettingsNumberRow
      title="Terminal Min Column Width"
      description="Minimum width for each terminal pane"
      min={MIN_TERMINAL_MIN_COLUMN_WIDTH}
      max={MAX_TERMINAL_MIN_COLUMN_WIDTH}
      step={10}
      value={field.draft}
      onValueChange={field.setDraft}
      onCommit={commit}
      hint={
        <>
          {MIN_TERMINAL_MIN_COLUMN_WIDTH}-{MAX_TERMINAL_MIN_COLUMN_WIDTH} px
          {minColumnWidth === DEFAULT_TERMINAL_MIN_COLUMN_WIDTH ? " (default)" : ""}
        </>
      }
    />
  )
}

function TabMinWidthRow({ state }: { state: Pick<KannaState, "handleWriteAppSettings"> }) {
  const { write } = useAppSettingsWriter(state)
  const tabMinWidth = useAppSettingsStore((s) => s.settings?.panes.tabMinWidth ?? DEFAULT_TAB_MIN_WIDTH)
  const field = useNumericDraft("tabMinWidth", tabMinWidth)

  function commit() {
    const nextValue = field.parsed()
    if (nextValue === null) {
      field.reset()
      return
    }
    write({ panes: { tabMinWidth: clampTabMinWidth(nextValue) } })
  }

  return (
    <SettingsNumberRow
      title="Tab Minimum Width"
      description="How narrow a pane tab may get before the strip scrolls instead of shrinking"
      min={MIN_TAB_WIDTH}
      max={MAX_TAB_WIDTH}
      step={10}
      value={field.draft}
      onValueChange={field.setDraft}
      onCommit={commit}
      hint={
        <>
          {MIN_TAB_WIDTH}-{MAX_TAB_WIDTH} px
          {tabMinWidth === DEFAULT_TAB_MIN_WIDTH ? " (default)" : ""}
        </>
      }
    />
  )
}

function UploadMaxFileSizeRow({ state }: { state: Pick<KannaState, "handleWriteAppSettings"> }) {
  const { write } = useAppSettingsWriter(state)
  const uploadMaxFileSizeMb = useAppSettingsStore((s) => s.settings?.uploads.maxFileSizeMb ?? UPLOAD_DEFAULTS.maxFileSizeMb)
  const draft = useGeneralSettingsStore((s) => s.drafts.uploadMaxFileSize)
  const patchDrafts = useGeneralSettingsStore((s) => s.patchDrafts)
  const setAppSettingsError = useGeneralSettingsStore((s) => s.setAppSettingsError)

  useEffect(() => {
    patchDrafts({ uploadMaxFileSize: String(uploadMaxFileSizeMb) })
  }, [uploadMaxFileSizeMb, patchDrafts])

  function commit() {
    const result = resolveNumberCommit(draft, uploadMaxFileSizeMb, {
      min: UPLOAD_MAX_FILE_SIZE_MB_MIN,
      max: UPLOAD_MAX_FILE_SIZE_MB_MAX,
      whole: "round",
    })
    if (result.kind !== "write") {
      patchDrafts({ uploadMaxFileSize: String(uploadMaxFileSizeMb) })
      if (result.kind === "invalid") {
        setAppSettingsError(`Max file size must be between ${UPLOAD_MAX_FILE_SIZE_MB_MIN} and ${UPLOAD_MAX_FILE_SIZE_MB_MAX} MB.`)
      }
      return
    }
    write({ uploads: { maxFileSizeMb: result.value } })
  }

  return (
    <SettingsNumberRow
      title="Max upload file size"
      description="Largest single file the chat upload endpoint accepts."
      min={UPLOAD_MAX_FILE_SIZE_MB_MIN}
      max={UPLOAD_MAX_FILE_SIZE_MB_MAX}
      step={1}
      value={draft}
      onValueChange={(value) => patchDrafts({ uploadMaxFileSize: value })}
      onCommit={commit}
      unit="MB"
      ariaLabel="Max upload file size in megabytes"
      hint={`${UPLOAD_MAX_FILE_SIZE_MB_MIN}–${UPLOAD_MAX_FILE_SIZE_MB_MAX} MB · default ${UPLOAD_DEFAULTS.maxFileSizeMb}`}
    />
  )
}

export function GeneralTerminalRows({ state }: { state: Pick<KannaState, "handleWriteAppSettings"> }) {
  const autoResumeOnRateLimit = usePreferencesStore((preferences) => preferences.autoResumeOnRateLimit)
  const setAutoResumeOnRateLimit = usePreferencesStore((preferences) => preferences.setAutoResumeOnRateLimit)
  return (
    <>
      <ScrollbackRow state={state} />
      <MinColumnWidthRow state={state} />
      <TabMinWidthRow state={state} />
      <UploadMaxFileSizeRow state={state} />
      <SettingsRow
        title="Auto-resume on rate limit"
        description={'When you hit a rate limit, automatically schedule "continue" at the reset time instead of asking. You can still cancel each one from the chat.'}
      >
        <AutoResumeToggleSection
          checked={autoResumeOnRateLimit}
          onChange={setAutoResumeOnRateLimit}
        />
      </SettingsRow>
    </>
  )
}
