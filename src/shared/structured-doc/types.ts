
export type DocFormat = "markdown"

export interface SectionInfo {
  heading: string
  normalized: string
  depth: number
}

export interface SectionQuery {
  sections?: readonly string[]
  listLimit?: number
}

export interface StructuredDocQueryResult {
  content: string
  matched: readonly string[]
  missing: readonly string[]
}

export interface AppendRequest {
  section: string
  entry: string
  position?: "top" | "bottom"
}

export interface StructuredDocAppendResult {
  content: string
  created: boolean
}

export interface ReplaceRequest {
  section: string
  body: string
}

export interface StructuredDocReplaceResult {
  content: string
  created: boolean
}

export interface StructuredDoc {
  readonly format: DocFormat
  sections(content: string): readonly SectionInfo[]
  query(content: string, q: SectionQuery): StructuredDocQueryResult
  listItems(content: string, section: string): readonly string[]
  append(content: string, req: AppendRequest): StructuredDocAppendResult
  replace(content: string, req: ReplaceRequest): StructuredDocReplaceResult
}
