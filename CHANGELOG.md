# Changelog

> **Heads up — the version number went backward on purpose.**
> On 2026-07-10 we rolled `main` back to **v0.105.0**. Everything released
> between **v0.106.0 and v0.108.2** was removed from the main line because of a
> problem introduced in that range. Nothing is permanently lost — those
> versions still live under their git tags (`v0.106.0` … `v0.108.2`) if we ever
> need to bring a piece of them back. If you had v0.106–v0.108 installed,
> updating now will take you *down* to v0.105.0, which is expected.

## [1.43.0](https://github.com/cuongtranba/kanna/compare/v1.42.0...v1.43.0) (2026-08-26)


### Features

* **effort-picker:** replace supportsEffort booleans with supportedEfforts list ([#882](https://github.com/cuongtranba/kanna/issues/882)) ([cc30461](https://github.com/cuongtranba/kanna/commit/cc30461c026d24c455d885ff1c94e03c937754fa))

## [1.42.0](https://github.com/cuongtranba/kanna/compare/v1.41.7...v1.42.0) (2026-08-25)


### Features

* **observability:** export per-turn and per-subagent token spend ([#874](https://github.com/cuongtranba/kanna/issues/874)) ([8bea0e4](https://github.com/cuongtranba/kanna/commit/8bea0e4991d825dc945c6c4861c69df326503f40))

## [1.41.7](https://github.com/cuongtranba/kanna/compare/v1.41.6...v1.41.7) (2026-08-25)


### Bug Fixes

* **ui:** close ui ux audit findings ([#872](https://github.com/cuongtranba/kanna/issues/872)) ([aad1ade](https://github.com/cuongtranba/kanna/commit/aad1ade679ca62838186d8256eaeb03d51f541ac))

## [1.41.6](https://github.com/cuongtranba/kanna/compare/v1.41.5...v1.41.6) (2026-08-22)


### Bug Fixes

* **event-store:** free per-chat private caches on chat deletion ([#868](https://github.com/cuongtranba/kanna/issues/868)) ([e8e0400](https://github.com/cuongtranba/kanna/commit/e8e0400fc562df7b4b113bfc7c7a77eede2d1d82)), closes [#863](https://github.com/cuongtranba/kanna/issues/863)

## [1.41.5](https://github.com/cuongtranba/kanna/compare/v1.41.4...v1.41.5) (2026-08-22)


### Bug Fixes

* **alerting:** scope a perf ticket to the condition, not the release ([#864](https://github.com/cuongtranba/kanna/issues/864)) ([b8003d9](https://github.com/cuongtranba/kanna/commit/b8003d920c4e2e13708109de369f57ddcaa3acf2))

## [1.41.4](https://github.com/cuongtranba/kanna/compare/v1.41.3...v1.41.4) (2026-08-22)


### Performance Improvements

* **transcript:** prevent repeated full-load spikes for oversized transcripts and trim dead loop events ([#865](https://github.com/cuongtranba/kanna/issues/865)) ([6d96f33](https://github.com/cuongtranba/kanna/commit/6d96f3332f8279f4659370f5c331238d3c0282b8)), closes [#863](https://github.com/cuongtranba/kanna/issues/863)

## [1.41.3](https://github.com/cuongtranba/kanna/compare/v1.41.2...v1.41.3) (2026-08-22)


### Bug Fixes

* **cancel:** orphaned SDK stream no longer re-arms selfWakeActive after Stop ([#861](https://github.com/cuongtranba/kanna/issues/861)) ([22bbf5c](https://github.com/cuongtranba/kanna/commit/22bbf5cb586cb404eaf0b4b044b0598ae5f00c1a)), closes [#860](https://github.com/cuongtranba/kanna/issues/860)

## [1.41.2](https://github.com/cuongtranba/kanna/compare/v1.41.1...v1.41.2) (2026-08-22)


### Performance Improvements

* **transcript-cache:** remove size&gt;1 evict guard pinning oversized transcripts ([ceee741](https://github.com/cuongtranba/kanna/commit/ceee741b4a96b05e52b02097bfae085043a17b88)), closes [#855](https://github.com/cuongtranba/kanna/issues/855)

## [1.41.1](https://github.com/cuongtranba/kanna/compare/v1.41.0...v1.41.1) (2026-08-22)


### Bug Fixes

* **ui:** silent icon overlaps live status text in sidebar and navbar ([#856](https://github.com/cuongtranba/kanna/issues/856)) ([d3cfc00](https://github.com/cuongtranba/kanna/commit/d3cfc005e64ba0cb5e203b231452112e0c19496b)), closes [#854](https://github.com/cuongtranba/kanna/issues/854)

## [1.41.0](https://github.com/cuongtranba/kanna/compare/v1.40.7...v1.41.0) (2026-08-22)


### Features

* **push:** per-chat silent toggle for push notifications ([#852](https://github.com/cuongtranba/kanna/issues/852)) ([3657b58](https://github.com/cuongtranba/kanna/commit/3657b581c1983baafd6c842b9bf06e9cb8300ee6)), closes [#851](https://github.com/cuongtranba/kanna/issues/851)

## [1.40.7](https://github.com/cuongtranba/kanna/compare/v1.40.6...v1.40.7) (2026-08-22)


### Performance Improvements

* fix TranscriptCache evict guard and full-transcript scope primer ([#848](https://github.com/cuongtranba/kanna/issues/848)) ([84d9980](https://github.com/cuongtranba/kanna/commit/84d9980ef074b4190df05202ebfdad11362c0a82)), closes [#844](https://github.com/cuongtranba/kanna/issues/844)

## [1.40.6](https://github.com/cuongtranba/kanna/compare/v1.40.5...v1.40.6) (2026-08-22)


### Bug Fixes

* **alerting:** reopen a perf ticket instead of filing one per alert flap ([#847](https://github.com/cuongtranba/kanna/issues/847)) ([2d0e102](https://github.com/cuongtranba/kanna/commit/2d0e10202e096c69c728915a4244bd8c83463dc6))


### Performance Improvements

* use getRecentRawEntries for history primer to avoid full transcript load per loop iteration ([#845](https://github.com/cuongtranba/kanna/issues/845)) ([64dabcd](https://github.com/cuongtranba/kanna/commit/64dabcdaa0779af07c19df39eee8399d465210b3)), closes [#843](https://github.com/cuongtranba/kanna/issues/843)

## [1.40.5](https://github.com/cuongtranba/kanna/compare/v1.40.4...v1.40.5) (2026-08-22)


### Performance Improvements

* cut RSS on auto-continue turns and subagent spawns ([#841](https://github.com/cuongtranba/kanna/issues/841)) ([ddf255c](https://github.com/cuongtranba/kanna/commit/ddf255c96c491cdd06def04f5eca8ec6b4bafe7c))

## [1.40.4](https://github.com/cuongtranba/kanna/compare/v1.40.3...v1.40.4) (2026-08-22)


### Performance Improvements

* **subagent:** cap entries[] per run at MAX_SUBAGENT_ENTRIES_PER_RUN ([#837](https://github.com/cuongtranba/kanna/issues/837)) ([2cad366](https://github.com/cuongtranba/kanna/commit/2cad36645ec4dcc0afed547ea2ddde05ab024287)), closes [#836](https://github.com/cuongtranba/kanna/issues/836)

## [1.40.3](https://github.com/cuongtranba/kanna/compare/v1.40.2...v1.40.3) (2026-08-22)


### Performance Improvements

* **subagent:** cap settled runs per chat at MAX_SUBAGENT_RUNS_PER_CHAT ([#834](https://github.com/cuongtranba/kanna/issues/834)) ([8f92116](https://github.com/cuongtranba/kanna/commit/8f92116103dfa8cc1197e70c5630c7b23e75deca)), closes [#833](https://github.com/cuongtranba/kanna/issues/833)

## [1.40.2](https://github.com/cuongtranba/kanna/compare/v1.40.1...v1.40.2) (2026-08-21)


### Bug Fixes

* **alerting:** update stale KannaMemoryPressure TranscriptCache code hint ([#831](https://github.com/cuongtranba/kanna/issues/831)) ([a3a7d0c](https://github.com/cuongtranba/kanna/commit/a3a7d0ceee3bba147c749867913c130d7e255b1c)), closes [#828](https://github.com/cuongtranba/kanna/issues/828)

## [1.40.1](https://github.com/cuongtranba/kanna/compare/v1.40.0...v1.40.1) (2026-08-21)


### Bug Fixes

* **transcript-cache:** never cache transcripts exceeding the byte budget ([#829](https://github.com/cuongtranba/kanna/issues/829)) ([2023e76](https://github.com/cuongtranba/kanna/commit/2023e766e9bb203f83b02a17a29fb69cff852571)), closes [#827](https://github.com/cuongtranba/kanna/issues/827)

## [1.40.0](https://github.com/cuongtranba/kanna/compare/v1.39.3...v1.40.0) (2026-08-21)


### Features

* **typography:** user-adjustable typography scale in Settings → General ([#825](https://github.com/cuongtranba/kanna/issues/825)) ([67c83d5](https://github.com/cuongtranba/kanna/commit/67c83d512a95459c916e34b4b7301098660b90e4))

## [1.39.3](https://github.com/cuongtranba/kanna/compare/v1.39.2...v1.39.3) (2026-08-21)


### Bug Fixes

* **runner:** suppress self-wake re-entry after Stop with pending background tasks ([#823](https://github.com/cuongtranba/kanna/issues/823)) ([4de21ae](https://github.com/cuongtranba/kanna/commit/4de21ae1c529d0e901e44c3292b8976f3794a6ed))

## [1.39.2](https://github.com/cuongtranba/kanna/compare/v1.39.1...v1.39.2) (2026-08-21)


### Bug Fixes

* **alerting:** correct stale src/server/transcript-cache.ts code hints ([#821](https://github.com/cuongtranba/kanna/issues/821)) ([6d8029d](https://github.com/cuongtranba/kanna/commit/6d8029d1ba1504172ad65c7c00a183cb035d6506)), closes [#818](https://github.com/cuongtranba/kanna/issues/818)

## [1.39.1](https://github.com/cuongtranba/kanna/compare/v1.39.0...v1.39.1) (2026-08-21)


### Bug Fixes

* **runner:** enrich background task entry with outputPath when SDK snapshot arrives first ([#811](https://github.com/cuongtranba/kanna/issues/811)) ([b5471f5](https://github.com/cuongtranba/kanna/commit/b5471f52d4e17af8558c2243ce0b5822efd61e54))
* **runner:** gate background task launch detection on tool_call provenance ([#816](https://github.com/cuongtranba/kanna/issues/816)) ([70ef598](https://github.com/cuongtranba/kanna/commit/70ef5981ffdb023eb828f25d611b48923856dc08)), closes [#814](https://github.com/cuongtranba/kanna/issues/814)

## [1.39.0](https://github.com/cuongtranba/kanna/compare/v1.38.1...v1.39.0) (2026-08-21)


### Features

* **observability:** open a GitHub ticket when the fleet regresses ([#799](https://github.com/cuongtranba/kanna/issues/799)) ([db6b9b8](https://github.com/cuongtranba/kanna/commit/db6b9b87850abffb721eff705296ae46ddbf584c))

## [1.38.1](https://github.com/cuongtranba/kanna/compare/v1.38.0...v1.38.1) (2026-08-21)


### Bug Fixes

* **watch:** fire once after arming to close the arming-window drop ([#801](https://github.com/cuongtranba/kanna/issues/801)) ([0a5e40f](https://github.com/cuongtranba/kanna/commit/0a5e40fa9b49a98f27490f312ad101a2873df8ad)), closes [#800](https://github.com/cuongtranba/kanna/issues/800)

## [1.38.0](https://github.com/cuongtranba/kanna/compare/v1.37.0...v1.38.0) (2026-08-20)


### Features

* **telemetry:** add service.version to OTel resource attributes ([#797](https://github.com/cuongtranba/kanna/issues/797)) ([005930e](https://github.com/cuongtranba/kanna/commit/005930e9d671e44582c931cd4f846847f57f0693)), closes [#796](https://github.com/cuongtranba/kanna/issues/796)

## [1.37.0](https://github.com/cuongtranba/kanna/compare/v1.36.0...v1.37.0) (2026-08-20)


### Features

* **cron:** add /cron update subcommand and update_cron MCP tool ([#794](https://github.com/cuongtranba/kanna/issues/794)) ([b2be044](https://github.com/cuongtranba/kanna/commit/b2be04454565a1c1e1b74c5ed414421ccf8fe5ee))

## [1.36.0](https://github.com/cuongtranba/kanna/compare/v1.35.0...v1.36.0) (2026-08-20)


### Features

* **boards:** card drawer — issue identity, Work section, GitHub read-only fields ([#792](https://github.com/cuongtranba/kanna/issues/792)) ([24544a9](https://github.com/cuongtranba/kanna/commit/24544a9e8b83465a86fc0141c482f1cb897cd020))
* **boards:** cardChatSignal → cardWorkSignal with 10-row precedence table ([#790](https://github.com/cuongtranba/kanna/issues/790)) ([b916e9f](https://github.com/cuongtranba/kanna/commit/b916e9f7968a15603b2742bc513f11874373839d))
* **boards:** connect every repo in a Stack, one repo to one board ([#782](https://github.com/cuongtranba/kanna/issues/782)) ([d5da225](https://github.com/cuongtranba/kanna/commit/d5da225693f9e3975940e8d9d933beb5480ef94d))

## [1.35.0](https://github.com/cuongtranba/kanna/compare/v1.34.0...v1.35.0) (2026-08-20)


### Features

* **background-tasks:** stream task output to the chat UI ([#788](https://github.com/cuongtranba/kanna/issues/788)) ([ea96c66](https://github.com/cuongtranba/kanna/commit/ea96c66bd687a4c6ca15a7fd214cae9da4625313))

## [1.34.0](https://github.com/cuongtranba/kanna/compare/v1.33.0...v1.34.0) (2026-08-20)


### Features

* **boards:** filter bar, move to top, and new-issue marker in the Inbox column ([#765](https://github.com/cuongtranba/kanna/issues/765)) ([#786](https://github.com/cuongtranba/kanna/issues/786)) ([76f6928](https://github.com/cuongtranba/kanna/commit/76f69280b7596560352cf28300d7904f8e5f01b5))

## [1.33.0](https://github.com/cuongtranba/kanna/compare/v1.32.1...v1.33.0) (2026-08-19)


### Features

* **boards:** one board, N sync bindings (getBinding → listBindings) ([#779](https://github.com/cuongtranba/kanna/issues/779)) ([67bd3cd](https://github.com/cuongtranba/kanna/commit/67bd3cdab5819ee8c0abdbba56e34c82b8323b8b)), closes [#758](https://github.com/cuongtranba/kanna/issues/758)


### Bug Fixes

* **cron:** settle every cron run, and stop tearing down sessions in use ([#777](https://github.com/cuongtranba/kanna/issues/777)) ([a8fb278](https://github.com/cuongtranba/kanna/commit/a8fb278624360e834a7c3bcc8abc56f4f2b4aeea))


### Performance Improvements

* **cron:** bound cron run events on the auto-continue log ([#781](https://github.com/cuongtranba/kanna/issues/781)) ([297e578](https://github.com/cuongtranba/kanna/commit/297e578e2f9bbdc73b1dcfde651fed9a50b37498))

## [1.32.1](https://github.com/cuongtranba/kanna/compare/v1.32.0...v1.32.1) (2026-08-19)


### Bug Fixes

* **cron:** give /cron its own scroll container ([#772](https://github.com/cuongtranba/kanna/issues/772)) ([#774](https://github.com/cuongtranba/kanna/issues/774)) ([49e543b](https://github.com/cuongtranba/kanna/commit/49e543b00f1a4c803e905a97afdb6bdf698c0cac))


### Performance Improvements

* **event-store:** read latest context-window usage from the transcript tail ([#775](https://github.com/cuongtranba/kanna/issues/775)) ([f1cd01e](https://github.com/cuongtranba/kanna/commit/f1cd01ee8093854d0dc784f5dc5fb643cc3863ad))

## [1.32.0](https://github.com/cuongtranba/kanna/compare/v1.31.0...v1.32.0) (2026-08-18)


### Features

* **boards:** give ownerKind "stack" a door (routes + sidebar + BoardsPage) ([#771](https://github.com/cuongtranba/kanna/issues/771)) ([6b6d045](https://github.com/cuongtranba/kanna/commit/6b6d045521f065641afc62689dd7d20a13c2fd21))
* **cron:** link spawned chat to originating card via onChatSpawned hook ([#763](https://github.com/cuongtranba/kanna/issues/763)) ([#769](https://github.com/cuongtranba/kanna/issues/769)) ([8f00884](https://github.com/cuongtranba/kanna/commit/8f008842068db1aa9157c72b886b87c24227bbb5))

## [1.31.0](https://github.com/cuongtranba/kanna/compare/v1.30.0...v1.31.0) (2026-08-18)


### Features

* **chat:** add ChatActivity to SidebarChatRow ([#761](https://github.com/cuongtranba/kanna/issues/761)) ([#767](https://github.com/cuongtranba/kanna/issues/767)) ([6cf7ad7](https://github.com/cuongtranba/kanna/commit/6cf7ad7b84ecbb6dac009dff5eb71a7897f23698))

## [1.30.0](https://github.com/cuongtranba/kanna/compare/v1.29.0...v1.30.0) (2026-08-18)


### Features

* **cron:** escalate typed /cron arm to a model review-and-confirm turn ([#744](https://github.com/cuongtranba/kanna/issues/744)) ([#755](https://github.com/cuongtranba/kanna/issues/755)) ([f1243c6](https://github.com/cuongtranba/kanna/commit/f1243c6e124f1b6604fccd25e7147e56239b06d7))

## [1.29.0](https://github.com/cuongtranba/kanna/compare/v1.28.0...v1.29.0) (2026-08-18)


### Features

* **cron:** arm_cron result includes job id and AskUserQuestion review instruction ([#743](https://github.com/cuongtranba/kanna/issues/743)) ([#753](https://github.com/cuongtranba/kanna/issues/753)) ([7e7f4a0](https://github.com/cuongtranba/kanna/commit/7e7f4a0c964dfbbba5be163073bf356503562c36))

## [1.28.0](https://github.com/cuongtranba/kanna/compare/v1.27.0...v1.28.0) (2026-08-18)


### Features

* **cron:** show full config on CronArmedMessage (model, fires, cwd, edit/disarm) ([#751](https://github.com/cuongtranba/kanna/issues/751)) ([e69c872](https://github.com/cuongtranba/kanna/commit/e69c872c6393ce3e89ad0308d5dd5a7aab275517)), closes [#742](https://github.com/cuongtranba/kanna/issues/742)

## [1.27.0](https://github.com/cuongtranba/kanna/compare/v1.26.8...v1.27.0) (2026-08-18)


### Features

* **cron:** extract CronArmSummary as structured review payload ([#741](https://github.com/cuongtranba/kanna/issues/741)) ([#749](https://github.com/cuongtranba/kanna/issues/749)) ([f045919](https://github.com/cuongtranba/kanna/commit/f045919fa97dc56f61ac65421f1fbc0823228222))

## [1.26.8](https://github.com/cuongtranba/kanna/compare/v1.26.7...v1.26.8) (2026-08-18)


### Bug Fixes

* **cron:** show 'running for' only during active runs, derived from firedAt ([#747](https://github.com/cuongtranba/kanna/issues/747)) ([bfe5f62](https://github.com/cuongtranba/kanna/commit/bfe5f627aa7fa56a6f3bb74eacbc9fbc8428217f)), closes [#739](https://github.com/cuongtranba/kanna/issues/739)

## [1.26.7](https://github.com/cuongtranba/kanna/compare/v1.26.6...v1.26.7) (2026-08-18)


### Bug Fixes

* **discovery:** default composer to Codex for Codex-only discovered projects ([#745](https://github.com/cuongtranba/kanna/issues/745)) ([8e2eb67](https://github.com/cuongtranba/kanna/commit/8e2eb6785561e7321708ed6754e662145b9070ba))

## [1.26.6](https://github.com/cuongtranba/kanna/compare/v1.26.5...v1.26.6) (2026-08-18)


### Bug Fixes

* **cron:** paused jobs show Paused indicator instead of Running ([#734](https://github.com/cuongtranba/kanna/issues/734)) ([67a9a4e](https://github.com/cuongtranba/kanna/commit/67a9a4e6d708290bf7617e46c51e1fd16ca82c1d)), closes [#733](https://github.com/cuongtranba/kanna/issues/733)

## [1.26.5](https://github.com/cuongtranba/kanna/compare/v1.26.4...v1.26.5) (2026-08-17)


### Bug Fixes

* **pty:** extend SessionEnd hook grace period before SIGTERM ([#730](https://github.com/cuongtranba/kanna/issues/730)) ([bc09e59](https://github.com/cuongtranba/kanna/commit/bc09e59b301a75084a624eeee1acb9adf7b839d8))

## [1.26.4](https://github.com/cuongtranba/kanna/compare/v1.26.3...v1.26.4) (2026-08-17)


### Bug Fixes

* **composer:** use project's most recent chat provider as hint on new chat creation ([#728](https://github.com/cuongtranba/kanna/issues/728)) ([27831da](https://github.com/cuongtranba/kanna/commit/27831da70c2fbd7b59aa06600e391091ce2f1d14))

## [1.26.3](https://github.com/cuongtranba/kanna/compare/v1.26.2...v1.26.3) (2026-08-17)


### Bug Fixes

* **composer:** guard Korean IME double-submission on macOS ([#726](https://github.com/cuongtranba/kanna/issues/726)) ([4c5e9f6](https://github.com/cuongtranba/kanna/commit/4c5e9f6cf14956d9e50b7b051642377f24e60044))

## [1.26.2](https://github.com/cuongtranba/kanna/compare/v1.26.1...v1.26.2) (2026-08-17)


### Bug Fixes

* **composer:** sync provider when runtime resolves after initial render ([#723](https://github.com/cuongtranba/kanna/issues/723)) ([b900a03](https://github.com/cuongtranba/kanna/commit/b900a03b81ba6c42d33585f5686f56d3ad24c394))
* **terminal:** pass --interactive to fish shell to bypass PTY foreground-pgid detection loop ([#724](https://github.com/cuongtranba/kanna/issues/724)) ([b12e264](https://github.com/cuongtranba/kanna/commit/b12e2646c2c5f409256b3d7a40d721005f792b0d))

## [1.26.1](https://github.com/cuongtranba/kanna/compare/v1.26.0...v1.26.1) (2026-08-17)


### Bug Fixes

* **codex:** pass shell:true on Windows so codex.cmd is resolved during spawn ([#720](https://github.com/cuongtranba/kanna/issues/720)) ([0cba3a3](https://github.com/cuongtranba/kanna/commit/0cba3a3374012618687875207e0929da85a5638e))
* **composer:** submit on Enter when iPad has external keyboard (Universal Control / Magic Keyboard) ([#716](https://github.com/cuongtranba/kanna/issues/716)) ([18f6be0](https://github.com/cuongtranba/kanna/commit/18f6be05b091918f5d5b6388fa136c5a8f7018a6))

## [1.26.0](https://github.com/cuongtranba/kanna/compare/v1.25.0...v1.26.0) (2026-08-17)


### Features

* **cron:** show model, created-at, and elapsed time per cron job ([#713](https://github.com/cuongtranba/kanna/issues/713)) ([a860113](https://github.com/cuongtranba/kanna/commit/a860113b7af1c6cddde81b560b2456229f68b33c))


### Bug Fixes

* **shutdown:** await session closed promises during dispose so SessionEnd hook fires ([#714](https://github.com/cuongtranba/kanna/issues/714)) ([1c5356b](https://github.com/cuongtranba/kanna/commit/1c5356b580218f412f7fe4acf4c0ba00e07d55af)), closes [#71](https://github.com/cuongtranba/kanna/issues/71)

## [1.25.0](https://github.com/cuongtranba/kanna/compare/v1.24.3...v1.25.0) (2026-08-17)


### Features

* **cron:** lock model picker while an unpaused cron job is armed ([#711](https://github.com/cuongtranba/kanna/issues/711)) ([f5e23e7](https://github.com/cuongtranba/kanna/commit/f5e23e77b2e82307201169cbf344964f9e371f48)), closes [#709](https://github.com/cuongtranba/kanna/issues/709)

## [1.24.3](https://github.com/cuongtranba/kanna/compare/v1.24.2...v1.24.3) (2026-08-17)


### Bug Fixes

* **process-utils:** make hasCommand cross-platform for Windows ([#707](https://github.com/cuongtranba/kanna/issues/707)) ([47a4f48](https://github.com/cuongtranba/kanna/commit/47a4f48f1377442f2a59bdbcd77aff3e00e11526))

## [1.24.2](https://github.com/cuongtranba/kanna/compare/v1.24.1...v1.24.2) (2026-08-17)


### Bug Fixes

* **composer:** track composition state via ref to guard Korean IME ghost-syllable edge case ([#705](https://github.com/cuongtranba/kanna/issues/705)) ([ea512a4](https://github.com/cuongtranba/kanna/commit/ea512a4c435f5fd2d75378c667bd39d9e5c1c53f))

## [1.24.1](https://github.com/cuongtranba/kanna/compare/v1.24.0...v1.24.1) (2026-08-17)


### Bug Fixes

* **composer:** guard Enter submit against active IME composition ([#702](https://github.com/cuongtranba/kanna/issues/702)) ([38c3cc1](https://github.com/cuongtranba/kanna/commit/38c3cc1e64b71ba8fd98a67ddfa10e03ca6edc67)), closes [#701](https://github.com/cuongtranba/kanna/issues/701)

## [1.24.0](https://github.com/cuongtranba/kanna/compare/v1.23.0...v1.24.0) (2026-08-17)


### Features

* **ports:** extract PushPort capability interface from DomPort ([#695](https://github.com/cuongtranba/kanna/issues/695)) ([012ef85](https://github.com/cuongtranba/kanna/commit/012ef8511c4d24dc0c615e1ad14bb241b1e8ce89)), closes [#679](https://github.com/cuongtranba/kanna/issues/679)

## [1.23.0](https://github.com/cuongtranba/kanna/compare/v1.22.0...v1.23.0) (2026-08-17)


### Features

* **settings:** extract push/telemetry/auth/uploads/cloudflare-tunnel into concept-owned domain modules ([#693](https://github.com/cuongtranba/kanna/issues/693)) ([ddfbb8a](https://github.com/cuongtranba/kanna/commit/ddfbb8a503bfa12f135345e0bab9453655355c85))

## [1.22.0](https://github.com/cuongtranba/kanna/compare/v1.21.4...v1.22.0) (2026-08-17)


### Features

* **c3:** add eval bindings so c3x lookup resolves all component owners ([#690](https://github.com/cuongtranba/kanna/issues/690)) ([70685d6](https://github.com/cuongtranba/kanna/commit/70685d67c9599d0ee7a7d56b0dd7fa017736a2cb))

## [1.21.4](https://github.com/cuongtranba/kanna/compare/v1.21.3...v1.21.4) (2026-08-17)


### Bug Fixes

* **design:** WCAG AA contrast for semantic tint pairings ([#684](https://github.com/cuongtranba/kanna/issues/684) [#685](https://github.com/cuongtranba/kanna/issues/685)) ([#688](https://github.com/cuongtranba/kanna/issues/688)) ([0d653be](https://github.com/cuongtranba/kanna/commit/0d653befb4ebe8a9039400428e65d35fad3b35a6))

## [1.21.3](https://github.com/cuongtranba/kanna/compare/v1.21.2...v1.21.3) (2026-08-17)


### Bug Fixes

* **cron:** prevent double-settle of queued runs at boot ([#686](https://github.com/cuongtranba/kanna/issues/686)) ([f25a199](https://github.com/cuongtranba/kanna/commit/f25a19969b5b448047684f0a62cab47c6774ecc2)), closes [#673](https://github.com/cuongtranba/kanna/issues/673)

## [1.21.2](https://github.com/cuongtranba/kanna/compare/v1.21.1...v1.21.2) (2026-08-17)


### Bug Fixes

* **cron:** graceful shutdown drains in-flight fires and cron outcomes ([#672](https://github.com/cuongtranba/kanna/issues/672)) ([#682](https://github.com/cuongtranba/kanna/issues/682)) ([72549c7](https://github.com/cuongtranba/kanna/commit/72549c779bb2526b110d4490e9cb05e7d0c3d93c))

## [1.21.1](https://github.com/cuongtranba/kanna/compare/v1.21.0...v1.21.1) (2026-08-17)


### Bug Fixes

* **cron:** let a multiline /cron message reach the self-repair escalation ([#670](https://github.com/cuongtranba/kanna/issues/670)) ([21f63d7](https://github.com/cuongtranba/kanna/commit/21f63d71c097e7ecd4647f47dd9164db40545ccf))

## [1.21.0](https://github.com/cuongtranba/kanna/compare/v1.20.0...v1.21.0) (2026-08-16)


### Features

* **cron:** sub-minute schedules, with skips coalesced into one counted row ([#668](https://github.com/cuongtranba/kanna/issues/668)) ([40576da](https://github.com/cuongtranba/kanna/commit/40576da7e1d0242fba2c70eadd81ab36d7d304c3))

## [1.20.0](https://github.com/cuongtranba/kanna/compare/v1.19.0...v1.20.0) (2026-08-16)


### Features

* **cron:** LLM self-repair for invalid /cron commands ([#665](https://github.com/cuongtranba/kanna/issues/665)) ([36dfcf9](https://github.com/cuongtranba/kanna/commit/36dfcf92c87fa1fe71a6037d159db44b000107fc))

## [1.19.0](https://github.com/cuongtranba/kanna/compare/v1.18.0...v1.19.0) (2026-08-16)


### Features

* **cron:** /cron builtin — scheduled instructions with inline and spawn run modes ([#662](https://github.com/cuongtranba/kanna/issues/662)) ([3671522](https://github.com/cuongtranba/kanna/commit/3671522558ebe85eb6e5e2a1da3f11bab1ac3b33))

## [1.18.0](https://github.com/cuongtranba/kanna/compare/v1.17.0...v1.18.0) (2026-08-14)


### Features

* **observability:** settings-gated telemetry with machine-named service ([#658](https://github.com/cuongtranba/kanna/issues/658)) ([01bb958](https://github.com/cuongtranba/kanna/commit/01bb9582d50c5cc24cc3b4f6225d5bf3a6423f4d))

## [1.17.0](https://github.com/cuongtranba/kanna/compare/v1.16.2...v1.17.0) (2026-08-14)


### Features

* **boards:** ask the agent to advance its own card when the work is done ([#652](https://github.com/cuongtranba/kanna/issues/652)) ([2c44f60](https://github.com/cuongtranba/kanna/commit/2c44f60047fb65bf534a52a7ad689830c633d7e3))
* **observability:** OTel traces + memory forensics, and recover armed-loop wakes at boot ([#657](https://github.com/cuongtranba/kanna/issues/657)) ([a447c6d](https://github.com/cuongtranba/kanna/commit/a447c6d871e5541b1ab8e0b7898858de889ea834))

## [1.16.2](https://github.com/cuongtranba/kanna/compare/v1.16.1...v1.16.2) (2026-08-13)


### Bug Fixes

* **loop:** survive a server restart mid-wake, and bound transcript memory ([#654](https://github.com/cuongtranba/kanna/issues/654)) ([5a5cbb9](https://github.com/cuongtranba/kanna/commit/5a5cbb96af4480945610c1378ba395b122ad9abb))

## [1.16.1](https://github.com/cuongtranba/kanna/compare/v1.16.0...v1.16.1) (2026-08-12)


### Bug Fixes

* **oauth-pool:** drop the 5-chat ceiling on per-token concurrency ([#650](https://github.com/cuongtranba/kanna/issues/650)) ([8c445e0](https://github.com/cuongtranba/kanna/commit/8c445e093856fe5853e64ec6a765335afb2be51d))

## [1.16.0](https://github.com/cuongtranba/kanna/compare/v1.15.0...v1.16.0) (2026-08-12)


### Features

* **boards:** kanban boards — Start work, SQLite store, GitHub sync, agent tools ([#645](https://github.com/cuongtranba/kanna/issues/645)) ([91b9f0a](https://github.com/cuongtranba/kanna/commit/91b9f0add1b280b9bd33d3f62f6ecf11adf9358e))
* **boards:** open a board in the workspace, show its chats, define its cards ([#646](https://github.com/cuongtranba/kanna/issues/646)) ([5bead4e](https://github.com/cuongtranba/kanna/commit/5bead4e25d2a326dd87ea8007efba6cd0acdb38f))
* **chat:** /clear and /compact [instructions] as real Kanna commands ([#649](https://github.com/cuongtranba/kanna/issues/649)) ([a193638](https://github.com/cuongtranba/kanna/commit/a193638eb664ae8b3b1ab222be4857490ed9a551))
* **panes:** close a tab with a middle click ([#648](https://github.com/cuongtranba/kanna/issues/648)) ([965d069](https://github.com/cuongtranba/kanna/commit/965d0696421ea56799f558ca94eeaba41f573971))
* **panes:** make pane resizing reachable — grabbable divider, keyboard nudges, tab width ([#647](https://github.com/cuongtranba/kanna/issues/647)) ([861bba4](https://github.com/cuongtranba/kanna/commit/861bba4c1f0710e931e7b6b0b932588907b165ea))


### Bug Fixes

* **codex:** keep transient turns alive and classify failure reasons ([#643](https://github.com/cuongtranba/kanna/issues/643)) ([a257391](https://github.com/cuongtranba/kanna/commit/a25739122fc0e9bb0fc3708e25791269a9364801))
* **mermaid:** validate the model's diagrams at creation instead of patching spellings ([#641](https://github.com/cuongtranba/kanna/issues/641)) ([6cb1445](https://github.com/cuongtranba/kanna/commit/6cb1445856e99b9c989dd1c40ca5c311853312ce))


### Performance Improvements

* **chat:** bound tab-open cost by bytes, cache the transcript tail, free chat slices ([#644](https://github.com/cuongtranba/kanna/issues/644)) ([b583c03](https://github.com/cuongtranba/kanna/commit/b583c0393e25724513d6a651ee101285c6436bde))

## [1.15.0](https://github.com/cuongtranba/kanna/compare/v1.14.1...v1.15.0) (2026-08-09)


### Features

* **client:** mirror the sidebar's chat status indicators onto pane tabs ([#639](https://github.com/cuongtranba/kanna/issues/639)) ([2322fa8](https://github.com/cuongtranba/kanna/commit/2322fa8b7b4100377c1251ed2ac775bf22d6e90b))


### Bug Fixes

* **client:** render mermaid diagrams a model spelled `-.x` instead of `-.-x` ([#637](https://github.com/cuongtranba/kanna/issues/637)) ([87fb17a](https://github.com/cuongtranba/kanna/commit/87fb17a8eaa5744bdd4753251ff5acb440c7c0cf))
* **test:** isolate paths-route data dir from the real ~/.kanna store ([#640](https://github.com/cuongtranba/kanna/issues/640)) ([7c08cbe](https://github.com/cuongtranba/kanna/commit/7c08cbe3017f6fd74c379560a7dd63b3e56ff034))

## [1.14.1](https://github.com/cuongtranba/kanna/compare/v1.14.0...v1.14.1) (2026-08-08)


### Bug Fixes

* **ci:** drop stray .claude/worktrees gitlinks, bump checkout/setup-node ([#635](https://github.com/cuongtranba/kanna/issues/635)) ([5f66be3](https://github.com/cuongtranba/kanna/commit/5f66be3c93372df3f1287b95ffe8d16c8281a209))

## [1.14.0](https://github.com/cuongtranba/kanna/compare/v1.13.0...v1.14.0) (2026-08-08)


### Features

* **client:** one shared pane workspace, not one per project ([#632](https://github.com/cuongtranba/kanna/issues/632)) ([91d7a0b](https://github.com/cuongtranba/kanna/commit/91d7a0b082a4dd1c204fc3568451300a1cc3fbda))


### Bug Fixes

* **agent:** trust the SDK background-task level signal, stop waking healthy tasks ([#634](https://github.com/cuongtranba/kanna/issues/634)) ([51dce6a](https://github.com/cuongtranba/kanna/commit/51dce6a69e99de0540f9d7a5323119e1f4b60662))

## [1.13.0](https://github.com/cuongtranba/kanna/compare/v1.12.0...v1.13.0) (2026-08-07)


### Features

* **loop:** list every loop step in the Progress panel, sourced from the tracking file ([#627](https://github.com/cuongtranba/kanna/issues/627)) ([fb59dff](https://github.com/cuongtranba/kanna/commit/fb59dffc3e3ed9257902f472bc90f8dfe167c1ed))
* **loop:** terminal whole-plan check + arm-time oracle audit ([#629](https://github.com/cuongtranba/kanna/issues/629)) ([6f1d83d](https://github.com/cuongtranba/kanna/commit/6f1d83d1aea995f19fe39b0e779604ca3a5fa54a))
* **panes:** scroll the tab strip on a phone, smoothly ([#630](https://github.com/cuongtranba/kanna/issues/630)) ([a58c3ef](https://github.com/cuongtranba/kanna/commit/a58c3ef47300a37c65301d7c35132e7d0fc21112))


### Bug Fixes

* **agent:** park pending tools in per-chat slots, kill ghost turns for good ([#631](https://github.com/cuongtranba/kanna/issues/631)) ([0ccfd51](https://github.com/cuongtranba/kanna/commit/0ccfd511c7047148dc4ec68e10d04c7c9f684d66))

## [1.12.0](https://github.com/cuongtranba/kanna/compare/v1.11.0...v1.12.0) (2026-08-06)


### Features

* **client:** session tabs — N open chats give N tabs, side by side ([#626](https://github.com/cuongtranba/kanna/issues/626)) ([3bad30e](https://github.com/cuongtranba/kanna/commit/3bad30e6787b550435d801b817b2ee5617960f5c))


### Bug Fixes

* **loop:** label Progress rows with the chunk being worked ([#622](https://github.com/cuongtranba/kanna/issues/622)) ([796c110](https://github.com/cuongtranba/kanna/commit/796c110171845c908a08b0639378dc52ff0336cf))
* **mermaid:** make a diagram parse error diagnosable ([#621](https://github.com/cuongtranba/kanna/issues/621)) ([63d44ca](https://github.com/cuongtranba/kanna/commit/63d44ca7325029c172b3431b34d06d721aa31e89))
* **pane-layout:** two findings from the pane-tree QA run ([#619](https://github.com/cuongtranba/kanna/issues/619)) ([5087153](https://github.com/cuongtranba/kanna/commit/5087153a36490907a63fc5bae7fffd423f62f09c))
* **shell:** put the sidebar header and the pane tab strip on one band ([#623](https://github.com/cuongtranba/kanna/issues/623)) ([e3b4ba1](https://github.com/cuongtranba/kanna/commit/e3b4ba102a9291ac116b4253cdf3ac20a488134c))

## [1.11.0](https://github.com/cuongtranba/kanna/compare/v1.10.0...v1.11.0) (2026-08-05)


### Features

* **client:** finish the pane tree — retention, phone view, keyboard, drag-and-drop ([#618](https://github.com/cuongtranba/kanna/issues/618)) ([fdf25a9](https://github.com/cuongtranba/kanna/commit/fdf25a9bd631341fcfe736703344fc2dfd5e1283))
* **client:** port paseo layout/IA foundations — breakpoints, sidebar clamp, transcript rhythm ([#614](https://github.com/cuongtranba/kanna/issues/614)) ([490d6b4](https://github.com/cuongtranba/kanna/commit/490d6b463c2abe55902d4c87419fa67b53e4af99))
* **client:** replace the chat route's fixed layout with a user-editable pane tree ([#616](https://github.com/cuongtranba/kanna/issues/616)) ([e71c5e7](https://github.com/cuongtranba/kanna/commit/e71c5e7279fed8d8f88db51732c2b37a2b3012c5))


### Bug Fixes

* a parked AskUserQuestion can no longer wedge a chat ([#613](https://github.com/cuongtranba/kanna/issues/613)) ([3afca2f](https://github.com/cuongtranba/kanna/commit/3afca2fc346cdbd035bcfcb7e10ba74fbb1a9e9f))
* **agent:** stop a turn on the first click, including mid-boot ([#611](https://github.com/cuongtranba/kanna/issues/611)) ([5f18484](https://github.com/cuongtranba/kanna/commit/5f18484954f06859d3d4799f43896bbd53f07f80))
* **loop:** gate GOAL MET on the plan, refuse bad setups at arm time ([#617](https://github.com/cuongtranba/kanna/issues/617)) ([63d4d0e](https://github.com/cuongtranba/kanna/commit/63d4d0e1b8b67f9f2906f64e6b6ed17edbca7b97))
* **subagent:** match the claude spawn gate to the main chat ([#615](https://github.com/cuongtranba/kanna/issues/615)) ([a03e24f](https://github.com/cuongtranba/kanna/commit/a03e24f6ef63b73566ea229e62a333719e58b95e))

## [1.10.0](https://github.com/cuongtranba/kanna/compare/v1.9.1...v1.10.0) (2026-08-04)


### Features

* **slash-picker:** serve the command catalog per project, not per chat ([#609](https://github.com/cuongtranba/kanna/issues/609)) ([80dd7b7](https://github.com/cuongtranba/kanna/commit/80dd7b77c408012eae027be2117e9fa226a4a430))

## [1.9.1](https://github.com/cuongtranba/kanna/compare/v1.9.0...v1.9.1) (2026-08-03)


### Bug Fixes

* **server:** 404 missing assets instead of serving the SPA shell ([#607](https://github.com/cuongtranba/kanna/issues/607)) ([b2ba0d7](https://github.com/cuongtranba/kanna/commit/b2ba0d784a6b5c652c384432ba41fe5753da5e94))

## [1.9.0](https://github.com/cuongtranba/kanna/compare/v1.8.2...v1.9.0) (2026-08-02)


### Features

* **agent:** surface self-wake status + live background task list ([#606](https://github.com/cuongtranba/kanna/issues/606)) ([d5a6512](https://github.com/cuongtranba/kanna/commit/d5a6512dc4ae1750714d5e1789d5e5cb18885da5))
* **client:** ban state-transition logic written inline in JSX props ([#605](https://github.com/cuongtranba/kanna/issues/605)) ([2adaa35](https://github.com/cuongtranba/kanna/commit/2adaa351e1491aefdc2e298a47dd43552c0262a5))


### Bug Fixes

* **sidebar:** label starred and unstarred project lists ([#603](https://github.com/cuongtranba/kanna/issues/603)) ([75ef663](https://github.com/cuongtranba/kanna/commit/75ef6633764e609a831a641222ac01238ff281ca))

## [1.8.2](https://github.com/cuongtranba/kanna/compare/v1.8.1...v1.8.2) (2026-08-02)


### Bug Fixes

* **event-store:** stop reading and truncating legacy orch.jsonl ([545bc8a](https://github.com/cuongtranba/kanna/commit/545bc8ab88704145cbc5958a4a45d2b58e67d0a2))

## [1.8.1](https://github.com/cuongtranba/kanna/compare/v1.8.0...v1.8.1) (2026-07-31)


### Bug Fixes

* **agent:** escalate expired background-task guards to visible wakes, never silent reaps ([c2f777e](https://github.com/cuongtranba/kanna/commit/c2f777ed8eb19313e46f62289d60d34a9eb89d84))
* **agent:** escalate expired background-task guards to visible wakes, never silent reaps ([3c9595b](https://github.com/cuongtranba/kanna/commit/3c9595b506f343ec9c3f892430f74465e1f592e5))

## [1.8.0](https://github.com/cuongtranba/kanna/compare/v1.7.1...v1.8.0) (2026-07-30)


### Features

* **client:** import dialog with paste-a-session-id ([7d32ce0](https://github.com/cuongtranba/kanna/commit/7d32ce0793ab3b5946dc4fb941808d0934d31320))
* **client:** live-tail WS push + following pill in chat header ([bf5b652](https://github.com/cuongtranba/kanna/commit/bf5b652c0fb6665dad0988b06edc22e3054d76ff))
* import dialog with paste-a-session-id ([7dea312](https://github.com/cuongtranba/kanna/commit/7dea312577954915a85b8c368fdc4033e0432916))
* import specific Claude sessions by id (foundation) ([79b9460](https://github.com/cuongtranba/kanna/commit/79b9460d7fcd46ea9f3ed978ee92b602830ec5f7))
* live tail for imported Claude sessions (PR C — WS-Live) ([a58fd5a](https://github.com/cuongtranba/kanna/commit/a58fd5ac3c9410a4ff91ffbe334414cc93e4b0c4))
* **server:** derive subagents dir for imported chats ([472681a](https://github.com/cuongtranba/kanna/commit/472681a20d849dbe3eb981791b48c0c2bf21f25e))
* **server:** followed-session registry (pure core) for live import tail ([bc9d103](https://github.com/cuongtranba/kanna/commit/bc9d103b7642468e485d579db8c816915f8223c1))
* **server:** import specific Claude sessions by id (sessions.importClaudeSession) ([cbd8c9b](https://github.com/cuongtranba/kanna/commit/cbd8c9b1582f2a031d1ce6e42c247265dcd48193))
* **server:** live tail for imported sessions (stat-poll delta) ([5eefce3](https://github.com/cuongtranba/kanna/commit/5eefce385192f6a65b1fc1727d9116b9fabb4236))
* **server:** locate one Claude session transcript by uuid ([4cdde5c](https://github.com/cuongtranba/kanna/commit/4cdde5cc4a1ac4deaea527aacd191a94d3b43456))
* **server:** subagent drill-in for imported chats (WS-Drill) ([b4a9278](https://github.com/cuongtranba/kanna/commit/b4a9278360382b6cd1921bd71b05a24c921b1313))
* **server:** subagent drill-in for imported chats via lazy dir derivation ([bae79ec](https://github.com/cuongtranba/kanna/commit/bae79ec52151e45c01fb359913fb9c08654b0388))
* **shared:** extract Claude session uuids from pasted text ([9c3f9ad](https://github.com/cuongtranba/kanna/commit/9c3f9ad96852bcc3d10de68292528e758e537f19))


### Bug Fixes

* **push:** make VAPID contact subject configurable; stop deleting devices on 403 ([#580](https://github.com/cuongtranba/kanna/issues/580)) ([55062e3](https://github.com/cuongtranba/kanna/commit/55062e3f1cb278c479f5821867dc60c4a7bf0306))
* **server:** enrich imported tool_result entries with toolUseResult debugRaw ([4d031df](https://github.com/cuongtranba/kanna/commit/4d031df4b819205637d7ac8ee0f397f4371f5c03))
* **test:** stop hardcoding a local absolute path in encodeCwd fixtures ([be79e2b](https://github.com/cuongtranba/kanna/commit/be79e2b3affb13f198153d87435b6d64bc13d4cc))

## [1.7.1](https://github.com/cuongtranba/kanna/compare/v1.7.0...v1.7.1) (2026-07-24)


### Bug Fixes

* **slash:** populate / picker from local project+user skills only, drop Claude CLI init ([#578](https://github.com/cuongtranba/kanna/issues/578)) ([ba2c5ac](https://github.com/cuongtranba/kanna/commit/ba2c5acd585d150321ae6c59e3a7da926885fa71))

## [1.7.0](https://github.com/cuongtranba/kanna/compare/v1.6.4...v1.7.0) (2026-07-24)


### Features

* **orch:** bound {{DIFF}} injection and structure adversarial-review output ([#575](https://github.com/cuongtranba/kanna/issues/575)) ([35cfe80](https://github.com/cuongtranba/kanna/commit/35cfe8022d524a5638c859ed86961fed6e3bbbbb))


### Bug Fixes

* **prompt:** guard workflow resume against dropped args ([#576](https://github.com/cuongtranba/kanna/issues/576)) ([e283ec9](https://github.com/cuongtranba/kanna/commit/e283ec997ce38d7320aabb3184b46018ca4e52e8))

## [1.6.4](https://github.com/cuongtranba/kanna/compare/v1.6.3...v1.6.4) (2026-07-24)


### Bug Fixes

* **external-open:** bridge open folder/default/terminal to Windows under WSL2 ([#573](https://github.com/cuongtranba/kanna/issues/573)) ([2e5bcd1](https://github.com/cuongtranba/kanna/commit/2e5bcd1aaf67615987091f97ec0b11468b8cc727))
* **plan:** render mermaid diagrams in ExitPlanMode plans ([#572](https://github.com/cuongtranba/kanna/issues/572)) ([a8c9671](https://github.com/cuongtranba/kanna/commit/a8c96717341675988944877e4e1d30df981fc64f))

## [1.6.3](https://github.com/cuongtranba/kanna/compare/v1.6.2...v1.6.3) (2026-07-22)


### Bug Fixes

* **agent:** keep session alive during background Agent runs ([#570](https://github.com/cuongtranba/kanna/issues/570)) ([a9350fb](https://github.com/cuongtranba/kanna/commit/a9350fb10b294fe898d554f404caaa4b5bf64071))

## [1.6.2](https://github.com/cuongtranba/kanna/compare/v1.6.1...v1.6.2) (2026-07-22)


### Bug Fixes

* **file-preview:** render markdown + mermaid in file viewer regardless of label ([#568](https://github.com/cuongtranba/kanna/issues/568)) ([058c1b7](https://github.com/cuongtranba/kanna/commit/058c1b7a9f60dde0d57c614ed1a599b42bb440e4))

## [1.6.1](https://github.com/cuongtranba/kanna/compare/v1.6.0...v1.6.1) (2026-07-21)


### Bug Fixes

* **wiki:** rename Screenshot pages .md-&gt;.mdx so imports/JSX render ([#566](https://github.com/cuongtranba/kanna/issues/566)) ([8ebdb96](https://github.com/cuongtranba/kanna/commit/8ebdb9671f830778b19b0f68e4543761574718d7))

## [1.6.0](https://github.com/cuongtranba/kanna/compare/v1.5.2...v1.6.0) (2026-07-21)


### Features

* **loop:** mdast structured tracking-file access to bound loop context ([#564](https://github.com/cuongtranba/kanna/issues/564)) ([f442766](https://github.com/cuongtranba/kanna/commit/f442766794bf784ccc1463b6178a24df5b651245))

## [1.5.2](https://github.com/cuongtranba/kanna/compare/v1.5.1...v1.5.2) (2026-07-20)


### Bug Fixes

* **client:** stop SocketBridge reconnect loop + ast-grep render-loop gates ([#562](https://github.com/cuongtranba/kanna/issues/562)) ([7ee3920](https://github.com/cuongtranba/kanna/commit/7ee392012ee486f45482543a61ba9556cb104b32))

## [1.5.1](https://github.com/cuongtranba/kanna/compare/v1.5.0...v1.5.1) (2026-07-20)


### Bug Fixes

* **deps:** bump claude-agent-sdk 0.2.140 -&gt; 0.3.215 ([#559](https://github.com/cuongtranba/kanna/issues/559)) ([e0b1a13](https://github.com/cuongtranba/kanna/commit/e0b1a13d7b278a08a0d354a55d92fa76e126bd90))

## [1.5.0](https://github.com/cuongtranba/kanna/compare/v1.4.0...v1.5.0) (2026-07-20)


### Features

* **loop:** defer 429 wake to quota reset when loop is armed ([#553](https://github.com/cuongtranba/kanna/issues/553)) ([0556374](https://github.com/cuongtranba/kanna/commit/0556374e3876a87ace246307fd91e4ac27a5b65d))


### Bug Fixes

* **messages:** show error badge when a Mermaid diagram fails to render ([51c9f78](https://github.com/cuongtranba/kanna/commit/51c9f784b2c5d0212005b076f922cfa07d597c4d))
* **messages:** show error badge when a Mermaid diagram fails to render ([80d2617](https://github.com/cuongtranba/kanna/commit/80d2617c2658b07ab62b1996e0a9e2e873e2d125))
* **slash-commands:** stop the / picker hanging on eternal loading ([#557](https://github.com/cuongtranba/kanna/issues/557)) ([279162d](https://github.com/cuongtranba/kanna/commit/279162d0be3b9eac19ddc7ebc8d9ad552a8bbfd0))

## [1.4.0](https://github.com/cuongtranba/kanna/compare/v1.3.1...v1.4.0) (2026-07-18)


### Features

* **client:** apply chat.ops deltas with gap-triggered resync ([7937e4a](https://github.com/cuongtranba/kanna/commit/7937e4a33e7d61f2bd42e0452fc8483ef008d32c))
* **protocol:** chat.ops event + since on chat topic ([a807472](https://github.com/cuongtranba/kanna/commit/a80747251bc1160ae04f12321c0e439cbd593d03))
* **server:** chat.ops delta broadcast with snapshot fallback ([32e7725](https://github.com/cuongtranba/kanna/commit/32e7725eee29ff0d1004e286cb63a573dc460ce1))
* **server:** ChatOpLog ring buffer with per-chat seq ([950cd92](https://github.com/cuongtranba/kanna/commit/950cd9254f7e3ffbcbfa6886d02b11e47dbd7267))
* **server:** pure chat meta diff -&gt; ops ([d08946c](https://github.com/cuongtranba/kanna/commit/d08946ce9a30e800c674ffdc8d896bcef4196279))
* **server:** record entries.append ops in appendMessage; stamp seq on chat snapshots ([1682abd](https://github.com/cuongtranba/kanna/commit/1682abd786fd96cb1bd2f5bd9f2212db4e8f9229))
* **shared:** chat op-log types + pure applyChatOps reducer ([7522aa6](https://github.com/cuongtranba/kanna/commit/7522aa66f45ae9026b18bfe4603e7466e2081ed2))


### Bug Fixes

* **server:** replace banned type assertion with typed literal in chat-ops-diff ([8c24b49](https://github.com/cuongtranba/kanna/commit/8c24b49bf272ebbd26ed46db04d14a6b39551ae8))


### Performance Improvements

* add long-session benchmark harness + baseline (DKR-1) ([152cb9d](https://github.com/cuongtranba/kanna/commit/152cb9d8596fe9d37a470c334cc09e4dbf9d3a4a))
* long-session performance — chat.ops delta stream, transcript LRU + tail-read, render windowing ([fad3b5d](https://github.com/cuongtranba/kanna/commit/fad3b5d77d852c51d23ab03709253cbc79814ccb))
* long-session performance — chat.ops delta stream, transcript LRU + tail-read, render windowing ([fad3b5d](https://github.com/cuongtranba/kanna/commit/fad3b5d77d852c51d23ab03709253cbc79814ccb))
* post-change bench numbers + KR verdict (KR1/KR2/KR4 met, KR3 flagged) ([019fed9](https://github.com/cuongtranba/kanna/commit/019fed9c1d58a1b352c500dbdd4bc320387cddb5))
* **server:** JSONL tail-read with byte-offset cursors for cold chat open (KR3) ([e6e02e2](https://github.com/cuongtranba/kanna/commit/e6e02e2e68001fb735c7ed44f4c2ae9fb0134a91))
* **server:** transcript LRU cache + window-only page cloning ([3e0dd5d](https://github.com/cuongtranba/kanna/commit/3e0dd5dc4b0093f27f47da70e739a0809519d983))
* **share:** content-visibility windowing on shared-session rows ([ee8affe](https://github.com/cuongtranba/kanna/commit/ee8affe58b3b47b6753c3a6086cc08a204136761))

## [1.3.1](https://github.com/cuongtranba/kanna/compare/v1.3.0...v1.3.1) (2026-07-18)


### Bug Fixes

* seed subagentRunsByChatId for chats restored from snapshot.json ([#549](https://github.com/cuongtranba/kanna/issues/549)) ([ca804f8](https://github.com/cuongtranba/kanna/commit/ca804f811c1c5f17cfaf797a601b0829bcb6962b))

## [1.3.0](https://github.com/cuongtranba/kanna/compare/v1.2.0...v1.3.0) (2026-07-17)


### Features

* **loop:** resume armed loops through usage limits + Loop Progress panel ([#544](https://github.com/cuongtranba/kanna/issues/544)) ([24d8c98](https://github.com/cuongtranba/kanna/commit/24d8c984e6d660155238dcf07fc7912b02c463df))


### Bug Fixes

* **client:** show loading state when steering a queued message ([#542](https://github.com/cuongtranba/kanna/issues/542)) ([3a02138](https://github.com/cuongtranba/kanna/commit/3a02138260a136ad08078e320670a9351aa14aab))

## [1.2.0](https://github.com/cuongtranba/kanna/compare/v1.1.5...v1.2.0) (2026-07-15)


### Features

* **events:** capture run config + model on turn_started for tracing ([#538](https://github.com/cuongtranba/kanna/issues/538)) ([2c08808](https://github.com/cuongtranba/kanna/commit/2c08808e51b164130f480e2221886fc4241f11aa))
* **orchestration:** make OrchestrationQueue user-callable (simple, linear, no-gate v1) ([#537](https://github.com/cuongtranba/kanna/issues/537)) ([34ac4aa](https://github.com/cuongtranba/kanna/commit/34ac4aaaea60291214077ee842bd7eb4eea110ea))


### Bug Fixes

* **agent:** gate background-task keep-alive on settle signal not deadline ([#539](https://github.com/cuongtranba/kanna/issues/539)) ([20c6e1f](https://github.com/cuongtranba/kanna/commit/20c6e1f01aefde45f350484e07ae4c4d35e2ed81))

## [1.1.5](https://github.com/cuongtranba/kanna/compare/v1.1.4...v1.1.5) (2026-07-13)


### Bug Fixes

* **settings:** proxy changelog releases through server ([#535](https://github.com/cuongtranba/kanna/issues/535)) ([0371717](https://github.com/cuongtranba/kanna/commit/03717174a45cc09777b762ad5046d9a8f609d26f))

## [1.1.4](https://github.com/cuongtranba/kanna/compare/v1.1.3...v1.1.4) (2026-07-13)


### Bug Fixes

* **loop:** deterministically reconcile existing tracking files in setup_loop ([#533](https://github.com/cuongtranba/kanna/issues/533)) ([4f10445](https://github.com/cuongtranba/kanna/commit/4f104454dda475b14b33017ba472aebd58050988))

## [1.1.3](https://github.com/cuongtranba/kanna/compare/v1.1.2...v1.1.3) (2026-07-13)


### Bug Fixes

* **agent:** self-heal poisoned Claude session tokens and make loop /clear stick ([#531](https://github.com/cuongtranba/kanna/issues/531)) ([e8f1701](https://github.com/cuongtranba/kanna/commit/e8f17013a42bc105829ec0188f61cc14f059328b))

## [1.1.2](https://github.com/cuongtranba/kanna/compare/v1.1.1...v1.1.2) (2026-07-12)


### Bug Fixes

* **composer:** swallow Tab auto-repeat keydowns after a snippet expansion ([#530](https://github.com/cuongtranba/kanna/issues/530)) ([00b8216](https://github.com/cuongtranba/kanna/commit/00b82163353d4f71d2526dac50a223bdacf3dafe))
* **subagent:** embed live roster in UNKNOWN_SUBAGENT errors and reject guessed ids before delegation ([#527](https://github.com/cuongtranba/kanna/issues/527)) ([30bd397](https://github.com/cuongtranba/kanna/commit/30bd3974886127c1bf17c8727260b6c79554d70a))

## [1.1.1](https://github.com/cuongtranba/kanna/compare/v1.1.0...v1.1.1) (2026-07-12)


### Bug Fixes

* **composer:** keep Tab snippet caret in editor by preventing default synchronously ([#524](https://github.com/cuongtranba/kanna/issues/524)) ([1d07c2c](https://github.com/cuongtranba/kanna/commit/1d07c2c097cac80eabf2ec577e580012d20c2ae3))
* **loop:** stall-watchdog timeout, armed-state re-injection, hard tool-block, deterministic worker ([#526](https://github.com/cuongtranba/kanna/issues/526)) ([bc32d6f](https://github.com/cuongtranba/kanna/commit/bc32d6f6aa6391d3d33d28e1192c75644ed9b1d5))

## [1.1.0](https://github.com/cuongtranba/kanna/compare/v1.0.1...v1.1.0) (2026-07-11)


### Features

* **agent:** notification-driven loop orchestration; remove schedule_wakeup ([#519](https://github.com/cuongtranba/kanna/issues/519)) ([2cb3470](https://github.com/cuongtranba/kanna/commit/2cb34707904000fc8b049a4557e7b791d6c091cf))
* **mcp:** setup_loop MCP tool with validated template ([#522](https://github.com/cuongtranba/kanna/issues/522)) ([3bb70f4](https://github.com/cuongtranba/kanna/commit/3bb70f46ffd3f00b86cd1eb1915a4ae83f6c83f3))

## [1.0.1](https://github.com/cuongtranba/kanna/compare/v1.0.0...v1.0.1) (2026-07-10)


### Bug Fixes

* **composer:** keep snippet-expand caret visible after Tab ([#517](https://github.com/cuongtranba/kanna/issues/517)) ([15fd450](https://github.com/cuongtranba/kanna/commit/15fd45089fff435dda2be8a7c54b7a0fbd24bb6f))

## [1.0.0](https://github.com/cuongtranba/kanna/compare/v0.108.2...v1.0.0) (2026-07-10)


### ⚠ BREAKING CHANGES

* **claude-pty:** Shannon-style TUI transport — drop --print, tail transcript JSONL ([#261](https://github.com/cuongtranba/kanna/issues/261))

### Features

* add full-page /workflows view with per-agent transcript drill-in ([#468](https://github.com/cuongtranba/kanna/issues/468)) ([#478](https://github.com/cuongtranba/kanna/issues/478)) ([a13cd75](https://github.com/cuongtranba/kanna/commit/a13cd758b189f28034f90cc1963f971d46d6f8a0))
* **agent:** inline file downloads via offer_download SDK MCP tool ([#42](https://github.com/cuongtranba/kanna/issues/42)) ([20b2d99](https://github.com/cuongtranba/kanna/commit/20b2d998e532860551b22bd7dcd4b30ff1e436ef))
* **agent:** label stack projects in the Claude system prompt ([#425](https://github.com/cuongtranba/kanna/issues/425)) ([a43e805](https://github.com/cuongtranba/kanna/commit/a43e80556b5e283835e35c23d0a7a3f2439c8b7f))
* **agent:** proactive /compact injection before context overflows ([#116](https://github.com/cuongtranba/kanna/issues/116)) ([1169e3e](https://github.com/cuongtranba/kanna/commit/1169e3e120946e8c0cfce5a76da6527e6b228356))
* **auth:** persist sessions across restart and browser close ([#10](https://github.com/cuongtranba/kanna/issues/10)) ([2734f51](https://github.com/cuongtranba/kanna/commit/2734f51a582ebf2d5895a2f7e8021e8274a99d4e))
* **bg-tasks:** visibility and stop control for background tasks ([#38](https://github.com/cuongtranba/kanna/issues/38)) ([416bab5](https://github.com/cuongtranba/kanna/commit/416bab580b0cede033f6a16e2bce29026d472e10))
* cancel individual subagent run ([#96](https://github.com/cuongtranba/kanna/issues/96)) ([b171ddf](https://github.com/cuongtranba/kanna/commit/b171ddf7cbf1b566b6df4aa0c82684364a29f704))
* **chat-navbar:** show worktree dir in branch label ([#69](https://github.com/cuongtranba/kanna/issues/69)) ([6dca7cc](https://github.com/cuongtranba/kanna/commit/6dca7cc70e3a950bf88713fe95add172ce00644e))
* **chat-ui:** show home-relative cwd + branch in navbar label ([#388](https://github.com/cuongtranba/kanna/issues/388)) ([74d080a](https://github.com/cuongtranba/kanna/commit/74d080a04325e488ec24633d456e6d6761c35a06))
* **chat-ui:** show local skills + slash commands in / picker ([#444](https://github.com/cuongtranba/kanna/issues/444)) ([d5e344b](https://github.com/cuongtranba/kanna/commit/d5e344b6e08e6d22748387543b352e12d7e90919))
* **chat-ui:** show session token total pill in composer ([#341](https://github.com/cuongtranba/kanna/issues/341)) ([23872d9](https://github.com/cuongtranba/kanna/commit/23872d99ee48539340f51ada184b8cd679690997))
* **claude-pty:** allowlist preflight + --tools flag (P3b) ([#110](https://github.com/cuongtranba/kanna/issues/110)) ([ba6b440](https://github.com/cuongtranba/kanna/commit/ba6b440ae53a6f47cd459d8e5d10750de04e246d))
* **claude-pty:** Linux bwrap sandbox parity (P4.1) ([#112](https://github.com/cuongtranba/kanna/issues/112)) ([713c1da](https://github.com/cuongtranba/kanna/commit/713c1da25cbbd9c933434920994e6aabf67d4023))
* **claude-pty:** macOS sandbox-exec wrapper (P4) ([#111](https://github.com/cuongtranba/kanna/issues/111)) ([b3a9e12](https://github.com/cuongtranba/kanna/commit/b3a9e1258c30057dce89f4aa6a68598948643f99))
* **claude-pty:** OAuth pool rotation via CLAUDE_CODE_OAUTH_TOKEN (P5) ([#114](https://github.com/cuongtranba/kanna/issues/114)) ([65c1542](https://github.com/cuongtranba/kanna/commit/65c1542e4e371a5109c2565679a45ad8dd9c945a))
* **claude-pty:** on-disk pid registry to reap crash orphans on next boot ([#267](https://github.com/cuongtranba/kanna/issues/267)) ([1817cde](https://github.com/cuongtranba/kanna/commit/1817cde883b2a5ad992d359a22be682ba134850c))
* **claude-pty:** P7 — driver toggle, lifecycle, sidebar badges, per-chat permissions ([#135](https://github.com/cuongtranba/kanna/issues/135)) ([1742ea7](https://github.com/cuongtranba/kanna/commit/1742ea775e419adfb43f01514557e6fc57241529))
* **claude-pty:** plan-mode exit via Shift+Tab (F1) + getSupportedCommands live list (F2) ([#262](https://github.com/cuongtranba/kanna/issues/262)) ([5d941a5](https://github.com/cuongtranba/kanna/commit/5d941a574f8686701ad87554ece7bbe9167ada1b))
* **claude-pty:** PTY core driver (P2 — flag off by default) ([#106](https://github.com/cuongtranba/kanna/issues/106)) ([0ece0ba](https://github.com/cuongtranba/kanna/commit/0ece0ba128c5fc16fd758e675a878f63f8b69095))
* **claude-pty:** session lifecycle + prompt-too-long recovery (P6) ([#122](https://github.com/cuongtranba/kanna/issues/122)) ([9239751](https://github.com/cuongtranba/kanna/commit/9239751d5af721c7807572e454c9e40228f25605))
* **claude-pty:** Shannon-style TUI transport — drop --print, tail transcript JSONL ([#261](https://github.com/cuongtranba/kanna/issues/261)) ([273386c](https://github.com/cuongtranba/kanna/commit/273386cdb8d63803bc863f0ebfcf26b208e84ed9))
* **client:** render &lt;thinking&gt; blocks as collapsible disclosure ([#250](https://github.com/cuongtranba/kanna/issues/250)) ([f91722d](https://github.com/cuongtranba/kanna/commit/f91722d64e640b74f800a6f5f52a5ec5be36926d))
* **codex:** auto-relocate ImageGeneration outputs into project ([#210](https://github.com/cuongtranba/kanna/issues/210)) ([d1fb494](https://github.com/cuongtranba/kanna/commit/d1fb494b664882ec58b9ab39773ab7469f77ed05))
* **composer:** add Tab-expand text snippets ([#511](https://github.com/cuongtranba/kanna/issues/511)) ([d93e1c8](https://github.com/cuongtranba/kanna/commit/d93e1c8ec2dd3de564767b69b751f9c708caa1b6))
* configurable model catalog (customModels in settings) ([#469](https://github.com/cuongtranba/kanna/issues/469)) ([4371f06](https://github.com/cuongtranba/kanna/commit/4371f0651f6efbacfcec6f7be960ea65a1b373a6))
* custom MCP servers in settings (SDK + PTY) ([#282](https://github.com/cuongtranba/kanna/issues/282)) ([996b732](https://github.com/cuongtranba/kanna/commit/996b732d6fffdaf42e07afe7ee513d7995813300))
* **file-preview:** mobile-first universal file preview sheet ([#143](https://github.com/cuongtranba/kanna/issues/143)) ([181e60a](https://github.com/cuongtranba/kanna/commit/181e60aca9877815da7fb95b84a9183889a593cd))
* in-chat file preview via mcp__kanna__preview_file tool ([#479](https://github.com/cuongtranba/kanna/issues/479)) ([93056ab](https://github.com/cuongtranba/kanna/commit/93056ab75e41373041868d6a52c9682c51c78dee))
* **kanna-mcp:** built-in tool shims (P3a — flag off by default) ([#107](https://github.com/cuongtranba/kanna/issues/107)) ([bbaed17](https://github.com/cuongtranba/kanna/commit/bbaed17c014bbe874b255aa871b1af5db1c2172b))
* Kanna-owned agent self-scheduled wake (ScheduleWakeup + pending-workflow harvest) ([#357](https://github.com/cuongtranba/kanna/issues/357)) ([51fd6fa](https://github.com/cuongtranba/kanna/commit/51fd6fafcf9bdf0c66e5fa823545e3d715c5d60d))
* **lexical:** migrate chat input and messages to Lexical 0.45 ([#446](https://github.com/cuongtranba/kanna/issues/446)) ([a5d3619](https://github.com/cuongtranba/kanna/commit/a5d3619fe2f7d34652ffd54533007b8c1c3c50c4))
* **lint:** ban side-effect imports in src/shared and src/client ([#283](https://github.com/cuongtranba/kanna/issues/283)) ([c5d6934](https://github.com/cuongtranba/kanna/commit/c5d69342fe6e96dec05a829c93a424743792ad48))
* **lint:** catch DB construction, process.exit, process.env in pure layers ([#286](https://github.com/cuongtranba/kanna/issues/286)) ([8977d83](https://github.com/cuongtranba/kanna/commit/8977d83caa1139394b933d2e6b726ec0ad257905))
* **lint:** ratchet side-effect call sites in src/server (warn + lower-only baseline) ([#287](https://github.com/cuongtranba/kanna/issues/287)) ([9ec4c7e](https://github.com/cuongtranba/kanna/commit/9ec4c7e528f200b69336bb21721d7067ca8fbe44))
* **mcp-tool-refactor:** durable approval protocol + permission-gate (P1 — flag off by default) ([#105](https://github.com/cuongtranba/kanna/issues/105)) ([d2b2cce](https://github.com/cuongtranba/kanna/commit/d2b2cce003191f5989520adfabeaea6a3de2a1eb))
* **messages:** always render file card for local file links ([#377](https://github.com/cuongtranba/kanna/issues/377)) ([e864cc6](https://github.com/cuongtranba/kanna/commit/e864cc66726c00a9bb9b5892e9aeedd026268a54))
* **messages:** mask OAuth key as primary AccountInfo identifier ([#257](https://github.com/cuongtranba/kanna/issues/257)) ([d91f880](https://github.com/cuongtranba/kanna/commit/d91f880747ccad444cbc04c8bf970f412d773a40))
* **messages:** render mermaid diagrams in transcript markdown ([#242](https://github.com/cuongtranba/kanna/issues/242)) ([c606355](https://github.com/cuongtranba/kanna/commit/c606355c6330175f6ccf170afdc228a90aeea943))
* **messages:** surface OAuth key in chat AccountInfoMessage ([#254](https://github.com/cuongtranba/kanna/issues/254)) ([e24ec3e](https://github.com/cuongtranba/kanna/commit/e24ec3e6c2ad96bfd65d12d420b25e26f30042d8))
* **mobile:** swipe to open/close sidebar ([#306](https://github.com/cuongtranba/kanna/issues/306)) ([3000d58](https://github.com/cuongtranba/kanna/commit/3000d589f4aadb9071f868be4af4abd65cd76f83))
* model-independent chat phase 1 (provider-switching) ([#77](https://github.com/cuongtranba/kanna/issues/77)) ([075000b](https://github.com/cuongtranba/kanna/commit/075000be0201cc59194a76415213784cec0f6db1))
* model-independent chat phase 2 (subagent CRUD + [@agent](https://github.com/agent) mentions) ([#81](https://github.com/cuongtranba/kanna/issues/81)) ([07955a8](https://github.com/cuongtranba/kanna/commit/07955a81ad07f16a24bbf69f0c325a7f21999337))
* **models:** add Claude Fable 5 to the Claude provider catalog ([#409](https://github.com/cuongtranba/kanna/issues/409)) ([ffd106f](https://github.com/cuongtranba/kanna/commit/ffd106ffc8d1e3da3a27f440b67d31a1c6a63480))
* **models:** add claude-opus-4-8 to provider catalog ([#335](https://github.com/cuongtranba/kanna/issues/335)) ([8d36fdb](https://github.com/cuongtranba/kanna/commit/8d36fdb392561bfcd91534a168aaa0bd4e16cd34))
* **notice-banner:** extract reusable shell notice primitive ([#256](https://github.com/cuongtranba/kanna/issues/256)) ([1d1539e](https://github.com/cuongtranba/kanna/commit/1d1539e300a094b98b7e71a805759ae35f37d216))
* OAuth 2.1 client for HTTP/SSE custom MCP servers ([#461](https://github.com/cuongtranba/kanna/issues/461)) ([924ba2e](https://github.com/cuongtranba/kanna/commit/924ba2e902de5010e344d1ef1f18b4d5532d29ad))
* OAuth token pool with automatic rotation on rate-limit ([#52](https://github.com/cuongtranba/kanna/issues/52)) ([219ecef](https://github.com/cuongtranba/kanna/commit/219ecefe4fb453525c6e4314413c976235e7806c))
* **oauth-pool:** add disabled token status to exclude accounts from pool ([#117](https://github.com/cuongtranba/kanna/issues/117)) ([1fb43ae](https://github.com/cuongtranba/kanna/commit/1fb43ae04b2e7e76282f83864fbdacf7e734cf86))
* **oauth-pool:** name contested chat in token-unavailable refusal ([#235](https://github.com/cuongtranba/kanna/issues/235)) ([eef731b](https://github.com/cuongtranba/kanna/commit/eef731bccd2301aad12bcc6dfa8a32f113a723a8))
* **oauth-pool:** per-token concurrency cap (share OAuth across chats) ([#275](https://github.com/cuongtranba/kanna/issues/275)) ([9fdbfdd](https://github.com/cuongtranba/kanna/commit/9fdbfdd142130aa032c4a0b842420e3cbc9772af))
* **orchestration:** durable multi-task orchestration engine (Plan A) ([#507](https://github.com/cuongtranba/kanna/issues/507)) ([05a75f1](https://github.com/cuongtranba/kanna/commit/05a75f10ae8ed35c1b317d29415bfcfa13bcb5c2))
* per-turn token cost across SDK/OpenRouter/Codex + cumulative session totals ([#460](https://github.com/cuongtranba/kanna/issues/460)) ([5e4c9d7](https://github.com/cuongtranba/kanna/commit/5e4c9d709bf3e5d8d356b8c0fa284cff99198958))
* phase 3 subagent orchestration + UI ([#83](https://github.com/cuongtranba/kanna/issues/83)) ([bca45b9](https://github.com/cuongtranba/kanna/commit/bca45b9098b292373b54dcfd1e2bda5f05a3efe9))
* phase 4 real provider integration for subagents ([#86](https://github.com/cuongtranba/kanna/issues/86)) ([52d22ce](https://github.com/cuongtranba/kanna/commit/52d22ce50335059cc52b3c8705e1608b573d8a70))
* **provider:** add OpenRouter as third agentic chat provider ([#435](https://github.com/cuongtranba/kanna/issues/435)) ([01b26a8](https://github.com/cuongtranba/kanna/commit/01b26a8c51ae551f4d2219e95d366b74bc068d8e))
* **pty:** D4 partial — runtime /plan enter via slash command ([#174](https://github.com/cuongtranba/kanna/issues/174)) ([f9ab062](https://github.com/cuongtranba/kanna/commit/f9ab062837d9135e97b31bc584d4d11591ba5bfc))
* **pty:** hide exited instances from status panel + TTL prune ([#313](https://github.com/cuongtranba/kanna/issues/313)) ([2efb78e](https://github.com/cuongtranba/kanna/commit/2efb78e54012b6ecd055a1f2570b704024dfaab2))
* **pty:** live status panel + cancel/kill actions ([#309](https://github.com/cuongtranba/kanna/issues/309)) ([e077d7a](https://github.com/cuongtranba/kanna/commit/e077d7a86639a8f9d60183f3ac26421757e465ec))
* **pty:** phase 1 parity wiring (B2 + B5) ([#164](https://github.com/cuongtranba/kanna/issues/164)) ([3781119](https://github.com/cuongtranba/kanna/commit/3781119ae70cf3b754da6f013ef9ac5e8207cc7e))
* **pty:** phase 2 — register kanna MCP server in PTY (B3 + B6) ([#168](https://github.com/cuongtranba/kanna/issues/168)) ([aa37c86](https://github.com/cuongtranba/kanna/commit/aa37c86717cd3d5bb8bd4ea3bd4f798470c7919e))
* **pty:** phase 3 — JSONL event parity (D1 + D2 + D3 + D4) ([#169](https://github.com/cuongtranba/kanna/issues/169)) ([f90384d](https://github.com/cuongtranba/kanna/commit/f90384dee08d457770d00c1505cdb412586a1195))
* **pty:** phase 4 — failure handling parity (B4 + D5 + D7) ([#170](https://github.com/cuongtranba/kanna/issues/170)) ([85a685d](https://github.com/cuongtranba/kanna/commit/85a685d7138609af9a576663a76cd8843e05b31f))
* **pty:** phase 5 — subagent routing + shared prompt + account (D6 + D8 + C1) ([#171](https://github.com/cuongtranba/kanna/issues/171)) ([0fa777d](https://github.com/cuongtranba/kanna/commit/0fa777d7b8f988ed6514f5b47c9211c335e1b3c8))
* **pty:** phase 6 — SDK ↔ PTY equivalence matrix + doc sweep ([#172](https://github.com/cuongtranba/kanna/issues/172)) ([043d82c](https://github.com/cuongtranba/kanna/commit/043d82cf6516752ae707e6272801df2aeb460434))
* **pty:** realtime memory tracking in live status panel ([#316](https://github.com/cuongtranba/kanna/issues/316)) ([8148302](https://github.com/cuongtranba/kanna/commit/814830259868c93183418de32af5ed9b031c2b2d))
* **pty:** surface live Claude TUI spinner status in chat header ([#389](https://github.com/cuongtranba/kanna/issues/389)) ([ac3b107](https://github.com/cuongtranba/kanna/commit/ac3b1079a3e593a8d215e03c680878b5191f3c34))
* **pty:** surface loaded CLAUDE.md / rule files in transcript ([#386](https://github.com/cuongtranba/kanna/issues/386)) ([5d4cc52](https://github.com/cuongtranba/kanna/commit/5d4cc527bb19d63aec02ff076614c9eb51a88887))
* **pty:** switch to --print stream-json + trust claude as source of truth ([#200](https://github.com/cuongtranba/kanna/issues/200)) ([ca62112](https://github.com/cuongtranba/kanna/commit/ca621122f39b22609d89782287dbcb8548ff164d))
* **push:** web push notifications for chat state changes ([#11](https://github.com/cuongtranba/kanna/issues/11)) ([8ecb9d1](https://github.com/cuongtranba/kanna/commit/8ecb9d1b76674a22482b086af033c6e2196bec1c))
* remove background tasks panel and related code ([#315](https://github.com/cuongtranba/kanna/issues/315)) ([a59079c](https://github.com/cuongtranba/kanna/commit/a59079c937c72e1e39c8d16b5b11dda0032cd5dd))
* **renderer:** linkify text references adjacent to URLs ([#456](https://github.com/cuongtranba/kanna/issues/456)) ([794d662](https://github.com/cuongtranba/kanna/commit/794d662cc31e4892bf28240b5ac3b15770144bc7))
* SDK↔PTY driver feature parity (keep-alive subagents, workflow panel) ([#418](https://github.com/cuongtranba/kanna/issues/418)) ([1742464](https://github.com/cuongtranba/kanna/commit/1742464a114611459be90f04dcb5be7e69da84e8))
* **settings:** add global prompt append for Claude + Codex turns ([#260](https://github.com/cuongtranba/kanna/issues/260)) ([f700d08](https://github.com/cuongtranba/kanna/commit/f700d085cd1d60249d582411a449ed25e14288f5))
* **settings:** subagent CRUD UI ([#166](https://github.com/cuongtranba/kanna/issues/166)) ([0f094ab](https://github.com/cuongtranba/kanna/commit/0f094ab7870fb311a84ec17b080923045923fe3a))
* **share:** derive share URL from request origin, drop tunnel gate ([#321](https://github.com/cuongtranba/kanna/issues/321)) ([24599e9](https://github.com/cuongtranba/kanna/commit/24599e9b12118c623c6730ba65244f5017ea18cd))
* **share:** read-only public session share ([#318](https://github.com/cuongtranba/kanna/issues/318)) ([c7a7245](https://github.com/cuongtranba/kanna/commit/c7a7245fcd21cc869c352c8a9a7d88b5a8749784))
* **sidebar:** add stack delete via dropdown + context menu ([#79](https://github.com/cuongtranba/kanna/issues/79)) ([f4843a1](https://github.com/cuongtranba/kanna/commit/f4843a1fc987cc05986fdfcb7fc276bb2c4a4702))
* **sidebar:** asterism separator between stacks ([#85](https://github.com/cuongtranba/kanna/issues/85)) ([002f39e](https://github.com/cuongtranba/kanna/commit/002f39ecb73173ee1b0fbcfe5bd1a34eb264d8ca))
* **skills:** add kanna-debug skill for transcript-driven debugging ([f6df21a](https://github.com/cuongtranba/kanna/commit/f6df21afbb27a5c4e41c7ac9b6ae9c7b946a00e6))
* **stacks:** Phase 1 — server, events, store, ws-router ([#48](https://github.com/cuongtranba/kanna/issues/48)) ([7abeff1](https://github.com/cuongtranba/kanna/commit/7abeff13a6a7293959d712a36b0480b5ea1e6787))
* **stacks:** Phase 2 — chat bindings + agent spawn wiring ([#50](https://github.com/cuongtranba/kanna/issues/50)) ([2295fc8](https://github.com/cuongtranba/kanna/commit/2295fc80f2a24815e9263040ab731d91efce8cab))
* **stacks:** Phase 3 — sidebar UI, chat creation, peer strip ([#55](https://github.com/cuongtranba/kanna/issues/55)) ([0a680c1](https://github.com/cuongtranba/kanna/commit/0a680c119688a9c069e747c5087df96ebe461645))
* **stacks:** Phase 3 — UI plan (draft, plan-only) ([#51](https://github.com/cuongtranba/kanna/issues/51)) ([4f52dac](https://github.com/cuongtranba/kanna/commit/4f52dace8ddc06f26c879b40a9b0151c0693031a))
* star projects in sidebar ([#74](https://github.com/cuongtranba/kanna/issues/74)) ([65c1b33](https://github.com/cuongtranba/kanna/commit/65c1b330b88c3c67157b8514b5fc3ae0e59efe60))
* **subagent:** add run_in_background delegation mode ([#420](https://github.com/cuongtranba/kanna/issues/420)) ([a10fc89](https://github.com/cuongtranba/kanna/commit/a10fc893847fae90613a20016805b3287acb0ce1))
* **subagent:** keep-alive multi-turn PTY sessions ([#338](https://github.com/cuongtranba/kanna/issues/338)) ([deb412b](https://github.com/cuongtranba/kanna/commit/deb412b2c321899375e235a1c4e6adff90235ac2))
* **subagent:** live UI broadcast + pending tool loading state ([#237](https://github.com/cuongtranba/kanna/issues/237)) ([65969ed](https://github.com/cuongtranba/kanna/commit/65969eda3382ae480d1b8e2bf968fdeb26c0d2e5))
* **subagent:** main agent delegates via mcp__kanna__delegate_subagent ([#205](https://github.com/cuongtranba/kanna/issues/205)) ([47466dc](https://github.com/cuongtranba/kanna/commit/47466dc7aff848baf0fc22d89a14149ee1c30148))
* **subagent:** per-subagent folder restriction (workingDir + allowedPaths) ([#404](https://github.com/cuongtranba/kanna/issues/404)) ([f4e5af3](https://github.com/cuongtranba/kanna/commit/f4e5af39ff7f4a40901781c7e83a71f613be1b35))
* **subagent:** per-subagent trigger mode (auto/manual) ([#429](https://github.com/cuongtranba/kanna/issues/429)) ([0a3a405](https://github.com/cuongtranba/kanna/commit/0a3a405c7da813b3666d22304dbbbe60244ea310))
* **subagent:** reactive activity label from latest entries ([#231](https://github.com/cuongtranba/kanna/issues/231)) ([08a41a5](https://github.com/cuongtranba/kanna/commit/08a41a58e23642a55b34b3786a1339219a6fe3f8))
* **subagent:** rich activity labels + MCP progress notifications ([#234](https://github.com/cuongtranba/kanna/issues/234)) ([493ef87](https://github.com/cuongtranba/kanna/commit/493ef87e809d09594c210e2f2f52475bef510f82))
* **timings:** chat session timings UI ([#28](https://github.com/cuongtranba/kanna/issues/28)) ([2f50b22](https://github.com/cuongtranba/kanna/commit/2f50b22d1f21b1b2760cb02f5af5c5d1a7e885cf))
* **transcript:** anchor subagent runs under their delegate_subagent call ([#339](https://github.com/cuongtranba/kanna/issues/339)) ([8e5e445](https://github.com/cuongtranba/kanna/commit/8e5e4451c31f7bf625e2c4200791c03d2002ea66))
* **transcript:** expandable nested child transcript for native Agent calls ([174d011](https://github.com/cuongtranba/kanna/commit/174d011083f76b04dd29fc1fcf0bc30c32fe0333))
* **transcript:** expandable nested child transcript for native Agent calls ([7a504f0](https://github.com/cuongtranba/kanna/commit/7a504f0a6862354c06cc6b8d833bf6143b97df59))
* **transcript:** render Claude CLI synthetic API errors as dedicated entry kind ([#273](https://github.com/cuongtranba/kanna/issues/273)) ([b2b1585](https://github.com/cuongtranba/kanna/commit/b2b158517f03c0be2f0993c2070db90745442e49))
* **transcript:** summary card for native Agent subagent tool calls ([69a44a2](https://github.com/cuongtranba/kanna/commit/69a44a25cc35257390c6ffe180b848cd3eb1158b))
* **transcript:** summary card for native Agent subagent tool calls ([dff35c0](https://github.com/cuongtranba/kanna/commit/dff35c0277687e2bd27cef2ac15956c36da72a66))
* **transcript:** surface Claude thinking blocks as assistant_thinking ([61b9f16](https://github.com/cuongtranba/kanna/commit/61b9f1613db287353ce4e94129c0bd4781668bb1))
* **transcript:** surface Claude thinking blocks as assistant_thinking ([43860b9](https://github.com/cuongtranba/kanna/commit/43860b93ec118cd0f1b9576cfac7a7cc73861812))
* **transcript:** syntax-highlight fenced code blocks in chat messages ([#276](https://github.com/cuongtranba/kanna/issues/276)) ([f966b56](https://github.com/cuongtranba/kanna/commit/f966b560dc4a5081d3c54fcd7019a6476c1a523c))
* **tunnel:** replace bash-detector with agent-callable expose_port tool ([#70](https://github.com/cuongtranba/kanna/issues/70)) ([24c6233](https://github.com/cuongtranba/kanna/commit/24c6233f3e0594c8ab0543485a312b62661a936b))
* **ui:** centralize app bootstrap loading state ([#206](https://github.com/cuongtranba/kanna/issues/206)) ([b4ada0e](https://github.com/cuongtranba/kanna/commit/b4ada0ef1504fad5c53471ceecdf016b2127a97b))
* **ui:** full-app loading overlay during redeploy/update restart ([#207](https://github.com/cuongtranba/kanna/issues/207)) ([c967cf2](https://github.com/cuongtranba/kanna/commit/c967cf21e0b733f06ea2d34f982f8e80ecb96a67))
* **ui:** unify AskUserQuestion slide UI across native + pending paths ([#229](https://github.com/cuongtranba/kanna/issues/229)) ([a565506](https://github.com/cuongtranba/kanna/commit/a5655068e415ead2389da36b40c1759f8b0635db))
* **update:** host-agnostic install with detection + KANNA_UPDATE_COMMAND override ([#119](https://github.com/cuongtranba/kanna/issues/119)) ([e9e66b2](https://github.com/cuongtranba/kanna/commit/e9e66b2d62b34751efacdc2b818db6733c986964))
* **update:** install any release from changelog UI ([#208](https://github.com/cuongtranba/kanna/issues/208)) ([8fd44e9](https://github.com/cuongtranba/kanna/commit/8fd44e9cdf91fe21b8686081b3dbfb38a549ff6b))
* **uploads:** configurable max file size + upload progress UI ([#37](https://github.com/cuongtranba/kanna/issues/37)) ([220d590](https://github.com/cuongtranba/kanna/commit/220d590f541d7e13bce1499484380f5d9be0c87b))
* **wiki:** Kanna documentation site at kanna-wiki.lowbit.link ([#249](https://github.com/cuongtranba/kanna/issues/249)) ([01a86a2](https://github.com/cuongtranba/kanna/commit/01a86a24c33e2af66ada7443373693180a06d040))
* workflow status panel (PTY disk-watch) ([#358](https://github.com/cuongtranba/kanna/issues/358)) ([1ab36a2](https://github.com/cuongtranba/kanna/commit/1ab36a2c3fcde805c8369baf882d3b7cc3611038))
* **workflow:** live per-agent detail for running runs (journal.jsonl) ([#367](https://github.com/cuongtranba/kanna/issues/367)) ([5ac6975](https://github.com/cuongtranba/kanna/commit/5ac6975bb347287e86a078658bc55357b218b0e7))
* **workflow:** richer per-agent journal detail in drill-in ([#372](https://github.com/cuongtranba/kanna/issues/372)) ([8d27627](https://github.com/cuongtranba/kanna/commit/8d27627e64ef02839accc8cb5781ced6a70e20c3))
* **workflow:** show in-flight runs as running in the status panel ([#363](https://github.com/cuongtranba/kanna/issues/363)) ([be3933d](https://github.com/cuongtranba/kanna/commit/be3933d879fa8a67cc7f660e3f1402d5d29a27f8))
* **worktrees:** server git wrapper (phase 1) ([#44](https://github.com/cuongtranba/kanna/issues/44)) ([8c1553c](https://github.com/cuongtranba/kanna/commit/8c1553c8c8e0b0bb3d64b70b4b23eae4acfb6299))


### Bug Fixes

* **agent:** clear stuck Running state after cancel-then-steer ([#39](https://github.com/cuongtranba/kanna/issues/39)) ([c951f1c](https://github.com/cuongtranba/kanna/commit/c951f1c8e941b300f488bda7db31189a2a36895a))
* **agent:** deliver OpenRouter prompts via the SDK session transport ([#443](https://github.com/cuongtranba/kanna/issues/443)) ([d826774](https://github.com/cuongtranba/kanna/commit/d8267748c7c1acca3161e0f8d86396d518f04653))
* **agent:** drop duplicate rate-limit body on trailing error result ([#434](https://github.com/cuongtranba/kanna/issues/434)) ([0274e27](https://github.com/cuongtranba/kanna/commit/0274e27129d621108dd5d40837024c4087d878d2))
* **agent:** fail-close OpenRouter turns whose SDK stream stalls before first entry ([#441](https://github.com/cuongtranba/kanna/issues/441)) ([7a10c59](https://github.com/cuongtranba/kanna/commit/7a10c59d1ec1e9f2eba1cae4809d8e5bc585ede7))
* **agent:** gate runClaudeSession finally activeTurn cleanup on isCurrentSession ([#115](https://github.com/cuongtranba/kanna/issues/115)) ([fad644a](https://github.com/cuongtranba/kanna/commit/fad644a87a2be63ebc7842cedea16621d7f39b0a))
* **agent:** keep PTY session alive while a background workflow is running ([#359](https://github.com/cuongtranba/kanna/issues/359)) ([8e7af80](https://github.com/cuongtranba/kanna/commit/8e7af80ee3b1fff0249bd7f4226d659e7ccaa281))
* **agent:** mirror PTY OAuth-pool account info in SDK driver ([#422](https://github.com/cuongtranba/kanna/issues/422)) ([ca347be](https://github.com/cuongtranba/kanna/commit/ca347beaf16e279a8a307c4415085d08fba93825))
* **agent:** preserve rotation reservation in closeClaudeSession ([#179](https://github.com/cuongtranba/kanna/issues/179)) ([102270c](https://github.com/cuongtranba/kanna/commit/102270c7f8e7b934e0ce2a40588a7f9529987224))
* **agent:** real workflow liveness via live run dir (corrects [#359](https://github.com/cuongtranba/kanna/issues/359) no-op) ([#361](https://github.com/cuongtranba/kanna/issues/361)) ([9707062](https://github.com/cuongtranba/kanna/commit/970706234ce75915d16e8f6f992449535391ae07))
* **agent:** recreate activeTurn on late canUseTool from SDK self-resume ([#148](https://github.com/cuongtranba/kanna/issues/148)) ([4114fc7](https://github.com/cuongtranba/kanna/commit/4114fc7c99944ee0e0f11a4dc8b5e4140d3c7a88))
* **agent:** run the selected OpenRouter model instead of collapsing to default ([#437](https://github.com/cuongtranba/kanna/issues/437)) ([f548d4a](https://github.com/cuongtranba/kanna/commit/f548d4adee96e47996173031b2c84ffe40711337))
* **agent:** set claude_code preset with trust context to stop spurious malware refusals ([a38ec31](https://github.com/cuongtranba/kanna/commit/a38ec3113391c4aef22530a0595d195ecc26ef19))
* **agent:** surface OpenRouter identity in account_info, not Anthropic source ([#436](https://github.com/cuongtranba/kanna/issues/436)) ([9970b04](https://github.com/cuongtranba/kanna/commit/9970b043baac59f8e86b0e6af6d363e983e8c44a))
* **agent:** surface SDK background-task completions in the transcript ([#453](https://github.com/cuongtranba/kanna/issues/453)) ([353bd26](https://github.com/cuongtranba/kanna/commit/353bd26a67eb954cf6ca5993954ffd27a0608d95))
* **agent:** swallow SDK interrupt tail error on cancel ([#424](https://github.com/cuongtranba/kanna/issues/424)) ([dfc52a6](https://github.com/cuongtranba/kanna/commit/dfc52a6fa18e2136c1640689d72dc50dd0e49c59))
* **app-settings:** atomic writes prevent OAuth token loss ([#60](https://github.com/cuongtranba/kanna/issues/60)) ([7619fb8](https://github.com/cuongtranba/kanna/commit/7619fb8e7c2d3ec30a1084704decb2db3dad9077))
* **auto-continue:** suppress noisy 'continue' bubble on rate-limit recovery ([#506](https://github.com/cuongtranba/kanna/issues/506)) ([16ed674](https://github.com/cuongtranba/kanna/commit/16ed674632f753579214a8bc8af248131ec9d698))
* **bg-tasks:** remove duplicate "Background tasks" header ([#53](https://github.com/cuongtranba/kanna/issues/53)) ([029c957](https://github.com/cuongtranba/kanna/commit/029c957f44208df6aa4e85ef7ea4e1a611a4c776))
* **chat-input:** prevent iOS Safari page-jump when tapping file picker ([#182](https://github.com/cuongtranba/kanna/issues/182)) ([d8cd8cd](https://github.com/cuongtranba/kanna/commit/d8cd8cdc30de476fdb3e6f3373f3a217c0784708))
* **chat-input:** prevent iOS Safari page-jump when tapping file picker ([#192](https://github.com/cuongtranba/kanna/issues/192)) ([e139eb8](https://github.com/cuongtranba/kanna/commit/e139eb83f5044fdc15fa711fd8afa4c4b46f61e4))
* **chat-input:** show attach button on desktop ([#35](https://github.com/cuongtranba/kanna/issues/35)) ([40c8c8e](https://github.com/cuongtranba/kanna/commit/40c8c8eb50ba95381a5279f0319b76b5d5c68643))
* **chat-preferences:** persist composer state + use providerDefaults for new chat ([#155](https://github.com/cuongtranba/kanna/issues/155)) ([54aa3e0](https://github.com/cuongtranba/kanna/commit/54aa3e0562158d965c80d4426ca90ab6489d2d10))
* **chat-preferences:** refresh new-chat composer when settings change ([#151](https://github.com/cuongtranba/kanna/issues/151)) ([ad7c3ac](https://github.com/cuongtranba/kanna/commit/ad7c3acd91efd437607f4c2617d5969d34d2a4bf))
* **chat-ui:** align session token readout with flat toolbar ([#349](https://github.com/cuongtranba/kanna/issues/349)) ([53a8e98](https://github.com/cuongtranba/kanna/commit/53a8e986207b2c30d74373634de4a3a4d0767174))
* **chat-ui:** clamp Selection back into textarea on iOS keyboard-trackpad drift ([#183](https://github.com/cuongtranba/kanna/issues/183)) ([2b55798](https://github.com/cuongtranba/kanna/commit/2b557987c9d23fcf60b152f125a30f8d77c1be98))
* **chat-ui:** keep session token pill visible on mobile ([#345](https://github.com/cuongtranba/kanna/issues/345)) ([3f5b30e](https://github.com/cuongtranba/kanna/commit/3f5b30e906096c5311088c70bf0e661e92def738))
* **chat-ui:** keep subagent message text selectable ([#407](https://github.com/cuongtranba/kanna/issues/407)) ([73f8121](https://github.com/cuongtranba/kanna/commit/73f8121bc26f83bd42a8e90397f5e7961ad519b0))
* **chat-ui:** make composer toolbar tappable on mobile ([#378](https://github.com/cuongtranba/kanna/issues/378)) ([73f1fd4](https://github.com/cuongtranba/kanna/commit/73f1fd40e655086c42cdb20bbf1d205c41003eb1))
* **chat-ui:** prevent composer toolbar / token readout overlap ([#354](https://github.com/cuongtranba/kanna/issues/354)) ([1e429b6](https://github.com/cuongtranba/kanna/commit/1e429b69ce122418dc364337fcb9c48dc00f7a7e))
* **chat-ui:** prevent iOS cursor-jump during hold-space cursor drag ([#180](https://github.com/cuongtranba/kanna/issues/180)) ([cf28ff0](https://github.com/cuongtranba/kanna/commit/cf28ff0ebf2730d54e306bf1927b1a61848b3b7a))
* **chat-ui:** stop crash on aborted-stream result with missing body ([#439](https://github.com/cuongtranba/kanna/issues/439)) ([3c398f3](https://github.com/cuongtranba/kanna/commit/3c398f33e52bd4d883ff75b4c5411d28f7b46bc4))
* **chat-ui:** surface subagent pending question at transcript footer ([#432](https://github.com/cuongtranba/kanna/issues/432)) ([ab6d0ac](https://github.com/cuongtranba/kanna/commit/ab6d0ac27a6e5237a73f1c915e3b94647a31222a))
* **chat:** seed composer provider from server snapshot on session reload ([#137](https://github.com/cuongtranba/kanna/issues/137)) ([9019c50](https://github.com/cuongtranba/kanna/commit/9019c509786b13153680dbd2342c39db46b17d06))
* **chat:** server-authoritative routing kills duplicate queued bubble ([#136](https://github.com/cuongtranba/kanna/issues/136)) ([5354454](https://github.com/cuongtranba/kanna/commit/535445437a7d08dde652c2b39b9a91bf71755bd8))
* **chat:** surface tool and action card errors in UI ([8533147](https://github.com/cuongtranba/kanna/commit/85331479c26018a5c07871ed0b3ffcf1fffc204a))
* **chat:** transcript not scrollable on mobile for long conversations ([#159](https://github.com/cuongtranba/kanna/issues/159)) ([22b273b](https://github.com/cuongtranba/kanna/commit/22b273b90301bef85df8c7b02b693c34bea2e4f1))
* **ci:diag:** capture stuck-process stack when bun test hangs ([#141](https://github.com/cuongtranba/kanna/issues/141)) ([4d83e9c](https://github.com/cuongtranba/kanna/commit/4d83e9cc25cd519aef38e522ca353f9287ad858b))
* **claude-pty, subagent:** adaptive paste-commit wait + clear stale cancel on new turn ([#265](https://github.com/cuongtranba/kanna/issues/265)) ([0782da4](https://github.com/cuongtranba/kanna/commit/0782da4bac0a30b03f2e4b1d7565c8d71204a3bd))
* **claude-pty:** detect turn end via stop_reason — CLI ≥2.1.x writes no system rows ([#411](https://github.com/cuongtranba/kanna/issues/411)) ([8889806](https://github.com/cuongtranba/kanna/commit/888980683922b4bd5546d4354db4b4b37b3d74dd))
* **claude-pty:** fail-close hung turns on stream-end + add lifecycle trace logs ([#268](https://github.com/cuongtranba/kanna/issues/268)) ([b321973](https://github.com/cuongtranba/kanna/commit/b3219739b0c81afa864c4f006fc6b4e5dda94889))
* **claude-pty:** follow transcript with pure tail-poll, drop fs.watch ([#392](https://github.com/cuongtranba/kanna/issues/392)) ([1b6f3f2](https://github.com/cuongtranba/kanna/commit/1b6f3f2cd2b62e1a219fe6525a3ac69494eee03e))
* **claude-pty:** multi-line paste submit + mtime-floor JSONL discovery ([#264](https://github.com/cuongtranba/kanna/issues/264)) ([d9d9052](https://github.com/cuongtranba/kanna/commit/d9d905207929351df42c33d512f586337895a952))
* **claude-pty:** PID registry JSONL discovery + cross-talk hardening ([#271](https://github.com/cuongtranba/kanna/issues/271)) ([9b5bbf8](https://github.com/cuongtranba/kanna/commit/9b5bbf87ff672be45ebd533c4119f5bc787c3f50))
* **claude-pty:** plug PTY resource leaks + harden graceful shutdown ([#266](https://github.com/cuongtranba/kanna/issues/266)) ([2dd5a16](https://github.com/cuongtranba/kanna/commit/2dd5a1625157896a4fb60ec67049b3a59969aded))
* **claude-pty:** route AskUserQuestion/ExitPlanMode to UI under PTY ([#216](https://github.com/cuongtranba/kanna/issues/216)) ([2316725](https://github.com/cuongtranba/kanna/commit/2316725845263948761e24d897d5eba5b03bcebb)), closes [#215](https://github.com/cuongtranba/kanna/issues/215)
* **claude-pty:** SIGINT on stop, drain queue after cancel ([#220](https://github.com/cuongtranba/kanna/issues/220)) ([f5a76ff](https://github.com/cuongtranba/kanna/commit/f5a76ff1d40e956e95a26d818172c19e2b6d436a))
* **claude-pty:** TUI prompt submission, turn-end marker, deterministic JSONL path ([#263](https://github.com/cuongtranba/kanna/issues/263)) ([57aa777](https://github.com/cuongtranba/kanna/commit/57aa77703f31ae9940f3c655e4d7bee7d1c76460))
* **cli-supervisor:** skip self-update after UI-triggered restart so rollback sticks ([#269](https://github.com/cuongtranba/kanna/issues/269)) ([91d1415](https://github.com/cuongtranba/kanna/commit/91d141510917add042c13a9995b9cd17674ff57c))
* **client:** include subagentRuns in chat-snapshot dedup compare ([#245](https://github.com/cuongtranba/kanna/issues/245)) ([76d7b45](https://github.com/cuongtranba/kanna/commit/76d7b4586d5705234983339996d9f77f52b2e463))
* **client:** only 404 disables download offer card ([#476](https://github.com/cuongtranba/kanna/issues/476)) ([54fbc13](https://github.com/cuongtranba/kanna/commit/54fbc1394304a86b47492f1ca7e90f6fd5a45071))
* **codex:** render ImageGeneration inline with project URL and populated prompt ([#132](https://github.com/cuongtranba/kanna/issues/132)) ([a9d4c39](https://github.com/cuongtranba/kanna/commit/a9d4c3911729984201b498acce32eead1f5263d2))
* **codex:** serve absolute-path generated images via /api/local-file ([#167](https://github.com/cuongtranba/kanna/issues/167)) ([61aa1de](https://github.com/cuongtranba/kanna/commit/61aa1de077404a2009ace01a46043c3d06452eb1))
* **codex:** surface image generation + unknown ThreadItems, suppress empty agent messages ([#125](https://github.com/cuongtranba/kanna/issues/125)) ([4130ba9](https://github.com/cuongtranba/kanna/commit/4130ba93d49d98138241a68a66a8798bf73f6af8))
* **compact:** finalize PTY proactive /compact turn on compact_boundary ([#402](https://github.com/cuongtranba/kanna/issues/402)) ([653c8f5](https://github.com/cuongtranba/kanna/commit/653c8f55cc7934938b7a84d880c8d64efc9f1c64))
* **compact:** persist proactive-compact circuit breaker + harden audit gaps ([#139](https://github.com/cuongtranba/kanna/issues/139)) ([81ed65b](https://github.com/cuongtranba/kanna/commit/81ed65b3db05a96134d4335ad2b32a56f48cb051))
* **compact:** protect queued message from accidental dequeue mid-compact ([#134](https://github.com/cuongtranba/kanna/issues/134)) ([e1c0c73](https://github.com/cuongtranba/kanna/commit/e1c0c73b79f770483fbdd509ae64d13646650959))
* **compact:** seed maxTokens from [1m] model id to stop premature compact ([#131](https://github.com/cuongtranba/kanna/issues/131)) ([1f7bc42](https://github.com/cuongtranba/kanna/commit/1f7bc42a483c5d8b65a5eb074c14c25422e4c0b4))
* **compact:** stop cumulative result.usage leaking into usedTokens ([#152](https://github.com/cuongtranba/kanna/issues/152)) ([3007810](https://github.com/cuongtranba/kanna/commit/30078108852aed9b147479b73cbba04e00271613))
* **composer:** paste/drop images upload to the project, not the chat ([#459](https://github.com/cuongtranba/kanna/issues/459)) ([6826647](https://github.com/cuongtranba/kanna/commit/68266473098018f994445da52e9e15f9a41d5d70))
* **diff-store:** harden git spawns and add CI test workflow ([#31](https://github.com/cuongtranba/kanna/issues/31)) ([fe874fb](https://github.com/cuongtranba/kanna/commit/fe874fbfdaa5c670d2c083c4e044b5984bd21028))
* **downloads:** render local-file markdown links as download cards ([#75](https://github.com/cuongtranba/kanna/issues/75)) ([67fb665](https://github.com/cuongtranba/kanna/commit/67fb6651788c5718bae2403e777c5db28d9e1667))
* **event-store:** coalesce context_window_updated in live window ([#387](https://github.com/cuongtranba/kanna/issues/387)) ([3f49d69](https://github.com/cuongtranba/kanna/commit/3f49d695e3dd7436b1fe858db0e13d5838c6c495))
* **event-store:** decouple subagent live progress from global writeChain ([#244](https://github.com/cuongtranba/kanna/issues/244)) ([21ea6e9](https://github.com/cuongtranba/kanna/commit/21ea6e9aefe497fcd66984bbbdbdf1346145faae))
* **event-store:** dedupe appendMessage by messageId (JSONL replay safety) ([#109](https://github.com/cuongtranba/kanna/issues/109)) ([b6d5c01](https://github.com/cuongtranba/kanna/commit/b6d5c01e3e733d3b3e4a9bad2413b55099edff56))
* **event-store:** forkChat preserves stack membership ([#87](https://github.com/cuongtranba/kanna/issues/87)) ([7f76ac9](https://github.com/cuongtranba/kanna/commit/7f76ac94bdb1d3f7558b8cfc92ad8deed91d2c26))
* **file-preview:** bound scroll region inside dialog for long content ([#330](https://github.com/cuongtranba/kanna/issues/330)) ([5d12c76](https://github.com/cuongtranba/kanna/commit/5d12c76d83d0c19384ec8bacafda6ffe8099a36e))
* **file-preview:** restore scroll inside @-triggered file sheet ([#305](https://github.com/cuongtranba/kanna/issues/305)) ([c388e5a](https://github.com/cuongtranba/kanna/commit/c388e5a06976f71d2b6579a5eebf8529f5f00f64))
* **image-gen:** tighten types, fix silent error, dedupe URL builder ([#138](https://github.com/cuongtranba/kanna/issues/138)) ([890ad71](https://github.com/cuongtranba/kanna/commit/890ad716ccf15b3484c3ad6192ae0b8feeb7b3d2))
* import Claude session titles ([#383](https://github.com/cuongtranba/kanna/issues/383)) ([b7e69c1](https://github.com/cuongtranba/kanna/commit/b7e69c18a5f6b91acc1d4ae0869105a5012a9abf))
* **local-catalog:** namespace marketplace skills by real plugin name ([#458](https://github.com/cuongtranba/kanna/issues/458)) ([42fa49e](https://github.com/cuongtranba/kanna/commit/42fa49e9802fe7c4d0f1329fd2167d884875b3e4))
* **local-file-link:** treat extension-less paths as editor links ([#129](https://github.com/cuongtranba/kanna/issues/129)) ([8a0c867](https://github.com/cuongtranba/kanna/commit/8a0c867d857f50374d9836988870e2decddebb59))
* **local-projects:** enable vertical scroll when projects overflow viewport ([#416](https://github.com/cuongtranba/kanna/issues/416)) ([bb721b7](https://github.com/cuongtranba/kanna/commit/bb721b7c038b0ec1c302856bc90053fc5d57ef5b))
* **mcp-oauth:** persist AS metadata so token refresh survives past TTL ([#463](https://github.com/cuongtranba/kanna/issues/463)) ([be82004](https://github.com/cuongtranba/kanna/commit/be8200498ca7ea76712e298067d32b01aa680e9b))
* **mcp:** forward customMcpServers through agent settings view ([#353](https://github.com/cuongtranba/kanna/issues/353)) ([7efa965](https://github.com/cuongtranba/kanna/commit/7efa965b8f889cad7537a4aa51c66f751dbf1292))
* **mcp:** inject fresh oauth bearer when testing authenticated MCP servers ([#465](https://github.com/cuongtranba/kanna/issues/465)) ([b187c39](https://github.com/cuongtranba/kanna/commit/b187c3986422e020c42929a6799fba2b6b3cd697))
* **mcp:** keep loopback MCP transport alive across idle gaps ([#351](https://github.com/cuongtranba/kanna/issues/351)) ([22f8bec](https://github.com/cuongtranba/kanna/commit/22f8bec92e6dafdbaeeaaa58ff7f200d3f95900c))
* **mobile:** left-edge swipe opens sidebar instead of going back ([#406](https://github.com/cuongtranba/kanna/issues/406)) ([cfe4452](https://github.com/cuongtranba/kanna/commit/cfe445222ff79412d041ecebc6e0e9ba25b9fcd6))
* **models:** honor custom model catalog when normalizing selections ([#472](https://github.com/cuongtranba/kanna/issues/472)) ([9fd134b](https://github.com/cuongtranba/kanna/commit/9fd134bb2b219edd12178952f9a3a7ddf6dd98da))
* **npm:** rename package scope to [@cuongtran001](https://github.com/cuongtran001) to match npm account ([bd2c0d0](https://github.com/cuongtranba/kanna/commit/bd2c0d0e3d6df02712017a0facd023a463412b87))
* **oauth-pool:** detect SDK-wrapped rate-limit and rotate tokens ([c0a30a9](https://github.com/cuongtranba/kanna/commit/c0a30a90122db3c15fd5c98a0c00d3e44b62f887))
* **oauth-pool:** keep "In use" badge on single line ([#278](https://github.com/cuongtranba/kanna/issues/278)) ([4aa2aa8](https://github.com/cuongtranba/kanna/commit/4aa2aa8d2a288ba588c665fa277989ac129ffcda))
* **oauth-pool:** persist refusal as transcript result entry ([#248](https://github.com/cuongtranba/kanna/issues/248)) ([adbf02d](https://github.com/cuongtranba/kanna/commit/adbf02d8a5f5f5d4ed7c7338117050c0fcf2aad2))
* **oauth-pool:** refuse spawn + rotate on 401 to stop keychain-fallback 401 loop ([#123](https://github.com/cuongtranba/kanna/issues/123)) ([99662fc](https://github.com/cuongtranba/kanna/commit/99662fca8cac12e53eaa8fc8019472ea73e5800c))
* **oauth-pool:** release token reservation on turn end so idle chats stop blocking ([#128](https://github.com/cuongtranba/kanna/issues/128)) ([086d60d](https://github.com/cuongtranba/kanna/commit/086d60da07199f8307071839fb946278729d6f24))
* **oauth-pool:** reserve token per chat to prevent concurrent rotation race ([#89](https://github.com/cuongtranba/kanna/issues/89)) ([686c6b8](https://github.com/cuongtranba/kanna/commit/686c6b8a7de31d02f31f85d52c1c00a6df1581c9))
* **oauth-pool:** stop turn-end release from leaking the rotation pin; OAuth-only PTY auth ([#227](https://github.com/cuongtranba/kanna/issues/227)) ([024e09b](https://github.com/cuongtranba/kanna/commit/024e09be2862fe5c2f7a8ccff1b4a76237626340))
* **oauth-pool:** tear down session on token rotation ([#72](https://github.com/cuongtranba/kanna/issues/72)) ([9f28a71](https://github.com/cuongtranba/kanna/commit/9f28a713bf78657cce14fbbc43cd22db806fb4f0))
* **oauth-pool:** TOCTOU-safe hasUsable, ephemeral lease, pure read loop ([#177](https://github.com/cuongtranba/kanna/issues/177)) ([561e074](https://github.com/cuongtranba/kanna/commit/561e074c4a1b313d29036009bc4847d013c72792))
* **permission-gate:** force ask for mcp__kanna__ask_user_question / exit_plan_mode ([#217](https://github.com/cuongtranba/kanna/issues/217)) ([941f92f](https://github.com/cuongtranba/kanna/commit/941f92f19f159fba83c07e94abf62d85adb4a438)), closes [#215](https://github.com/cuongtranba/kanna/issues/215)
* point the dynamic import at `./terminal-pid-registry.adapter`. ([54270c6](https://github.com/cuongtranba/kanna/commit/54270c63ebab9d1aa550818d3cddc65784d6362a))
* **pty/preflight:** fail-closed on throw, real invalidateAll, contract-versioned cache, poll vs sleep ([#176](https://github.com/cuongtranba/kanna/issues/176)) ([575011e](https://github.com/cuongtranba/kanna/commit/575011eee6c5ddd957808e489a184d8232a77b5e))
* **pty/preflight:** narrow TOCTOU window by re-verifying binary sha256 before spawn ([#178](https://github.com/cuongtranba/kanna/issues/178)) ([0404680](https://github.com/cuongtranba/kanna/commit/0404680e9a4c148874c075af6ddb697d5bd2c7dc))
* **pty/sandbox:** symlink resolution, glob surfacing, injection + signal ([#175](https://github.com/cuongtranba/kanna/issues/175)) ([378797f](https://github.com/cuongtranba/kanna/commit/378797f5578456410a002b0afc300918df416940))
* **pty:** bound transcript poll + quiet-period TUI ready gate ([#311](https://github.com/cuongtranba/kanna/issues/311)) ([e4b3bed](https://github.com/cuongtranba/kanna/commit/e4b3bed6ccafb8ecdacdac4bbd852b852b3caf0e))
* **pty:** cannot fork PTY-created conversations (session id collision) ([#352](https://github.com/cuongtranba/kanna/issues/352)) ([4b3852e](https://github.com/cuongtranba/kanna/commit/4b3852e22b7f10074ab6998ad4d981748e9020e9))
* **pty:** close mcp/tmp/tool-callbacks on every exit path ([#201](https://github.com/cuongtranba/kanna/issues/201)) ([26a13b8](https://github.com/cuongtranba/kanna/commit/26a13b8004b93bcafe2803f6ed442cd7e8fc61de))
* **pty:** deliver subagent prompt via MCP channel push (fail-fast) ([#333](https://github.com/cuongtranba/kanna/issues/333)) ([c93afc3](https://github.com/cuongtranba/kanna/commit/c93afc35a14d710b7bd2c8814e03323901e6c879))
* **pty:** drop credentials.json requirement when OAuth-pool token supplied ([#173](https://github.com/cuongtranba/kanna/issues/173)) ([6dc8f37](https://github.com/cuongtranba/kanna/commit/6dc8f37e8c3327f77f1a6bc09584b0c4954115b3))
* **pty:** gate follow-up prompt on TUI-ready to stop silent hang ([#401](https://github.com/cuongtranba/kanna/issues/401)) ([50bcf85](https://github.com/cuongtranba/kanna/commit/50bcf85ec965ee42931fdc39604f6e18f058c8fb))
* **pty:** ignore sidechain + background auto-wake lines in transcript parser ([#332](https://github.com/cuongtranba/kanna/issues/332)) ([216392b](https://github.com/cuongtranba/kanna/commit/216392b5ae8175682ed8ae11a083d4fb4cf51a75))
* **pty:** keep session warm while a background Bash task is pending ([#379](https://github.com/cuongtranba/kanna/issues/379)) ([3652234](https://github.com/cuongtranba/kanna/commit/36522341ce9b6d8849f7f9e12b8696fa72f69055))
* **pty:** read assistant usage from nested message.usage ([#344](https://github.com/cuongtranba/kanna/issues/344)) ([c387112](https://github.com/cuongtranba/kanna/commit/c387112ec7b715daebf9f34245b2dc584ba08a9c))
* **pty:** stop re-spawn from leaking an invisible PTY child ([#375](https://github.com/cuongtranba/kanna/issues/375)) ([a6fdbb0](https://github.com/cuongtranba/kanna/commit/a6fdbb0d54809ea21efd7d33c98b26bcc178e293))
* **push:** include diagnostic delivery logging in release ([fb549a9](https://github.com/cuongtranba/kanna/commit/fb549a9c6fb2a9ee91c603a797ddcb7dfe31f5b0))
* **push:** skip push when chat is currently open ([#41](https://github.com/cuongtranba/kanna/issues/41)) ([f6c6bf2](https://github.com/cuongtranba/kanna/commit/f6c6bf23b4ccb658a6ea81c048947bdc3a035050))
* **push:** use /chat singular route in notification payload ([#24](https://github.com/cuongtranba/kanna/issues/24)) ([f7ee018](https://github.com/cuongtranba/kanna/commit/f7ee01838df257cf6c650f8e96c8c3b2feca1d74))
* **push:** use real mailto for VAPID subject ([#18](https://github.com/cuongtranba/kanna/issues/18)) ([df5fd48](https://github.com/cuongtranba/kanna/commit/df5fd48878368cf4f71219a1d03d2cea11f1f057))
* **quick-response:** unblock Haiku title gen in nested CC sessions ([fff7fa4](https://github.com/cuongtranba/kanna/commit/fff7fa4e21aef17263cddd3506b1776e8a6682a2))
* remove PR assets ([#482](https://github.com/cuongtranba/kanna/issues/482)) ([2250d2a](https://github.com/cuongtranba/kanna/commit/2250d2aa82774a4bb4d49099e32c04fbd3699d3b))
* **server:** allow HEAD on /api/projects/:id/{files,uploads}/*/content ([#194](https://github.com/cuongtranba/kanna/issues/194)) ([330f33a](https://github.com/cuongtranba/kanna/commit/330f33a3adfa00e66889f263c1fa992ef95ddd71))
* **server:** dispose fs.watch managers before fallible shutdown awaits ([#146](https://github.com/cuongtranba/kanna/issues/146)) ([9460481](https://github.com/cuongtranba/kanna/commit/9460481145898b469605d4fd687b05dc6f242121))
* **server:** fall back to bundled cloudflared binary ([d539bae](https://github.com/cuongtranba/kanna/commit/d539bae7d87ccb3c7e8490dc1ac03d4b12e7dd07))
* **server:** serve arbitrary local files via /api/local-file ([#66](https://github.com/cuongtranba/kanna/issues/66)) ([dffbf01](https://github.com/cuongtranba/kanna/commit/dffbf0126b0faa49510dcda0a57eb7e7a1683e05))
* **session-panel:** merge Kanna subagents into system_init.agents ([#450](https://github.com/cuongtranba/kanna/issues/450)) ([ba899c8](https://github.com/cuongtranba/kanna/commit/ba899c8788e9eb45ffe5146b3c3413905f8a43bf))
* **settings/subagents:** remove duplicate copy in empty state and list ([#212](https://github.com/cuongtranba/kanna/issues/212)) ([55510cb](https://github.com/cuongtranba/kanna/commit/55510cbc8ef50bf3e62f03e641098d3e0e051450))
* **settings:** forward globalPromptAppend to agent spawn ([#281](https://github.com/cuongtranba/kanna/issues/281)) ([37e9fbd](https://github.com/cuongtranba/kanna/commit/37e9fbdb56766604bf7496f43eca0b7fb9569fba))
* **settings:** repair push notifications UI overflow ([#16](https://github.com/cuongtranba/kanna/issues/16)) ([ac39fcd](https://github.com/cuongtranba/kanna/commit/ac39fcdc27497e81aa8b36c1d9f95eaf6e1401ec))
* **settings:** reset model when switching LLM provider ([#452](https://github.com/cuongtranba/kanna/issues/452)) ([6fab63d](https://github.com/cuongtranba/kanna/commit/6fab63dd4cc1a76f3db6a9696f2ec0f683592999))
* **share:** include kind discriminant in share.* ws responses ([#323](https://github.com/cuongtranba/kanna/issues/323)) ([a115854](https://github.com/cuongtranba/kanna/commit/a1158541b42813fc675543179442230d63710a67))
* **share:** make share page scroll on overflow (mobile-safe) ([#347](https://github.com/cuongtranba/kanna/issues/347)) ([539b8e8](https://github.com/cuongtranba/kanna/commit/539b8e84fc9b83154f18a429bbc2a5f8e266d6c8))
* **share:** popover trigger + share-view rendering ([#325](https://github.com/cuongtranba/kanna/issues/325)) ([fd896ff](https://github.com/cuongtranba/kanna/commit/fd896ffcc574f649c1815b40e635e0bddcc89ec3))
* **share:** style share-view with Tailwind + shared markdown components ([#327](https://github.com/cuongtranba/kanna/issues/327)) ([3305bb3](https://github.com/cuongtranba/kanna/commit/3305bb3291a02676c54b88c49eda65c3aec5d44a))
* **sidebar:** make collapse-all chip a real affordance with semantic icon ([#369](https://github.com/cuongtranba/kanna/issues/369)) ([92cc071](https://github.com/cuongtranba/kanna/commit/92cc07127464e1e68edf5e3cdfa3d4e9a29a0ffa))
* **sidebar:** pin collapse-all toggle above scroll list ([#356](https://github.com/cuongtranba/kanna/issues/356)) ([abdb32b](https://github.com/cuongtranba/kanna/commit/abdb32b2c3195ba0146da0c66e0db6a85208a0d7))
* **stacks:** render stack chats inside expanded stack section ([#71](https://github.com/cuongtranba/kanna/issues/71)) ([d00f6a5](https://github.com/cuongtranba/kanna/commit/d00f6a555a7e51f03e979c3cb235a3014869e93b))
* **stacks:** stack chat create row layout on narrow widths ([#57](https://github.com/cuongtranba/kanna/issues/57)) ([95d83be](https://github.com/cuongtranba/kanna/commit/95d83bebfb6fbe82a464efe7ce80d68c33dd8888))
* **subagent:** cancel rejects pending resolvers even with no main turn ([#94](https://github.com/cuongtranba/kanna/issues/94)) ([9aac71d](https://github.com/cuongtranba/kanna/commit/9aac71dc226a62703568790bafd45974771c0167))
* **subagent:** clear pendingTool on terminal events + use /api/local-file ([#88](https://github.com/cuongtranba/kanna/issues/88)) ([e32db6f](https://github.com/cuongtranba/kanna/commit/e32db6fa264f5b5947bd524a3834fdce1890daa3))
* **subagent:** close 5 P1 concurrency / routing bugs (B1–B5) ([#199](https://github.com/cuongtranba/kanna/issues/199)) ([0775d69](https://github.com/cuongtranba/kanna/commit/0775d6948b63fc9c8629d97b059381fcf53c805b))
* **subagent:** forward user instruction + scan main reply for mentions ([#196](https://github.com/cuongtranba/kanna/issues/196)) ([0745f78](https://github.com/cuongtranba/kanna/commit/0745f78ac0dd19c153056c1cbec6ee9935e83e1b))
* **subagent:** inherit parent chat's OAuth-pool reservation ([#204](https://github.com/cuongtranba/kanna/issues/204)) ([007ece2](https://github.com/cuongtranba/kanna/commit/007ece27d2dcf4dc78ede815fd2bd9c0b2d9b79a))
* **subagent:** resolve delegate_subagent id by id or unambiguous name ([#427](https://github.com/cuongtranba/kanna/issues/427)) ([2d89d39](https://github.com/cuongtranba/kanna/commit/2d89d39d8e561ed3ada3ab7dfd471d9e9dd48663))
* **subagent:** resolver leaks, full restart recovery, harden cap ([#93](https://github.com/cuongtranba/kanna/issues/93)) ([7bb3d92](https://github.com/cuongtranba/kanna/commit/7bb3d923c84e012a2716aa428d624ec70c519c3a))
* **subagents:** centralize model catalog with customModels merge ([#474](https://github.com/cuongtranba/kanna/issues/474)) ([f3a7367](https://github.com/cuongtranba/kanna/commit/f3a73672fb2dc5d7bfae3873d88b06d5d8baef7c))
* **terminals:** stop dev process leaks on project remove, shell exit, SIGHUP, and crash ([#33](https://github.com/cuongtranba/kanna/issues/33)) ([7d872c1](https://github.com/cuongtranba/kanna/commit/7d872c1dbfa967baae5ccae8f390adb23c6753eb))
* **test:** dispose AppSettingsManager FSWatchers via centralized afterEach ([#144](https://github.com/cuongtranba/kanna/issues/144)) ([9b7c0be](https://github.com/cuongtranba/kanna/commit/9b7c0be4717167b1c5208db63c8a2c172fe6f91f))
* **test:** make pushClient tests robust to readonly globalThis.window ([#20](https://github.com/cuongtranba/kanna/issues/20)) ([18451f0](https://github.com/cuongtranba/kanna/commit/18451f08d90296c79192300f4dbcd3c68d692cf7))
* **test:** register happy-dom in preload so Radix portals render deterministically ([#414](https://github.com/cuongtranba/kanna/issues/414)) ([5981875](https://github.com/cuongtranba/kanna/commit/59818753912c2494c0af0437ddde0010f44c824c))
* **tests:** force NODE_ENV=test via bunfig preload to load React dev bundle ([#127](https://github.com/cuongtranba/kanna/issues/127)) ([b38d32f](https://github.com/cuongtranba/kanna/commit/b38d32f036ecd0d502b10311990c2db18276fafc))
* **test:** update dynamic import after terminal-pid-registry rename ([#291](https://github.com/cuongtranba/kanna/issues/291)) ([54270c6](https://github.com/cuongtranba/kanna/commit/54270c63ebab9d1aa550818d3cddc65784d6362a))
* **tool-callback test:** flush background persists before tmpdir cleanup ([#113](https://github.com/cuongtranba/kanna/issues/113)) ([dd0387a](https://github.com/cuongtranba/kanna/commit/dd0387a06b16f2df7bae471aa81a0c9db2b7c951))
* **tool-callback:** dedup duplicate AskUserQuestion prompts on long wait ([46c4dac](https://github.com/cuongtranba/kanna/commit/46c4dacdbccd99ad4a819f1c908ea02cb1dda5ef))
* **tool-callback:** dedup duplicate AskUserQuestion prompts on long wait ([6f7c0cb](https://github.com/cuongtranba/kanna/commit/6f7c0cb245bb1a724a2ae65e7f31ad201167cfd3))
* **tool-callback:** live broadcast + stop cancel-on-rotation + drop ask timeout ([#343](https://github.com/cuongtranba/kanna/issues/343)) ([0af2ff8](https://github.com/cuongtranba/kanna/commit/0af2ff837b4e0a575af57d18d281898a5872205e))
* **tools:** normalize mcp__kanna__ask_user_question text→question field ([#222](https://github.com/cuongtranba/kanna/issues/222)) ([b11741d](https://github.com/cuongtranba/kanna/commit/b11741dbd1ec604adf4f41d8d05a540db04e7747))
* **tools:** peel MCP CallToolResult envelope when hydrating ask_user_question ([#225](https://github.com/cuongtranba/kanna/issues/225)) ([fc106c1](https://github.com/cuongtranba/kanna/commit/fc106c1f0c4ca369b18493dfc4b56ae3bc1fcc0a))
* **transcript:** drop synthetic 'No response requested.' + surface Usage-Policy refusals ([#394](https://github.com/cuongtranba/kanna/issues/394)) ([07df860](https://github.com/cuongtranba/kanna/commit/07df8607af541309e7421a94e391a15fbe18f946))
* **transcript:** keep offer_download/image cards out of collapsed tool groups ([#455](https://github.com/cuongtranba/kanna/issues/455)) ([fc15009](https://github.com/cuongtranba/kanna/commit/fc150099ab5247316f9b4d553062ae70ca283f31))
* **transcript:** stop rendering benign synthetic turn-end markers as API errors ([#374](https://github.com/cuongtranba/kanna/issues/374)) ([6206239](https://github.com/cuongtranba/kanna/commit/62062395f4d12da847b0a9481a70dc465171e728))
* **tunnel:** hide card when dismissing a proposed tunnel ([097cc23](https://github.com/cuongtranba/kanna/commit/097cc2323e6cdea8bf2ec4ebebbd2513141d209b))
* **ui:** align PTY driver banner with floating sidebar chrome ([#239](https://github.com/cuongtranba/kanna/issues/239)) ([855b80d](https://github.com/cuongtranba/kanna/commit/855b80d5221bd0572a1e78ad18ab92c83b62077a))
* **ui:** normalize mcp__kanna__ask_user_question text→question in pending card ([#223](https://github.com/cuongtranba/kanna/issues/223)) ([3610f9b](https://github.com/cuongtranba/kanna/commit/3610f9b2cbf46510d8db0b3910d8a1cd87e07d0b))
* **ui:** surface question header + chosen option description in ask-user-question card ([#329](https://github.com/cuongtranba/kanna/issues/329)) ([fd9acb4](https://github.com/cuongtranba/kanna/commit/fd9acb4d265a2f3c071e7b2e91feb056e8033645))
* **update:** drop pm2 IPC reload to avoid "Reload in progress" error ([0629f04](https://github.com/cuongtranba/kanna/commit/0629f04f7b02615297dac67fb530c64c3843a394))
* **update:** instant overlay + per-button loading for install/rollback/redeploy ([#213](https://github.com/cuongtranba/kanna/issues/213)) ([e2f0801](https://github.com/cuongtranba/kanna/commit/e2f0801810ae12ee704e67d2eb375e8c5f387a24))
* **update:** re-deploy installs current version when latest is stale ([7deece0](https://github.com/cuongtranba/kanna/commit/7deece0e12556ce4f252d3e16acd6a3963a43980))
* **uploads:** raise Bun maxRequestBodySize to upload max ([#45](https://github.com/cuongtranba/kanna/issues/45)) ([68752f4](https://github.com/cuongtranba/kanna/commit/68752f4344c6ecf0dd6d760ef8aa238f4b2bfbf6))
* **useKannaState:** drop optimistic user_prompt when chat.send acks queued ([#133](https://github.com/cuongtranba/kanna/issues/133)) ([554b492](https://github.com/cuongtranba/kanna/commit/554b492bcee57f70a41fcf5f6573052ffc345b4e))
* **wiki:** editorial home page, WCAG AA gray ramp, Starlight cascade ([#252](https://github.com/cuongtranba/kanna/issues/252)) ([ed2acf3](https://github.com/cuongtranba/kanna/commit/ed2acf32b78ffb417178455e49552553251eaa27))
* **workflow-watch:** poll fallback for missed parent-arm FSEvents ([7f69c20](https://github.com/cuongtranba/kanna/commit/7f69c20d0ddeacfc94da12bcfdc907250221b36c))
* **workflow:** getRun returns synthetic running run (drill-in no longer flickers) ([#365](https://github.com/cuongtranba/kanna/issues/365)) ([243f8fd](https://github.com/cuongtranba/kanna/commit/243f8fd55bfe17efeec8389de7f5677f0c27b7ee))
* **workflow:** stop pending_workflow harvest wake re-arming forever ([#381](https://github.com/cuongtranba/kanna/issues/381)) ([5110cbc](https://github.com/cuongtranba/kanna/commit/5110cbc261e50dad1be267ea00ac8be2b883615c))
* **workflow:** surface a live re-run that reused a crashed run's runId ([#370](https://github.com/cuongtranba/kanna/issues/370)) ([bef730e](https://github.com/cuongtranba/kanna/commit/bef730e864bc03e6e029822e76d1e6f2d036c27e))
* **ws-router:** strip timings from chat snapshot dedup signature ([#90](https://github.com/cuongtranba/kanna/issues/90)) ([ee3548a](https://github.com/cuongtranba/kanna/commit/ee3548a9ece5c4785aeaaed5e4d9de465fb00668))


### Performance Improvements

* **diff-sidebar:** virtualize the changes file list ([#510](https://github.com/cuongtranba/kanna/issues/510)) ([8bc882f](https://github.com/cuongtranba/kanna/commit/8bc882f7608c17ad91e64f2f9565d36981150756))
* **transcript:** stabilize markdown props + memoize message components ([#157](https://github.com/cuongtranba/kanna/issues/157)) ([6ed1531](https://github.com/cuongtranba/kanna/commit/6ed153168686afc6d05fc2f858adcdadbec4209f))


### Reverts

* restore chat input + version to 0.57.0 state ([#186](https://github.com/cuongtranba/kanna/issues/186)) ([cb0495a](https://github.com/cuongtranba/kanna/commit/cb0495aaf94d974a1fdb16689ab8edf89c98d5c0))


### Miscellaneous Chores

* release 0.57.3 to publish reverted baseline to npm ([#190](https://github.com/cuongtranba/kanna/issues/190)) ([5dd8b88](https://github.com/cuongtranba/kanna/commit/5dd8b884921079df6115eef74c2f4f2b1a37f3e7))
* release as 1.0.0 ([5f0b5cc](https://github.com/cuongtranba/kanna/commit/5f0b5ccb1a11968b4a6387c1bcc2b7ad1e5ed5db))

## [0.107.0](https://github.com/cuongtranba/kanna/compare/v0.106.0...v0.107.0) (2026-07-10)


### Features

* **composer:** add Tab-expand text snippets ([#511](https://github.com/cuongtranba/kanna/issues/511)) ([d93e1c8](https://github.com/cuongtranba/kanna/commit/d93e1c8ec2dd3de564767b69b751f9c708caa1b6))

## [0.106.0](https://github.com/cuongtranba/kanna/compare/v0.105.0...v0.106.0) (2026-07-10)


### Features

* **orchestration:** durable multi-task orchestration engine (Plan A) ([#507](https://github.com/cuongtranba/kanna/issues/507)) ([05a75f1](https://github.com/cuongtranba/kanna/commit/05a75f10ae8ed35c1b317d29415bfcfa13bcb5c2))


### Bug Fixes

* **auto-continue:** suppress noisy 'continue' bubble on rate-limit recovery ([#506](https://github.com/cuongtranba/kanna/issues/506)) ([16ed674](https://github.com/cuongtranba/kanna/commit/16ed674632f753579214a8bc8af248131ec9d698))


### Performance Improvements

* **diff-sidebar:** virtualize the changes file list ([#510](https://github.com/cuongtranba/kanna/issues/510)) ([8bc882f](https://github.com/cuongtranba/kanna/commit/8bc882f7608c17ad91e64f2f9565d36981150756))

## [0.105.0](https://github.com/cuongtranba/kanna/compare/v0.104.0...v0.105.0) (2026-07-04)

**This is the current version of Kanna after the 2026-07-10 rollback.**

### New

* **Preview files right in the chat.** The assistant can now show a file inline
  in the conversation (via the `preview_file` tool) so you can read it without
  leaving the chat. ([#479](https://github.com/cuongtranba/kanna/issues/479)) ([93056ab](https://github.com/cuongtranba/kanna/commit/93056ab75e41373041868d6a52c9682c51c78dee))

### Fixes

* **Cleaner releases.** Stopped bundling extra PR attachment files into the
  release. ([#482](https://github.com/cuongtranba/kanna/issues/482)) ([2250d2a](https://github.com/cuongtranba/kanna/commit/2250d2aa82774a4bb4d49099e32c04fbd3699d3b))

## [0.104.0](https://github.com/cuongtranba/kanna/compare/v0.103.2...v0.104.0) (2026-07-03)


### Features

* add full-page /workflows view with per-agent transcript drill-in ([#468](https://github.com/cuongtranba/kanna/issues/468)) ([#478](https://github.com/cuongtranba/kanna/issues/478)) ([a13cd75](https://github.com/cuongtranba/kanna/commit/a13cd758b189f28034f90cc1963f971d46d6f8a0))


### Bug Fixes

* **client:** only 404 disables download offer card ([#476](https://github.com/cuongtranba/kanna/issues/476)) ([54fbc13](https://github.com/cuongtranba/kanna/commit/54fbc1394304a86b47492f1ca7e90f6fd5a45071))

## [0.103.2](https://github.com/cuongtranba/kanna/compare/v0.103.1...v0.103.2) (2026-07-01)


### Bug Fixes

* **subagents:** centralize model catalog with customModels merge ([#474](https://github.com/cuongtranba/kanna/issues/474)) ([f3a7367](https://github.com/cuongtranba/kanna/commit/f3a73672fb2dc5d7bfae3873d88b06d5d8baef7c))

## [0.103.1](https://github.com/cuongtranba/kanna/compare/v0.103.0...v0.103.1) (2026-07-01)


### Bug Fixes

* **models:** honor custom model catalog when normalizing selections ([#472](https://github.com/cuongtranba/kanna/issues/472)) ([9fd134b](https://github.com/cuongtranba/kanna/commit/9fd134bb2b219edd12178952f9a3a7ddf6dd98da))

## [0.103.0](https://github.com/cuongtranba/kanna/compare/v0.102.2...v0.103.0) (2026-07-01)


### Features

* configurable model catalog (customModels in settings) ([#469](https://github.com/cuongtranba/kanna/issues/469)) ([4371f06](https://github.com/cuongtranba/kanna/commit/4371f0651f6efbacfcec6f7be960ea65a1b373a6))

## [0.102.2](https://github.com/cuongtranba/kanna/compare/v0.102.1...v0.102.2) (2026-06-30)


### Bug Fixes

* **mcp:** inject fresh oauth bearer when testing authenticated MCP servers ([#465](https://github.com/cuongtranba/kanna/issues/465)) ([b187c39](https://github.com/cuongtranba/kanna/commit/b187c3986422e020c42929a6799fba2b6b3cd697))

## [0.102.1](https://github.com/cuongtranba/kanna/compare/v0.102.0...v0.102.1) (2026-06-30)


### Bug Fixes

* **mcp-oauth:** persist AS metadata so token refresh survives past TTL ([#463](https://github.com/cuongtranba/kanna/issues/463)) ([be82004](https://github.com/cuongtranba/kanna/commit/be8200498ca7ea76712e298067d32b01aa680e9b))

## [0.102.0](https://github.com/cuongtranba/kanna/compare/v0.101.0...v0.102.0) (2026-06-29)


### Features

* OAuth 2.1 client for HTTP/SSE custom MCP servers ([#461](https://github.com/cuongtranba/kanna/issues/461)) ([924ba2e](https://github.com/cuongtranba/kanna/commit/924ba2e902de5010e344d1ef1f18b4d5532d29ad))

## [0.101.0](https://github.com/cuongtranba/kanna/compare/v0.100.0...v0.101.0) (2026-06-26)


### Features

* per-turn token cost across SDK/OpenRouter/Codex + cumulative session totals ([#460](https://github.com/cuongtranba/kanna/issues/460)) ([5e4c9d7](https://github.com/cuongtranba/kanna/commit/5e4c9d709bf3e5d8d356b8c0fa284cff99198958))


### Bug Fixes

* **composer:** paste/drop images upload to the project, not the chat ([#459](https://github.com/cuongtranba/kanna/issues/459)) ([6826647](https://github.com/cuongtranba/kanna/commit/68266473098018f994445da52e9e15f9a41d5d70))
* **local-catalog:** namespace marketplace skills by real plugin name ([#458](https://github.com/cuongtranba/kanna/issues/458)) ([42fa49e](https://github.com/cuongtranba/kanna/commit/42fa49e9802fe7c4d0f1329fd2167d884875b3e4))
* **settings:** reset model when switching LLM provider ([#452](https://github.com/cuongtranba/kanna/issues/452)) ([6fab63d](https://github.com/cuongtranba/kanna/commit/6fab63dd4cc1a76f3db6a9696f2ec0f683592999))

## [0.100.0](https://github.com/cuongtranba/kanna/compare/v0.99.0...v0.100.0) (2026-06-25)


### Features

* **renderer:** linkify text references adjacent to URLs ([#456](https://github.com/cuongtranba/kanna/issues/456)) ([794d662](https://github.com/cuongtranba/kanna/commit/794d662cc31e4892bf28240b5ac3b15770144bc7))


### Bug Fixes

* **agent:** surface SDK background-task completions in the transcript ([#453](https://github.com/cuongtranba/kanna/issues/453)) ([353bd26](https://github.com/cuongtranba/kanna/commit/353bd26a67eb954cf6ca5993954ffd27a0608d95))
* **transcript:** keep offer_download/image cards out of collapsed tool groups ([#455](https://github.com/cuongtranba/kanna/issues/455)) ([fc15009](https://github.com/cuongtranba/kanna/commit/fc150099ab5247316f9b4d553062ae70ca283f31))

## [0.99.0](https://github.com/cuongtranba/kanna/compare/v0.98.0...v0.99.0) (2026-06-24)


### Features

* **lexical:** migrate chat input and messages to Lexical 0.45 ([#446](https://github.com/cuongtranba/kanna/issues/446)) ([a5d3619](https://github.com/cuongtranba/kanna/commit/a5d3619fe2f7d34652ffd54533007b8c1c3c50c4))


### Bug Fixes

* **session-panel:** merge Kanna subagents into system_init.agents ([#450](https://github.com/cuongtranba/kanna/issues/450)) ([ba899c8](https://github.com/cuongtranba/kanna/commit/ba899c8788e9eb45ffe5146b3c3413905f8a43bf))

## [0.98.0](https://github.com/cuongtranba/kanna/compare/v0.97.3...v0.98.0) (2026-06-22)


### Features

* **chat-ui:** show local skills + slash commands in / picker ([#444](https://github.com/cuongtranba/kanna/issues/444)) ([d5e344b](https://github.com/cuongtranba/kanna/commit/d5e344b6e08e6d22748387543b352e12d7e90919))

## [0.97.3](https://github.com/cuongtranba/kanna/compare/v0.97.2...v0.97.3) (2026-06-20)


### Bug Fixes

* **agent:** deliver OpenRouter prompts via the SDK session transport ([#443](https://github.com/cuongtranba/kanna/issues/443)) ([d826774](https://github.com/cuongtranba/kanna/commit/d8267748c7c1acca3161e0f8d86396d518f04653))
* **agent:** fail-close OpenRouter turns whose SDK stream stalls before first entry ([#441](https://github.com/cuongtranba/kanna/issues/441)) ([7a10c59](https://github.com/cuongtranba/kanna/commit/7a10c59d1ec1e9f2eba1cae4809d8e5bc585ede7))

## [0.97.2](https://github.com/cuongtranba/kanna/compare/v0.97.1...v0.97.2) (2026-06-20)


### Bug Fixes

* **chat-ui:** stop crash on aborted-stream result with missing body ([#439](https://github.com/cuongtranba/kanna/issues/439)) ([3c398f3](https://github.com/cuongtranba/kanna/commit/3c398f33e52bd4d883ff75b4c5411d28f7b46bc4))

## [0.97.1](https://github.com/cuongtranba/kanna/compare/v0.97.0...v0.97.1) (2026-06-19)


### Bug Fixes

* **agent:** run the selected OpenRouter model instead of collapsing to default ([#437](https://github.com/cuongtranba/kanna/issues/437)) ([f548d4a](https://github.com/cuongtranba/kanna/commit/f548d4adee96e47996173031b2c84ffe40711337))
* **agent:** surface OpenRouter identity in account_info, not Anthropic source ([#436](https://github.com/cuongtranba/kanna/issues/436)) ([9970b04](https://github.com/cuongtranba/kanna/commit/9970b043baac59f8e86b0e6af6d363e983e8c44a))

## [0.97.0](https://github.com/cuongtranba/kanna/compare/v0.96.0...v0.97.0) (2026-06-18)


### Features

* **provider:** add OpenRouter as third agentic chat provider ([#435](https://github.com/cuongtranba/kanna/issues/435)) ([01b26a8](https://github.com/cuongtranba/kanna/commit/01b26a8c51ae551f4d2219e95d366b74bc068d8e))


### Bug Fixes

* **agent:** drop duplicate rate-limit body on trailing error result ([#434](https://github.com/cuongtranba/kanna/issues/434)) ([0274e27](https://github.com/cuongtranba/kanna/commit/0274e27129d621108dd5d40837024c4087d878d2))
* **chat-ui:** surface subagent pending question at transcript footer ([#432](https://github.com/cuongtranba/kanna/issues/432)) ([ab6d0ac](https://github.com/cuongtranba/kanna/commit/ab6d0ac27a6e5237a73f1c915e3b94647a31222a))

## [0.96.0](https://github.com/cuongtranba/kanna/compare/v0.95.1...v0.96.0) (2026-06-17)


### Features

* **subagent:** per-subagent trigger mode (auto/manual) ([#429](https://github.com/cuongtranba/kanna/issues/429)) ([0a3a405](https://github.com/cuongtranba/kanna/commit/0a3a405c7da813b3666d22304dbbbe60244ea310))

## [0.95.1](https://github.com/cuongtranba/kanna/compare/v0.95.0...v0.95.1) (2026-06-17)


### Bug Fixes

* **subagent:** resolve delegate_subagent id by id or unambiguous name ([#427](https://github.com/cuongtranba/kanna/issues/427)) ([2d89d39](https://github.com/cuongtranba/kanna/commit/2d89d39d8e561ed3ada3ab7dfd471d9e9dd48663))

## [0.95.0](https://github.com/cuongtranba/kanna/compare/v0.94.1...v0.95.0) (2026-06-17)


### Features

* **agent:** label stack projects in the Claude system prompt ([#425](https://github.com/cuongtranba/kanna/issues/425)) ([a43e805](https://github.com/cuongtranba/kanna/commit/a43e80556b5e283835e35c23d0a7a3f2439c8b7f))

## [0.94.1](https://github.com/cuongtranba/kanna/compare/v0.94.0...v0.94.1) (2026-06-16)


### Bug Fixes

* **agent:** mirror PTY OAuth-pool account info in SDK driver ([#422](https://github.com/cuongtranba/kanna/issues/422)) ([ca347be](https://github.com/cuongtranba/kanna/commit/ca347beaf16e279a8a307c4415085d08fba93825))
* **agent:** swallow SDK interrupt tail error on cancel ([#424](https://github.com/cuongtranba/kanna/issues/424)) ([dfc52a6](https://github.com/cuongtranba/kanna/commit/dfc52a6fa18e2136c1640689d72dc50dd0e49c59))

## [0.94.0](https://github.com/cuongtranba/kanna/compare/v0.93.0...v0.94.0) (2026-06-16)


### Features

* **subagent:** add run_in_background delegation mode ([#420](https://github.com/cuongtranba/kanna/issues/420)) ([a10fc89](https://github.com/cuongtranba/kanna/commit/a10fc893847fae90613a20016805b3287acb0ce1))

## [0.93.0](https://github.com/cuongtranba/kanna/compare/v0.92.3...v0.93.0) (2026-06-16)


### Features

* SDK↔PTY driver feature parity (keep-alive subagents, workflow panel) ([#418](https://github.com/cuongtranba/kanna/issues/418)) ([1742464](https://github.com/cuongtranba/kanna/commit/1742464a114611459be90f04dcb5be7e69da84e8))

## [0.92.3](https://github.com/cuongtranba/kanna/compare/v0.92.2...v0.92.3) (2026-06-12)


### Bug Fixes

* **local-projects:** enable vertical scroll when projects overflow viewport ([#416](https://github.com/cuongtranba/kanna/issues/416)) ([bb721b7](https://github.com/cuongtranba/kanna/commit/bb721b7c038b0ec1c302856bc90053fc5d57ef5b))

## [0.92.2](https://github.com/cuongtranba/kanna/compare/v0.92.1...v0.92.2) (2026-06-12)


### Bug Fixes

* **test:** register happy-dom in preload so Radix portals render deterministically ([#414](https://github.com/cuongtranba/kanna/issues/414)) ([5981875](https://github.com/cuongtranba/kanna/commit/59818753912c2494c0af0437ddde0010f44c824c))

## [0.92.1](https://github.com/cuongtranba/kanna/compare/v0.92.0...v0.92.1) (2026-06-11)


### Bug Fixes

* **claude-pty:** detect turn end via stop_reason — CLI ≥2.1.x writes no system rows ([#411](https://github.com/cuongtranba/kanna/issues/411)) ([8889806](https://github.com/cuongtranba/kanna/commit/888980683922b4bd5546d4354db4b4b37b3d74dd))

## [0.92.0](https://github.com/cuongtranba/kanna/compare/v0.91.0...v0.92.0) (2026-06-09)


### Features

* **models:** add Claude Fable 5 to the Claude provider catalog ([#409](https://github.com/cuongtranba/kanna/issues/409)) ([ffd106f](https://github.com/cuongtranba/kanna/commit/ffd106ffc8d1e3da3a27f440b67d31a1c6a63480))


### Bug Fixes

* **chat-ui:** keep subagent message text selectable ([#407](https://github.com/cuongtranba/kanna/issues/407)) ([73f8121](https://github.com/cuongtranba/kanna/commit/73f8121bc26f83bd42a8e90397f5e7961ad519b0))

## [0.91.0](https://github.com/cuongtranba/kanna/compare/v0.90.1...v0.91.0) (2026-06-08)


### Features

* **subagent:** per-subagent folder restriction (workingDir + allowedPaths) ([#404](https://github.com/cuongtranba/kanna/issues/404)) ([f4e5af3](https://github.com/cuongtranba/kanna/commit/f4e5af39ff7f4a40901781c7e83a71f613be1b35))


### Bug Fixes

* **mobile:** left-edge swipe opens sidebar instead of going back ([#406](https://github.com/cuongtranba/kanna/issues/406)) ([cfe4452](https://github.com/cuongtranba/kanna/commit/cfe445222ff79412d041ecebc6e0e9ba25b9fcd6))

## [0.90.1](https://github.com/cuongtranba/kanna/compare/v0.90.0...v0.90.1) (2026-06-08)


### Bug Fixes

* **compact:** finalize PTY proactive /compact turn on compact_boundary ([#402](https://github.com/cuongtranba/kanna/issues/402)) ([653c8f5](https://github.com/cuongtranba/kanna/commit/653c8f55cc7934938b7a84d880c8d64efc9f1c64))

## [0.90.0](https://github.com/cuongtranba/kanna/compare/v0.89.0...v0.90.0) (2026-06-07)


### Features

* **transcript:** expandable nested child transcript for native Agent calls ([174d011](https://github.com/cuongtranba/kanna/commit/174d011083f76b04dd29fc1fcf0bc30c32fe0333))
* **transcript:** expandable nested child transcript for native Agent calls ([7a504f0](https://github.com/cuongtranba/kanna/commit/7a504f0a6862354c06cc6b8d833bf6143b97df59))
* **transcript:** summary card for native Agent subagent tool calls ([69a44a2](https://github.com/cuongtranba/kanna/commit/69a44a25cc35257390c6ffe180b848cd3eb1158b))
* **transcript:** summary card for native Agent subagent tool calls ([dff35c0](https://github.com/cuongtranba/kanna/commit/dff35c0277687e2bd27cef2ac15956c36da72a66))


### Bug Fixes

* **pty:** gate follow-up prompt on TUI-ready to stop silent hang ([#401](https://github.com/cuongtranba/kanna/issues/401)) ([50bcf85](https://github.com/cuongtranba/kanna/commit/50bcf85ec965ee42931fdc39604f6e18f058c8fb))
* **tool-callback:** dedup duplicate AskUserQuestion prompts on long wait ([46c4dac](https://github.com/cuongtranba/kanna/commit/46c4dacdbccd99ad4a819f1c908ea02cb1dda5ef))
* **tool-callback:** dedup duplicate AskUserQuestion prompts on long wait ([6f7c0cb](https://github.com/cuongtranba/kanna/commit/6f7c0cb245bb1a724a2ae65e7f31ad201167cfd3))

## [0.89.0](https://github.com/cuongtranba/kanna/compare/v0.88.1...v0.89.0) (2026-06-07)


### Features

* **transcript:** surface Claude thinking blocks as assistant_thinking ([61b9f16](https://github.com/cuongtranba/kanna/commit/61b9f1613db287353ce4e94129c0bd4781668bb1))
* **transcript:** surface Claude thinking blocks as assistant_thinking ([43860b9](https://github.com/cuongtranba/kanna/commit/43860b93ec118cd0f1b9576cfac7a7cc73861812))


### Bug Fixes

* **transcript:** drop synthetic 'No response requested.' + surface Usage-Policy refusals ([#394](https://github.com/cuongtranba/kanna/issues/394)) ([07df860](https://github.com/cuongtranba/kanna/commit/07df8607af541309e7421a94e391a15fbe18f946))
* **workflow-watch:** poll fallback for missed parent-arm FSEvents ([7f69c20](https://github.com/cuongtranba/kanna/commit/7f69c20d0ddeacfc94da12bcfdc907250221b36c))

## [0.88.1](https://github.com/cuongtranba/kanna/compare/v0.88.0...v0.88.1) (2026-06-07)


### Bug Fixes

* **claude-pty:** follow transcript with pure tail-poll, drop fs.watch ([#392](https://github.com/cuongtranba/kanna/issues/392)) ([1b6f3f2](https://github.com/cuongtranba/kanna/commit/1b6f3f2cd2b62e1a219fe6525a3ac69494eee03e))

## [0.88.0](https://github.com/cuongtranba/kanna/compare/v0.87.0...v0.88.0) (2026-06-06)


### Features

* **chat-ui:** show home-relative cwd + branch in navbar label ([#388](https://github.com/cuongtranba/kanna/issues/388)) ([74d080a](https://github.com/cuongtranba/kanna/commit/74d080a04325e488ec24633d456e6d6761c35a06))
* **pty:** surface live Claude TUI spinner status in chat header ([#389](https://github.com/cuongtranba/kanna/issues/389)) ([ac3b107](https://github.com/cuongtranba/kanna/commit/ac3b1079a3e593a8d215e03c680878b5191f3c34))

## [0.87.0](https://github.com/cuongtranba/kanna/compare/v0.86.0...v0.87.0) (2026-06-06)


### Features

* **pty:** surface loaded CLAUDE.md / rule files in transcript ([#386](https://github.com/cuongtranba/kanna/issues/386)) ([5d4cc52](https://github.com/cuongtranba/kanna/commit/5d4cc527bb19d63aec02ff076614c9eb51a88887))


### Bug Fixes

* **event-store:** coalesce context_window_updated in live window ([#387](https://github.com/cuongtranba/kanna/issues/387)) ([3f49d69](https://github.com/cuongtranba/kanna/commit/3f49d695e3dd7436b1fe858db0e13d5838c6c495))
* import Claude session titles ([#383](https://github.com/cuongtranba/kanna/issues/383)) ([b7e69c1](https://github.com/cuongtranba/kanna/commit/b7e69c18a5f6b91acc1d4ae0869105a5012a9abf))

## [0.86.0](https://github.com/cuongtranba/kanna/compare/v0.85.2...v0.86.0) (2026-06-05)


### Features

* **messages:** always render file card for local file links ([#377](https://github.com/cuongtranba/kanna/issues/377)) ([e864cc6](https://github.com/cuongtranba/kanna/commit/e864cc66726c00a9bb9b5892e9aeedd026268a54))


### Bug Fixes

* **chat-ui:** make composer toolbar tappable on mobile ([#378](https://github.com/cuongtranba/kanna/issues/378)) ([73f1fd4](https://github.com/cuongtranba/kanna/commit/73f1fd40e655086c42cdb20bbf1d205c41003eb1))

## [0.85.2](https://github.com/cuongtranba/kanna/compare/v0.85.1...v0.85.2) (2026-06-04)


### Bug Fixes

* **pty:** keep session warm while a background Bash task is pending ([#379](https://github.com/cuongtranba/kanna/issues/379)) ([3652234](https://github.com/cuongtranba/kanna/commit/36522341ce9b6d8849f7f9e12b8696fa72f69055))
* **workflow:** stop pending_workflow harvest wake re-arming forever ([#381](https://github.com/cuongtranba/kanna/issues/381)) ([5110cbc](https://github.com/cuongtranba/kanna/commit/5110cbc261e50dad1be267ea00ac8be2b883615c))

## [0.85.1](https://github.com/cuongtranba/kanna/compare/v0.85.0...v0.85.1) (2026-06-04)


### Bug Fixes

* **pty:** stop re-spawn from leaking an invisible PTY child ([#375](https://github.com/cuongtranba/kanna/issues/375)) ([a6fdbb0](https://github.com/cuongtranba/kanna/commit/a6fdbb0d54809ea21efd7d33c98b26bcc178e293))

## [0.85.0](https://github.com/cuongtranba/kanna/compare/v0.84.1...v0.85.0) (2026-06-04)


### Features

* **workflow:** richer per-agent journal detail in drill-in ([#372](https://github.com/cuongtranba/kanna/issues/372)) ([8d27627](https://github.com/cuongtranba/kanna/commit/8d27627e64ef02839accc8cb5781ced6a70e20c3))


### Bug Fixes

* **transcript:** stop rendering benign synthetic turn-end markers as API errors ([#374](https://github.com/cuongtranba/kanna/issues/374)) ([6206239](https://github.com/cuongtranba/kanna/commit/62062395f4d12da847b0a9481a70dc465171e728))

## [0.84.1](https://github.com/cuongtranba/kanna/compare/v0.84.0...v0.84.1) (2026-06-04)


### Bug Fixes

* **workflow:** surface a live re-run that reused a crashed run's runId ([#370](https://github.com/cuongtranba/kanna/issues/370)) ([bef730e](https://github.com/cuongtranba/kanna/commit/bef730e864bc03e6e029822e76d1e6f2d036c27e))

## [0.84.0](https://github.com/cuongtranba/kanna/compare/v0.83.1...v0.84.0) (2026-06-04)


### Features

* **workflow:** live per-agent detail for running runs (journal.jsonl) ([#367](https://github.com/cuongtranba/kanna/issues/367)) ([5ac6975](https://github.com/cuongtranba/kanna/commit/5ac6975bb347287e86a078658bc55357b218b0e7))


### Bug Fixes

* **sidebar:** make collapse-all chip a real affordance with semantic icon ([#369](https://github.com/cuongtranba/kanna/issues/369)) ([92cc071](https://github.com/cuongtranba/kanna/commit/92cc07127464e1e68edf5e3cdfa3d4e9a29a0ffa))

## [0.83.1](https://github.com/cuongtranba/kanna/compare/v0.83.0...v0.83.1) (2026-06-03)


### Bug Fixes

* **workflow:** getRun returns synthetic running run (drill-in no longer flickers) ([#365](https://github.com/cuongtranba/kanna/issues/365)) ([243f8fd](https://github.com/cuongtranba/kanna/commit/243f8fd55bfe17efeec8389de7f5677f0c27b7ee))

## [0.83.0](https://github.com/cuongtranba/kanna/compare/v0.82.2...v0.83.0) (2026-06-03)


### Features

* **workflow:** show in-flight runs as running in the status panel ([#363](https://github.com/cuongtranba/kanna/issues/363)) ([be3933d](https://github.com/cuongtranba/kanna/commit/be3933d879fa8a67cc7f660e3f1402d5d29a27f8))

## [0.82.2](https://github.com/cuongtranba/kanna/compare/v0.82.1...v0.82.2) (2026-06-03)


### Bug Fixes

* **agent:** real workflow liveness via live run dir (corrects [#359](https://github.com/cuongtranba/kanna/issues/359) no-op) ([#361](https://github.com/cuongtranba/kanna/issues/361)) ([9707062](https://github.com/cuongtranba/kanna/commit/970706234ce75915d16e8f6f992449535391ae07))

## [0.82.1](https://github.com/cuongtranba/kanna/compare/v0.82.0...v0.82.1) (2026-06-03)


### Bug Fixes

* **agent:** keep PTY session alive while a background workflow is running ([#359](https://github.com/cuongtranba/kanna/issues/359)) ([8e7af80](https://github.com/cuongtranba/kanna/commit/8e7af80ee3b1fff0249bd7f4226d659e7ccaa281))

## [0.82.0](https://github.com/cuongtranba/kanna/compare/v0.81.3...v0.82.0) (2026-06-03)


### Features

* Kanna-owned agent self-scheduled wake (ScheduleWakeup + pending-workflow harvest) ([#357](https://github.com/cuongtranba/kanna/issues/357)) ([51fd6fa](https://github.com/cuongtranba/kanna/commit/51fd6fafcf9bdf0c66e5fa823545e3d715c5d60d))
* workflow status panel (PTY disk-watch) ([#358](https://github.com/cuongtranba/kanna/issues/358)) ([1ab36a2](https://github.com/cuongtranba/kanna/commit/1ab36a2c3fcde805c8369baf882d3b7cc3611038))


### Bug Fixes

* **chat-ui:** prevent composer toolbar / token readout overlap ([#354](https://github.com/cuongtranba/kanna/issues/354)) ([1e429b6](https://github.com/cuongtranba/kanna/commit/1e429b69ce122418dc364337fcb9c48dc00f7a7e))
* **sidebar:** pin collapse-all toggle above scroll list ([#356](https://github.com/cuongtranba/kanna/issues/356)) ([abdb32b](https://github.com/cuongtranba/kanna/commit/abdb32b2c3195ba0146da0c66e0db6a85208a0d7))

## [0.81.3](https://github.com/cuongtranba/kanna/compare/v0.81.2...v0.81.3) (2026-06-03)


### Bug Fixes

* **chat-ui:** align session token readout with flat toolbar ([#349](https://github.com/cuongtranba/kanna/issues/349)) ([53a8e98](https://github.com/cuongtranba/kanna/commit/53a8e986207b2c30d74373634de4a3a4d0767174))
* **mcp:** forward customMcpServers through agent settings view ([#353](https://github.com/cuongtranba/kanna/issues/353)) ([7efa965](https://github.com/cuongtranba/kanna/commit/7efa965b8f889cad7537a4aa51c66f751dbf1292))
* **mcp:** keep loopback MCP transport alive across idle gaps ([#351](https://github.com/cuongtranba/kanna/issues/351)) ([22f8bec](https://github.com/cuongtranba/kanna/commit/22f8bec92e6dafdbaeeaaa58ff7f200d3f95900c))
* **pty:** cannot fork PTY-created conversations (session id collision) ([#352](https://github.com/cuongtranba/kanna/issues/352)) ([4b3852e](https://github.com/cuongtranba/kanna/commit/4b3852e22b7f10074ab6998ad4d981748e9020e9))

## [0.81.2](https://github.com/cuongtranba/kanna/compare/v0.81.1...v0.81.2) (2026-06-02)


### Bug Fixes

* **share:** make share page scroll on overflow (mobile-safe) ([#347](https://github.com/cuongtranba/kanna/issues/347)) ([539b8e8](https://github.com/cuongtranba/kanna/commit/539b8e84fc9b83154f18a429bbc2a5f8e266d6c8))

## [0.81.1](https://github.com/cuongtranba/kanna/compare/v0.81.0...v0.81.1) (2026-06-02)


### Bug Fixes

* **chat-ui:** keep session token pill visible on mobile ([#345](https://github.com/cuongtranba/kanna/issues/345)) ([3f5b30e](https://github.com/cuongtranba/kanna/commit/3f5b30e906096c5311088c70bf0e661e92def738))
* **pty:** read assistant usage from nested message.usage ([#344](https://github.com/cuongtranba/kanna/issues/344)) ([c387112](https://github.com/cuongtranba/kanna/commit/c387112ec7b715daebf9f34245b2dc584ba08a9c))

## [0.81.0](https://github.com/cuongtranba/kanna/compare/v0.80.0...v0.81.0) (2026-06-01)


### Features

* **chat-ui:** show session token total pill in composer ([#341](https://github.com/cuongtranba/kanna/issues/341)) ([23872d9](https://github.com/cuongtranba/kanna/commit/23872d99ee48539340f51ada184b8cd679690997))


### Bug Fixes

* **tool-callback:** live broadcast + stop cancel-on-rotation + drop ask timeout ([#343](https://github.com/cuongtranba/kanna/issues/343)) ([0af2ff8](https://github.com/cuongtranba/kanna/commit/0af2ff837b4e0a575af57d18d281898a5872205e))

## [0.80.0](https://github.com/cuongtranba/kanna/compare/v0.79.0...v0.80.0) (2026-05-31)


### Features

* **transcript:** anchor subagent runs under their delegate_subagent call ([#339](https://github.com/cuongtranba/kanna/issues/339)) ([8e5e445](https://github.com/cuongtranba/kanna/commit/8e5e4451c31f7bf625e2c4200791c03d2002ea66))

## [0.79.0](https://github.com/cuongtranba/kanna/compare/v0.78.0...v0.79.0) (2026-05-30)


### Features

* **subagent:** keep-alive multi-turn PTY sessions ([#338](https://github.com/cuongtranba/kanna/issues/338)) ([deb412b](https://github.com/cuongtranba/kanna/commit/deb412b2c321899375e235a1c4e6adff90235ac2))


### Bug Fixes

* **pty:** deliver subagent prompt via MCP channel push (fail-fast) ([#333](https://github.com/cuongtranba/kanna/issues/333)) ([c93afc3](https://github.com/cuongtranba/kanna/commit/c93afc35a14d710b7bd2c8814e03323901e6c879))

## [0.78.0](https://github.com/cuongtranba/kanna/compare/v0.77.3...v0.78.0) (2026-05-29)


### Features

* **models:** add claude-opus-4-8 to provider catalog ([#335](https://github.com/cuongtranba/kanna/issues/335)) ([8d36fdb](https://github.com/cuongtranba/kanna/commit/8d36fdb392561bfcd91534a168aaa0bd4e16cd34))

## [0.77.3](https://github.com/cuongtranba/kanna/compare/v0.77.2...v0.77.3) (2026-05-28)


### Bug Fixes

* **file-preview:** bound scroll region inside dialog for long content ([#330](https://github.com/cuongtranba/kanna/issues/330)) ([5d12c76](https://github.com/cuongtranba/kanna/commit/5d12c76d83d0c19384ec8bacafda6ffe8099a36e))
* **pty:** ignore sidechain + background auto-wake lines in transcript parser ([#332](https://github.com/cuongtranba/kanna/issues/332)) ([216392b](https://github.com/cuongtranba/kanna/commit/216392b5ae8175682ed8ae11a083d4fb4cf51a75))
* **share:** style share-view with Tailwind + shared markdown components ([#327](https://github.com/cuongtranba/kanna/issues/327)) ([3305bb3](https://github.com/cuongtranba/kanna/commit/3305bb3291a02676c54b88c49eda65c3aec5d44a))
* **ui:** surface question header + chosen option description in ask-user-question card ([#329](https://github.com/cuongtranba/kanna/issues/329)) ([fd9acb4](https://github.com/cuongtranba/kanna/commit/fd9acb4d265a2f3c071e7b2e91feb056e8033645))

## [0.77.2](https://github.com/cuongtranba/kanna/compare/v0.77.1...v0.77.2) (2026-05-25)


### Bug Fixes

* **share:** popover trigger + share-view rendering ([#325](https://github.com/cuongtranba/kanna/issues/325)) ([fd896ff](https://github.com/cuongtranba/kanna/commit/fd896ffcc574f649c1815b40e635e0bddcc89ec3))

## [0.77.1](https://github.com/cuongtranba/kanna/compare/v0.77.0...v0.77.1) (2026-05-25)


### Bug Fixes

* **share:** include kind discriminant in share.* ws responses ([#323](https://github.com/cuongtranba/kanna/issues/323)) ([a115854](https://github.com/cuongtranba/kanna/commit/a1158541b42813fc675543179442230d63710a67))

## [0.77.0](https://github.com/cuongtranba/kanna/compare/v0.76.0...v0.77.0) (2026-05-25)


### Features

* **share:** derive share URL from request origin, drop tunnel gate ([#321](https://github.com/cuongtranba/kanna/issues/321)) ([24599e9](https://github.com/cuongtranba/kanna/commit/24599e9b12118c623c6730ba65244f5017ea18cd))

## [0.76.0](https://github.com/cuongtranba/kanna/compare/v0.75.0...v0.76.0) (2026-05-24)


### Features

* **share:** read-only public session share ([#318](https://github.com/cuongtranba/kanna/issues/318)) ([c7a7245](https://github.com/cuongtranba/kanna/commit/c7a7245fcd21cc869c352c8a9a7d88b5a8749784))

## [0.75.0](https://github.com/cuongtranba/kanna/compare/v0.74.0...v0.75.0) (2026-05-24)


### Features

* **pty:** realtime memory tracking in live status panel ([#316](https://github.com/cuongtranba/kanna/issues/316)) ([8148302](https://github.com/cuongtranba/kanna/commit/814830259868c93183418de32af5ed9b031c2b2d))

## [0.74.0](https://github.com/cuongtranba/kanna/compare/v0.73.1...v0.74.0) (2026-05-23)


### Features

* **pty:** hide exited instances from status panel + TTL prune ([#313](https://github.com/cuongtranba/kanna/issues/313)) ([2efb78e](https://github.com/cuongtranba/kanna/commit/2efb78e54012b6ecd055a1f2570b704024dfaab2))
* remove background tasks panel and related code ([#315](https://github.com/cuongtranba/kanna/issues/315)) ([a59079c](https://github.com/cuongtranba/kanna/commit/a59079c937c72e1e39c8d16b5b11dda0032cd5dd))

## [0.73.1](https://github.com/cuongtranba/kanna/compare/v0.73.0...v0.73.1) (2026-05-23)


### Bug Fixes

* **pty:** bound transcript poll + quiet-period TUI ready gate ([#311](https://github.com/cuongtranba/kanna/issues/311)) ([e4b3bed](https://github.com/cuongtranba/kanna/commit/e4b3bed6ccafb8ecdacdac4bbd852b852b3caf0e))

## [0.73.0](https://github.com/cuongtranba/kanna/compare/v0.72.0...v0.73.0) (2026-05-23)


### Features

* **pty:** live status panel + cancel/kill actions ([#309](https://github.com/cuongtranba/kanna/issues/309)) ([e077d7a](https://github.com/cuongtranba/kanna/commit/e077d7a86639a8f9d60183f3ac26421757e465ec))

## [0.72.0](https://github.com/cuongtranba/kanna/compare/v0.71.0...v0.72.0) (2026-05-23)


### Features

* **mobile:** swipe to open/close sidebar ([#306](https://github.com/cuongtranba/kanna/issues/306)) ([3000d58](https://github.com/cuongtranba/kanna/commit/3000d589f4aadb9071f868be4af4abd65cd76f83))

## [0.71.0](https://github.com/cuongtranba/kanna/compare/v0.70.0...v0.71.0) (2026-05-23)


### Features

* custom MCP servers in settings (SDK + PTY) ([#282](https://github.com/cuongtranba/kanna/issues/282)) ([996b732](https://github.com/cuongtranba/kanna/commit/996b732d6fffdaf42e07afe7ee513d7995813300))
* **lint:** ban side-effect imports in src/shared and src/client ([#283](https://github.com/cuongtranba/kanna/issues/283)) ([c5d6934](https://github.com/cuongtranba/kanna/commit/c5d69342fe6e96dec05a829c93a424743792ad48))
* **lint:** catch DB construction, process.exit, process.env in pure layers ([#286](https://github.com/cuongtranba/kanna/issues/286)) ([8977d83](https://github.com/cuongtranba/kanna/commit/8977d83caa1139394b933d2e6b726ec0ad257905))
* **lint:** ratchet side-effect call sites in src/server (warn + lower-only baseline) ([#287](https://github.com/cuongtranba/kanna/issues/287)) ([9ec4c7e](https://github.com/cuongtranba/kanna/commit/9ec4c7e528f200b69336bb21721d7067ca8fbe44))


### Bug Fixes

* **file-preview:** restore scroll inside @-triggered file sheet ([#305](https://github.com/cuongtranba/kanna/issues/305)) ([c388e5a](https://github.com/cuongtranba/kanna/commit/c388e5a06976f71d2b6579a5eebf8529f5f00f64))
* **oauth-pool:** keep "In use" badge on single line ([#278](https://github.com/cuongtranba/kanna/issues/278)) ([4aa2aa8](https://github.com/cuongtranba/kanna/commit/4aa2aa8d2a288ba588c665fa277989ac129ffcda))
* point the dynamic import at `./terminal-pid-registry.adapter`. ([54270c6](https://github.com/cuongtranba/kanna/commit/54270c63ebab9d1aa550818d3cddc65784d6362a))
* **settings:** forward globalPromptAppend to agent spawn ([#281](https://github.com/cuongtranba/kanna/issues/281)) ([37e9fbd](https://github.com/cuongtranba/kanna/commit/37e9fbdb56766604bf7496f43eca0b7fb9569fba))
* **test:** update dynamic import after terminal-pid-registry rename ([#291](https://github.com/cuongtranba/kanna/issues/291)) ([54270c6](https://github.com/cuongtranba/kanna/commit/54270c63ebab9d1aa550818d3cddc65784d6362a))

## [0.70.0](https://github.com/cuongtranba/kanna/compare/v0.69.0...v0.70.0) (2026-05-22)


### Features

* **transcript:** syntax-highlight fenced code blocks in chat messages ([#276](https://github.com/cuongtranba/kanna/issues/276)) ([f966b56](https://github.com/cuongtranba/kanna/commit/f966b560dc4a5081d3c54fcd7019a6476c1a523c))

## [0.69.0](https://github.com/cuongtranba/kanna/compare/v0.68.1...v0.69.0) (2026-05-22)


### Features

* **oauth-pool:** per-token concurrency cap (share OAuth across chats) ([#275](https://github.com/cuongtranba/kanna/issues/275)) ([9fdbfdd](https://github.com/cuongtranba/kanna/commit/9fdbfdd142130aa032c4a0b842420e3cbc9772af))
* **transcript:** render Claude CLI synthetic API errors as dedicated entry kind ([#273](https://github.com/cuongtranba/kanna/issues/273)) ([b2b1585](https://github.com/cuongtranba/kanna/commit/b2b158517f03c0be2f0993c2070db90745442e49))

## [0.68.1](https://github.com/cuongtranba/kanna/compare/v0.68.0...v0.68.1) (2026-05-21)


### Bug Fixes

* **claude-pty:** PID registry JSONL discovery + cross-talk hardening ([#271](https://github.com/cuongtranba/kanna/issues/271)) ([9b5bbf8](https://github.com/cuongtranba/kanna/commit/9b5bbf87ff672be45ebd533c4119f5bc787c3f50))
* **cli-supervisor:** skip self-update after UI-triggered restart so rollback sticks ([#269](https://github.com/cuongtranba/kanna/issues/269)) ([91d1415](https://github.com/cuongtranba/kanna/commit/91d141510917add042c13a9995b9cd17674ff57c))

## [0.68.0](https://github.com/cuongtranba/kanna/compare/v0.67.0...v0.68.0) (2026-05-21)


### ⚠ BREAKING CHANGES

* **claude-pty:** Shannon-style TUI transport — drop --print, tail transcript JSONL ([#261](https://github.com/cuongtranba/kanna/issues/261))

### Features

* **claude-pty:** on-disk pid registry to reap crash orphans on next boot ([#267](https://github.com/cuongtranba/kanna/issues/267)) ([1817cde](https://github.com/cuongtranba/kanna/commit/1817cde883b2a5ad992d359a22be682ba134850c))
* **claude-pty:** plan-mode exit via Shift+Tab (F1) + getSupportedCommands live list (F2) ([#262](https://github.com/cuongtranba/kanna/issues/262)) ([5d941a5](https://github.com/cuongtranba/kanna/commit/5d941a574f8686701ad87554ece7bbe9167ada1b))
* **claude-pty:** Shannon-style TUI transport — drop --print, tail transcript JSONL ([#261](https://github.com/cuongtranba/kanna/issues/261)) ([273386c](https://github.com/cuongtranba/kanna/commit/273386cdb8d63803bc863f0ebfcf26b208e84ed9))
* **messages:** mask OAuth key as primary AccountInfo identifier ([#257](https://github.com/cuongtranba/kanna/issues/257)) ([d91f880](https://github.com/cuongtranba/kanna/commit/d91f880747ccad444cbc04c8bf970f412d773a40))
* **notice-banner:** extract reusable shell notice primitive ([#256](https://github.com/cuongtranba/kanna/issues/256)) ([1d1539e](https://github.com/cuongtranba/kanna/commit/1d1539e300a094b98b7e71a805759ae35f37d216))
* **settings:** add global prompt append for Claude + Codex turns ([#260](https://github.com/cuongtranba/kanna/issues/260)) ([f700d08](https://github.com/cuongtranba/kanna/commit/f700d085cd1d60249d582411a449ed25e14288f5))


### Bug Fixes

* **claude-pty, subagent:** adaptive paste-commit wait + clear stale cancel on new turn ([#265](https://github.com/cuongtranba/kanna/issues/265)) ([0782da4](https://github.com/cuongtranba/kanna/commit/0782da4bac0a30b03f2e4b1d7565c8d71204a3bd))
* **claude-pty:** fail-close hung turns on stream-end + add lifecycle trace logs ([#268](https://github.com/cuongtranba/kanna/issues/268)) ([b321973](https://github.com/cuongtranba/kanna/commit/b3219739b0c81afa864c4f006fc6b4e5dda94889))
* **claude-pty:** multi-line paste submit + mtime-floor JSONL discovery ([#264](https://github.com/cuongtranba/kanna/issues/264)) ([d9d9052](https://github.com/cuongtranba/kanna/commit/d9d905207929351df42c33d512f586337895a952))
* **claude-pty:** plug PTY resource leaks + harden graceful shutdown ([#266](https://github.com/cuongtranba/kanna/issues/266)) ([2dd5a16](https://github.com/cuongtranba/kanna/commit/2dd5a1625157896a4fb60ec67049b3a59969aded))
* **claude-pty:** TUI prompt submission, turn-end marker, deterministic JSONL path ([#263](https://github.com/cuongtranba/kanna/issues/263)) ([57aa777](https://github.com/cuongtranba/kanna/commit/57aa77703f31ae9940f3c655e4d7bee7d1c76460))

## [0.67.0](https://github.com/cuongtranba/kanna/compare/v0.66.1...v0.67.0) (2026-05-20)


### Features

* **messages:** surface OAuth key in chat AccountInfoMessage ([#254](https://github.com/cuongtranba/kanna/issues/254)) ([e24ec3e](https://github.com/cuongtranba/kanna/commit/e24ec3e6c2ad96bfd65d12d420b25e26f30042d8))

## [0.66.1](https://github.com/cuongtranba/kanna/compare/v0.66.0...v0.66.1) (2026-05-20)


### Bug Fixes

* **wiki:** editorial home page, WCAG AA gray ramp, Starlight cascade ([#252](https://github.com/cuongtranba/kanna/issues/252)) ([ed2acf3](https://github.com/cuongtranba/kanna/commit/ed2acf32b78ffb417178455e49552553251eaa27))

## [0.66.0](https://github.com/cuongtranba/kanna/compare/v0.65.1...v0.66.0) (2026-05-20)


### Features

* **client:** render &lt;thinking&gt; blocks as collapsible disclosure ([#250](https://github.com/cuongtranba/kanna/issues/250)) ([f91722d](https://github.com/cuongtranba/kanna/commit/f91722d64e640b74f800a6f5f52a5ec5be36926d))
* **wiki:** Kanna documentation site at kanna-wiki.lowbit.link ([#249](https://github.com/cuongtranba/kanna/issues/249)) ([01a86a2](https://github.com/cuongtranba/kanna/commit/01a86a24c33e2af66ada7443373693180a06d040))

## [0.65.1](https://github.com/cuongtranba/kanna/compare/v0.65.0...v0.65.1) (2026-05-19)


### Bug Fixes

* **client:** include subagentRuns in chat-snapshot dedup compare ([#245](https://github.com/cuongtranba/kanna/issues/245)) ([76d7b45](https://github.com/cuongtranba/kanna/commit/76d7b4586d5705234983339996d9f77f52b2e463))
* **oauth-pool:** persist refusal as transcript result entry ([#248](https://github.com/cuongtranba/kanna/issues/248)) ([adbf02d](https://github.com/cuongtranba/kanna/commit/adbf02d8a5f5f5d4ed7c7338117050c0fcf2aad2))

## [0.65.0](https://github.com/cuongtranba/kanna/compare/v0.64.0...v0.65.0) (2026-05-19)


### Features

* **messages:** render mermaid diagrams in transcript markdown ([#242](https://github.com/cuongtranba/kanna/issues/242)) ([c606355](https://github.com/cuongtranba/kanna/commit/c606355c6330175f6ccf170afdc228a90aeea943))


### Bug Fixes

* **event-store:** decouple subagent live progress from global writeChain ([#244](https://github.com/cuongtranba/kanna/issues/244)) ([21ea6e9](https://github.com/cuongtranba/kanna/commit/21ea6e9aefe497fcd66984bbbdbdf1346145faae))

## [0.64.0](https://github.com/cuongtranba/kanna/compare/v0.63.0...v0.64.0) (2026-05-19)


### Features

* **oauth-pool:** name contested chat in token-unavailable refusal ([#235](https://github.com/cuongtranba/kanna/issues/235)) ([eef731b](https://github.com/cuongtranba/kanna/commit/eef731bccd2301aad12bcc6dfa8a32f113a723a8))
* **subagent:** live UI broadcast + pending tool loading state ([#237](https://github.com/cuongtranba/kanna/issues/237)) ([65969ed](https://github.com/cuongtranba/kanna/commit/65969eda3382ae480d1b8e2bf968fdeb26c0d2e5))


### Bug Fixes

* **ui:** align PTY driver banner with floating sidebar chrome ([#239](https://github.com/cuongtranba/kanna/issues/239)) ([855b80d](https://github.com/cuongtranba/kanna/commit/855b80d5221bd0572a1e78ad18ab92c83b62077a))

## [0.63.0](https://github.com/cuongtranba/kanna/compare/v0.62.0...v0.63.0) (2026-05-19)


### Features

* **subagent:** reactive activity label from latest entries ([#231](https://github.com/cuongtranba/kanna/issues/231)) ([08a41a5](https://github.com/cuongtranba/kanna/commit/08a41a58e23642a55b34b3786a1339219a6fe3f8))
* **subagent:** rich activity labels + MCP progress notifications ([#234](https://github.com/cuongtranba/kanna/issues/234)) ([493ef87](https://github.com/cuongtranba/kanna/commit/493ef87e809d09594c210e2f2f52475bef510f82))

## [0.62.0](https://github.com/cuongtranba/kanna/compare/v0.61.5...v0.62.0) (2026-05-19)


### Features

* **ui:** unify AskUserQuestion slide UI across native + pending paths ([#229](https://github.com/cuongtranba/kanna/issues/229)) ([a565506](https://github.com/cuongtranba/kanna/commit/a5655068e415ead2389da36b40c1759f8b0635db))


### Bug Fixes

* **oauth-pool:** stop turn-end release from leaking the rotation pin; OAuth-only PTY auth ([#227](https://github.com/cuongtranba/kanna/issues/227)) ([024e09b](https://github.com/cuongtranba/kanna/commit/024e09be2862fe5c2f7a8ccff1b4a76237626340))

## [0.61.5](https://github.com/cuongtranba/kanna/compare/v0.61.4...v0.61.5) (2026-05-19)


### Bug Fixes

* **tools:** peel MCP CallToolResult envelope when hydrating ask_user_question ([#225](https://github.com/cuongtranba/kanna/issues/225)) ([fc106c1](https://github.com/cuongtranba/kanna/commit/fc106c1f0c4ca369b18493dfc4b56ae3bc1fcc0a))

## [0.61.4](https://github.com/cuongtranba/kanna/compare/v0.61.3...v0.61.4) (2026-05-18)


### Bug Fixes

* **ui:** normalize mcp__kanna__ask_user_question text→question in pending card ([#223](https://github.com/cuongtranba/kanna/issues/223)) ([3610f9b](https://github.com/cuongtranba/kanna/commit/3610f9b2cbf46510d8db0b3910d8a1cd87e07d0b))

## [0.61.3](https://github.com/cuongtranba/kanna/compare/v0.61.2...v0.61.3) (2026-05-18)


### Bug Fixes

* **claude-pty:** SIGINT on stop, drain queue after cancel ([#220](https://github.com/cuongtranba/kanna/issues/220)) ([f5a76ff](https://github.com/cuongtranba/kanna/commit/f5a76ff1d40e956e95a26d818172c19e2b6d436a))
* **tools:** normalize mcp__kanna__ask_user_question text→question field ([#222](https://github.com/cuongtranba/kanna/issues/222)) ([b11741d](https://github.com/cuongtranba/kanna/commit/b11741dbd1ec604adf4f41d8d05a540db04e7747))

## [0.61.2](https://github.com/cuongtranba/kanna/compare/v0.61.1...v0.61.2) (2026-05-18)


### Bug Fixes

* **permission-gate:** force ask for mcp__kanna__ask_user_question / exit_plan_mode ([#217](https://github.com/cuongtranba/kanna/issues/217)) ([941f92f](https://github.com/cuongtranba/kanna/commit/941f92f19f159fba83c07e94abf62d85adb4a438)), closes [#215](https://github.com/cuongtranba/kanna/issues/215)

## [0.61.1](https://github.com/cuongtranba/kanna/compare/v0.61.0...v0.61.1) (2026-05-18)


### Bug Fixes

* **claude-pty:** route AskUserQuestion/ExitPlanMode to UI under PTY ([#216](https://github.com/cuongtranba/kanna/issues/216)) ([2316725](https://github.com/cuongtranba/kanna/commit/2316725845263948761e24d897d5eba5b03bcebb)), closes [#215](https://github.com/cuongtranba/kanna/issues/215)
* **update:** instant overlay + per-button loading for install/rollback/redeploy ([#213](https://github.com/cuongtranba/kanna/issues/213)) ([e2f0801](https://github.com/cuongtranba/kanna/commit/e2f0801810ae12ee704e67d2eb375e8c5f387a24))

## [0.61.0](https://github.com/cuongtranba/kanna/compare/v0.60.0...v0.61.0) (2026-05-18)


### Features

* **codex:** auto-relocate ImageGeneration outputs into project ([#210](https://github.com/cuongtranba/kanna/issues/210)) ([d1fb494](https://github.com/cuongtranba/kanna/commit/d1fb494b664882ec58b9ab39773ab7469f77ed05))


### Bug Fixes

* **settings/subagents:** remove duplicate copy in empty state and list ([#212](https://github.com/cuongtranba/kanna/issues/212)) ([55510cb](https://github.com/cuongtranba/kanna/commit/55510cbc8ef50bf3e62f03e641098d3e0e051450))

## [0.60.0](https://github.com/cuongtranba/kanna/compare/v0.59.0...v0.60.0) (2026-05-18)


### Features

* **ui:** full-app loading overlay during redeploy/update restart ([#207](https://github.com/cuongtranba/kanna/issues/207)) ([c967cf2](https://github.com/cuongtranba/kanna/commit/c967cf21e0b733f06ea2d34f982f8e80ecb96a67))
* **update:** install any release from changelog UI ([#208](https://github.com/cuongtranba/kanna/issues/208)) ([8fd44e9](https://github.com/cuongtranba/kanna/commit/8fd44e9cdf91fe21b8686081b3dbfb38a549ff6b))

## [0.59.0](https://github.com/cuongtranba/kanna/compare/v0.58.0...v0.59.0) (2026-05-18)


### Features

* **subagent:** main agent delegates via mcp__kanna__delegate_subagent ([#205](https://github.com/cuongtranba/kanna/issues/205)) ([47466dc](https://github.com/cuongtranba/kanna/commit/47466dc7aff848baf0fc22d89a14149ee1c30148))
* **ui:** centralize app bootstrap loading state ([#206](https://github.com/cuongtranba/kanna/issues/206)) ([b4ada0e](https://github.com/cuongtranba/kanna/commit/b4ada0ef1504fad5c53471ceecdf016b2127a97b))


### Bug Fixes

* **pty:** close mcp/tmp/tool-callbacks on every exit path ([#201](https://github.com/cuongtranba/kanna/issues/201)) ([26a13b8](https://github.com/cuongtranba/kanna/commit/26a13b8004b93bcafe2803f6ed442cd7e8fc61de))
* **subagent:** inherit parent chat's OAuth-pool reservation ([#204](https://github.com/cuongtranba/kanna/issues/204)) ([007ece2](https://github.com/cuongtranba/kanna/commit/007ece27d2dcf4dc78ede815fd2bd9c0b2d9b79a))

## [0.58.0](https://github.com/cuongtranba/kanna/compare/v0.57.5...v0.58.0) (2026-05-18)


### Features

* **pty:** switch to --print stream-json + trust claude as source of truth ([#200](https://github.com/cuongtranba/kanna/issues/200)) ([ca62112](https://github.com/cuongtranba/kanna/commit/ca621122f39b22609d89782287dbcb8548ff164d))


### Bug Fixes

* **subagent:** close 5 P1 concurrency / routing bugs (B1–B5) ([#199](https://github.com/cuongtranba/kanna/issues/199)) ([0775d69](https://github.com/cuongtranba/kanna/commit/0775d6948b63fc9c8629d97b059381fcf53c805b))
* **subagent:** forward user instruction + scan main reply for mentions ([#196](https://github.com/cuongtranba/kanna/issues/196)) ([0745f78](https://github.com/cuongtranba/kanna/commit/0745f78ac0dd19c153056c1cbec6ee9935e83e1b))

## [0.57.5](https://github.com/cuongtranba/kanna/compare/v0.57.4...v0.57.5) (2026-05-18)


### Bug Fixes

* **server:** allow HEAD on /api/projects/:id/{files,uploads}/*/content ([#194](https://github.com/cuongtranba/kanna/issues/194)) ([330f33a](https://github.com/cuongtranba/kanna/commit/330f33a3adfa00e66889f263c1fa992ef95ddd71))

## [0.57.4](https://github.com/cuongtranba/kanna/compare/v0.57.3...v0.57.4) (2026-05-17)


### Bug Fixes

* **chat-input:** prevent iOS Safari page-jump when tapping file picker ([#192](https://github.com/cuongtranba/kanna/issues/192)) ([e139eb8](https://github.com/cuongtranba/kanna/commit/e139eb83f5044fdc15fa711fd8afa4c4b46f61e4))

## [0.57.3](https://github.com/cuongtranba/kanna/compare/v0.57.2...v0.57.3) (2026-05-17)


### Miscellaneous Chores

* release 0.57.3 to publish reverted baseline to npm ([#190](https://github.com/cuongtranba/kanna/issues/190)) ([5dd8b88](https://github.com/cuongtranba/kanna/commit/5dd8b884921079df6115eef74c2f4f2b1a37f3e7))

## [0.57.2](https://github.com/cuongtranba/kanna/compare/v0.57.1...v0.57.2) (2026-05-17)


### Chores

* bump to 0.57.2 to bypass tag clash with the prior v0.57.1 release (v0.57.1 was reverted in #186 but the git tag still points at the old release commit)

## [0.57.1](https://github.com/cuongtranba/kanna/compare/v0.57.0...v0.57.1) (2026-05-17)


### Bug Fixes

* **chat-input:** prevent iOS Safari page-jump when tapping file picker ([#182](https://github.com/cuongtranba/kanna/issues/182)) ([d8cd8cd](https://github.com/cuongtranba/kanna/commit/d8cd8cdc30de476fdb3e6f3373f3a217c0784708))
* **chat-ui:** clamp Selection back into textarea on iOS keyboard-trackpad drift ([#183](https://github.com/cuongtranba/kanna/issues/183)) ([2b55798](https://github.com/cuongtranba/kanna/commit/2b557987c9d23fcf60b152f125a30f8d77c1be98))


### Reverts

* restore chat input + version to 0.57.0 state ([#186](https://github.com/cuongtranba/kanna/issues/186)) ([cb0495a](https://github.com/cuongtranba/kanna/commit/cb0495aaf94d974a1fdb16689ab8edf89c98d5c0))

## [0.57.0](https://github.com/cuongtranba/kanna/compare/v0.56.4...v0.57.0) (2026-05-17)


### Features

* **pty:** D4 partial — runtime /plan enter via slash command ([#174](https://github.com/cuongtranba/kanna/issues/174)) ([f9ab062](https://github.com/cuongtranba/kanna/commit/f9ab062837d9135e97b31bc584d4d11591ba5bfc))
* **pty:** phase 1 parity wiring (B2 + B5) ([#164](https://github.com/cuongtranba/kanna/issues/164)) ([3781119](https://github.com/cuongtranba/kanna/commit/3781119ae70cf3b754da6f013ef9ac5e8207cc7e))
* **pty:** phase 2 — register kanna MCP server in PTY (B3 + B6) ([#168](https://github.com/cuongtranba/kanna/issues/168)) ([aa37c86](https://github.com/cuongtranba/kanna/commit/aa37c86717cd3d5bb8bd4ea3bd4f798470c7919e))
* **pty:** phase 3 — JSONL event parity (D1 + D2 + D3 + D4) ([#169](https://github.com/cuongtranba/kanna/issues/169)) ([f90384d](https://github.com/cuongtranba/kanna/commit/f90384dee08d457770d00c1505cdb412586a1195))
* **pty:** phase 4 — failure handling parity (B4 + D5 + D7) ([#170](https://github.com/cuongtranba/kanna/issues/170)) ([85a685d](https://github.com/cuongtranba/kanna/commit/85a685d7138609af9a576663a76cd8843e05b31f))
* **pty:** phase 5 — subagent routing + shared prompt + account (D6 + D8 + C1) ([#171](https://github.com/cuongtranba/kanna/issues/171)) ([0fa777d](https://github.com/cuongtranba/kanna/commit/0fa777d7b8f988ed6514f5b47c9211c335e1b3c8))
* **pty:** phase 6 — SDK ↔ PTY equivalence matrix + doc sweep ([#172](https://github.com/cuongtranba/kanna/issues/172)) ([043d82c](https://github.com/cuongtranba/kanna/commit/043d82cf6516752ae707e6272801df2aeb460434))
* **settings:** subagent CRUD UI ([#166](https://github.com/cuongtranba/kanna/issues/166)) ([0f094ab](https://github.com/cuongtranba/kanna/commit/0f094ab7870fb311a84ec17b080923045923fe3a))
* **skills:** add kanna-debug skill for transcript-driven debugging ([f6df21a](https://github.com/cuongtranba/kanna/commit/f6df21afbb27a5c4e41c7ac9b6ae9c7b946a00e6))


### Bug Fixes

* **agent:** preserve rotation reservation in closeClaudeSession ([#179](https://github.com/cuongtranba/kanna/issues/179)) ([102270c](https://github.com/cuongtranba/kanna/commit/102270c7f8e7b934e0ce2a40588a7f9529987224))
* **chat-ui:** prevent iOS cursor-jump during hold-space cursor drag ([#180](https://github.com/cuongtranba/kanna/issues/180)) ([cf28ff0](https://github.com/cuongtranba/kanna/commit/cf28ff0ebf2730d54e306bf1927b1a61848b3b7a))
* **codex:** serve absolute-path generated images via /api/local-file ([#167](https://github.com/cuongtranba/kanna/issues/167)) ([61aa1de](https://github.com/cuongtranba/kanna/commit/61aa1de077404a2009ace01a46043c3d06452eb1))
* **oauth-pool:** TOCTOU-safe hasUsable, ephemeral lease, pure read loop ([#177](https://github.com/cuongtranba/kanna/issues/177)) ([561e074](https://github.com/cuongtranba/kanna/commit/561e074c4a1b313d29036009bc4847d013c72792))
* **pty/preflight:** fail-closed on throw, real invalidateAll, contract-versioned cache, poll vs sleep ([#176](https://github.com/cuongtranba/kanna/issues/176)) ([575011e](https://github.com/cuongtranba/kanna/commit/575011eee6c5ddd957808e489a184d8232a77b5e))
* **pty/preflight:** narrow TOCTOU window by re-verifying binary sha256 before spawn ([#178](https://github.com/cuongtranba/kanna/issues/178)) ([0404680](https://github.com/cuongtranba/kanna/commit/0404680e9a4c148874c075af6ddb697d5bd2c7dc))
* **pty/sandbox:** symlink resolution, glob surfacing, injection + signal ([#175](https://github.com/cuongtranba/kanna/issues/175)) ([378797f](https://github.com/cuongtranba/kanna/commit/378797f5578456410a002b0afc300918df416940))
* **pty:** drop credentials.json requirement when OAuth-pool token supplied ([#173](https://github.com/cuongtranba/kanna/issues/173)) ([6dc8f37](https://github.com/cuongtranba/kanna/commit/6dc8f37e8c3327f77f1a6bc09584b0c4954115b3))

## [0.56.4](https://github.com/cuongtranba/kanna/compare/v0.56.3...v0.56.4) (2026-05-16)


### Bug Fixes

* **chat:** transcript not scrollable on mobile for long conversations ([#159](https://github.com/cuongtranba/kanna/issues/159)) ([22b273b](https://github.com/cuongtranba/kanna/commit/22b273b90301bef85df8c7b02b693c34bea2e4f1))

## [0.56.3](https://github.com/cuongtranba/kanna/compare/v0.56.2...v0.56.3) (2026-05-16)


### Performance Improvements

* **transcript:** stabilize markdown props + memoize message components ([#157](https://github.com/cuongtranba/kanna/issues/157)) ([6ed1531](https://github.com/cuongtranba/kanna/commit/6ed153168686afc6d05fc2f858adcdadbec4209f))

## [0.56.2](https://github.com/cuongtranba/kanna/compare/v0.56.1...v0.56.2) (2026-05-16)


### Bug Fixes

* **chat-preferences:** persist composer state + use providerDefaults for new chat ([#155](https://github.com/cuongtranba/kanna/issues/155)) ([54aa3e0](https://github.com/cuongtranba/kanna/commit/54aa3e0562158d965c80d4426ca90ab6489d2d10))

## [0.56.1](https://github.com/cuongtranba/kanna/compare/v0.56.0...v0.56.1) (2026-05-16)


### Bug Fixes

* **chat-preferences:** refresh new-chat composer when settings change ([#151](https://github.com/cuongtranba/kanna/issues/151)) ([ad7c3ac](https://github.com/cuongtranba/kanna/commit/ad7c3acd91efd437607f4c2617d5969d34d2a4bf))
* **compact:** stop cumulative result.usage leaking into usedTokens ([#152](https://github.com/cuongtranba/kanna/issues/152)) ([3007810](https://github.com/cuongtranba/kanna/commit/30078108852aed9b147479b73cbba04e00271613))

## [0.56.0](https://github.com/cuongtranba/kanna/compare/v0.55.3...v0.56.0) (2026-05-16)


### Features

* **file-preview:** mobile-first universal file preview sheet ([#143](https://github.com/cuongtranba/kanna/issues/143)) ([181e60a](https://github.com/cuongtranba/kanna/commit/181e60aca9877815da7fb95b84a9183889a593cd))


### Bug Fixes

* **agent:** recreate activeTurn on late canUseTool from SDK self-resume ([#148](https://github.com/cuongtranba/kanna/issues/148)) ([4114fc7](https://github.com/cuongtranba/kanna/commit/4114fc7c99944ee0e0f11a4dc8b5e4140d3c7a88))

## [0.55.3](https://github.com/cuongtranba/kanna/compare/v0.55.2...v0.55.3) (2026-05-16)


### Bug Fixes

* **server:** dispose fs.watch managers before fallible shutdown awaits ([#146](https://github.com/cuongtranba/kanna/issues/146)) ([9460481](https://github.com/cuongtranba/kanna/commit/9460481145898b469605d4fd687b05dc6f242121))

## [0.55.2](https://github.com/cuongtranba/kanna/compare/v0.55.1...v0.55.2) (2026-05-16)


### Bug Fixes

* **test:** dispose AppSettingsManager FSWatchers via centralized afterEach ([#144](https://github.com/cuongtranba/kanna/issues/144)) ([9b7c0be](https://github.com/cuongtranba/kanna/commit/9b7c0be4717167b1c5208db63c8a2c172fe6f91f))

## [0.55.1](https://github.com/cuongtranba/kanna/compare/v0.55.0...v0.55.1) (2026-05-16)


### Bug Fixes

* **ci:diag:** capture stuck-process stack when bun test hangs ([#141](https://github.com/cuongtranba/kanna/issues/141)) ([4d83e9c](https://github.com/cuongtranba/kanna/commit/4d83e9cc25cd519aef38e522ca353f9287ad858b))

## [0.55.0](https://github.com/cuongtranba/kanna/compare/v0.54.0...v0.55.0) (2026-05-16)


### Features

* **claude-pty:** P7 — driver toggle, lifecycle, sidebar badges, per-chat permissions ([#135](https://github.com/cuongtranba/kanna/issues/135)) ([1742ea7](https://github.com/cuongtranba/kanna/commit/1742ea775e419adfb43f01514557e6fc57241529))


### Bug Fixes

* **chat:** seed composer provider from server snapshot on session reload ([#137](https://github.com/cuongtranba/kanna/issues/137)) ([9019c50](https://github.com/cuongtranba/kanna/commit/9019c509786b13153680dbd2342c39db46b17d06))
* **chat:** server-authoritative routing kills duplicate queued bubble ([#136](https://github.com/cuongtranba/kanna/issues/136)) ([5354454](https://github.com/cuongtranba/kanna/commit/535445437a7d08dde652c2b39b9a91bf71755bd8))
* **codex:** render ImageGeneration inline with project URL and populated prompt ([#132](https://github.com/cuongtranba/kanna/issues/132)) ([a9d4c39](https://github.com/cuongtranba/kanna/commit/a9d4c3911729984201b498acce32eead1f5263d2))
* **compact:** persist proactive-compact circuit breaker + harden audit gaps ([#139](https://github.com/cuongtranba/kanna/issues/139)) ([81ed65b](https://github.com/cuongtranba/kanna/commit/81ed65b3db05a96134d4335ad2b32a56f48cb051))
* **compact:** protect queued message from accidental dequeue mid-compact ([#134](https://github.com/cuongtranba/kanna/issues/134)) ([e1c0c73](https://github.com/cuongtranba/kanna/commit/e1c0c73b79f770483fbdd509ae64d13646650959))
* **compact:** seed maxTokens from [1m] model id to stop premature compact ([#131](https://github.com/cuongtranba/kanna/issues/131)) ([1f7bc42](https://github.com/cuongtranba/kanna/commit/1f7bc42a483c5d8b65a5eb074c14c25422e4c0b4))
* **image-gen:** tighten types, fix silent error, dedupe URL builder ([#138](https://github.com/cuongtranba/kanna/issues/138)) ([890ad71](https://github.com/cuongtranba/kanna/commit/890ad716ccf15b3484c3ad6192ae0b8feeb7b3d2))
* **local-file-link:** treat extension-less paths as editor links ([#129](https://github.com/cuongtranba/kanna/issues/129)) ([8a0c867](https://github.com/cuongtranba/kanna/commit/8a0c867d857f50374d9836988870e2decddebb59))
* **useKannaState:** drop optimistic user_prompt when chat.send acks queued ([#133](https://github.com/cuongtranba/kanna/issues/133)) ([554b492](https://github.com/cuongtranba/kanna/commit/554b492bcee57f70a41fcf5f6573052ffc345b4e))

## [0.54.0](https://github.com/cuongtranba/kanna/compare/v0.53.0...v0.54.0) (2026-05-15)


### Features

* **claude-pty:** session lifecycle + prompt-too-long recovery (P6) ([#122](https://github.com/cuongtranba/kanna/issues/122)) ([9239751](https://github.com/cuongtranba/kanna/commit/9239751d5af721c7807572e454c9e40228f25605))


### Bug Fixes

* **codex:** surface image generation + unknown ThreadItems, suppress empty agent messages ([#125](https://github.com/cuongtranba/kanna/issues/125)) ([4130ba9](https://github.com/cuongtranba/kanna/commit/4130ba93d49d98138241a68a66a8798bf73f6af8))
* **oauth-pool:** release token reservation on turn end so idle chats stop blocking ([#128](https://github.com/cuongtranba/kanna/issues/128)) ([086d60d](https://github.com/cuongtranba/kanna/commit/086d60da07199f8307071839fb946278729d6f24))
* **tests:** force NODE_ENV=test via bunfig preload to load React dev bundle ([#127](https://github.com/cuongtranba/kanna/issues/127)) ([b38d32f](https://github.com/cuongtranba/kanna/commit/b38d32f036ecd0d502b10311990c2db18276fafc))

## [0.53.0](https://github.com/cuongtranba/kanna/compare/v0.52.0...v0.53.0) (2026-05-15)


### Features

* **oauth-pool:** add disabled token status to exclude accounts from pool ([#117](https://github.com/cuongtranba/kanna/issues/117)) ([1fb43ae](https://github.com/cuongtranba/kanna/commit/1fb43ae04b2e7e76282f83864fbdacf7e734cf86))
* **update:** host-agnostic install with detection + KANNA_UPDATE_COMMAND override ([#119](https://github.com/cuongtranba/kanna/issues/119)) ([e9e66b2](https://github.com/cuongtranba/kanna/commit/e9e66b2d62b34751efacdc2b818db6733c986964))


### Bug Fixes

* **oauth-pool:** refuse spawn + rotate on 401 to stop keychain-fallback 401 loop ([#123](https://github.com/cuongtranba/kanna/issues/123)) ([99662fc](https://github.com/cuongtranba/kanna/commit/99662fca8cac12e53eaa8fc8019472ea73e5800c))

## [0.52.0](https://github.com/cuongtranba/kanna/compare/v0.51.0...v0.52.0) (2026-05-15)


### Features

* **agent:** proactive /compact injection before context overflows ([#116](https://github.com/cuongtranba/kanna/issues/116)) ([1169e3e](https://github.com/cuongtranba/kanna/commit/1169e3e120946e8c0cfce5a76da6527e6b228356))
* cancel individual subagent run ([#96](https://github.com/cuongtranba/kanna/issues/96)) ([b171ddf](https://github.com/cuongtranba/kanna/commit/b171ddf7cbf1b566b6df4aa0c82684364a29f704))
* **claude-pty:** allowlist preflight + --tools flag (P3b) ([#110](https://github.com/cuongtranba/kanna/issues/110)) ([ba6b440](https://github.com/cuongtranba/kanna/commit/ba6b440ae53a6f47cd459d8e5d10750de04e246d))
* **claude-pty:** Linux bwrap sandbox parity (P4.1) ([#112](https://github.com/cuongtranba/kanna/issues/112)) ([713c1da](https://github.com/cuongtranba/kanna/commit/713c1da25cbbd9c933434920994e6aabf67d4023))
* **claude-pty:** macOS sandbox-exec wrapper (P4) ([#111](https://github.com/cuongtranba/kanna/issues/111)) ([b3a9e12](https://github.com/cuongtranba/kanna/commit/b3a9e1258c30057dce89f4aa6a68598948643f99))
* **claude-pty:** OAuth pool rotation via CLAUDE_CODE_OAUTH_TOKEN (P5) ([#114](https://github.com/cuongtranba/kanna/issues/114)) ([65c1542](https://github.com/cuongtranba/kanna/commit/65c1542e4e371a5109c2565679a45ad8dd9c945a))
* **claude-pty:** PTY core driver (P2 — flag off by default) ([#106](https://github.com/cuongtranba/kanna/issues/106)) ([0ece0ba](https://github.com/cuongtranba/kanna/commit/0ece0ba128c5fc16fd758e675a878f63f8b69095))
* **kanna-mcp:** built-in tool shims (P3a — flag off by default) ([#107](https://github.com/cuongtranba/kanna/issues/107)) ([bbaed17](https://github.com/cuongtranba/kanna/commit/bbaed17c014bbe874b255aa871b1af5db1c2172b))
* **mcp-tool-refactor:** durable approval protocol + permission-gate (P1 — flag off by default) ([#105](https://github.com/cuongtranba/kanna/issues/105)) ([d2b2cce](https://github.com/cuongtranba/kanna/commit/d2b2cce003191f5989520adfabeaea6a3de2a1eb))


### Bug Fixes

* **agent:** gate runClaudeSession finally activeTurn cleanup on isCurrentSession ([#115](https://github.com/cuongtranba/kanna/issues/115)) ([fad644a](https://github.com/cuongtranba/kanna/commit/fad644a87a2be63ebc7842cedea16621d7f39b0a))
* **event-store:** dedupe appendMessage by messageId (JSONL replay safety) ([#109](https://github.com/cuongtranba/kanna/issues/109)) ([b6d5c01](https://github.com/cuongtranba/kanna/commit/b6d5c01e3e733d3b3e4a9bad2413b55099edff56))
* **subagent:** cancel rejects pending resolvers even with no main turn ([#94](https://github.com/cuongtranba/kanna/issues/94)) ([9aac71d](https://github.com/cuongtranba/kanna/commit/9aac71dc226a62703568790bafd45974771c0167))
* **tool-callback test:** flush background persists before tmpdir cleanup ([#113](https://github.com/cuongtranba/kanna/issues/113)) ([dd0387a](https://github.com/cuongtranba/kanna/commit/dd0387a06b16f2df7bae471aa81a0c9db2b7c951))

## [0.51.0](https://github.com/cuongtranba/kanna/compare/v0.50.0...v0.51.0) (2026-05-14)


### Features

* phase 3 subagent orchestration + UI ([#83](https://github.com/cuongtranba/kanna/issues/83)) ([bca45b9](https://github.com/cuongtranba/kanna/commit/bca45b9098b292373b54dcfd1e2bda5f05a3efe9))
* phase 4 real provider integration for subagents ([#86](https://github.com/cuongtranba/kanna/issues/86)) ([52d22ce](https://github.com/cuongtranba/kanna/commit/52d22ce50335059cc52b3c8705e1608b573d8a70))
* **sidebar:** asterism separator between stacks ([#85](https://github.com/cuongtranba/kanna/issues/85)) ([002f39e](https://github.com/cuongtranba/kanna/commit/002f39ecb73173ee1b0fbcfe5bd1a34eb264d8ca))


### Bug Fixes

* **event-store:** forkChat preserves stack membership ([#87](https://github.com/cuongtranba/kanna/issues/87)) ([7f76ac9](https://github.com/cuongtranba/kanna/commit/7f76ac94bdb1d3f7558b8cfc92ad8deed91d2c26))
* **oauth-pool:** reserve token per chat to prevent concurrent rotation race ([#89](https://github.com/cuongtranba/kanna/issues/89)) ([686c6b8](https://github.com/cuongtranba/kanna/commit/686c6b8a7de31d02f31f85d52c1c00a6df1581c9))
* **subagent:** clear pendingTool on terminal events + use /api/local-file ([#88](https://github.com/cuongtranba/kanna/issues/88)) ([e32db6f](https://github.com/cuongtranba/kanna/commit/e32db6fa264f5b5947bd524a3834fdce1890daa3))
* **subagent:** resolver leaks, full restart recovery, harden cap ([#93](https://github.com/cuongtranba/kanna/issues/93)) ([7bb3d92](https://github.com/cuongtranba/kanna/commit/7bb3d923c84e012a2716aa428d624ec70c519c3a))
* **ws-router:** strip timings from chat snapshot dedup signature ([#90](https://github.com/cuongtranba/kanna/issues/90)) ([ee3548a](https://github.com/cuongtranba/kanna/commit/ee3548a9ece5c4785aeaaed5e4d9de465fb00668))

## [0.50.0](https://github.com/cuongtranba/kanna/compare/v0.49.0...v0.50.0) (2026-05-14)


### Features

* model-independent chat phase 2 (subagent CRUD + [@agent](https://github.com/agent) mentions) ([#81](https://github.com/cuongtranba/kanna/issues/81)) ([07955a8](https://github.com/cuongtranba/kanna/commit/07955a81ad07f16a24bbf69f0c325a7f21999337))

## [0.49.0](https://github.com/cuongtranba/kanna/compare/v0.48.0...v0.49.0) (2026-05-13)


### Features

* model-independent chat phase 1 (provider-switching) ([#77](https://github.com/cuongtranba/kanna/issues/77)) ([075000b](https://github.com/cuongtranba/kanna/commit/075000be0201cc59194a76415213784cec0f6db1))
* **sidebar:** add stack delete via dropdown + context menu ([#79](https://github.com/cuongtranba/kanna/issues/79)) ([f4843a1](https://github.com/cuongtranba/kanna/commit/f4843a1fc987cc05986fdfcb7fc276bb2c4a4702))

## [0.48.0](https://github.com/cuongtranba/kanna/compare/v0.47.2...v0.48.0) (2026-05-13)


### Features

* **chat-navbar:** show worktree dir in branch label ([#69](https://github.com/cuongtranba/kanna/issues/69)) ([6dca7cc](https://github.com/cuongtranba/kanna/commit/6dca7cc70e3a950bf88713fe95add172ce00644e))
* star projects in sidebar ([#74](https://github.com/cuongtranba/kanna/issues/74)) ([65c1b33](https://github.com/cuongtranba/kanna/commit/65c1b330b88c3c67157b8514b5fc3ae0e59efe60))
* **tunnel:** replace bash-detector with agent-callable expose_port tool ([#70](https://github.com/cuongtranba/kanna/issues/70)) ([24c6233](https://github.com/cuongtranba/kanna/commit/24c6233f3e0594c8ab0543485a312b62661a936b))


### Bug Fixes

* **downloads:** render local-file markdown links as download cards ([#75](https://github.com/cuongtranba/kanna/issues/75)) ([67fb665](https://github.com/cuongtranba/kanna/commit/67fb6651788c5718bae2403e777c5db28d9e1667))
* **oauth-pool:** tear down session on token rotation ([#72](https://github.com/cuongtranba/kanna/issues/72)) ([9f28a71](https://github.com/cuongtranba/kanna/commit/9f28a713bf78657cce14fbbc43cd22db806fb4f0))
* **server:** serve arbitrary local files via /api/local-file ([#66](https://github.com/cuongtranba/kanna/issues/66)) ([dffbf01](https://github.com/cuongtranba/kanna/commit/dffbf0126b0faa49510dcda0a57eb7e7a1683e05))
* **stacks:** render stack chats inside expanded stack section ([#71](https://github.com/cuongtranba/kanna/issues/71)) ([d00f6a5](https://github.com/cuongtranba/kanna/commit/d00f6a555a7e51f03e979c3cb235a3014869e93b))

## [0.47.2](https://github.com/cuongtranba/kanna/compare/v0.47.1...v0.47.2) (2026-05-13)


### Bug Fixes

* **app-settings:** atomic writes prevent OAuth token loss ([#60](https://github.com/cuongtranba/kanna/issues/60)) ([7619fb8](https://github.com/cuongtranba/kanna/commit/7619fb8e7c2d3ec30a1084704decb2db3dad9077))

## [0.47.1](https://github.com/cuongtranba/kanna/compare/v0.47.0...v0.47.1) (2026-05-13)


### Bug Fixes

* **stacks:** stack chat create row layout on narrow widths ([#57](https://github.com/cuongtranba/kanna/issues/57)) ([95d83be](https://github.com/cuongtranba/kanna/commit/95d83bebfb6fbe82a464efe7ce80d68c33dd8888))

## [0.47.0](https://github.com/cuongtranba/kanna/compare/v0.46.1...v0.47.0) (2026-05-13)


### Features

* **stacks:** Phase 3 — sidebar UI, chat creation, peer strip ([#55](https://github.com/cuongtranba/kanna/issues/55)) ([0a680c1](https://github.com/cuongtranba/kanna/commit/0a680c119688a9c069e747c5087df96ebe461645))

## [0.46.1](https://github.com/cuongtranba/kanna/compare/v0.46.0...v0.46.1) (2026-05-12)


### Bug Fixes

* **oauth-pool:** detect SDK-wrapped rate-limit and rotate tokens ([c0a30a9](https://github.com/cuongtranba/kanna/commit/c0a30a90122db3c15fd5c98a0c00d3e44b62f887))

## [0.46.0](https://github.com/cuongtranba/kanna/compare/v0.45.0...v0.46.0) (2026-05-11)


### Features

* OAuth token pool with automatic rotation on rate-limit ([#52](https://github.com/cuongtranba/kanna/issues/52)) ([219ecef](https://github.com/cuongtranba/kanna/commit/219ecefe4fb453525c6e4314413c976235e7806c))
* **stacks:** Phase 1 — server, events, store, ws-router ([#48](https://github.com/cuongtranba/kanna/issues/48)) ([7abeff1](https://github.com/cuongtranba/kanna/commit/7abeff13a6a7293959d712a36b0480b5ea1e6787))
* **stacks:** Phase 2 — chat bindings + agent spawn wiring ([#50](https://github.com/cuongtranba/kanna/issues/50)) ([2295fc8](https://github.com/cuongtranba/kanna/commit/2295fc80f2a24815e9263040ab731d91efce8cab))
* **stacks:** Phase 3 — UI plan (draft, plan-only) ([#51](https://github.com/cuongtranba/kanna/issues/51)) ([4f52dac](https://github.com/cuongtranba/kanna/commit/4f52dace8ddc06f26c879b40a9b0151c0693031a))


### Bug Fixes

* **bg-tasks:** remove duplicate "Background tasks" header ([#53](https://github.com/cuongtranba/kanna/issues/53)) ([029c957](https://github.com/cuongtranba/kanna/commit/029c957f44208df6aa4e85ef7ea4e1a611a4c776))
* **uploads:** raise Bun maxRequestBodySize to upload max ([#45](https://github.com/cuongtranba/kanna/issues/45)) ([68752f4](https://github.com/cuongtranba/kanna/commit/68752f4344c6ecf0dd6d760ef8aa238f4b2bfbf6))

## [0.45.0](https://github.com/cuongtranba/kanna/compare/v0.44.0...v0.45.0) (2026-05-10)


### Features

* **agent:** inline file downloads via offer_download SDK MCP tool ([#42](https://github.com/cuongtranba/kanna/issues/42)) ([20b2d99](https://github.com/cuongtranba/kanna/commit/20b2d998e532860551b22bd7dcd4b30ff1e436ef))
* **bg-tasks:** visibility and stop control for background tasks ([#38](https://github.com/cuongtranba/kanna/issues/38)) ([416bab5](https://github.com/cuongtranba/kanna/commit/416bab580b0cede033f6a16e2bce29026d472e10))
* **worktrees:** server git wrapper (phase 1) ([#44](https://github.com/cuongtranba/kanna/issues/44)) ([8c1553c](https://github.com/cuongtranba/kanna/commit/8c1553c8c8e0b0bb3d64b70b4b23eae4acfb6299))


### Bug Fixes

* **push:** skip push when chat is currently open ([#41](https://github.com/cuongtranba/kanna/issues/41)) ([f6c6bf2](https://github.com/cuongtranba/kanna/commit/f6c6bf23b4ccb658a6ea81c048947bdc3a035050))

## [0.44.0](https://github.com/cuongtranba/kanna/compare/v0.43.2...v0.44.0) (2026-05-08)


### Features

* **uploads:** configurable max file size + upload progress UI ([#37](https://github.com/cuongtranba/kanna/issues/37)) ([220d590](https://github.com/cuongtranba/kanna/commit/220d590f541d7e13bce1499484380f5d9be0c87b))


### Bug Fixes

* **agent:** clear stuck Running state after cancel-then-steer ([#39](https://github.com/cuongtranba/kanna/issues/39)) ([c951f1c](https://github.com/cuongtranba/kanna/commit/c951f1c8e941b300f488bda7db31189a2a36895a))
* **chat-input:** show attach button on desktop ([#35](https://github.com/cuongtranba/kanna/issues/35)) ([40c8c8e](https://github.com/cuongtranba/kanna/commit/40c8c8eb50ba95381a5279f0319b76b5d5c68643))

## [0.43.2](https://github.com/cuongtranba/kanna/compare/v0.43.1...v0.43.2) (2026-05-06)


### Bug Fixes

* **terminals:** stop dev process leaks on project remove, shell exit, SIGHUP, and crash ([#33](https://github.com/cuongtranba/kanna/issues/33)) ([7d872c1](https://github.com/cuongtranba/kanna/commit/7d872c1dbfa967baae5ccae8f390adb23c6753eb))

## [0.43.1](https://github.com/cuongtranba/kanna/compare/v0.43.0...v0.43.1) (2026-05-06)


### Bug Fixes

* **diff-store:** harden git spawns and add CI test workflow ([#31](https://github.com/cuongtranba/kanna/issues/31)) ([fe874fb](https://github.com/cuongtranba/kanna/commit/fe874fbfdaa5c670d2c083c4e044b5984bd21028))

## [0.43.0](https://github.com/cuongtranba/kanna/compare/v0.42.6...v0.43.0) (2026-05-06)


### Features

* **timings:** chat session timings UI ([#28](https://github.com/cuongtranba/kanna/issues/28)) ([2f50b22](https://github.com/cuongtranba/kanna/commit/2f50b22d1f21b1b2760cb02f5af5c5d1a7e885cf))


### Bug Fixes

* **agent:** set claude_code preset with trust context to stop spurious malware refusals ([a38ec31](https://github.com/cuongtranba/kanna/commit/a38ec3113391c4aef22530a0595d195ecc26ef19))

## [0.42.6](https://github.com/cuongtranba/kanna/compare/v0.42.5...v0.42.6) (2026-05-05)


### Bug Fixes

* **quick-response:** unblock Haiku title gen in nested CC sessions ([fff7fa4](https://github.com/cuongtranba/kanna/commit/fff7fa4e21aef17263cddd3506b1776e8a6682a2))

## [0.42.5](https://github.com/cuongtranba/kanna/compare/v0.42.4...v0.42.5) (2026-05-05)


### Bug Fixes

* **push:** use /chat singular route in notification payload ([#24](https://github.com/cuongtranba/kanna/issues/24)) ([f7ee018](https://github.com/cuongtranba/kanna/commit/f7ee01838df257cf6c650f8e96c8c3b2feca1d74))

## [0.42.4](https://github.com/cuongtranba/kanna/compare/v0.42.3...v0.42.4) (2026-05-05)


### Bug Fixes

* **push:** include diagnostic delivery logging in release ([fb549a9](https://github.com/cuongtranba/kanna/commit/fb549a9c6fb2a9ee91c603a797ddcb7dfe31f5b0))

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
