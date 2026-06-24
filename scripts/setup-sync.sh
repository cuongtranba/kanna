#!/usr/bin/env bash
# One-time setup for upstream-sync workflow.
# Enables git rerere (auto-replay conflict resolutions) and registers
# the "ours" merge driver used by .gitattributes.
set -euo pipefail

# Auto-replay previously-resolved conflicts on next sync.
git config rerere.enabled true
git config rerere.autoupdate true

# Register the "ours" merge driver. Without this, `merge=ours` in
# .gitattributes is a no-op. This makes listed files keep the local
# (fork) version on every merge from upstream.
git config merge.ours.driver true

echo "Sync setup complete:"
echo "  rerere.enabled       = $(git config --get rerere.enabled)"
echo "  rerere.autoupdate    = $(git config --get rerere.autoupdate)"
echo "  merge.ours.driver    = $(git config --get merge.ours.driver)"
