---
target: c3-224
scope: block
base: c3-224#n13263@v1:sha256:29a0533f251592cbae83bb24bd04f1b8feeaf793ad86b11df412778ea4cedee0
---
| Primary path | pickActive(chatId) → markUsed → withPoolCredential strips CLAUDE\_CODE\_OAUTH\_TOKEN, ANTHROPIC\_API\_KEY and ANTHROPIC\_AUTH\_TOKEN, then spawns with CLAUDE\_CODE\_OAUTH\_TOKEN for an OAuth token (sk-ant-oat or no sk-ant- prefix) or ANTHROPIC\_API\_KEY for an Anthropic API key (any other sk-ant- prefix), plus ANTHROPIC\_BASE\_URL when the picked entry declares one | c3-210 |
