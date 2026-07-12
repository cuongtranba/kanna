---
target: rule-zustand-store
scope: block
base: rule-zustand-store#n8576@v1:sha256:0c3e29ac16b47c6add292ca8dd1f4473626f4dedca86a3ed6185bf92aa521d47
---
| Singleton store file at src/client/app/myStore.ts | src/client/stores/myStore.ts for singletons; colocated <Component>.store.ts via createScopedStore for per-instance state | Singleton stores outside stores/ break the directory contract; only createScopedStore stores may colocate with their component |
