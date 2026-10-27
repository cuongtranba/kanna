import { useCallback, useMemo } from "react"
import type { ReactNode, RefObject } from "react"
import { $createTextNode, $insertNodes, TextNode } from "lexical"
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
} from "@lexical/react/LexicalTypeaheadMenuPlugin"
import { AtSign, Bot, Folder, FileText, FolderGit2, Radio } from "lucide-react"
import { useMentionSuggestions } from "../../../hooks/useMentionSuggestions"
import { useSubagentSuggestions } from "../../../hooks/useSubagentSuggestions"
import { useProjectSuggestions } from "../../../hooks/useProjectSuggestions"
import { useBeaconSuggestions } from "../../../hooks/useBeaconSuggestions"
import type { BeaconSuggestion } from "../../../hooks/useBeaconSuggestions"
import type { SubagentSuggestion } from "../../../hooks/useSubagentSuggestions"
import type { ProjectSuggestion } from "../../../hooks/useProjectSuggestions"
import type { ProjectPath } from "../../../hooks/useMentionSuggestions"
import { formatMentionLabel, matchNamespacedQuery, type MentionNamespace } from "../../../lib/mentionNamespaces"
import { StateMarkLabel } from "../../ui/state-mark"
import { selectBeaconRows, useBeaconsStore } from "../../../stores/beaconsStore"
import { $createMentionNode, type CreateMentionNodeArgs } from "../nodes/MentionNode"
import { ChatTabScopedStore } from "../../../stores/chatTabScopedStore"
import { useTypeaheadHoverHighlight } from "./typeahead-hover-highlight"
import { TypeaheadMenu, useRegexTypeaheadTrigger } from "./typeahead-menu"


const MENTION_TRIGGER_RE = /(?:^|\s)(@((?:[^@\s]){0,200}))$/

export type MentionOption =
  | { kind: "agent"; subagent: SubagentSuggestion["subagent"] }
  | { kind: "project"; project: ProjectSuggestion }
  | { kind: "beacon"; beacon: BeaconSuggestion }
  | { kind: "path"; path: ProjectPath }

function mentionOptionKey(data: MentionOption): string {
  if (data.kind === "agent") return `agent:${data.subagent.id}`
  if (data.kind === "project") return `project:${data.project.projectId}`
  if (data.kind === "beacon") return `beacon:${data.beacon.beaconId}`
  return `path:${data.path.kind}:${data.path.path}`
}

export function createMentionArgs(data: MentionOption): CreateMentionNodeArgs {
  if (data.kind === "agent") {
    return { mentionKind: "agent", value: data.subagent.name, label: data.subagent.name }
  }
  if (data.kind === "project") {
    return {
      mentionKind: "project",
      value: data.project.slug,
      label: formatMentionLabel("project", data.project.slug),
    }
  }
  if (data.kind === "beacon") {
    return {
      mentionKind: "beacon",
      value: data.beacon.handle,
      label: formatMentionLabel("beacon", data.beacon.handle),
    }
  }
  return { mentionKind: "path", value: data.path.path, label: data.path.path }
}

export class MentionMenuOption extends MenuOption {
  readonly data: MentionOption

  constructor(data: MentionOption) {
    super(mentionOptionKey(data))
    this.data = data
  }
}


export const NAMESPACE_PREVIEW_LIMIT = 3

function namespacedGroup<T>(
  items: readonly T[],
  query: string,
  namespace: MentionNamespace,
): readonly T[] {
  const { namespaced, listsEverything } = matchNamespacedQuery(query, namespace)
  return listsEverything && !namespaced ? items.slice(0, NAMESPACE_PREVIEW_LIMIT) : items
}

export function composeMentionOptions(args: {
  query: string
  agents: readonly SubagentSuggestion[]
  projects: readonly ProjectSuggestion[]
  beacons: readonly BeaconSuggestion[]
  paths: readonly ProjectPath[]
}): MentionOption[] {
  const query = args.query.toLowerCase()
  const agents = namespacedGroup(args.agents, query, "agent")
  const projects = namespacedGroup(args.projects, query, "project")
  const beacons = namespacedGroup(args.beacons, query, "beacon")
  return [
    ...agents.map((agent): MentionOption => ({ kind: "agent", subagent: agent.subagent })),
    ...projects.map((project): MentionOption => ({ kind: "project", project })),
    ...beacons.map((beacon): MentionOption => ({ kind: "beacon", beacon })),
    ...args.paths.map((path): MentionOption => ({ kind: "path", path })),
  ]
}


function MentionMenuSkeleton() {
  return Array.from({ length: 4 }).map((_, i) => (
    <li key={i} className="flex items-center gap-2 px-3 py-1.5" aria-hidden="true">
      <span className="h-3.5 w-3.5 rounded bg-muted animate-pulse" />
      <span className="h-3 w-40 max-w-full rounded bg-muted animate-pulse" />
    </li>
  ))
}

function MentionRowContent({ data, onlineBeaconIds }: { data: MentionOption; onlineBeaconIds: ReadonlySet<string> }) {
  if (data.kind === "agent") {
    return (
      <>
        <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="font-mono truncate">{formatMentionLabel("agent", data.subagent.name)}</span>
        {data.subagent.description ? (
          <span className="min-w-0 truncate text-xs text-muted-foreground">{data.subagent.description}</span>
        ) : null}
      </>
    )
  }
  if (data.kind === "project") {
    return (
      <>
        <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="font-mono truncate">{formatMentionLabel("project", data.project.slug)}</span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">{data.project.localPath}</span>
      </>
    )
  }
  if (data.kind === "beacon") {
    const online = onlineBeaconIds.has(data.beacon.beaconId)
    return (
      <>
        <Radio className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="font-mono truncate">{formatMentionLabel("beacon", data.beacon.handle)}</span>
        {data.beacon.alias !== null ? (
          <span className="min-w-0 truncate text-xs font-mono text-muted-foreground">{data.beacon.hostname}</span>
        ) : null}
        <span className="ml-auto text-xs">
          <StateMarkLabel tone={online ? "active" : "muted"} label={online ? "Online" : "Offline"} />
        </span>
      </>
    )
  }
  const Icon = data.path.kind === "dir" ? Folder : FileText
  return (
    <>
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="font-mono truncate">{data.path.path}</span>
    </>
  )
}


export interface MentionTypeaheadPluginProps {
  projectId: string | null
}


export function MentionTypeaheadPlugin({
  projectId,
}: MentionTypeaheadPluginProps): ReactNode {
  const query = ChatTabScopedStore.useScopedStore((state) => state.mentionQuery)
  const setQuery = ChatTabScopedStore.useScopedStore((state) => state.setMentionQuery)

  const triggerFn = useRegexTypeaheadTrigger(MENTION_TRIGGER_RE)

  const enabled = query !== null

  const mentionState = useMentionSuggestions({
    projectId,
    query: query ?? "",
    enabled,
  })
  const subagentState = useSubagentSuggestions({
    query: query ?? "",
    enabled,
  })
  const projectState = useProjectSuggestions({
    query: query ?? "",
    enabled,
    excludeProjectId: projectId,
  })

  const beaconState = useBeaconSuggestions({
    query: query ?? "",
    enabled,
  })
  const beaconRows = useBeaconsStore(selectBeaconRows)
  const onlineBeaconIds = useMemo(
    () => new Set(beaconRows.filter((row) => row.online).map((row) => row.id)),
    [beaconRows],
  )

  const options = useMemo<MentionMenuOption[]>(
    () =>
      composeMentionOptions({
        query: query ?? "",
        agents: subagentState.items,
        projects: projectState.items,
        beacons: beaconState.items,
        paths: mentionState.items,
      }).map((data) => new MentionMenuOption(data)),
    [query, subagentState.items, projectState.items, beaconState.items, mentionState.items],
  )

  const highlightOnPointerMove = useTypeaheadHoverHighlight()

  const onSelectOption = useCallback(
    (
      option: MentionMenuOption,
      textNodeContainingQuery: TextNode | null,
      closeMenu: () => void,
    ) => {
      const mentionNode = $createMentionNode(createMentionArgs(option.data))

      if (textNodeContainingQuery !== null) {
        textNodeContainingQuery.replace(mentionNode)
      } else {
        $insertNodes([mentionNode])
      }

      const trailingSpace = $createTextNode(" ")
      mentionNode.insertAfter(trailingSpace)
      trailingSpace.select()

      closeMenu()
    },
    [],
  )

  const menuRenderFn = useCallback(
    (
      anchorElementRef: RefObject<HTMLElement | null>,
      {
        selectedIndex,
        selectOptionAndCleanUp,
        setHighlightedIndex,
        options: menuOptions,
      }: {
        selectedIndex: number | null
        selectOptionAndCleanUp: (option: MentionMenuOption) => void
        setHighlightedIndex: (index: number) => void
        options: MentionMenuOption[]
      },
    ) => {
      if (anchorElementRef.current == null) return null
      if (menuOptions.length === 0 && !mentionState.loading) return null

      return (
        <TypeaheadMenu
          kind="mention"
          maxHeightClass="max-h-80"
          rowClassName="flex items-center gap-2 px-3 py-1.5 cursor-pointer text-sm"
          options={menuOptions}
          selectedIndex={selectedIndex}
          onPick={selectOptionAndCleanUp}
          onRowPointerMove={(event, index) => highlightOnPointerMove(event, index, setHighlightedIndex)}
          placeholder={mentionState.loading && menuOptions.length === 0 ? <MentionMenuSkeleton /> : undefined}
          renderRow={(option) => (
            <>
              <AtSign className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <MentionRowContent data={option.data} onlineBeaconIds={onlineBeaconIds} />
            </>
          )}
        />
      )
    },
    [mentionState.loading, highlightOnPointerMove, onlineBeaconIds],
  )

  return (
    <LexicalTypeaheadMenuPlugin<MentionMenuOption>
      options={options}
      onQueryChange={setQuery}
      onSelectOption={onSelectOption}
      triggerFn={triggerFn}
      menuRenderFn={menuRenderFn}
    />
  )
}
