import path from "node:path"
import type { SkillFileEntry, SkillFiles } from "@modelcontextprotocol/server/ext/skills"
import { nodeSkillFiles } from "@modelcontextprotocol/server/ext/skills/node"
import { toError } from "../../shared/errors"
import { log } from "../../shared/log"
import type { LocalCatalogService } from "../local-catalog"

export interface RemoteMcpSkillProject {
  id: string
  localPath: string
}

export interface RemoteMcpSkillSources {
  localCatalog: Pick<LocalCatalogService, "skillSources" | "homeDir">
  projects: () => readonly RemoteMcpSkillProject[]
}

type SkillDirs = Map<string, string>

interface SkillTree {
  personal: SkillDirs
  plugins: Map<string, SkillDirs>
  projects: Map<string, SkillDirs>
}

type TreeNode = { names: string[] } | { dir: string; rest: string } | null

const NESTED_GROUPS: ReadonlyMap<string, (tree: SkillTree) => Map<string, SkillDirs>> = new Map([
  ["plugins", (tree) => tree.plugins],
  ["projects", (tree) => tree.projects],
])

const SEGMENT_UNSAFE = /[^A-Za-z0-9._-]/g

function segmentOf(name: string): string | null {
  const segment = name.replace(SEGMENT_UNSAFE, "-")
  return segment === "" || segment === "." || segment === ".." ? null : segment
}

function addSkill(group: SkillDirs, dir: string): void {
  const segment = segmentOf(path.basename(dir))
  if (segment !== null && !group.has(segment)) group.set(segment, dir)
}

function groupFor(groups: Map<string, SkillDirs>, name: string): SkillDirs | null {
  const segment = segmentOf(name)
  if (segment === null) return null
  const existing = groups.get(segment)
  if (existing) return existing
  const created: SkillDirs = new Map()
  groups.set(segment, created)
  return created
}

function buildTree(sources: RemoteMcpSkillSources): SkillTree {
  const tree: SkillTree = { personal: new Map(), plugins: new Map(), projects: new Map() }
  const seen = new Set<string>()
  const { localCatalog } = sources
  const shared = (cwd: string) => {
    for (const source of localCatalog.skillSources(cwd)) {
      const dir = path.dirname(source.filePath)
      if (source.scope === "project" || seen.has(dir)) continue
      seen.add(dir)
      const group = source.scope === "personal" ? tree.personal : groupFor(tree.plugins, source.pluginName ?? "")
      if (group) addSkill(group, dir)
    }
  }
  shared(localCatalog.homeDir)
  const projects = [...sources.projects()].sort((a, b) => a.id.localeCompare(b.id))
  for (const project of projects) {
    shared(project.localPath)
    for (const source of localCatalog.skillSources(project.localPath)) {
      const dir = path.dirname(source.filePath)
      if (source.scope !== "project" || seen.has(dir)) continue
      const group = groupFor(tree.projects, project.id)
      if (group) addSkill(group, dir)
    }
  }
  return tree
}

function resolveIn(dirs: SkillDirs, tail: readonly string[]): TreeNode {
  const [skill, ...rest] = tail
  if (skill === undefined) return { names: [...dirs.keys()] }
  const dir = dirs.get(skill)
  return dir === undefined ? null : { dir, rest: rest.join("/") }
}

function resolve(tree: SkillTree, segments: readonly string[]): TreeNode {
  const [group, ...tail] = segments
  if (group === undefined) {
    const roots = [["personal", tree.personal], ["plugins", tree.plugins], ["projects", tree.projects]] as const
    return { names: roots.filter(([, members]) => members.size > 0).map(([name]) => name) }
  }
  if (group === "personal") return resolveIn(tree.personal, tail)
  const nested = NESTED_GROUPS.get(group)
  if (nested === undefined) return null
  const [name, ...skillTail] = tail
  if (name === undefined) return { names: [...nested(tree).keys()] }
  const dirs = nested(tree).get(name)
  return dirs === undefined ? null : resolveIn(dirs, skillTail)
}

export function createRemoteMcpSkillFiles(sources: RemoteMcpSkillSources): SkillFiles {
  let tree: SkillTree | null = null
  const delegates = new Map<string, SkillFiles>()

  const locate = (virtualPath: string): TreeNode => {
    tree ??= buildTree(sources)
    return resolve(tree, virtualPath === "" ? [] : virtualPath.split("/"))
  }

  const delegateFor = (dir: string): SkillFiles => {
    const existing = delegates.get(dir)
    if (existing) return existing
    const created = nodeSkillFiles(dir)
    delegates.set(dir, created)
    return created
  }

  return {
    async list(dir): Promise<SkillFileEntry[]> {
      if (dir === "") tree = null
      const node = locate(dir)
      if (node === null) return []
      if ("names" in node) return node.names.sort().map((name) => ({ name, kind: "directory" }))
      try {
        return await delegateFor(node.dir).list(node.rest)
      } catch (error) {
        log.debug("[kanna/remote-mcp] skill folder is unreadable", { dir: node.dir, message: toError(error).message })
        return []
      }
    },
    async read(file) {
      const node = locate(file)
      if (node === null || "names" in node) throw new Error(`no skill file at ${file}`)
      return await delegateFor(node.dir).read(node.rest)
    },
  }
}
