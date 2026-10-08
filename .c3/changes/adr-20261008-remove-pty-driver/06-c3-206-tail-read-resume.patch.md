---
target: c3-206
scope: block
base: c3-206#n11067@v1:sha256:1e9447688604210836f62796c345c6ba30085355bf855e3259df44b4bc718bb4
---
limit lines or BOF. Older paging uses opaque `byte:<offset>` cursors
(`idx:` cursors keep working on the warm/full path). Cross-page
`context_window_updated` coalescing stays exact via a sentinel parse of the
newer page's first line. When the tail reaches BOF the complete transcript
is promoted into the FULL cache WITH messageId dedup seeding. A PARTIAL tail
is never promoted there and never touches the dedup set (resume safety),
but it IS kept in the separate tail-window cache — that cache holds parsed
entries only, seeds no dedup state, and so cannot affect resume.
