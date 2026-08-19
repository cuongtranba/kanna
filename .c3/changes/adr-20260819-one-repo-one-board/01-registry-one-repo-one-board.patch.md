---
target: c3-232
scope: block
base: c3-232#n11174@v1:sha256:d8161c3abb4c208d15db7ddb37393f1078dbcf8f23a6ee558a5129ddc5c9158c
---
| BoardRegistry | IN/OUT | Reads (listBoards / boardView / cardPage / cardDetail / findCardsByLink / listBindings / repoBindingOwner) and writes (board, column, card, link, comment, template, bind and unbind); every write notifies subscribers; bindSync refuses a repo another board holds unless detachFromBoardId names that board, re-checked against the live owner so a stale screen cannot detach a board the user never saw | c3-207 | src/server/board-registry.ts |
