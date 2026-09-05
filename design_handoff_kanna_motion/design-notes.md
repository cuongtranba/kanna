# Kanna source values (lifted from src/index.css)

## Dark tokens
background oklch(20% 0.01 13) · foreground oklch(98% 0.003 13) · card oklch(23% 0.01 13)
popover oklch(20% 0.01 13) · primary oklch(98% 0.003 13) · primary-fg oklch(18% 0.01 13)
secondary oklch(26% 0.01 13) · muted oklch(25% 0.01 13) · muted-foreground oklch(72% 0.012 13)
accent oklch(26% 0.01 13) · border oklch(29% 0.008 13) · input oklch(26% 0.01 13)
ring oklch(85% 0.008 13) · muted-icon oklch(55% 0.01 13) · overlay oklch(12% 0.008 13)
logo oklch(71.2% 0.194 13.428)
success oklch(72% 0.14 155) / success-text oklch(76% 0.14 155)
warning oklch(80% 0.13 78) / warning-text = warning
info oklch(72% 0.12 235) / info-text = info
destructive = logo · destructive-text oklch(78% 0.18 13) · destructive-filled oklch(68% 0.16 13)

## Light tokens
background oklch(99.5% 0.003 13) · foreground oklch(16% 0.01 13) · card oklch(99.5% 0.003 13)
primary oklch(20% 0.012 13) · primary-fg oklch(98% 0.005 13)
secondary oklch(96% 0.005 13) · muted oklch(97% 0.005 13) · muted-foreground oklch(46% 0.013 13)
accent oklch(96% 0.005 13) · border oklch(91% 0.008 13) · input oklch(91% 0.008 13)
ring oklch(18% 0.01 13) · muted-icon oklch(82% 0.008 13) · overlay oklch(20% 0.01 13)
logo oklch(71.2% 0.194 13.428)
success oklch(68% 0.15 155) / success-text oklch(37% 0.1 155)
warning oklch(76% 0.14 78) / warning-text oklch(42% 0.09 78)
info oklch(66% 0.13 235) / info-text oklch(38% 0.09 235)

## Geometry
--radius .5rem (radius-lg 8px, md 6px, sm 4px)
--shell-top-band 4rem mobile / 3.4375rem (55px) at md
sidebar: default 275px, min 220, max 520; card = my-2 ml-2, h calc(100%-16px), radius 16px, 1px border
content outlet: my-2 mr-2, radius 16px, 1px border
transcript rows: mx-auto max-w-[800px], default gap pt-4; navbar offset 72px
composer: max-w-[840px], input row radius 12px (rounded-xl), pr-1.5, dark bg card/90
send + attach buttons 44x44 rounded-full; preference pills min-h 36px radius 6px

## Type
body: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial (repo ships a "Body" woff2)
logo: "Bricolage Grotesque", weight 800 · mono: "Roboto Mono"
steps: 9 .5625rem · 10 .625 · 11 .6875 · 12 .75 · 13 .8125 · 15 .9375 · 16 1 · 18 1.125 · 20 1.25 · 22 1.375

## Existing motion in the repo (baseline to beat)
- fade-in 250ms ease-out; shiny-pulse 1.6s ease-in-out infinite (opacity .55→1)
- empty-state flower: 0.42s cubic-bezier(.22,1,.36,1) — opacity+blur(12px)+scale(.1)
- empty-state text: blur(4px)→0 over .38s; typewriter cursor blink .9s step-end
- terminal / right-sidebar panels: opacity+translate 280ms cubic-bezier(.22,1,.36,1)
- scroll-to-bottom button: scale .75→1 + opacity, 200ms cubic-bezier(.22,1,.36,1)
- bootstrap sweep: translateX(-100%)→400%, 1.4s
- prefers-reduced-motion: all animation/transition durations forced to 0.01ms
- empty state copy: "What are we building?" typed at 19ms/char; composer placeholder "Build something..."

## Status vocabulary
statusLabel: idle→Idle, starting→Starting, running→Running, waiting_for_user→Waiting, failed→Failed
tone: running=active (text-foreground), waiting=attention (warning-text), failed=destructive, else muted
sidebar dot: running/starting=warning, waiting=info, failed=destructive, unread=success
StateMark 9x13 strokes: doubled [(2.5,1)-(2.5,12),(6.5,1)-(6.5,12)]; based [(4.5,1)-(4.5,10),(1,11.5)-(8,11.5)];
struck [(4.5,1)-(4.5,12),(0.5,9.5)-(8.5,3.5)]; half [(4.5,5)-(4.5,12)] — strokeWidth 1.5
SessionMark 12x12 r=4 c=6: filled / half (ring + left half) / ring / dashed(2 2), strokeWidth 1.25
