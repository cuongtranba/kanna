import { describe, expect, test } from "vite-plus/test"
import { lstatSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const SKILLS_ROOT = join(import.meta.dirname, "../../../.claude/skills")

const BODY_LINE_LIMIT = 500
const DESCRIPTION_CHAR_LIMIT = 1024
const REFERENCE_TOC_THRESHOLD = 100

const LEGACY_BODY_ALLOWANCES: Readonly<Record<string, number>> = {
  "kanna-loop": 571,
  "kanna-sessions": 882,
}

const NAME_SHAPE = /^[a-z0-9-]{1,64}$/
const RESERVED_NAME = /anthropic|claude/
const XML_TAG = /<\/?[A-Za-z][^>]*>/
const PERSONAL_VOICE = /\b(you|your|yours|yourself)\b|\bI (can|will|am)\b|\bI'(m|ll)\b/i
const BLOCK_SCALAR = /^[>|][-+]?$/

interface SkillFile {
  readonly directory: string
  readonly frontmatter: readonly string[]
  readonly bodyLines: number
}

const firstPartySkillDirectories = (): string[] =>
  readdirSync(SKILLS_ROOT)
    .filter((entry) => lstatSync(join(SKILLS_ROOT, entry)).isDirectory())
    .sort()

function readSkill(directory: string): SkillFile {
  const lines = readFileSync(join(SKILLS_ROOT, directory, "SKILL.md"), "utf8").split("\n")
  const closing = lines[0] === "---" ? lines.indexOf("---", 1) : -1
  const body = lines.slice(closing + 1)
  while (body.length > 0 && body[body.length - 1]?.trim() === "") body.pop()
  return { directory, frontmatter: closing > 0 ? lines.slice(1, closing) : [], bodyLines: body.length }
}

const fieldOf = (skill: SkillFile, key: string): string | null => {
  const line = skill.frontmatter.find((entry) => entry.startsWith(`${key}:`))
  return line === undefined ? null : line.slice(key.length + 1).trim()
}

function referenceFiles(directory: string): string[] {
  const found: string[] = []
  const visit = (relative: string): void => {
    for (const entry of readdirSync(join(SKILLS_ROOT, directory, relative), { withFileTypes: true })) {
      const child = relative === "" ? entry.name : `${relative}/${entry.name}`
      if (entry.isDirectory()) visit(child)
      else if (child.endsWith(".md") && child !== "SKILL.md") found.push(child)
    }
  }
  visit("")
  return found
}

function authoringViolations(skill: SkillFile): string[] {
  const violations: string[] = []
  const name = fieldOf(skill, "name")
  const description = fieldOf(skill, "description")

  if (skill.frontmatter.length === 0) violations.push("has no YAML frontmatter")
  if (name !== skill.directory) violations.push(`name "${name ?? ""}" does not match its directory`)
  if (name !== null && !NAME_SHAPE.test(name)) violations.push("name is not 1-64 lowercase letters, digits, and hyphens")
  if (name !== null && RESERVED_NAME.test(name)) violations.push("name contains a reserved word (anthropic, claude)")

  if (description === null || description === "") violations.push("has no description")
  else {
    if (BLOCK_SCALAR.test(description)) violations.push("description is a block scalar; Kanna's line-based picker reads it as empty")
    if (description.length > DESCRIPTION_CHAR_LIMIT) violations.push(`description is ${description.length} characters, over ${DESCRIPTION_CHAR_LIMIT}`)
    if (XML_TAG.test(description)) violations.push("description contains an XML tag")
    if (PERSONAL_VOICE.test(description)) violations.push("description is not in the third person")
  }

  const allowance = LEGACY_BODY_ALLOWANCES[skill.directory]
  if (allowance === undefined && skill.bodyLines > BODY_LINE_LIMIT) {
    violations.push(`body is ${skill.bodyLines} lines, over ${BODY_LINE_LIMIT}; move detail into reference files linked from SKILL.md`)
  }
  if (allowance !== undefined && skill.bodyLines > allowance) {
    violations.push(`body grew to ${skill.bodyLines} lines, past its legacy allowance of ${allowance}`)
  }
  if (allowance !== undefined && skill.bodyLines <= BODY_LINE_LIMIT) {
    violations.push(`body is now ${skill.bodyLines} lines; delete its LEGACY_BODY_ALLOWANCES entry`)
  }

  for (const reference of referenceFiles(skill.directory)) {
    const contents = readFileSync(join(SKILLS_ROOT, skill.directory, reference), "utf8")
    if (contents.split("\n").length > REFERENCE_TOC_THRESHOLD && !/^## Contents$/m.test(contents)) {
      violations.push(`${reference} is over ${REFERENCE_TOC_THRESHOLD} lines and has no "## Contents" section`)
    }
  }

  return violations.map((violation) => `${skill.directory}: ${violation}`)
}

describe("first-party skills follow Anthropic's skill-authoring limits", () => {
  const skills = firstPartySkillDirectories().map(readSkill)

  test("the scan reaches the real skills, so an empty gate cannot pass", () => {
    expect(skills.map((skill) => skill.directory)).toContain("kanna-test")
  })

  test("every skill has a valid name, a one-line third-person description, and a bounded body", () => {
    expect(skills.flatMap(authoringViolations)).toEqual([])
  })

  test("every legacy body allowance names a skill that still exists, so a stale entry cannot be reused", () => {
    const directories = new Set(skills.map((skill) => skill.directory))
    expect(Object.keys(LEGACY_BODY_ALLOWANCES).filter((directory) => !directories.has(directory))).toEqual([])
  })
})
