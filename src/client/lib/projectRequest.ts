export interface ProjectRequest {
  mode: "new" | "existing"
  localPath: string
  title: string
}
