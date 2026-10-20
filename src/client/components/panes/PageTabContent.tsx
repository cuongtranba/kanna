import { Suspense, lazy } from "react"
import { resolvePageRoute, type PageTabTarget } from "../../lib/paneTree"
import { Spinner } from "../ui/spinner"

const LocalProjectsPage = lazy(() => import("../../app/LocalProjectsPage").then((module) => ({ default: module.LocalProjectsPage })))
const BoardsRoutePage = lazy(() => import("../../app/BoardsRoutePage").then((module) => ({ default: module.BoardsRoutePage })))
const StackBoardsRoutePage = lazy(() => import("../../app/StackBoardsRoutePage").then((module) => ({ default: module.StackBoardsRoutePage })))
const SettingsPage = lazy(() => import("../../app/SettingsPage").then((module) => ({ default: module.SettingsPage })))
const WorkflowsPage = lazy(() => import("../../app/WorkflowsPage").then((module) => ({ default: module.WorkflowsPage })))
const WebhooksPage = lazy(() => import("../../app/WebhooksPage").then((module) => ({ default: module.WebhooksPage })))
const InboxPage = lazy(() => import("../../app/InboxPage").then((module) => ({ default: module.InboxPage })))
const CronJobsPage = lazy(() => import("../../app/CronJobsPage").then((module) => ({ default: module.CronJobsPage })))

function PageTabFallback() {
  return (
    <div role="status" aria-label="Loading page" className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
      <Spinner className="size-5" />
    </div>
  )
}

function PageBody({ target }: { target: PageTabTarget }) {
  const params = resolvePageRoute(target.path)?.params ?? {}
  switch (target.page) {
    case "projects":
      return <LocalProjectsPage />
    case "settings":
      return <SettingsPage sectionId={params.sectionId} />
    case "cron":
      return <CronJobsPage />
    case "webhooks":
      return <WebhooksPage />
    case "inbox":
      return <InboxPage threadId={params.threadId ?? null} />
    case "workflows":
      return <WorkflowsPage chatId={params.chatId} />
    case "boards":
      return params.stackId ? (
        <StackBoardsRoutePage stackId={params.stackId} />
      ) : (
        <BoardsRoutePage projectId={params.projectId ?? ""} />
      )
  }
}

export function PageTabContent({ target }: { target: PageTabTarget }) {
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <Suspense fallback={<PageTabFallback />}>
        <PageBody target={target} />
      </Suspense>
    </div>
  )
}
