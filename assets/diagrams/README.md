# Diagrams

The SVGs here are used by the README (`<picture>` light/dark pairs) and copied to
`wiki/public/diagrams/` for the wiki's `Diagram` component.

They were drawn with the `diagram-design` skill in Kanna's own skin (tokens from
`DESIGN.md`). `src/*.html` is the source of truth; never hand-edit an `.svg`.

To change one:

1. Edit its function in `src/generate.py` (one geometry drives both the light and
   the dark variant), then regenerate the HTML: `python3 src/generate.py src`.
2. Export each changed file with the skill's helper:
   `python3 <diagram-design>/scripts/export_svg.py src/<name>.html <name>.svg`,
   and swap the injected Google Fonts `@import` for Roboto Mono, the only web font
   the diagrams use.
3. Copy the SVGs to `wiki/public/diagrams/`.
