---
target: c3-104
scope: block
base: c3-104#n10007@v1:sha256:d119a29ac0ca621408075e2fb895c3bf52696a5e2c775fb1981ba182a5db7306
---
| Tab status indicator | IN | A chat tab draws its status from the SAME table the sidebar row uses (src/client/lib/chatStatusIndicator.ts): the dot takes the icon's slot so an icon-only tab keeps it, the session glyph yields its width first, and the status is named in the tooltip + accessible name so colour never carries it alone | c3-111 | src/client/components/panes/tabPresentation.ts |
