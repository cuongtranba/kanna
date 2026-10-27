import { useCallback, useEffect } from "react"
import { errorMessage } from "../../shared/errors"
import type { GithubRelease } from "../../shared/types"
import { loadChangelog, type FetchReleases } from "../lib/changelog"
import { runDetached } from "../lib/runDetached"
import { useChangelogStore, type ChangelogStatus } from "../stores/changelogStore"

export interface ChangelogView {
  status: ChangelogStatus
  releases: GithubRelease[]
  error: string | null
  retry: () => void
}

export function useChangelog(fetchReleases: FetchReleases): ChangelogView {
  const status = useChangelogStore((state) => state.status)
  const releases = useChangelogStore((state) => state.releases)
  const error = useChangelogStore((state) => state.error)
  const loadStarted = useChangelogStore((state) => state.loadStarted)
  const loaded = useChangelogStore((state) => state.loaded)
  const loadFailed = useChangelogStore((state) => state.loadFailed)

  const load = useCallback(
    async (force: boolean, isCancelled: () => boolean) => {
      loadStarted()
      try {
        const next = await loadChangelog(fetchReleases, { force })
        if (!isCancelled()) loaded(next)
      } catch (cause) {
        if (!isCancelled()) loadFailed(errorMessage(cause))
      }
    },
    [fetchReleases, loadStarted, loaded, loadFailed],
  )

  useEffect(() => {
    let cancelled = false
    runDetached("changelog.load", load(false, () => cancelled))
    return () => {
      cancelled = true
    }
  }, [load])

  const retry = useCallback(() => {
    runDetached("changelog.retry", load(true, () => false))
  }, [load])

  return { status, releases, error, retry }
}
