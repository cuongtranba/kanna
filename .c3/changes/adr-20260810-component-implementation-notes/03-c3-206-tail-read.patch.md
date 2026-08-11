---
target: c3-206
scope: block
base: c3-206#n8292@v1:sha256:5ea478e4dafdb031d2807aa4d90ada91302a6a84d5077749985d0a2157e8d20c
---
> limit lines or BOF. Older paging uses opaque `byte:<offset>` cursors
> (`idx:` cursors keep working on the warm/full path). Cross-page
> `context_window_updated` coalescing stays exact via a sentinel parse of the
> newer page's first line. When the tail reaches BOF the complete transcript
> is promoted into the FULL cache WITH messageId dedup seeding. A PARTIAL tail
> is never promoted there and never touches the dedup set (PTY resume safety),
> but it IS kept in the separate tail-window cache — that cache holds parsed
> entries only, seeds no dedup state, and so cannot affect resume.
