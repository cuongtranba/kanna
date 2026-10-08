import math
import os
import sys

OUT = sys.argv[1]

SANS = "'Body', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
MONO = "'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"

THEMES = {
    "light": dict(paper="#fffdfd", ink="#110c0c", ink_rgb=(17, 12, 12), muted="#5f5556", muted_rgb=(95, 85, 86),
                  soft="#7b7272", accent="#ff637e", accent_rgb=(255, 99, 126), accent_text="#c73756",
                  accent_tint="rgba(255,99,126,0.08)", link="#006c9d", backend="#ffffff"),
    "dark": dict(paper="#1a1415", ink="#faf8f8", ink_rgb=(250, 248, 248), muted="#aca2a2", muted_rgb=(172, 162, 162),
                 soft="#867e7e", accent="#ff637e", accent_rgb=(255, 99, 126), accent_text="#ff8096",
                 accent_tint="rgba(255,99,126,0.12)", link="#4cb0e5", backend="#211b1c"),
}


def rgba(rgb, a):
    return "rgba(%d,%d,%d,%s)" % (rgb[0], rgb[1], rgb[2], a)


def r4(v):
    return int(math.ceil(v / 4.0) * 4)


def mono_w(text, size=8, track=0.06):
    return len(text) * size * (0.62 + track)


class Svg:
    def __init__(self, t):
        self.t = t
        self.zones = []
        self.arrows = []
        self.labels = []
        self.nodes = []
        self.extra = []

    def zone(self, x, y, w, h, label):
        t = self.t
        lw = r4(mono_w(label, 7, 0.14) + 12)
        self.zones.append(
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{rgba(t["ink_rgb"], 0.02)}" stroke="{rgba(t["ink_rgb"], 0.12)}" stroke-width="0.8"/>'
            f'<rect x="{x + 12}" y="{y + 4}" width="{lw}" height="12" rx="2" fill="{t["paper"]}"/>'
            f'<text x="{x + 12 + lw / 2}" y="{y + 13}" fill="{t["soft"]}" font-size="7" font-family="{MONO}" text-anchor="middle" letter-spacing="0.14em">{label}</text>')

    def arrow(self, d, kind="muted", dashed=False):
        t = self.t
        color = {"muted": t["muted"], "accent": t["accent"], "link": t["link"], "soft": t["soft"]}[kind]
        marker = {"muted": "arrow", "accent": "arrow-accent", "link": "arrow-link", "soft": "arrow-soft"}[kind]
        width = "1.4" if kind == "accent" else ("1" if dashed else "1.2")
        dash = ' stroke-dasharray="4,3"' if dashed else ""
        self.arrows.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}"{dash} marker-end="url(#{marker})"/>')

    def label(self, cx, y, text, kind="muted"):
        t = self.t
        color = {"muted": t["muted"], "accent": t["accent_text"], "link": t["link"], "soft": t["soft"]}[kind]
        w = r4(mono_w(text) + 8)
        self.labels.append(
            f'<rect x="{cx - w / 2}" y="{y}" width="{w}" height="12" rx="2" fill="{t["paper"]}"/>'
            f'<text x="{cx}" y="{y + 9}" fill="{color}" font-size="8" font-family="{MONO}" text-anchor="middle" letter-spacing="0.06em">{text}</text>')

    def kind_style(self, kind):
        t = self.t
        return {
            "focal": (t["accent_tint"], t["accent"], rgba(t["accent_rgb"], 0.5), t["accent_text"]),
            "backend": (t["backend"], t["ink"], rgba(t["ink_rgb"], 0.4), t["ink"]),
            "store": (rgba(t["ink_rgb"], 0.05), t["muted"], rgba(t["muted_rgb"], 0.5), t["muted"]),
            "external": (rgba(t["ink_rgb"], 0.03), rgba(t["ink_rgb"], 0.3), rgba(t["ink_rgb"], 0.22), t["soft"]),
            "input": (rgba(t["muted_rgb"], 0.1), t["soft"], rgba(t["muted_rgb"], 0.4), t["soft"]),
        }[kind]

    def node(self, x, y, w, h, kind, tag, name, sub):
        t = self.t
        fill, stroke, tag_stroke, tag_text = self.kind_style(kind)
        tw = r4(mono_w(tag, 7, 0.08) + 10)
        cx = x + w / 2
        ny, sy = (y + 38, y + 54) if h >= 64 else (y + 33, y + 47)
        self.nodes.append(
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{t["paper"]}"/>'
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{fill}" stroke="{stroke}" stroke-width="1"/>'
            f'<rect x="{x + 8}" y="{y + 8}" width="{tw}" height="12" rx="2" fill="none" stroke="{tag_stroke}" stroke-width="0.8"/>'
            f'<text x="{x + 8 + tw / 2}" y="{y + 17}" fill="{tag_text}" font-size="7" font-family="{MONO}" text-anchor="middle" letter-spacing="0.08em">{tag}</text>'
            f'<text x="{cx}" y="{ny}" fill="{t["ink"]}" font-size="12" font-weight="600" font-family="{SANS}" text-anchor="middle">{name}</text>'
            f'<text x="{cx}" y="{sy}" fill="{t["muted"]}" font-size="9" font-family="{MONO}" text-anchor="middle">{sub}</text>')

    def legend(self, y, width, items):
        t = self.t
        out = [f'<line x1="40" y1="{y}" x2="{width - 40}" y2="{y}" stroke="{rgba(t["ink_rgb"], 0.10)}" stroke-width="0.8"/>',
               f'<text x="40" y="{y + 16}" fill="{t["muted"]}" font-size="8" font-family="{MONO}" letter-spacing="0.18em">LEGEND</text>']
        x = 40
        iy = y + 32
        for item in items:
            if item[0] == "box":
                if item[1] == "hub":
                    fill, stroke = t["ink"], t["ink"]
                else:
                    fill, stroke, _, _ = self.kind_style(item[1])
                out.append(f'<rect x="{x}" y="{iy}" width="14" height="10" rx="2" fill="{fill}" stroke="{stroke}" stroke-width="1"/>')
                tx = x + 20
            else:
                kind, dashed = item[1], item[3] if len(item) > 3 else False
                color = {"muted": t["muted"], "accent": t["accent"], "link": t["link"], "soft": t["soft"]}[kind]
                marker = {"muted": "arrow", "accent": "arrow-accent", "link": "arrow-link", "soft": "arrow-soft"}[kind]
                dash = ' stroke-dasharray="4,3"' if dashed else ""
                out.append(f'<line x1="{x}" y1="{iy + 5}" x2="{x + 28}" y2="{iy + 5}" stroke="{color}" stroke-width="1.2"{dash} marker-end="url(#{marker})"/>')
                tx = x + 36
            out.append(f'<text x="{tx}" y="{iy + 8}" fill="{t["muted"]}" font-size="8.5" font-family="{SANS}">{item[2]}</text>')
            x = r4(tx + len(item[2]) * 8.5 * 0.56 + 28)
        self.extra.append("".join(out))

    def body(self):
        return "\n".join(self.zones + self.arrows + self.labels + self.nodes + self.extra)


def defs(t):
    m = lambda i, c: f'<marker id="{i}" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="{c}"/></marker>'
    return "<defs>" + m("arrow", t["muted"]) + m("arrow-accent", t["accent"]) + m("arrow-link", t["link"]) + m("arrow-soft", t["soft"]) + "</defs>"


def page(slug, mode, eyebrow, title, desc, w, h, body):
    t = THEMES[mode]
    sid = slug if mode == "light" else slug + "-dark"
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
  <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,800&family=Roboto+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: {SANS};
      background: {t["paper"]};
      color: {t["ink"]};
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 3rem 2rem;
    }}
    .frame {{ max-width: {w + 40}px; width: 100%; }}
    .diagram-container {{ width: 100%; overflow-x: auto; }}
    .eyebrow {{
      font-family: {MONO};
      font-size: 0.66rem;
      font-weight: 500;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: {t["muted"]};
      margin-bottom: 0.5rem;
    }}
    h1 {{
      font-family: 'Bricolage Grotesque', {SANS};
      font-size: clamp(1.5rem, 2.4vw + 0.75rem, 2rem);
      font-weight: 800;
      letter-spacing: -0.02em;
      line-height: 1.15;
      color: {t["ink"]};
      margin-bottom: 1.5rem;
    }}
    svg {{ width: 100%; min-width: {w}px; display: block; }}
    @media print {{
      .diagram-container {{ overflow-x: visible; }}
      svg {{ min-width: 0; }}
    }}
  </style>
</head>
<body>
  <div class="frame">
    <p class="eyebrow">{eyebrow}</p>
    <h1>{title}</h1>
    <div class="diagram-container">
      <svg viewBox="0 0 {w} {h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="{sid}-title {sid}-desc">
        <title id="{sid}-title">{title}</title>
        <desc id="{sid}-desc">{desc}</desc>
        {defs(t)}
        <rect width="100%" height="100%" rx="8" fill="{t["paper"]}"/>
{body}
      </svg>
    </div>
  </div>
</body>
</html>
"""


def architecture(s):
    s.zone(272, 168, 416, 280, "KANNA SERVER · BUN")
    s.zone(712, 120, 216, 248, "AGENT RUNTIMES")
    s.arrow("M192,220 H296", "link")
    s.arrow("M296,244 H192", "muted", dashed=True)
    s.arrow("M384,264 V360")
    s.arrow("M472,220 H584 Q592,220 592,212 V192 Q592,184 600,184 H736")
    s.arrow("M472,244 H608 Q616,244 616,252 V304 Q616,312 624,312 H736")
    s.arrow("M736,204 H648 Q640,204 640,212 V304 a8,8 0 0,0 0,16 V360", "muted", dashed=True)
    s.arrow("M912,172 H968 Q976,172 976,164 V144 Q976,136 984,136 H1040")
    s.arrow("M912,196 H992 Q1000,196 1000,204 V260 Q1000,268 1008,268 H1040")
    s.arrow("M912,312 H1008 Q1016,312 1016,304 V300 Q1016,292 1024,292 H1040")
    s.label(232, 200, "COMMANDS", "link")
    s.label(232, 250, "LIVE STATE")
    s.label(412, 306, "APPEND")
    s.label(668, 164, "TURN")
    s.label(602, 336, "KANNA MCP")
    s.label(974, 224, "TOOLS")
    s.label(1012, 116, "MCP")
    s.node(40, 200, 152, 64, "input", "UI", "Kanna web app", "browser · PWA")
    s.node(296, 200, 176, 64, "focal", "CORE", "Agent coordinator", "turns · queue · approvals")
    s.node(296, 360, 176, 64, "store", "LOG", "Event store", "~/.kanna/data · JSONL")
    s.node(504, 360, 160, 64, "backend", "MCP", "Kanna tools", "subagents · cron · tasks")
    s.node(736, 152, 176, 64, "external", "SDK", "Claude Agent SDK", "Claude · OpenRouter")
    s.node(736, 280, 176, 64, "external", "RPC", "Codex app-server", "JSON-RPC")
    s.node(1040, 104, 200, 64, "external", "EXT", "Your MCP servers", "stdio · http · sse · ws")
    s.node(1040, 248, 200, 64, "store", "GIT", "Project worktree", "one branch per chat")
    s.legend(472, 1280, [("box", "focal", "Focal"), ("box", "backend", "Kanna service"), ("box", "store", "Data"),
                          ("box", "external", "External runtime"), ("box", "input", "You"),
                          ("line", "link", "WebSocket"), ("line", "muted", "Call"), ("line", "muted", "Return / tool call", True)])


def turn_queue(s):
    s.arrow("M240,92 H336 Q344,92 344,100 V188 Q344,196 352,196 H400")
    s.arrow("M240,164 H312 Q320,164 320,172 V208 Q320,216 328,216 H400")
    s.arrow("M240,236 H400")
    s.arrow("M240,308 H312 Q320,308 320,300 V264 Q320,256 328,256 H400")
    s.arrow("M240,380 H336 Q344,380 344,372 V284 Q344,276 352,276 H400")
    s.arrow("M640,236 H720", "accent")
    s.arrow("M904,236 H1024")
    s.arrow("M812,268 V324 Q812,332 804,332 H528 Q520,332 520,324 V296", "muted", dashed=True)
    s.label(680, 216, "WHEN IDLE", "accent")
    s.label(964, 216, "ENTRIES")
    s.label(666, 338, "CHAT BUSY")
    sources = [("CRON", "/cron job", "inline or spawn"), ("LOOP", "Loop wake", "worker finished"),
               ("USER", "You", "type · queue · steer"), ("AGENT", "Background subagent", "reports back"),
               ("BOARD", "Board card", "Start work")]
    for i, (tag, name, sub) in enumerate(sources):
        s.node(40, 64 + 72 * i, 200, 56, "input", tag, name, sub)
    s.node(400, 176, 240, 120, "focal", "QUEUE", "Chat queue", "durable · survives restart")
    t = s.t
    for i, text in enumerate(["wake", "cron", "you"]):
        x = 416 + i * 72
        s.nodes.append(f'<rect x="{x}" y="252" width="64" height="24" rx="2" fill="{t["paper"]}" stroke="{rgba(t["accent_rgb"], 0.5)}" stroke-width="0.8"/>'
                       f'<text x="{x + 32}" y="267" fill="{t["accent_text"]}" font-size="8" font-family="{MONO}" text-anchor="middle" letter-spacing="0.06em">{text}</text>')
    s.node(720, 204, 184, 64, "backend", "TURN", "Turn runner", "one live turn per chat")
    s.node(1024, 204, 216, 64, "store", "LOG", "Transcript", "saved · streamed live")
    s.legend(432, 1280, [("box", "input", "Trigger"), ("box", "focal", "Queue"), ("box", "backend", "Runner"),
                          ("box", "store", "Record"), ("line", "accent", "Dequeue"),
                          ("line", "muted", "Wait while busy", True)])


def board_card(s):
    t = s.t
    s.arrow("M62,136 H96")
    s.arrow("M288,136 H384", "accent")
    s.arrow("M576,136 H672")
    s.arrow("M864,136 H960")
    s.arrow("M480,168 V232", "muted", dashed=True)
    s.arrow("M1056,168 V232", "muted", dashed=True)
    s.label(336, 116, "START WORK", "accent")
    s.label(336, 142, "KANNA", "soft")
    s.label(624, 116, "CARD_MOVE")
    s.label(624, 142, "AGENT", "soft")
    s.label(912, 116, "DRAG")
    s.label(912, 142, "YOU", "soft")
    s.label(516, 194, "CREATES")
    s.label(1096, 194, "ASKS")
    s.nodes.append(f'<circle cx="56" cy="136" r="6" fill="{t["ink"]}"/>')
    s.node(96, 104, 192, 64, "backend", "START", "To do", "start column")
    s.node(384, 104, 192, 64, "focal", "ACTIVE", "In progress", "agent works here")
    s.node(672, 104, 192, 64, "backend", "NEXT", "Next stage", "review · test · QA")
    s.node(960, 104, 192, 64, "backend", "DONE", "Done", "closes the issue")
    s.node(384, 232, 192, 64, "store", "GIT", "Worktree + chat", "one branch per card")
    s.node(960, 232, 192, 64, "input", "YOU", "Cleanup question", "merge · discard · leave")
    s.legend(328, 1280, [("box", "focal", "Agent is working"), ("box", "backend", "Column"), ("box", "store", "Isolated checkout"),
                          ("box", "input", "Your decision"), ("line", "accent", "Moved by Kanna"),
                          ("line", "muted", "Moved by agent or you"), ("line", "muted", "Side effect", True)])


def event_flow(s):
    s.zone(1040, 136, 200, 120, "IO ADAPTERS")
    s.arrow("M200,200 H280", "link")
    s.arrow("M456,200 H536")
    s.arrow("M712,200 H792", "accent")
    s.arrow("M968,200 H1056")
    s.arrow("M400,168 V128 Q400,120 408,120 H848 Q856,120 856,128 V168")
    s.arrow("M880,232 V312")
    s.arrow("M792,344 H128 Q120,344 120,336 V232", "link", dashed=True)
    s.label(240, 180, "COMMAND", "link")
    s.label(496, 180, "SEND")
    s.label(752, 180, "APPEND", "accent")
    s.label(1004, 180, "WRITE")
    s.label(628, 100, "OTHER EDITS")
    s.label(916, 266, "DERIVE")
    s.label(456, 324, "SNAPSHOTS", "link")
    s.node(40, 168, 160, 64, "input", "UI", "Kanna web app", "React · zustand")
    s.node(280, 168, 176, 64, "backend", "WS", "WebSocket router", "commands · topics")
    s.node(536, 168, 176, 64, "backend", "CORE", "Agent coordinator", "turns · queue · tools")
    s.node(792, 168, 176, 64, "focal", "LOG", "Event store", "append-only · replayed")
    s.node(1056, 168, 168, 64, "store", "DISK", "~/.kanna/data", "JSONL + snapshot")
    s.node(792, 312, 176, 64, "backend", "VIEW", "Read models", "derived snapshots")
    s.legend(408, 1280, [("box", "focal", "Source of truth"), ("box", "backend", "Server module"), ("box", "store", "Disk"),
                          ("box", "input", "Client"), ("line", "accent", "Append event"), ("line", "link", "WebSocket"),
                          ("line", "muted", "Internal call")])


def loop(s):
    t = s.t
    N, R = 6, 230
    sw, sh, hw, hh = 176, 64, 184, 88
    cx, cy = 480, 310
    stations = [("Wake", "fresh context", None), ("Read the plan", "task_list", None),
                ("Run the oracle", "exit 0 → goal met", "focal"), ("Pick a task", "pending → in progress", "CLAIM"),
                ("Delegate", "background worker", None), ("Worker settles", "status + notes", "SETTLE")]
    centers = []
    for k in range(N):
        th = math.radians(-90 + k * 360 / N)
        centers.append((cx + R * math.cos(th), cy + R * math.sin(th)))
    boxes = []
    for (px, py) in centers:
        x = round((px - sw / 2) / 4) * 4
        y = round((py - sh / 2) / 4) * 4
        boxes.append((x, y))

    def ang(px, py):
        return math.atan2(py - cy, px - cx)

    def intersections(x, y):
        pts = []
        for xe in (x, x + sw):
            d = R * R - (xe - cx) ** 2
            if d >= 0:
                for sgn in (1, -1):
                    yy = cy + sgn * math.sqrt(d)
                    if y <= yy <= y + sh:
                        pts.append((xe, yy))
        for ye in (y, y + sh):
            d = R * R - (ye - cy) ** 2
            if d >= 0:
                for sgn in (1, -1):
                    xx = cx + sgn * math.sqrt(d)
                    if x <= xx <= x + sw:
                        pts.append((xx, ye))
        return pts

    def norm(a, ref):
        while a < ref - math.pi:
            a += 2 * math.pi
        while a > ref + math.pi:
            a -= 2 * math.pi
        return a

    exits, entries = [], []
    for k in range(N):
        x, y = boxes[k]
        th = math.radians(-90 + k * 360 / N)
        pts = intersections(x, y)
        after = [p for p in pts if norm(ang(*p), th) > th]
        before = [p for p in pts if norm(ang(*p), th) < th]
        exits.append(min(after, key=lambda p: norm(ang(*p), th)))
        entries.append(max(before, key=lambda p: norm(ang(*p), th)))
    for k in range(N):
        j = (k + 1) % N
        ex = exits[k]
        en = entries[j]
        phi = ang(*en) - 1.2 / R
        q = (cx + R * math.cos(phi), cy + R * math.sin(phi))
        s.arrow(f"M{ex[0]:.3f},{ex[1]:.3f} A{R},{R} 0 0 1 {q[0]:.3f},{q[1]:.3f}")

    def box_distance(ux, uy, a, b):
        c = []
        if abs(ux) > 1e-9:
            c.append(a / abs(ux))
        if abs(uy) > 1e-9:
            c.append(b / abs(uy))
        return min(c)

    for k, (_, _, extra) in enumerate(stations):
        if extra in (None, "focal"):
            continue
        x, y = boxes[k]
        px, py = x + sw / 2, y + sh / 2
        dx, dy = cx - px, cy - py
        L = math.hypot(dx, dy)
        ux, uy = -dx / L, -dy / L
        start = (px - box_distance(ux, uy, sw / 2, sh / 2) * ux, py - box_distance(ux, uy, sw / 2, sh / 2) * uy)
        dh = box_distance(ux, uy, hw / 2, hh / 2) + 6
        end = (cx + dh * ux, cy + dh * uy)
        s.arrows.append(f'<path d="M{start[0]:.3f},{start[1]:.3f} L{end[0]:.3f},{end[1]:.3f}" fill="none" stroke="{t["soft"]}" stroke-width="1" stroke-dasharray="5,4" marker-end="url(#arrow-soft)"/>')
        mx, my = (start[0] + end[0]) / 2, (start[1] + end[1]) / 2
        w = r4(mono_w(extra) + 8)
        side = 1 if ux < 0 else -1
        lx = mx + side * (w / 2 + 10)
        s.label(round(lx), round(my - 6), extra, "soft")
    for k, (name, sub, extra) in enumerate(stations):
        x, y = boxes[k]
        kind = "focal" if extra == "focal" else "backend"
        tag = "%02d" % (k + 1)
        s.node(x, y, sw, sh, kind, tag, name, sub)
    hx, hy = cx - hw / 2, cy - hh / 2
    s.nodes.append(
        f'<rect x="{hx}" y="{hy}" width="{hw}" height="{hh}" rx="8" fill="{t["ink"]}" stroke="{t["ink"]}" stroke-width="1"/>'
        f'<text x="{cx}" y="{cy - 14}" fill="{t["paper"]}" font-size="7" font-family="{MONO}" text-anchor="middle" letter-spacing="0.14em" opacity="0.7">THE PLAN</text>'
        f'<text x="{cx}" y="{cy + 6}" fill="{t["paper"]}" font-size="14" font-weight="600" font-family="{SANS}" text-anchor="middle">Chat task list</text>'
        f'<text x="{cx}" y="{cy + 24}" fill="{t["paper"]}" font-size="9" font-family="{MONO}" text-anchor="middle" opacity="0.8">survives /clear · restart</text>')
    s.legend(612, 960, [("box", "backend", "Step"), ("box", "focal", "Exit check"), ("box", "hub", "Durable state"),
                         ("line", "muted", "Next step"), ("line", "soft", "Writes to the plan", True)])


DIAGRAMS = [
    ("kanna-architecture", "Architecture · Kanna", "How Kanna fits together",
     "Architecture diagram: the Kanna web app talks to a Bun server over WebSocket; its agent coordinator records every event, runs turns on the Claude Agent SDK or the Codex app-server, and those agents edit your project worktree and call your MCP servers and Kanna's own tools.",
     1280, 536, architecture),
    ("kanna-turn-queue", "Data flow · Kanna", "Every trigger is a message to a chat",
     "Fan-in diagram: a typed message, a cron job, a loop wake, a background subagent and a board card all enter one durable per-chat queue, which starts a turn only when the chat is idle and writes its output to the transcript.",
     1280, 496, turn_queue),
    ("kanna-board-card", "State machine · Kanna boards", "One card, one worktree, one chat",
     "State diagram of a board card: Kanna moves it to In progress on Start work and creates its worktree and chat, the agent advances it one column when the work is verified, and only you move it to Done, which asks whether to merge, discard or keep the worktree.",
     1280, 392, board_card),
    ("kanna-event-flow", "Architecture · Kanna server", "Event-sourced from command to screen",
     "Architecture diagram of the Kanna server: browser commands enter the WebSocket router, turns and edits append events to the event store, the store writes JSONL logs through IO adapters, and derived read models push snapshots back to the browser.",
     1280, 456, event_flow),
    ("kanna-loop", "Loop · Kanna", "How an autonomous loop iterates",
     "Loop diagram: each iteration wakes with a fresh context, reads the chat task list, runs the verify oracle and stops when it passes, otherwise picks a task, delegates it to a background worker, and the worker settles the task, which wakes the next iteration.",
     960, 672, loop),
]

os.makedirs(OUT, exist_ok=True)
for slug, eyebrow, title, desc, w, h, fn in DIAGRAMS:
    for mode in ("light", "dark"):
        s = Svg(THEMES[mode])
        fn(s)
        name = slug if mode == "light" else slug + "-dark"
        with open(os.path.join(OUT, name + ".html"), "w") as f:
            f.write(page(slug, mode, eyebrow, title, desc, w, h, s.body()))
        print("wrote", name)
