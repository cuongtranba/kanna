/**
 * StoragePort — typed interface for key-value browser storage.
 *
 * Abstracts localStorage and sessionStorage behind a single interface
 * so stores/components never touch the globals directly. The concrete
 * implementation is src/client/adapters/storage.adapter.ts.
 *
 * Architecture: .c3/adr/adr-20260715-client-state-effect-architecture.md
 */

export interface StoragePort {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  clear(): void
}
