export interface StorageBackend {
  mkdir(path: string): Promise<void>
  exists(path: string): Promise<boolean>
  existsSync(path: string): boolean
  size(path: string): Promise<number>
  readText(path: string): Promise<string>
  readTextSync(path: string): string
  sizeSync?(path: string): number
  readSliceSync?(path: string, start: number, endExclusive: number): Uint8Array
  writeText(path: string, content: string): Promise<void>
  appendText(path: string, content: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  remove(path: string, opts?: { recursive?: boolean }): Promise<void>
}
