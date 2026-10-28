import { useEffect } from "react"
import { Monitor, Moon, Sun } from "lucide-react"
import { APP_VERSION } from "../../shared/branding"
import { isChatSoundId, isChatSoundPreference, isEditorPreset, type UpdateSnapshot } from "../../shared/types"
import { isFontScaleStep, resolveEffectiveScaleStep, type FontScaleStep } from "../../shared/design/typography"
import type { EditorPreset } from "../../shared/protocol"
import { EDITOR_OPTIONS, EditorIcon } from "../components/editor-icons"
import { SettingsRow } from "../components/settings/SettingsList"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { SegmentedControl } from "../components/ui/segmented-control"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select"
import { useTheme, type ThemePreference } from "../hooks/useTheme"
import { playChatNotificationSound } from "../lib/chatSounds"
import { runDetached } from "../lib/runDetached"
import { handleTextInputKeyDown } from "../lib/settings-input"
import {
  selectChatSoundId,
  selectChatSoundPreference,
  selectEditorCommandTemplate,
  selectEditorPreset,
  useAppSettingsStore,
} from "../stores/appSettingsStore"
import {
  CHAT_SOUND_OPTIONS,
  useChatSoundPreferencesStore,
  type ChatSoundId,
  type ChatSoundPreference,
} from "../stores/chatSoundPreferencesStore"
import { useGeneralSettingsStore } from "../stores/generalSettingsStore"
import { runPendingAction, usePendingAction } from "../stores/pendingActionsStore"
import { usePreferencesStore } from "../stores/preferences"
import { getDefaultEditorCommandTemplate, useTerminalPreferencesStore } from "../stores/terminalPreferencesStore"
import type { KannaState } from "./useKannaState"
import { useAppSettingsWriter } from "./useAppSettingsWriter"

const themeOptions: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
]

const typographyScaleOptions: { value: FontScaleStep; label: string }[] = [
  { value: "sm", label: "Small" },
  { value: "md", label: "Default" },
  { value: "lg", label: "Large" },
  { value: "xl", label: "Extra Large" },
  { value: "xxl", label: "XX-Large" },
]

const chatSoundPreferenceOptions: { value: ChatSoundPreference; label: string }[] = [
  { value: "never", label: "Never" },
  { value: "unfocused", label: "When Unfocused" },
  { value: "always", label: "Always" },
]

const CHAT_SOUND_PREFERENCE_KEY = "settings.chatSoundPreference"
const CHAT_SOUND_ID_KEY = "settings.chatSoundId"

export function shouldPreviewChatSoundChange(
  previousValue: string,
  nextValue: string
) {
  return previousValue !== nextValue
}

function updateStatusLabel(snapshot: UpdateSnapshot | null): string {
  if (snapshot?.status === "checking") return "Checking for updates…"
  if (snapshot?.status === "updating") return "Installing update…"
  if (snapshot?.status === "restart_pending") return "Restarting Kanna…"
  if (snapshot?.status === "available") {
    return `Update available${snapshot.latestVersion ? `: ${snapshot.latestVersion}` : ""}`
  }
  if (snapshot?.status === "up_to_date") return "Up to date"
  if (snapshot?.status === "error") return "Update check failed"
  return "Not checked yet"
}

function ApplicationUpdateRow({ updateSnapshot }: { updateSnapshot: UpdateSnapshot | null }) {
  return (
    <SettingsRow
      title="Application Update"
      description={(
        <>
          <span>{updateStatusLabel(updateSnapshot)}.</span>
          {updateSnapshot?.lastCheckedAt ? (
            <span> Last checked {new Intl.DateTimeFormat(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            }).format(updateSnapshot.lastCheckedAt)}.</span>
          ) : null}
          {updateSnapshot?.error ? (
            <span> {updateSnapshot.error}</span>
          ) : null}
        </>
      )}
      bordered={false}
    >
      <div className="text-right text-sm text-foreground">
        <div>Current: {updateSnapshot?.currentVersion ?? APP_VERSION}</div>
        <div className="text-xs text-muted-foreground">
          Latest: {updateSnapshot?.latestVersion ?? "Unknown"}
        </div>
      </div>
    </SettingsRow>
  )
}

function ChatSoundRows({ state }: { state: Pick<KannaState, "handleWriteAppSettings"> }) {
  const { writeAsync } = useAppSettingsWriter(state)
  const chatSoundPreference = useAppSettingsStore(selectChatSoundPreference)
  const chatSoundId = useAppSettingsStore(selectChatSoundId)
  const setChatSoundPreference = useChatSoundPreferencesStore((store) => store.setChatSoundPreference)
  const setChatSoundId = useChatSoundPreferencesStore((store) => store.setChatSoundId)
  const chatSoundPreferenceSaving = usePendingAction(CHAT_SOUND_PREFERENCE_KEY)
  const chatSoundIdSaving = usePendingAction(CHAT_SOUND_ID_KEY)

  function handleChatSoundPreferenceChange(nextValue: ChatSoundPreference) {
    if (!shouldPreviewChatSoundChange(chatSoundPreference, nextValue)) {
      return
    }

    setChatSoundPreference(nextValue)
    runPendingAction(CHAT_SOUND_PREFERENCE_KEY, () => writeAsync({ chatSoundPreference: nextValue }))
    runDetached("chat sound preview", playChatNotificationSound(chatSoundId, 1))
  }

  function handleChatSoundIdChange(nextValue: ChatSoundId) {
    if (!shouldPreviewChatSoundChange(chatSoundId, nextValue)) {
      return
    }

    setChatSoundId(nextValue)
    runPendingAction(CHAT_SOUND_ID_KEY, () => writeAsync({ chatSoundId: nextValue }))
    runDetached("chat sound preview", playChatNotificationSound(nextValue, 1))
  }

  return (
    <>
      <SettingsRow
        title="Chat Sounds"
        description="Play a pop when a chat starts waiting on you or the unread chat count increases"
      >
        <Select
          disabled={chatSoundPreferenceSaving}
          value={chatSoundPreference}
          onValueChange={(value) => { if (isChatSoundPreference(value)) handleChatSoundPreferenceChange(value) }}
        >
          <SelectTrigger className="min-w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {chatSoundPreferenceOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingsRow>

      <SettingsRow
        title="Chat Sound"
        description="The bundled sound used for chat notification playback and previews"
      >
        <Select
          disabled={chatSoundIdSaving}
          value={chatSoundId}
          onValueChange={(value) => { if (isChatSoundId(value)) handleChatSoundIdChange(value) }}
        >
          <SelectTrigger className="min-w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {CHAT_SOUND_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingsRow>
    </>
  )
}

function DefaultEditorRows({ state }: { state: Pick<KannaState, "handleWriteAppSettings"> }) {
  const { write } = useAppSettingsWriter(state)
  const editorPreset = useAppSettingsStore(selectEditorPreset)
  const editorCommandTemplate = useAppSettingsStore(selectEditorCommandTemplate)
  const setEditorPreset = useTerminalPreferencesStore((store) => store.setEditorPreset)
  const setEditorCommandTemplate = useTerminalPreferencesStore((store) => store.setEditorCommandTemplate)
  const editorCommandDraft = useGeneralSettingsStore((s) => s.drafts.editorCommand)
  const patchDrafts = useGeneralSettingsStore((s) => s.patchDrafts)

  useEffect(() => {
    patchDrafts({ editorCommand: editorCommandTemplate })
  }, [editorCommandTemplate, patchDrafts])

  function commitEditorCommand() {
    setEditorCommandTemplate(editorCommandDraft)
    write({ editor: { commandTemplate: editorCommandDraft } })
  }

  function handleEditorPresetChange(nextPreset: EditorPreset) {
    setEditorPreset(nextPreset)
    const commandTemplate = nextPreset === "custom" ? editorCommandTemplate : getDefaultEditorCommandTemplate(nextPreset)
    write({
      editor: {
        preset: nextPreset,
        commandTemplate,
      },
    })
  }

  const customEditorPreview = editorCommandDraft
    .replaceAll("{path}", "/Users/jake/Projects/kanna/src/client/app/App.tsx")
    .replaceAll("{line}", "12")
    .replaceAll("{column}", "1")

  return (
    <>
      <SettingsRow
        title="Default Editor"
        description="Used when opening transcript links or files from the git diff menu"
        alignStart
      >
        <Select
          value={editorPreset}
          onValueChange={(value) => { if (isEditorPreset(value)) handleEditorPresetChange(value) }}
        >
          <SelectTrigger className="min-w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {EDITOR_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <span className="flex items-center gap-2">
                    <EditorIcon preset={option.value} className="h-4 w-4 shrink-0" />
                    <span>{option.label}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingsRow>

      {editorPreset === "custom" ? (
        <div className="border-t border-border">
          <div className="flex justify-between gap-8 py-5 pl-6">
            <div className="min-w-0 max-w-xl">
              <div className="text-sm font-medium text-foreground">Command Template</div>
              <div className="mt-1 text-13 text-muted-foreground">
                Include {"{path}"} and optionally {"{line}"} and {"{column}"} in your command.
              </div>
            </div>
            <div className="flex min-w-0 max-w-[420px] flex-1 flex-col items-stretch gap-2">
              <Input
                type="text"
                value={editorCommandDraft}
                onChange={(event) => patchDrafts({ editorCommand: event.target.value })}
                onBlur={commitEditorCommand}
                onKeyDown={(event) => handleTextInputKeyDown(event, commitEditorCommand)}
                className="font-mono"
              />
              <div className="text-xs text-muted-foreground">
                Preview: <span className="font-mono">{customEditorPreview}</span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

export function GeneralAppearanceRows({ state }: { state: Pick<KannaState, "handleWriteAppSettings" | "updateSnapshot"> }) {
  const { write } = useAppSettingsWriter(state)
  const { theme, setTheme } = useTheme()
  const typographyOverride = usePreferencesStore((preferences) => preferences.typographyOverride)
  const clearTypographyOverride = usePreferencesStore((preferences) => preferences.clearTypographyOverride)
  const typographyServerDefault = useAppSettingsStore((store) => store.settings?.typography.scale)
  const effectiveTypographyScale = resolveEffectiveScaleStep(typographyOverride, typographyServerDefault)

  function handleThemeChange(nextTheme: ThemePreference) {
    setTheme(nextTheme)
    write({ theme: nextTheme })
  }

  return (
    <>
      <ApplicationUpdateRow updateSnapshot={state.updateSnapshot} />

      <SettingsRow
        title="Theme"
        description="Choose between light, dark, or system appearance"
      >
        <SegmentedControl
          value={theme}
          onValueChange={handleThemeChange}
          options={themeOptions}
          size="sm"
        />
      </SettingsRow>

      <SettingsRow
        title="Typography Scale"
        description={
          typographyOverride
            ? "This device uses its own text size instead of the account default."
            : "Choose how large text and UI elements appear across the app."
        }
      >
        <div className="flex items-center gap-3">
          <Select
            value={effectiveTypographyScale}
            onValueChange={(value) => { if (isFontScaleStep(value)) write({ typography: { scale: value } }) }}
          >
            <SelectTrigger className="min-w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {typographyScaleOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {typographyOverride ? (
            <Button type="button" variant="link" size="sm" onClick={clearTypographyOverride}>
              Use account default
            </Button>
          ) : null}
        </div>
      </SettingsRow>

      <ChatSoundRows state={state} />
      <DefaultEditorRows state={state} />
    </>
  )
}
