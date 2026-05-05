# Changelog

## [0.42.3](https://github.com/cuongtranba/kanna/compare/v0.42.2...v0.42.3) (2026-05-05)


### Bug Fixes

* **test:** make pushClient tests robust to readonly globalThis.window ([#20](https://github.com/cuongtranba/kanna/issues/20)) ([18451f0](https://github.com/cuongtranba/kanna/commit/18451f08d90296c79192300f4dbcd3c68d692cf7))

## [0.42.2](https://github.com/cuongtranba/kanna/compare/v0.42.1...v0.42.2) (2026-05-05)


### Bug Fixes

* **push:** use real mailto for VAPID subject ([#18](https://github.com/cuongtranba/kanna/issues/18)) ([df5fd48](https://github.com/cuongtranba/kanna/commit/df5fd48878368cf4f71219a1d03d2cea11f1f057))

## [0.42.1](https://github.com/cuongtranba/kanna/compare/v0.42.0...v0.42.1) (2026-05-05)


### Bug Fixes

* **settings:** repair push notifications UI overflow ([#16](https://github.com/cuongtranba/kanna/issues/16)) ([ac39fcd](https://github.com/cuongtranba/kanna/commit/ac39fcdc27497e81aa8b36c1d9f95eaf6e1401ec))

## [0.42.0](https://github.com/cuongtranba/kanna/compare/v0.41.0...v0.42.0) (2026-05-04)


### Features

* **agent:** emit session_commands_loaded on Claude session start ([ada47a3](https://github.com/cuongtranba/kanna/commit/ada47a32d962c05b5e1fad141942b7a09915c3f1))
* **agent:** expose getSupportedCommands on Claude harness ([5416847](https://github.com/cuongtranba/kanna/commit/541684778152845408f548a4b184e9fb76d0e6ae))
* always-on sidebar RELOAD button + design polish ([b341e37](https://github.com/cuongtranba/kanna/commit/b341e3783c59ec79bd312c3e209beaf8a28fbcc6))
* **auth:** persist sessions across restart and browser close ([#10](https://github.com/cuongtranba/kanna/issues/10)) ([2734f51](https://github.com/cuongtranba/kanna/commit/2734f51a582ebf2d5895a2f7e8021e8274a99d4e))
* **auto-continue:** auto-resume chats on rate-limit reset ([#2](https://github.com/cuongtranba/kanna/issues/2)) ([bd67cd8](https://github.com/cuongtranba/kanna/commit/bd67cd8f485a7f505f9d99a5c07f2a0c88c4ee87))
* **chat-ui:** @ mention file picker ([7f23523](https://github.com/cuongtranba/kanna/commit/7f23523b4b820f8f57dde45b7b5552b55a2c1832))
* **chat-ui:** add SlashCommandPicker component ([492a61a](https://github.com/cuongtranba/kanna/commit/492a61a6b3fb53fa6083157262bb93e027a4f92c))
* **chat-ui:** skeleton rows while slash commands load ([b3a4fba](https://github.com/cuongtranba/kanna/commit/b3a4fbab56463255be00e195d707f8ae1c78f52f))
* **chat-ui:** wire slash command picker into ChatInput ([41d1d22](https://github.com/cuongtranba/kanna/commit/41d1d22ba68b76ff1a94ba57277e02da51fbe16e))
* **client:** add slash command filter and picker-open utils ([5ebb58c](https://github.com/cuongtranba/kanna/commit/5ebb58c3fc577b72e86a9f731ce78b5a3290c6dc))
* **client:** add slash commands store ([e7af522](https://github.com/cuongtranba/kanna/commit/e7af5220fae38fb21a42e4b05eb1611c4f3d38d1))
* **client:** add useSlashCommands hook ([fc213ed](https://github.com/cuongtranba/kanna/commit/fc213ede672168c702e76c8649816e40efc04f68))
* **client:** populate slash commands store from chat snapshot ([65c2510](https://github.com/cuongtranba/kanna/commit/65c2510ed50d7e36e2729e2bb68f26dd0615b790))
* **event-store:** record session_commands_loaded events ([4415aab](https://github.com/cuongtranba/kanna/commit/4415aab1eff13a92ba895c87f9f41e07c8b593d5))
* **events:** add session_commands_loaded turn event ([374e550](https://github.com/cuongtranba/kanna/commit/374e5506b63125921b0d81a27a7809c8854a5674))
* **import:** add Claude Code session record types ([f5e1f64](https://github.com/cuongtranba/kanna/commit/f5e1f64efccd605572813e0aef93b801c1b79eba))
* **import:** add Import button to sidebar header ([0759563](https://github.com/cuongtranba/kanna/commit/075956393c9d0a3345c7dc4e8f357007f0633d7b))
* **import:** add importClaudeSessions state hook ([5e7e491](https://github.com/cuongtranba/kanna/commit/5e7e4916b1132d49ba4cb14a06c51f98e48a7b1e))
* **import:** add sessions.importClaude WS command ([83219b1](https://github.com/cuongtranba/kanna/commit/83219b168908af49b3b22e3a75fab6f25ad71865))
* **import:** append new messages when source JSONL changes ([f9fe383](https://github.com/cuongtranba/kanna/commit/f9fe383f246e00576a03b3f1b2759c40cb4279be))
* **import:** handle sessions.importClaude over WebSocket ([52487bc](https://github.com/cuongtranba/kanna/commit/52487bcc8c522dd2fa35d5e5afb7d6ef86d39b15))
* **import:** map Claude session records to Kanna transcript entries ([00706a0](https://github.com/cuongtranba/kanna/commit/00706a0a557bd48708531fd1255eb467b986697e))
* **import:** orchestrate import with dedup and event emission ([f131f69](https://github.com/cuongtranba/kanna/commit/f131f69333870f7c18fd3e248b654f7b490032a3))
* **import:** parse Claude Code session JSONL files ([46b96bb](https://github.com/cuongtranba/kanna/commit/46b96bb94b9114628d2d88785678d586016abba4))
* **import:** scan ~/.claude/projects for session files ([c6e369f](https://github.com/cuongtranba/kanna/commit/c6e369f5ac88e744bf9147b1ebd64236d2a0d119))
* **import:** surface updated count in import result alert ([2529569](https://github.com/cuongtranba/kanna/commit/252956994b353786ffb80d708793936c294d79e6))
* **import:** track source file md5 on chats for change detection ([02ad85d](https://github.com/cuongtranba/kanna/commit/02ad85d48ac0bbfd95da0072f510e65c7acbb962))
* pm2 update reloader + swappable update strategy ([4a36d0b](https://github.com/cuongtranba/kanna/commit/4a36d0befb71bd07cb4fe86fed2a941003a5d02f))
* **pm2:** forward cloudflared token + password via scripts/pm2.env ([3c7a250](https://github.com/cuongtranba/kanna/commit/3c7a2506d394487f5666a07e42120ba2957fe569))
* **push:** web push notifications for chat state changes ([#11](https://github.com/cuongtranba/kanna/issues/11)) ([8ecb9d1](https://github.com/cuongtranba/kanna/commit/8ecb9d1b76674a22482b086af033c6e2196bec1c))
* **read-models:** expose slashCommands on ChatSnapshot ([2846ffb](https://github.com/cuongtranba/kanna/commit/2846ffb4c109f784b5e6727bff37ff3215dec218))
* support serving kanna from a subpath ([72ead70](https://github.com/cuongtranba/kanna/commit/72ead70599bfc99e7b1f4e5a4f9369eed570dd94))
* **tunnel:** cloudflare quick-tunnel auto-expose ([#3](https://github.com/cuongtranba/kanna/issues/3)) ([7a3d365](https://github.com/cuongtranba/kanna/commit/7a3d3653230a98131e30b7d765b3b3c73bd18348))
* **types:** add SlashCommand type and ChatSnapshot.slashCommands ([e432971](https://github.com/cuongtranba/kanna/commit/e4329711c371360bff5c29a29cb50498baa3a2f4))
* **user-message:** render steer icon left of bubble for mid-turn messages ([e251047](https://github.com/cuongtranba/kanna/commit/e251047ba5a1cb8541436c9865173b79cdf40e3e))


### Bug Fixes

* add chat auto-scroll setting ([d314796](https://github.com/cuongtranba/kanna/commit/d3147969201af2b6b5b323f9cfc3b21b670e6587))
* **agent:** pre-warm slash commands on chat subscribe ([4c4ee81](https://github.com/cuongtranba/kanna/commit/4c4ee81d007c9a1b87e3ba085c5bbca3b45b9637))
* **auto-continue:** detect rate-limit from stream result text ([29ae73c](https://github.com/cuongtranba/kanna/commit/29ae73cd35da5018d2d0e4af3a9a1c1ebbd7327a))
* **auto-continue:** parse minutes in rate-limit reset text ([bf0f33e](https://github.com/cuongtranba/kanna/commit/bf0f33e97ea9319343374a0f9ec336e6e9161377))
* avoid autofocus for existing chat history ([8a98fd5](https://github.com/cuongtranba/kanna/commit/8a98fd59c0590d489d7f0c9754578e66659fc763))
* **chat-ui:** align slash picker columns, prevent wrap ([0da17a1](https://github.com/cuongtranba/kanna/commit/0da17a15ceb1ee0a343033a983f0379a65430856))
* **chat-ui:** dismiss picker after accepting a command ([321823a](https://github.com/cuongtranba/kanna/commit/321823a66cd4a0eaa5c1eb6f0617fead2afd98ec))
* **chat-ui:** show full slash command name, responsive picker ([31f2aa5](https://github.com/cuongtranba/kanna/commit/31f2aa5fad120be039de2acadb19e72702b58a51))
* **chat:** surface tool and action card errors in UI ([8533147](https://github.com/cuongtranba/kanna/commit/85331479c26018a5c07871ed0b3ffcf1fffc204a))
* close mobile sidebar after chat selection ([b4b5c6f](https://github.com/cuongtranba/kanna/commit/b4b5c6fe10e3f7f4737369bbd52bf84924d6b418))
* **diff-store:** use main as default branch and support Git &lt; 2.38 ([c22f2a7](https://github.com/cuongtranba/kanna/commit/c22f2a796fd8253bf3a24652e6430c4198a44232))
* **import:** extract title from array-form user content ([026ac34](https://github.com/cuongtranba/kanna/commit/026ac34c2150dede9fabd30efc4be6e4214232bb))
* **import:** harden parser against stat errors and use symmetric timestamp sentinels ([18cd8d0](https://github.com/cuongtranba/kanna/commit/18cd8d0674f7b49fdd5f017cab12b2b8b853d7e9))
* keep chat switches pinned to latest message ([ad73460](https://github.com/cuongtranba/kanna/commit/ad73460990d3b0db932ea2f4c8fd16227ca05b2b))
* **npm:** rename package scope to [@cuongtran001](https://github.com/cuongtran001) to match npm account ([bd2c0d0](https://github.com/cuongtranba/kanna/commit/bd2c0d0e3d6df02712017a0facd023a463412b87))
* **pm2:** use ./bin/kanna shebang to bypass pm2 require-based fork wrapper ([13a6e0c](https://github.com/cuongtranba/kanna/commit/13a6e0c690f664ac23c2320de8f0e4362fca5d85))
* restore chat title fallback generation ([40bc694](https://github.com/cuongtranba/kanna/commit/40bc69461418462710b96b7a4e38582e9d2320c7))
* restore kanna client bundle build ([38dc79b](https://github.com/cuongtranba/kanna/commit/38dc79b5d3f7049c9d814ae2adc6793ce607a022))
* **server:** fall back to bundled cloudflared binary ([d539bae](https://github.com/cuongtranba/kanna/commit/d539bae7d87ccb3c7e8490dc1ac03d4b12e7dd07))
* **sidebar:** allow touch scroll past project headers ([ecb97d8](https://github.com/cuongtranba/kanna/commit/ecb97d80ba4f1a637adecd3c33533032f0d3e8dd))
* stop forcing transcript autoscroll ([cc39984](https://github.com/cuongtranba/kanna/commit/cc39984f4b6ca6281b566bcfe6d7aa4ca48886a3))
* **terminal-manager:** prevent zsh-newuser-install dialog in tests ([ac22810](https://github.com/cuongtranba/kanna/commit/ac22810cc57f70124189f16c34a807c3f2d9a9ff))
* **tests:** use Object.defineProperty to override read-only globalThis props ([aea7eba](https://github.com/cuongtranba/kanna/commit/aea7eba77461bfc3225dd1f7cd99e8c7a5cf3520))
* **tunnel:** hide card when dismissing a proposed tunnel ([097cc23](https://github.com/cuongtranba/kanna/commit/097cc2323e6cdea8bf2ec4ebebbd2513141d209b))
* **update:** drop pm2 IPC reload to avoid "Reload in progress" error ([0629f04](https://github.com/cuongtranba/kanna/commit/0629f04f7b02615297dac67fb530c64c3843a394))
* **update:** re-deploy installs current version when latest is stale ([7deece0](https://github.com/cuongtranba/kanna/commit/7deece0e12556ce4f252d3e16acd6a3963a43980))

## [0.41.0](https://github.com/cuongtranba/kanna/compare/v0.40.1...v0.41.0) (2026-05-04)


### Features

* **push:** web push notifications for chat state changes ([#11](https://github.com/cuongtranba/kanna/issues/11)) ([8ecb9d1](https://github.com/cuongtranba/kanna/commit/8ecb9d1b76674a22482b086af033c6e2196bec1c))

## [0.40.1](https://github.com/cuongtranba/kanna/compare/v0.40.0...v0.40.1) (2026-04-30)


### Bug Fixes

* **tunnel:** hide card when dismissing a proposed tunnel ([097cc23](https://github.com/cuongtranba/kanna/commit/097cc2323e6cdea8bf2ec4ebebbd2513141d209b))

## [0.40.0](https://github.com/cuongtranba/kanna/compare/v0.39.2...v0.40.0) (2026-04-29)


### Features

* **auth:** persist sessions across restart and browser close ([#10](https://github.com/cuongtranba/kanna/issues/10)) ([2734f51](https://github.com/cuongtranba/kanna/commit/2734f51a582ebf2d5895a2f7e8021e8274a99d4e))


### Bug Fixes

* **chat:** surface tool and action card errors in UI ([8533147](https://github.com/cuongtranba/kanna/commit/85331479c26018a5c07871ed0b3ffcf1fffc204a))
* **server:** fall back to bundled cloudflared binary ([d539bae](https://github.com/cuongtranba/kanna/commit/d539bae7d87ccb3c7e8490dc1ac03d4b12e7dd07))

## [0.39.2](https://github.com/cuongtranba/kanna/compare/v0.39.1...v0.39.2) (2026-04-29)


### Bug Fixes

* **npm:** rename package scope to [@cuongtran001](https://github.com/cuongtran001) to match npm account ([bd2c0d0](https://github.com/cuongtranba/kanna/commit/bd2c0d0e3d6df02712017a0facd023a463412b87))

## [0.39.1](https://github.com/cuongtranba/kanna/compare/v0.39.0...v0.39.1) (2026-04-29)


### Bug Fixes

* **update:** re-deploy installs current version when latest is stale ([7deece0](https://github.com/cuongtranba/kanna/commit/7deece0e12556ce4f252d3e16acd6a3963a43980))

## [0.39.0](https://github.com/cuongtranba/kanna/compare/v0.38.0...v0.39.0) (2026-04-29)


### Features

* **agent:** emit session_commands_loaded on Claude session start ([ada47a3](https://github.com/cuongtranba/kanna/commit/ada47a32d962c05b5e1fad141942b7a09915c3f1))
* **agent:** expose getSupportedCommands on Claude harness ([5416847](https://github.com/cuongtranba/kanna/commit/541684778152845408f548a4b184e9fb76d0e6ae))
* always-on sidebar RELOAD button + design polish ([b341e37](https://github.com/cuongtranba/kanna/commit/b341e3783c59ec79bd312c3e209beaf8a28fbcc6))
* **auto-continue:** auto-resume chats on rate-limit reset ([#2](https://github.com/cuongtranba/kanna/issues/2)) ([bd67cd8](https://github.com/cuongtranba/kanna/commit/bd67cd8f485a7f505f9d99a5c07f2a0c88c4ee87))
* **chat-ui:** @ mention file picker ([7f23523](https://github.com/cuongtranba/kanna/commit/7f23523b4b820f8f57dde45b7b5552b55a2c1832))
* **chat-ui:** add SlashCommandPicker component ([492a61a](https://github.com/cuongtranba/kanna/commit/492a61a6b3fb53fa6083157262bb93e027a4f92c))
* **chat-ui:** skeleton rows while slash commands load ([b3a4fba](https://github.com/cuongtranba/kanna/commit/b3a4fbab56463255be00e195d707f8ae1c78f52f))
* **chat-ui:** wire slash command picker into ChatInput ([41d1d22](https://github.com/cuongtranba/kanna/commit/41d1d22ba68b76ff1a94ba57277e02da51fbe16e))
* **client:** add slash command filter and picker-open utils ([5ebb58c](https://github.com/cuongtranba/kanna/commit/5ebb58c3fc577b72e86a9f731ce78b5a3290c6dc))
* **client:** add slash commands store ([e7af522](https://github.com/cuongtranba/kanna/commit/e7af5220fae38fb21a42e4b05eb1611c4f3d38d1))
* **client:** add useSlashCommands hook ([fc213ed](https://github.com/cuongtranba/kanna/commit/fc213ede672168c702e76c8649816e40efc04f68))
* **client:** populate slash commands store from chat snapshot ([65c2510](https://github.com/cuongtranba/kanna/commit/65c2510ed50d7e36e2729e2bb68f26dd0615b790))
* **event-store:** record session_commands_loaded events ([4415aab](https://github.com/cuongtranba/kanna/commit/4415aab1eff13a92ba895c87f9f41e07c8b593d5))
* **events:** add session_commands_loaded turn event ([374e550](https://github.com/cuongtranba/kanna/commit/374e5506b63125921b0d81a27a7809c8854a5674))
* **import:** add Claude Code session record types ([f5e1f64](https://github.com/cuongtranba/kanna/commit/f5e1f64efccd605572813e0aef93b801c1b79eba))
* **import:** add Import button to sidebar header ([0759563](https://github.com/cuongtranba/kanna/commit/075956393c9d0a3345c7dc4e8f357007f0633d7b))
* **import:** add importClaudeSessions state hook ([5e7e491](https://github.com/cuongtranba/kanna/commit/5e7e4916b1132d49ba4cb14a06c51f98e48a7b1e))
* **import:** add sessions.importClaude WS command ([83219b1](https://github.com/cuongtranba/kanna/commit/83219b168908af49b3b22e3a75fab6f25ad71865))
* **import:** append new messages when source JSONL changes ([f9fe383](https://github.com/cuongtranba/kanna/commit/f9fe383f246e00576a03b3f1b2759c40cb4279be))
* **import:** handle sessions.importClaude over WebSocket ([52487bc](https://github.com/cuongtranba/kanna/commit/52487bcc8c522dd2fa35d5e5afb7d6ef86d39b15))
* **import:** map Claude session records to Kanna transcript entries ([00706a0](https://github.com/cuongtranba/kanna/commit/00706a0a557bd48708531fd1255eb467b986697e))
* **import:** orchestrate import with dedup and event emission ([f131f69](https://github.com/cuongtranba/kanna/commit/f131f69333870f7c18fd3e248b654f7b490032a3))
* **import:** parse Claude Code session JSONL files ([46b96bb](https://github.com/cuongtranba/kanna/commit/46b96bb94b9114628d2d88785678d586016abba4))
* **import:** scan ~/.claude/projects for session files ([c6e369f](https://github.com/cuongtranba/kanna/commit/c6e369f5ac88e744bf9147b1ebd64236d2a0d119))
* **import:** surface updated count in import result alert ([2529569](https://github.com/cuongtranba/kanna/commit/252956994b353786ffb80d708793936c294d79e6))
* **import:** track source file md5 on chats for change detection ([02ad85d](https://github.com/cuongtranba/kanna/commit/02ad85d48ac0bbfd95da0072f510e65c7acbb962))
* pm2 update reloader + swappable update strategy ([4a36d0b](https://github.com/cuongtranba/kanna/commit/4a36d0befb71bd07cb4fe86fed2a941003a5d02f))
* **pm2:** forward cloudflared token + password via scripts/pm2.env ([3c7a250](https://github.com/cuongtranba/kanna/commit/3c7a2506d394487f5666a07e42120ba2957fe569))
* **read-models:** expose slashCommands on ChatSnapshot ([2846ffb](https://github.com/cuongtranba/kanna/commit/2846ffb4c109f784b5e6727bff37ff3215dec218))
* support serving kanna from a subpath ([72ead70](https://github.com/cuongtranba/kanna/commit/72ead70599bfc99e7b1f4e5a4f9369eed570dd94))
* **tunnel:** cloudflare quick-tunnel auto-expose ([#3](https://github.com/cuongtranba/kanna/issues/3)) ([7a3d365](https://github.com/cuongtranba/kanna/commit/7a3d3653230a98131e30b7d765b3b3c73bd18348))
* **types:** add SlashCommand type and ChatSnapshot.slashCommands ([e432971](https://github.com/cuongtranba/kanna/commit/e4329711c371360bff5c29a29cb50498baa3a2f4))
* **user-message:** render steer icon left of bubble for mid-turn messages ([e251047](https://github.com/cuongtranba/kanna/commit/e251047ba5a1cb8541436c9865173b79cdf40e3e))


### Bug Fixes

* add chat auto-scroll setting ([d314796](https://github.com/cuongtranba/kanna/commit/d3147969201af2b6b5b323f9cfc3b21b670e6587))
* **agent:** pre-warm slash commands on chat subscribe ([4c4ee81](https://github.com/cuongtranba/kanna/commit/4c4ee81d007c9a1b87e3ba085c5bbca3b45b9637))
* **auto-continue:** detect rate-limit from stream result text ([29ae73c](https://github.com/cuongtranba/kanna/commit/29ae73cd35da5018d2d0e4af3a9a1c1ebbd7327a))
* **auto-continue:** parse minutes in rate-limit reset text ([bf0f33e](https://github.com/cuongtranba/kanna/commit/bf0f33e97ea9319343374a0f9ec336e6e9161377))
* avoid autofocus for existing chat history ([8a98fd5](https://github.com/cuongtranba/kanna/commit/8a98fd59c0590d489d7f0c9754578e66659fc763))
* **chat-ui:** align slash picker columns, prevent wrap ([0da17a1](https://github.com/cuongtranba/kanna/commit/0da17a15ceb1ee0a343033a983f0379a65430856))
* **chat-ui:** dismiss picker after accepting a command ([321823a](https://github.com/cuongtranba/kanna/commit/321823a66cd4a0eaa5c1eb6f0617fead2afd98ec))
* **chat-ui:** show full slash command name, responsive picker ([31f2aa5](https://github.com/cuongtranba/kanna/commit/31f2aa5fad120be039de2acadb19e72702b58a51))
* close mobile sidebar after chat selection ([b4b5c6f](https://github.com/cuongtranba/kanna/commit/b4b5c6fe10e3f7f4737369bbd52bf84924d6b418))
* **diff-store:** use main as default branch and support Git &lt; 2.38 ([c22f2a7](https://github.com/cuongtranba/kanna/commit/c22f2a796fd8253bf3a24652e6430c4198a44232))
* **import:** extract title from array-form user content ([026ac34](https://github.com/cuongtranba/kanna/commit/026ac34c2150dede9fabd30efc4be6e4214232bb))
* **import:** harden parser against stat errors and use symmetric timestamp sentinels ([18cd8d0](https://github.com/cuongtranba/kanna/commit/18cd8d0674f7b49fdd5f017cab12b2b8b853d7e9))
* keep chat switches pinned to latest message ([ad73460](https://github.com/cuongtranba/kanna/commit/ad73460990d3b0db932ea2f4c8fd16227ca05b2b))
* **pm2:** use ./bin/kanna shebang to bypass pm2 require-based fork wrapper ([13a6e0c](https://github.com/cuongtranba/kanna/commit/13a6e0c690f664ac23c2320de8f0e4362fca5d85))
* restore chat title fallback generation ([40bc694](https://github.com/cuongtranba/kanna/commit/40bc69461418462710b96b7a4e38582e9d2320c7))
* restore kanna client bundle build ([38dc79b](https://github.com/cuongtranba/kanna/commit/38dc79b5d3f7049c9d814ae2adc6793ce607a022))
* **sidebar:** allow touch scroll past project headers ([ecb97d8](https://github.com/cuongtranba/kanna/commit/ecb97d80ba4f1a637adecd3c33533032f0d3e8dd))
* stop forcing transcript autoscroll ([cc39984](https://github.com/cuongtranba/kanna/commit/cc39984f4b6ca6281b566bcfe6d7aa4ca48886a3))
* **terminal-manager:** prevent zsh-newuser-install dialog in tests ([ac22810](https://github.com/cuongtranba/kanna/commit/ac22810cc57f70124189f16c34a807c3f2d9a9ff))
* **tests:** use Object.defineProperty to override read-only globalThis props ([aea7eba](https://github.com/cuongtranba/kanna/commit/aea7eba77461bfc3225dd1f7cd99e8c7a5cf3520))

## [0.35.0](https://github.com/cuongtranba/kanna/compare/v0.34.2...v0.35.0) (2026-04-28)


### Features

* **agent:** emit session_commands_loaded on Claude session start ([ada47a3](https://github.com/cuongtranba/kanna/commit/ada47a32d962c05b5e1fad141942b7a09915c3f1))
* **agent:** expose getSupportedCommands on Claude harness ([5416847](https://github.com/cuongtranba/kanna/commit/541684778152845408f548a4b184e9fb76d0e6ae))
* always-on sidebar RELOAD button + design polish ([b341e37](https://github.com/cuongtranba/kanna/commit/b341e3783c59ec79bd312c3e209beaf8a28fbcc6))
* **auto-continue:** auto-resume chats on rate-limit reset ([#2](https://github.com/cuongtranba/kanna/issues/2)) ([bd67cd8](https://github.com/cuongtranba/kanna/commit/bd67cd8f485a7f505f9d99a5c07f2a0c88c4ee87))
* **chat-ui:** @ mention file picker ([7f23523](https://github.com/cuongtranba/kanna/commit/7f23523b4b820f8f57dde45b7b5552b55a2c1832))
* **chat-ui:** add SlashCommandPicker component ([492a61a](https://github.com/cuongtranba/kanna/commit/492a61a6b3fb53fa6083157262bb93e027a4f92c))
* **chat-ui:** skeleton rows while slash commands load ([b3a4fba](https://github.com/cuongtranba/kanna/commit/b3a4fbab56463255be00e195d707f8ae1c78f52f))
* **chat-ui:** wire slash command picker into ChatInput ([41d1d22](https://github.com/cuongtranba/kanna/commit/41d1d22ba68b76ff1a94ba57277e02da51fbe16e))
* **client:** add slash command filter and picker-open utils ([5ebb58c](https://github.com/cuongtranba/kanna/commit/5ebb58c3fc577b72e86a9f731ce78b5a3290c6dc))
* **client:** add slash commands store ([e7af522](https://github.com/cuongtranba/kanna/commit/e7af5220fae38fb21a42e4b05eb1611c4f3d38d1))
* **client:** add useSlashCommands hook ([fc213ed](https://github.com/cuongtranba/kanna/commit/fc213ede672168c702e76c8649816e40efc04f68))
* **client:** populate slash commands store from chat snapshot ([65c2510](https://github.com/cuongtranba/kanna/commit/65c2510ed50d7e36e2729e2bb68f26dd0615b790))
* **event-store:** record session_commands_loaded events ([4415aab](https://github.com/cuongtranba/kanna/commit/4415aab1eff13a92ba895c87f9f41e07c8b593d5))
* **events:** add session_commands_loaded turn event ([374e550](https://github.com/cuongtranba/kanna/commit/374e5506b63125921b0d81a27a7809c8854a5674))
* **import:** add Claude Code session record types ([f5e1f64](https://github.com/cuongtranba/kanna/commit/f5e1f64efccd605572813e0aef93b801c1b79eba))
* **import:** add Import button to sidebar header ([0759563](https://github.com/cuongtranba/kanna/commit/075956393c9d0a3345c7dc4e8f357007f0633d7b))
* **import:** add importClaudeSessions state hook ([5e7e491](https://github.com/cuongtranba/kanna/commit/5e7e4916b1132d49ba4cb14a06c51f98e48a7b1e))
* **import:** add sessions.importClaude WS command ([83219b1](https://github.com/cuongtranba/kanna/commit/83219b168908af49b3b22e3a75fab6f25ad71865))
* **import:** append new messages when source JSONL changes ([f9fe383](https://github.com/cuongtranba/kanna/commit/f9fe383f246e00576a03b3f1b2759c40cb4279be))
* **import:** handle sessions.importClaude over WebSocket ([52487bc](https://github.com/cuongtranba/kanna/commit/52487bcc8c522dd2fa35d5e5afb7d6ef86d39b15))
* **import:** map Claude session records to Kanna transcript entries ([00706a0](https://github.com/cuongtranba/kanna/commit/00706a0a557bd48708531fd1255eb467b986697e))
* **import:** orchestrate import with dedup and event emission ([f131f69](https://github.com/cuongtranba/kanna/commit/f131f69333870f7c18fd3e248b654f7b490032a3))
* **import:** parse Claude Code session JSONL files ([46b96bb](https://github.com/cuongtranba/kanna/commit/46b96bb94b9114628d2d88785678d586016abba4))
* **import:** scan ~/.claude/projects for session files ([c6e369f](https://github.com/cuongtranba/kanna/commit/c6e369f5ac88e744bf9147b1ebd64236d2a0d119))
* **import:** surface updated count in import result alert ([2529569](https://github.com/cuongtranba/kanna/commit/252956994b353786ffb80d708793936c294d79e6))
* **import:** track source file md5 on chats for change detection ([02ad85d](https://github.com/cuongtranba/kanna/commit/02ad85d48ac0bbfd95da0072f510e65c7acbb962))
* pm2 update reloader + swappable update strategy ([4a36d0b](https://github.com/cuongtranba/kanna/commit/4a36d0befb71bd07cb4fe86fed2a941003a5d02f))
* **pm2:** forward cloudflared token + password via scripts/pm2.env ([3c7a250](https://github.com/cuongtranba/kanna/commit/3c7a2506d394487f5666a07e42120ba2957fe569))
* **read-models:** expose slashCommands on ChatSnapshot ([2846ffb](https://github.com/cuongtranba/kanna/commit/2846ffb4c109f784b5e6727bff37ff3215dec218))
* support serving kanna from a subpath ([72ead70](https://github.com/cuongtranba/kanna/commit/72ead70599bfc99e7b1f4e5a4f9369eed570dd94))
* **tunnel:** cloudflare quick-tunnel auto-expose ([#3](https://github.com/cuongtranba/kanna/issues/3)) ([7a3d365](https://github.com/cuongtranba/kanna/commit/7a3d3653230a98131e30b7d765b3b3c73bd18348))
* **types:** add SlashCommand type and ChatSnapshot.slashCommands ([e432971](https://github.com/cuongtranba/kanna/commit/e4329711c371360bff5c29a29cb50498baa3a2f4))
* **user-message:** render steer icon left of bubble for mid-turn messages ([e251047](https://github.com/cuongtranba/kanna/commit/e251047ba5a1cb8541436c9865173b79cdf40e3e))


### Bug Fixes

* add chat auto-scroll setting ([d314796](https://github.com/cuongtranba/kanna/commit/d3147969201af2b6b5b323f9cfc3b21b670e6587))
* **agent:** pre-warm slash commands on chat subscribe ([4c4ee81](https://github.com/cuongtranba/kanna/commit/4c4ee81d007c9a1b87e3ba085c5bbca3b45b9637))
* **auto-continue:** detect rate-limit from stream result text ([29ae73c](https://github.com/cuongtranba/kanna/commit/29ae73cd35da5018d2d0e4af3a9a1c1ebbd7327a))
* **auto-continue:** parse minutes in rate-limit reset text ([bf0f33e](https://github.com/cuongtranba/kanna/commit/bf0f33e97ea9319343374a0f9ec336e6e9161377))
* avoid autofocus for existing chat history ([8a98fd5](https://github.com/cuongtranba/kanna/commit/8a98fd59c0590d489d7f0c9754578e66659fc763))
* **chat-ui:** align slash picker columns, prevent wrap ([0da17a1](https://github.com/cuongtranba/kanna/commit/0da17a15ceb1ee0a343033a983f0379a65430856))
* **chat-ui:** dismiss picker after accepting a command ([321823a](https://github.com/cuongtranba/kanna/commit/321823a66cd4a0eaa5c1eb6f0617fead2afd98ec))
* **chat-ui:** show full slash command name, responsive picker ([31f2aa5](https://github.com/cuongtranba/kanna/commit/31f2aa5fad120be039de2acadb19e72702b58a51))
* close mobile sidebar after chat selection ([b4b5c6f](https://github.com/cuongtranba/kanna/commit/b4b5c6fe10e3f7f4737369bbd52bf84924d6b418))
* **diff-store:** use main as default branch and support Git &lt; 2.38 ([c22f2a7](https://github.com/cuongtranba/kanna/commit/c22f2a796fd8253bf3a24652e6430c4198a44232))
* **import:** extract title from array-form user content ([026ac34](https://github.com/cuongtranba/kanna/commit/026ac34c2150dede9fabd30efc4be6e4214232bb))
* **import:** harden parser against stat errors and use symmetric timestamp sentinels ([18cd8d0](https://github.com/cuongtranba/kanna/commit/18cd8d0674f7b49fdd5f017cab12b2b8b853d7e9))
* keep chat switches pinned to latest message ([ad73460](https://github.com/cuongtranba/kanna/commit/ad73460990d3b0db932ea2f4c8fd16227ca05b2b))
* **pm2:** use ./bin/kanna shebang to bypass pm2 require-based fork wrapper ([13a6e0c](https://github.com/cuongtranba/kanna/commit/13a6e0c690f664ac23c2320de8f0e4362fca5d85))
* restore chat title fallback generation ([40bc694](https://github.com/cuongtranba/kanna/commit/40bc69461418462710b96b7a4e38582e9d2320c7))
* restore kanna client bundle build ([38dc79b](https://github.com/cuongtranba/kanna/commit/38dc79b5d3f7049c9d814ae2adc6793ce607a022))
* **sidebar:** allow touch scroll past project headers ([ecb97d8](https://github.com/cuongtranba/kanna/commit/ecb97d80ba4f1a637adecd3c33533032f0d3e8dd))
* stop forcing transcript autoscroll ([cc39984](https://github.com/cuongtranba/kanna/commit/cc39984f4b6ca6281b566bcfe6d7aa4ca48886a3))
* **terminal-manager:** prevent zsh-newuser-install dialog in tests ([ac22810](https://github.com/cuongtranba/kanna/commit/ac22810cc57f70124189f16c34a807c3f2d9a9ff))
* **tests:** use Object.defineProperty to override read-only globalThis props ([aea7eba](https://github.com/cuongtranba/kanna/commit/aea7eba77461bfc3225dd1f7cd99e8c7a5cf3520))
