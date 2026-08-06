/**
 * Types that were originally defined here — re-exported from chatTabScopedStore
 * so existing import sites don't need to change (type-only imports).
 *
 * The runtime singleton `useComposerStore` has been removed: all composer state
 * now lives in ChatTabScopedStore (one independent instance per chat tab).
 */

export type {
  ComposerAttachment,
  MentionSuggestionsState,
} from "./chatTabScopedStore"
