export interface StorageBackend {
  /** Create directory, including parents. No-op if already present. */
  mkdir(path: string): Promise<void>
  exists(path: string): Promise<boolean>
  existsSync(path: string): boolean
  /** File size in bytes; 0 if file missing. */
  size(path: string): Promise<number>
  readText(path: string): Promise<string>
  readTextSync(path: string): string
  /** Synchronous file size in bytes; 0 if missing. Optional (tail-read fast path). */
  sizeSync?(path: string): number
  /**
   * Synchronous byte-range read `[start, endExclusive)`. Optional — callers
   * MUST fall back to full reads when absent (tail-read fast path only).
   */
  readSliceSync?(path: string, start: number, endExclusive: number): Uint8Array
  writeText(path: string, content: string): Promise<void>
  appendText(path: string, content: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  /** Remove file or directory; never throws on missing (force semantics). */
  remove(path: string, opts?: { recursive?: boolean }): Promise<void>
}
