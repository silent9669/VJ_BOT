# VJBot — Manga Club local trial

Selected direction: **B · Manga Club**, retained as a local trial while the implementation is reviewed in a PR.
Original direction canvas is retained locally in `designs/vjbot-cultural-modern/`; it is not required to run the app.

## Contract and boundary

- A working visual layer on the current vanilla app, not a replacement backend or mock login.
- Keep canonical lesson links, account ownership, AI selection, progress writes, recovery states and keyboard navigation unchanged.
- The next lesson stays the primary dashboard action. Lessons and tutor replies remain quiet, readable surfaces.
- Enable only on exact loopback hosts (`localhost`, `127.0.0.1`, `[::1]`); a local switch restores the existing UI without deleting data. Never infer locality from a hostname substring.
- Publish only a feature-branch PR. No merge, auto-merge, deployment, production migrations or live AI calls as part of this trial.

## Visual language

- Paper `#F7F7F2`, white panels, ink `#181818`, yellow `#F7E34E` for selection and primary emphasis. Muted text `#50504C`. Preserve separate error/success semantics.
- Barlow Condensed 700/800 for short display headings; Be Vietnam Pro for controls and Vietnamese body; Noto Sans JP for Japanese. System fallbacks remain usable offline.
- Comic-panel borders (2–3px), restrained 3–6px hard shadows, square/small-radius controls. No glass, gradient washes or continuous mascot animation in the theme.
- Operator-supplied `knks.jpg` fills the dashboard image panel at its native 4:3 ratio, in original colors, without cropping people. Keep existing project teacher assets; do not use third-party anime characters.
- Layout: horizontal navigation at wide desktop, existing accessible drawer/rail at smaller widths; single-column reading and phone flow. All actions stay reachable.
- Neutral UI/background separation and 8px spacing rhythm take inspiration from the supplied Figma reference; body controls stay 16px-class and labels 12px. These are generic layout principles, not a reproduction of branded UI. The selected Manga canvas governs palette, geometry and typography.
- Craft details: ink-panel imagery, display typography, chapter indexes, yellow text selection, visible focus outlines, crisp press feedback. Reduced-motion removes movement.

## Implementation

- `static/local-ui.js`: loopback-gated theme initialization, persistent local comparison switch and supplementary desktop navigation. No API calls or credential changes.
- `static/manga.css`: theme-scoped visual overrides; preserve the old styles for comparison.
- `static/assets/knks.jpg`: operator-supplied dashboard photo.
- Desktop navigation includes Kanji and mirrors the existing account control's admin visibility; it does not grant privileges.
- `static/workspace.js` and `static/app.js`: remember the latest successfully opened canonical lesson per account/level; titles and links come from the current catalog. Completed targets advance to a following unfinished lesson. Resume state is browser-local, not cross-device.
- One script include in `static/index.html`; non-loopback pages do not load trial fonts/styles or insert trial controls.

## Verification

- Test loopback gating, production no-op, saved selection, unavailable browser storage, theme switch and real route navigation behavior.
- Run the Node suite without weakening checksum tests. Pin OpenJLPT JSON to LF in `.gitattributes` so Windows checkout conversion cannot invalidate upstream hashes.
- Use real local Worker + local D1. Exercise registration, dashboard, lesson opening, flashcards, tutor's missing-AI state and switch-back.
- Inspect 390, 768, 1024 and 1440px, keyboard drawer navigation, overflow, images, console and reduced motion.
- Do not claim live AI, Google OAuth or speech works without a separately authorized live test.
