import { useCallback } from "react"
import { APP_VERSION } from "../../shared/branding"
import type { FetchReleases } from "../lib/changelog"
import { ChangelogSection } from "./ChangelogSection"
import type { KannaState } from "./useKannaState"
import { useChangelog } from "./useChangelog"

export function ChangelogSettingsBranch({ state }: { state: KannaState }) {
  const { socket } = state
  const fetchReleases = useCallback<FetchReleases>(() => socket.command({ type: "settings.getChangelog" }), [socket])
  const changelog = useChangelog(fetchReleases)
  return (
    <ChangelogSection
      status={changelog.status}
      releases={changelog.releases}
      error={changelog.error}
      onRetry={changelog.retry}
      updateSnapshot={state.updateSnapshot}
      currentVersion={APP_VERSION}
      onInstallUpdate={(version) => state.handleInstallUpdate(version)}
      onCheckForUpdates={() => state.handleCheckForUpdates({ force: true })}
      onForceReload={() => state.handleForceReload()}
    />
  )
}
