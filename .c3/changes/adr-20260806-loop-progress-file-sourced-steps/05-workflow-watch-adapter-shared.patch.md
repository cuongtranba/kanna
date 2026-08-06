---
target: c3-229
scope: block
base: c3-229#n8926@v1:sha256:3f41a1fa409bbb03a1d9f35b757d3959a82a92de30847443507fa801435219bc
---
| watchWorkflowRunDirs(workflowsDir, cb) | IN | Adapter: watch the live run-dir root so a launch (no sidecar yet) pushes a snapshot promptly. The underlying watchWorkflowDir now takes an optional filterBasename, which narrows a watch to ONE file in the directory and makes the adapter shared: the loop-tracking read-model watches a tracking file through it rather than binding a watcher to an inode a rename-based write would orphan. An event reporting no filename still fires | c3-302 | src/server/workflow-watch-io.adapter.ts |
