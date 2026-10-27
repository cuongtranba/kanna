import { useEffect, useMemo, type ComponentType } from "react"
import { motion } from "motion/react"
import { MOTION_SPRING } from "../lib/motion"
import { fetchAuthStatus } from "../api/auth"
import {
  Blocks,
  BookText,
  Bot,
  CircleArrowUp,
  Command,
  Code,
  Cpu,
  Info,
  Loader2,
  Menu,
  MessageSquareQuote,
  Plug,
  Network,
  Radio,
  Settings2,
  LogOut,
  Type,
  Antenna,
  Waypoints,
} from "lucide-react"
import { useNavigate, useOutletContext } from "react-router-dom"
import { APP_VERSION, getKeybindingsFilePathDisplay } from "../../shared/branding"
import { HoverHint } from "../components/ui/truncated-text"
import { SettingsHeaderButton } from "../components/ui/settings-header-button"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select"
import { Spinner } from "../components/ui/spinner"
import { getResolvedKeybindings } from "../lib/keybindings"
import { runDetached } from "../lib/runDetached"
import { selectPluginsEnabled, useAppSettingsStore } from "../stores/appSettingsStore"
import { useAuthStatusStore } from "../stores/authStatusStore"
import { runPendingAction, usePendingAction } from "../stores/pendingActionsStore"
import { BeaconsSettingsBranch } from "./BeaconsSection"
import { ChangelogSettingsBranch } from "./ChangelogSettingsBranch"
import { GeneralSettingsBranch } from "./GeneralSettingsBranch"
import { GlobalInstructionsSection } from "./GlobalInstructionsSection"
import { KannaPluginsSettingsBranch } from "./KannaPluginsSettingsBranch"
import { KeybindingsSection } from "./KeybindingsSection"
import { McpServersSettingsBranch } from "./McpServersSection"
import { McpSourcesSettingsBranch } from "./McpSourcesSection"
import { ModelsSettingsBranch } from "./ModelsSection"
import { ProvidersSettingsBranch } from "./ProvidersSettingsBranch"
import { ServiceBusSection } from "./ServiceBusSection"
import { SkillsSection } from "./SkillsSection"
import { SubagentsSettingsBranch } from "./SubagentsSection"
import { TextSnippetsSettingsBranch } from "./TextSnippetsSection"
import { CliPluginPackagesSection } from "../components/settings/CliPluginPackagesSection"
import { RemoteMcpSection } from "../components/settings/RemoteMcpSection"
import type { KannaState } from "./useKannaState"

const SIGN_OUT_KEY = "auth.signOut"

const sidebarItems = [
  {
    id: "general",
    label: "General",
    icon: Settings2,
    subtitle: "Manage appearance, editor behavior, and embedded terminal defaults.",
  },
  {
    id: "skills",
    label: "Skills",
    icon: BookText,
    subtitle: "Manage globally installed agent skills from the active skill lock file.",
  },
  {
    id: "plugins",
    label: "Plugins",
    icon: Plug,
    subtitle: "View and update globally installed Claude Code and Codex plugins.",
  },
  {
    id: "kanna-plugins",
    label: "Kanna plugins",
    icon: Blocks,
    subtitle: "Install local Kanna plugins that contribute UI surfaces and daemon behavior.",
  },
  {
    id: "providers",
    label: "Providers",
    icon: MessageSquareQuote,
    subtitle: "Manage the default chat provider and saved model defaults for Claude Code and Codex.",
  },
  {
    id: "models",
    label: "Models",
    icon: Cpu,
    subtitle: "Add, edit, and remove Claude and Codex models available in the model picker.",
  },
  {
    id: "subagents",
    label: "Subagents",
    icon: Bot,
    subtitle: "Define reusable agent personas. Mention them in chat with @agent/<name>.",
  },
  {
    id: "mcp-servers",
    label: "MCP servers",
    icon: Plug,
    subtitle: "Install custom MCP servers (stdio, http, sse, ws) and connect-test them.",
  },
  {
    id: "mcp-sources",
    label: "MCP sources",
    icon: Antenna,
    subtitle: "Bring messages from an MCP server, such as Zalo, into the Inbox by subscription or polling.",
  },
  {
    id: "remote-mcp",
    label: "Remote MCP",
    icon: Network,
    subtitle: "Let Claude, Codex and ChatGPT drive Kanna over MCP, with setup snippets for each client.",
  },
  {
    id: "service-bus",
    label: "Service bus",
    icon: Waypoints,
    subtitle: "Mirror Kanna's events into NATS JetStream, with an embedded or your own server.",
  },
  {
    id: "beacons",
    label: "Beacons",
    icon: Radio,
    subtitle: "Pair your own machines so the agent can read files and run approved commands there.",
  },
  {
    id: "snippets",
    label: "Text snippets",
    icon: Type,
    subtitle: "Define shortcuts that expand to full text in the chat composer with Tab.",
  },
  {
    id: "instructions",
    label: "Instructions",
    icon: MessageSquareQuote,
    subtitle: "Global instructions appended to every Claude and Codex turn (main + subagents).",
  },
  {
    id: "keybindings",
    label: "Keybindings",
    icon: Command,
    subtitle: "Edit global app shortcuts stored in the active keybindings file.",
  },
  {
    id: "changelog",
    label: "Changelog",
    icon: BookText,
    subtitle: "Release notes pulled from the public GitHub releases feed.",
  },
] as const
type SidebarItem = (typeof sidebarItems)[number]
type SidebarPageId = SidebarItem["id"]

const SETTINGS_PAGES: Record<SidebarPageId, ComponentType<{ state: KannaState }>> = {
  general: GeneralSettingsBranch,
  skills: SkillsSection,
  plugins: CliPluginPackagesSection,
  "kanna-plugins": KannaPluginsSettingsBranch,
  providers: ProvidersSettingsBranch,
  models: ModelsSettingsBranch,
  subagents: SubagentsSettingsBranch,
  "mcp-servers": McpServersSettingsBranch,
  "mcp-sources": McpSourcesSettingsBranch,
  "remote-mcp": RemoteMcpSection,
  "service-bus": ServiceBusSection,
  beacons: BeaconsSettingsBranch,
  snippets: TextSnippetsSettingsBranch,
  instructions: GlobalInstructionsSection,
  keybindings: KeybindingsSection,
  changelog: ChangelogSettingsBranch,
}

export function resolveSettingsSectionId(sectionId: string | undefined): SidebarPageId | null {
  if (!sectionId) return null
  return sidebarItems.find((item) => item.id === sectionId)?.id ?? null
}

export function visibleSettingsSidebarItems(pluginsEnabled: boolean): readonly SidebarItem[] {
  if (pluginsEnabled) return sidebarItems
  return sidebarItems.filter((item) => item.id !== "kanna-plugins")
}

export function getKeybindingsSubtitle(filePathDisplay: string) {
  return `Edit global app shortcuts stored in ${filePathDisplay}.`
}

export function SettingsPage({ sectionId }: { sectionId?: string } = {}) {
  const navigate = useNavigate()
  const state = useOutletContext<KannaState>()
  const signingOut = usePendingAction(SIGN_OUT_KEY)
  const authEnabled = useAuthStatusStore((s) => s.authEnabled)
  const setAuthEnabled = useAuthStatusStore((s) => s.setAuthEnabled)
  const selectedPage = resolveSettingsSectionId(sectionId) ?? "general"
  const SelectedPage = SETTINGS_PAGES[selectedPage]
  const appSettingsLoading = useAppSettingsStore((s) => s.hydrationStatus === "loading" && s.settings === null)
  const isConnecting = state.connectionStatus === "connecting" || !state.localProjectsReady || appSettingsLoading
  const openingKeybindings = usePendingAction("keybindings.openEditor")
  const machineName = state.localProjects?.machine.displayName ?? "Unavailable"
  const projectCount = state.localProjects?.projects.length ?? 0
  const appVersion = APP_VERSION
  const updateSnapshot = state.updateSnapshot
  const keybindingsFilePathDisplay = useMemo(
    () => getResolvedKeybindings(state.keybindings).filePathDisplay || getKeybindingsFilePathDisplay(),
    [state.keybindings],
  )

  useEffect(() => {
    if (!sectionId) return
    if (resolveSettingsSectionId(sectionId)) return
    navigate("/settings/general", { replace: true })
  }, [navigate, sectionId])

  useEffect(() => {
    let cancelled = false

    runDetached("read auth status", fetchAuthStatus().then((result) => {
      if (cancelled) return
      setAuthEnabled(result.kind === "ok" && result.status.enabled === true)
    }))

    return () => {
      cancelled = true
    }
  }, [setAuthEnabled])

  const selectedSection = sidebarItems.find((item) => item.id === selectedPage) ?? sidebarItems[0]
  const kannaPluginsEnabled = useAppSettingsStore(selectPluginsEnabled)
  const visibleSidebarItems = useMemo(() => visibleSettingsSidebarItems(kannaPluginsEnabled), [kannaPluginsEnabled])
  const selectedSectionSubtitle =
    selectedPage === "keybindings"
      ? getKeybindingsSubtitle(keybindingsFilePathDisplay)
      : selectedSection.subtitle
  const showFooter = !isConnecting

  return (
    <div className="relative flex h-full flex-1 min-w-0 bg-background">
      <div className="flex min-w-0 flex-1">
        <aside className={`hidden w-[200px] shrink-0 md:block ${showFooter ? "pb-[89px]" : ""}`}>
          <div className="flex flex-col gap-1 px-4 py-6">
            <div className="px-3 pb-5 text-22 font-extrabold tracking-[-0.5px] text-foreground">
              Settings
            </div>
            {visibleSidebarItems.map((item) => {
              const showUpdateBadge = item.id === "changelog" && updateSnapshot?.updateAvailable === true
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => { navigate(`/settings/${item.id}`) }}
                  className={`relative cursor-pointer rounded-lg px-3 py-2 text-sm ${
                    item.id === selectedPage
                      ? "font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  }`}
                >
                  {item.id === selectedPage ? (
                    <motion.span
                      layoutId="settings-nav-indicator"
                      className="absolute inset-0 rounded-lg bg-muted"
                      transition={{ type: "spring", ...MOTION_SPRING.indicator }}
                    />
                  ) : null}
                  <div className="relative flex items-center gap-2.5">
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 truncate">{item.label}</span>
                    {showUpdateBadge ? (
                      <>
                        <CircleArrowUp className="ml-auto size-3.5 shrink-0 text-warning-text" aria-hidden="true" />
                        <span className="sr-only">Update available</span>
                      </>
                    ) : null}
                  </div>
                </button>
              )
            })}
            {authEnabled ? (
              <button
                type="button"
                onClick={() => runPendingAction(SIGN_OUT_KEY, state.handleSignOut)}
                disabled={signingOut}
                className="cursor-pointer rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="flex items-center gap-2.5">
                  {signingOut ? <Spinner className="h-4 w-4" /> : <LogOut className="h-4 w-4 shrink-0" />}
                  <span>{signingOut ? "Signing out..." : "Sign out"}</span>
                </div>
              </button>
            ) : null}
          </div>
        </aside>

        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="sticky top-0 z-20 border-b border-border bg-background px-2 py-2 md:hidden">
            <div className="flex items-center gap-2">
              <HoverHint label="Open sidebar">
                <button
                  type="button"
                  onClick={state.openSidebar}
                  className="flex size-11 shrink-0 items-center justify-center rounded-md text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                  aria-label="Open sidebar"
                >
                  <Menu className="h-4 w-4 shrink-0" />
                </button>
              </HoverHint>
              <Select value={selectedPage} onValueChange={(value) => { navigate(`/settings/${value}`) }}>
                <SelectTrigger className="h-11 min-w-0 flex-1" aria-label="Settings section">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {visibleSidebarItems.map((item) => (
                      <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {authEnabled ? (
                <button
                  type="button"
                  onClick={() => runPendingAction(SIGN_OUT_KEY, state.handleSignOut)}
                  disabled={signingOut}
                  className="flex min-h-11 shrink-0 items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {signingOut ? <Spinner className="h-4 w-4" /> : <LogOut className="h-4 w-4 shrink-0" />}
                  <span className="sr-only">{signingOut ? "Signing out..." : "Sign out"}</span>
                </button>
              ) : null}
            </div>
          </div>

          <div className="w-full px-4 pb-32 pt-8 md:px-6 md:pt-16">
            {isConnecting ? (
              <div className="flex min-h-[240px] items-center justify-center rounded-2xl border border-border bg-card/40 px-4 py-6 text-sm text-muted-foreground">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Loading machine settings…</span>
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-4xl kanna-settings-section-in" key={selectedPage}>
                <div className="pb-6">
                  <div className="flex items-center justify-between gap-4 min-h-[34px]">
                    <div className="text-lg font-semibold tracking-[-0.2px] text-foreground">
                      {selectedSection.label}
                    </div>
                    {selectedPage === "general" ? (
                      <SettingsHeaderButton
                        variant="outline"
                        onClick={() => { navigate("/settings/changelog") }}
                      >
                        Check for updates
                      </SettingsHeaderButton>
                    ) : null}
                    {selectedPage === "keybindings" ? (
                      <SettingsHeaderButton
                        onClick={() => runPendingAction("keybindings.openEditor", () => state.handleOpenExternalPath("open_editor", keybindingsFilePathDisplay))}
                        disabled={openingKeybindings}
                        aria-busy={openingKeybindings || undefined}
                        icon={openingKeybindings ? <Spinner className="h-4 w-4" /> : <Code className="h-4 w-4" />}
                      >
                        Open in {state.editorLabel}
                      </SettingsHeaderButton>
                    ) : null}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {selectedSectionSubtitle}
                  </div>
                </div>

                <SelectedPage state={state} />
              </div>
            )}

            {state.commandError ? (
              <div className="mx-auto mt-4 flex max-w-4xl items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>{state.commandError}</span>
              </div>
            ) : null}
          </div>

        </div>
      </div>


      {showFooter ? (
        <div className="absolute bottom-0 left-0 right-0 border-t border-border bg-background">
          <div className="px-6 py-[14.25px]">
            <div className="grid gap-3 text-xs text-muted-foreground grid-cols-2 lg:grid-cols-4">
              <div>
                <div className="mb-1 tracking-wide text-xs text-muted-foreground/80">Machine</div>
                <div className="text-foreground/80">{machineName}</div>
              </div>
              <div className="hidden md:block">
                <div className="mb-1 tracking-wide text-xs text-muted-foreground/80">Connection</div>
                <div className="text-foreground/80">{state.connectionStatus}</div>
              </div>
              <div className="hidden md:block">
                <div className="mb-1 tracking-wide text-xs text-muted-foreground/80">Projects Indexed</div>
                <div className="text-foreground/80">{projectCount}</div>
              </div>
              <div>
                <div className="mb-1 tracking-wide text-xs text-muted-foreground/80">App Version</div>
                <div className="text-foreground/80">{appVersion}</div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
