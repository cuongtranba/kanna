---
target: c3-125
scope: block
base: c3-125#n11591@v1:sha256:7d514ca8ae76d0e20abe55f3e258c5171d9bbe98ef17d5faadebc0755f710fba
---
Lets the user create and edit hooks in notify, inline or spawn mode, pick a target chat or project from the sidebar data through a searchable picker that also matches the project path, choose an optional model for inline and spawn hooks, write an optional payload filter and set the thread key path, sender path and reply hint, copy the hook url, enable or disable, rotate or delete a hook, and see a new or rotated secret exactly once together with ready-to-run bearer and HMAC curl commands. The hook row shows the last delivery, including a filtered one with its reason. It also renders the webhook_delivery card with the hook name, mode and delivery id. Non-goals: it never stores a secret after the dialog closes, does not compute signatures, and does not compile the filter, which only the server can check.
