# Feature request

## Template

```markdown
## Problem

<The pain, in terms of what happens today — with file:line for the current
behaviour and a number if one exists. Not "there is no X"; rather, what the
absence of X costs.>

<What the user does instead today, and why that workaround is the wrong
altitude / too slow / too coarse.>

## Ask

<What to build, in a sentence or two. Then the generalization: the motivating
case, and the other cases that share the shape.>

Deliberately NOT doing: <the adjacent, more automatic thing someone will
propose — and why it is wrong.>

## Where it goes

<The placement decision: file, component, or layer.>

Why there:

- <reason, usually "this is where the sibling affordances already live">

- Rejected — <alternative>: <why it does not fit>
- Rejected — <alternative>: <why>

## Spec

<Interface first: the shape of the thing. For UI, the component/variant/icon/
a11y contract and the DESIGN.md rules it has to clear. For a server change, the
type, the event, the persistence.>

## <The case that makes a naive implementation useless>

<The non-obvious interaction you found while investigating. This section has no
fixed name — it is named after the trap.>

## Data flow

```mermaid
<diagram, when the change crosses components>
```

## Acceptance

<How we know it works — the observable behaviour, and the test that pins it.>
```

## Why each section earns its place

**Problem before Ask.** An issue that opens with the solution invites a debate
about the solution. One that opens with cost — *288 pushes a day for work the
user deliberately automated* — establishes that something must change, and then
the Ask is a proposal against an agreed problem. Cite the current behaviour by
`file:line` for the same reason a bug does: it proves you read the code rather
than assumed the gap.

**"Deliberately NOT doing"** pre-empts the most likely redesign. In #851 that is
the automatic rule ("cron runs never notify"), and the reason it is rejected is
genuinely interesting — a cron job that *failed* is exactly what a notification
is for. Writing this down converts a review-cycle argument into a decision the
issue already carries.

**Placement with rejected alternatives** is what makes a feature issue
implementable rather than merely agreed. "Add a mute toggle" leaves the
implementer to pick a location, and any pick invites a change request in review.
Naming the location *and the two places it does not go, with reasons* removes the
whole cycle. Rejections are compressed design review; each one is a PR comment
that now never has to be written.

**Spec is interface-first.** Design the surface before the implementation — the
shape is what other code will depend on, and it is the part that is expensive to
change later. For UI in this repo the spec is not optional decoration: `DESIGN.md`
rules are mechanically enforced (no `backdrop-blur`, no raw hex, no native
`title` on intrinsic elements, tone pairings from `TONE_PAIRINGS`, colour never
the sole signal), so naming them in the issue is the difference between passing
lint on the first push and finding out in CI.

**The trap section** is the one that justifies the investigation. #851's is
spawn-mode cron: a per-chat mute does nothing for `mode: spawn`, which creates a
new chat per run — so the naive implementation of the feature fails at *exactly
the case that motivated it*. Nobody discovers that from the feature description;
you find it by reading `cron/fire.ts`. If your investigation turned up nothing of
this kind, that is a signal to look harder, not a signal that the feature is
simple.

**Data flow** as a mermaid diagram when the change crosses components. Validate
it before it lands — Kanna renders mermaid inline, so a syntax error reaches
every reader as a broken diagram. Quote any label containing `( ) [ ] { } | "` or
starting with `/`.

**Acceptance** is what closes the issue. Prefer an observable behaviour plus a
test over a feeling: *a spawned chat inherits the origin chat's silent state* is
checkable; *notifications are less annoying* is not.

## Annotated example — issue #851

> **Per-chat Silent toggle: stop cron runs from pushing a notification every fire**

Title carries area, the thing to build, and the outcome.

**Problem** — mechanism, then cost, then why the existing escape hatch fails:

> Every fired run drives the chat `running → idle`, and
> `PushManager.detectTransition` reads that as `completed` and pushes to every
> subscribed device (`src/server/push/push-manager.ts:253-281`). An `every 5m`
> job is 288 pushes a day for work the user deliberately automated and does not
> want to be told about.
>
> The only mute that exists today is **per project** […] muting the whole project
> also silences the chats the user is actively working in, and it takes a trip to
> Settings to do it.

The `file:line` shows the mechanism was read, not guessed. "288 pushes a day" is
a computed number, and it is what makes the issue impossible to deprioritize.
The second paragraph forecloses "just use the existing mute".

**Ask** — with the generalization and the explicit non-goal:

> Cron is the motivating case, but the toggle is not cron-specific: a long
> babysitting loop or a noisy background watch wants the same thing.
>
> Deliberately NOT doing: an automatic "cron runs never notify" rule. A cron job
> that *failed* or is *waiting for the user* is exactly what a notification is
> for. The user decides, per chat.

Generalizing beyond the motivating case is what keeps the implementation from
being cron-shaped and needing a rewrite at the second use.

**Where the button goes** — location, three reasons, two rejections:

> **Chat navbar, in the right-hand control cluster, immediately left of Share**
> (`src/client/components/chat-ui/ChatNavbar.tsx`, the
> `border border-border rounded-2xl` group that already holds overflow /
> terminal / share / branch).
>
> - Silence is **session-scoped persistent state**, and that cluster is where
>   every other session-scoped affordance already lives.
> - Rejected — chat footer `ChatPreferenceControls`: those are per-turn *model*
>   options riding the composer, not durable chat state […]
> - Rejected — Settings page: it already owns the project-level mute. A per-chat
>   control there would be a list of every chat — the wrong altitude and two
>   navigations away from the moment the user wants it.

Note the reasoning is about the *category* of the state (session-scoped and
durable vs. per-turn), not about visual preference. That is a reason that
survives a redesign.

**Spec** names the enforced rules directly:

> `Button variant="ghost" size="none"` […] Icon: lucide `Bell` ⇄ `BellOff`.
> Muted state renders `text-muted-foreground`; **never colour alone** — the icon
> swap is the signal. `aria-pressed={silent}` […] Tooltip via the project
> `Tooltip` — no native `title` on intrinsic elements. No `backdrop-blur`, no
> raw hex — token classes only.

**The trap** — the section that earns the whole issue:

> ### Spawn-mode cron: silence must be inherited
>
> `mode: spawn` creates a **brand-new chat per run** (`src/server/cron/fire.ts:113-145`).
> Muting the arming chat therefore does nothing for the chats that actually fire
> — this is the detail that makes a naive per-chat mute useless for the exact
> case that motivated it.
>
> `CronFireDeps.onChatSpawned(originChatId, spawnedChatId)` already exists as the
> link hook.

It names the trap, proves it from the source, and then hands over the existing
hook that solves it — so the implementer gets the hard part and its answer
together.
