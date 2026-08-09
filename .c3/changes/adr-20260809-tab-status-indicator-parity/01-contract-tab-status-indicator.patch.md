---
target: c3-104
scope: insert
base: c3-104#n7194@v1:sha256:c7958478ff100ded994469e6f88735069f55833c90720c150f9dfea0953812c6
---
| Tab status indicator | IN | A chat tab draws its status from the SAME table the sidebar row uses (src/client/lib/chatStatusIndicator.ts): the dot takes the icon's slot so an icon-only tab keeps it, the PTY session glyph yields its width first, and the status is named in the tooltip + accessible name so colour never carries it alone | c3-111 | src/client/components/panes/tabPresentation.ts |
