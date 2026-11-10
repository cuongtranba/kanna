# Inbox push preview, Send-from-notification and keyboard

User docs: the Notifications and Keyboard sections of the Inbox wiki page, the Inbox notifications section of the Push notifications page.

- **Two opt-ins, both default false.** `InboundHandler.pushPreview` (optional,
  stored only when true, read with `=== true`) puts the latest inbound `preview`,
  or the proposal text, in `PushPayload.body`, cut to `INBOX_PUSH_PREVIEW_MAX_CHARS`
  (140) by `inboxPushPreview` in `src/shared/inbox/push.ts`. `McpSourceAutonomy.
  sendFromNotification` adds `actions: [INBOX_PUSH_SEND_ACTION]` to the proposal
  push. Webhook hooks have no push switch, so `webhookHandler` never sets
  `pushPreview`. The handler and autonomy readers (`mcp-sources-settings.ts`),
  the zod schemas and the source form are four places a new flag must reach.
- **A proposal pushes when it becomes an OPEN card, and only then.**
  `InboxRegistry.addProposal` fires `onProposalOpened` for `status: "open"` after
  the write lands; `reopenScheduledProposals` at boot goes around it, so a restart
  never pushes, and a scheduled auto-send never pushes. A paused thread gets a
  draft from `decideProposal`, so it never reaches the hook. `wireInboxPush`
  (`inbox-boot.ts`, which takes an `AutopilotSourceResolver`) honours
  `pushEnabled`, then calls `PushManager.notifyInboxProposal` with
  `withPreview` and `withSendAction`. Kind `inbox_proposal`, dedupe
  `inbox-proposal:<proposalId>`, same tag as the thread so it replaces the
  needs-you notification.
- **The payload carries ids and text, never a credential.** `proposalId` and
  `threadId` are the only things the service worker can act on, and
  `push-manager`'s payload keys are pinned by `inbox-push.test.ts`.
- **The route is behind the `/api` session gate and adds its own Origin check.**
  `http-dispatcher.ts` 401s every `/api/*` request without a session when a
  password is set, but checks Origin only for `/ws`. `handleProposalApproveRequest`
  (`inbox/proposal-approve-http.ts`) therefore requires an `Origin` header that
  matches (`auth.validateOrigin`, or the request origin when no password is set),
  so a missing or foreign Origin is 403. It calls `InboxActions.approveProposal`
  with no edited text: 200 `{outboundId}`, 409 when the proposal is not open or
  the send failed, 400 for a bad body. No password means no 401, as for every
  other `/api` route. Do not add a second approve path.
- **`public/sw.js` is thin on purpose.** The decisions (`kannaNotificationOptions`,
  `kannaNotificationPlan`) live in `public/sw-notifications.js`, loaded with
  `importScripts`, and `push-service-worker.test.ts` runs both files in a
  `node:vm` context with a fake `self` and `fetch`. On Send the worker POSTs once
  with `credentials: "same-origin"`; a non-2xx, a throw or missing ids opens the
  thread and never retries. The route path is duplicated in the worker and pinned
  to `HTTP_ROUTES.inboxProposalApprove` by that test. A new action must be added
  in both the worker allowlist and the test.
- **Keys are keybinding actions.** `inboxNextThread`, `inboxPrevThread`,
  `inboxFocusComposer`, `inboxArchiveThread`, `inboxApproveProposal` with defaults
  `j k r e a` in `app-settings-types.ts`, labels in `lib/keybindings.ts`.
  `resolveBoundCommand` is the one place a bare-key binding is suppressed while
  typing (the pane commands use it too). `useInboxKeyboard` is mounted in
  `InboxPage`; archive and approve go through `lib/inboxActions.ts`, shared with
  the composer and the approval card. The composer registers its focus callback
  with `inboxStore.registerComposerFocus`.
