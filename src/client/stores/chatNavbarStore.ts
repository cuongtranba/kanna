/**
 * chatNavbarStore — all state has been moved to ChatTabScopedStore.
 *
 * `sharePopoverOpen` / `setSharePopoverOpen` now live in ChatTabScopedStore
 * (one independent instance per chat tab) so two tabs don't share a single
 * popover-open flag.
 *
 * This file is kept as a placeholder to avoid breaking any future import that
 * might reference the module path.
 */
