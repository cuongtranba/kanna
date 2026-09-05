
export interface ClipboardPort {
  writeText(text: string): Promise<void>
  readText(): Promise<string>
}
