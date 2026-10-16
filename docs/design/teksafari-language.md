# teKsafari design language, read for open-toolbar

Reference for the cosmetic stage (D-174). Sources: the private repository `teksafari/teksafari.org` at its default branch on 2026-10-16 (`src/app/globals.css`, `src/lib/fonts.ts`, `src/components/ui/*`, `src/components/navbar-client.tsx`, `src/components/footer.tsx`, `src/components/iso/iso.css`, and its own `doc/design-system.md`), plus the live site https://www.teksafari.org rendered in Playwright 1.63.0 Chromium on a private Xvfb display at 1440 x 900 and 390 x 844. Computed styles below come from that render, so they are what a browser shows, not what a class name suggests.

The site is a Next.js 16 app with Tailwind 4 (`@theme inline` tokens), `class-variance-authority` for variants, `lucide-react` icons, `motion` for fades and `sonner` for toasts. It needs Sanity credentials to build, so it was rendered from production instead of locally.

Screenshots: `docs/design/ref/` (PNG, palette-reduced, about 0.5 MB in all). Page shots at 1440 are scaled to 50 percent; 390 shots and component crops are 1:1.

| File | Shows |
|---|---|
| `home-1440.png`, `home-390.png` | Hero over a photograph, white capsule primary, glass secondary |
| `solutions-1440.png`, `solutions-390.png`, `solution-card.png` | Card grid, 28 px card, isometric line art |
| `blog-1440.png`, `blog-390.png`, `blog-card.png`, `filters-chips.png` | Index cards, capsule filter chips |
| `contact-1440.png`, `contact-390.png`, `form-focus.png`, `form-submit.png` | Card with header rule, 48 px fields, 3 px focus ring, capsule submit |
| `about-1440.png`, `solution-detail-1440.png` | Stat row (Nunito numbers, mono labels), detail page |
| `nav-hero.png`, `nav-dropdown.png`, `hero-actions.png`, `footer.png` | Nav on dark and on glass, dropdown, footer columns |

## 1. Character in one paragraph

Calm, precise, monochrome. The site borrows Vercel Geist and Linear: a near-white canvas, white cards with a 1 px cool-grey edge and no shadow, black as the only action colour, and type doing the hierarchy. Three families carry three roles: a rounded humanist display face (Nunito) for titles, Inter for everything you read or click, and Geist Mono uppercase for eyebrows and metadata. Colour appears in photographs and nowhere else. The brand voice lives in the rounded Nunito and in the lowercase-with-capital-K wordmark, so open-toolbar can take the structure without taking the identity.

## 2. Colour

### Light (the only theme the site ships)

Values from `globals.css`; the live `:root` matched on every page. The greys are Tailwind's `gray` scale (cool, a little blue).

| Token | Value | Role | Contrast |
|---|---|---|---|
| `background` | `#fafafa` | Page canvas, nav glass base (`background/80` + `backdrop-blur-md`) | |
| `card` | `#ffffff` | Cards, fields, dropdowns, toasts | |
| `secondary`, `muted` | `#f3f4f6` | Hover wash on quiet controls, sunken fills, illustration face | |
| `foreground` | `#111827` | Headings, labels, active nav, field text | 17.0:1 on canvas |
| `body` | `#374151` | Long-form paragraph colour (`p` default) | 9.9:1 |
| `muted-foreground` | `#6b7280` | Ledes, metadata, inactive nav, placeholders, eyebrows | 4.6:1 on canvas, 4.8:1 on white, 4.4:1 on `#f3f4f6` (fails AA there) |
| `edge` | `#e5e7eb` | Card borders, section rules, footer top rule, grid lines | 1.2:1 (decorative) |
| `border` | `#d1d5db` | Interactive control borders (fields, secondary button) | 1.5:1 |
| `input` | `#e5e7eb` | Declared, little used; fields use `border` | |
| `primary` | `#000000` | Primary buttons, links, focus ring, the one accent | 21:1 with white |
| `primary-hover` | `#1a1a1a` | Primary hover (lightens, black cannot darken) | |
| `primary-active` | `#333333` | Primary pressed, with a 1 px downward nudge | |
| `primary-foreground` | `#ffffff` | Text on primary | |
| `accent`, `link`, `ring` | `#000000` | Blockquote rule, links, focus ring base | |
| `destructive` | `#ef4444` | Errors | 3.8:1 on white: fails AA for text |

Hover on a secondary control raises its border to `muted-foreground / 35%`. Nav dropdown on glass: `white/90` + `backdrop-blur-md`, border `border/40`. On the photographic hero the nav text is `white/70`, active `white`, and the dropdown flips to `black/90`.

There are no success, warning or info tokens. The only coloured semantics in the codebase are in the isometric kit (`iso.css`), which uses Radix-like steps: light `#e5484d` red, `#30a46c` green, `#3e63dd` blue; dark `#ff6b6b`, `#6be0a0`, `#6b9bff`.

### Dark

teksafari.org has no dark mode. `prefers-color-scheme: dark` renders pixel-identical pages (checked at 1440 on home and contact), `themeColor` is `#ffffff` and the toaster is pinned to `theme="light"`. The one dark palette in the repository is the isometric kit's default (Linear-style neutral blacks):

| iso variable | Value | Read as |
|---|---|---|
| `--anatomy-page` | `#0b0b0b` | page |
| `--anatomy-card` / `paper` | `#131313` | surface |
| `--anatomy-face` | `#1b1b1b` | raised surface |
| `--anatomy-lit-top` | `#262626` | border |
| `--anatomy-lo` | `#3e3e3e` | strong border |
| `--anatomy-muted` / `mid` | `#6e6e6e` / `#6a6a6a` | faint text (3.6:1, decoration only) |
| `--anatomy-text` | `#a3a3a3` | body text (7.8:1) |
| `--anatomy-strong` | `#e6e6e6` | headings (14.9:1) |
| `--anatomy-lit` | `#ffffff` | the accent |

open-toolbar needs dark (its token file already ships one), so section 11 derives it from these values and the light rules.

## 3. Typography

| Role | Family | Live weights | Use |
|---|---|---|---|
| Brand | Nunito (variable 200 to 1000) | 400 hero, 500 titles and card headings, 700 editorial article titles | Page titles, every `h2`, card titles, big numbers |
| Interface | Inter (variable 100 to 900) | 400 body, 500 labels, buttons, active nav; 600 author names | Body, nav, forms, buttons, card text |
| Utility | Geist Mono (variable 100 to 900) | 400 | Eyebrows, footer column labels, stat labels, dates, code, `// 404` |

Measured sizes (computed style):

| Element | Size / line height | Weight | Tracking |
|---|---|---|---|
| Home hero `h1` | 46 / 46 px | 400 | -1.15 px (-0.025em, `tracking-tight`) |
| 404 `h1` | 60 / 60 | 400 | -1.5 px |
| Page title `h1` | 36 / 40 (30 on mobile) | 500 | -0.9 px |
| Section `h2` | 36 / 40 | 400 | -0.9 px |
| About `h2` | 32 / 42.7 | 500 | -0.8 px |
| Card / form-card `h2` | 18 / 28 | 500 | -0.45 px |
| Solution card title | 20 to 24 | 500 | |
| Blog card title (Inter) | 18 to 20 / 1.4 | 400 | |
| Lede | 16 / 26 (1.625) | 400 | normal, `muted-foreground` |
| Hero lede | 16 / 24 | 400 | -0.4 px |
| Body small, list items | 14 / 22.75 | 400 | |
| Nav links | 14 / 20 | 400, 500 active | -0.7 px (`tracking-tighter`, -0.05em) |
| Button | 14 (12 at `sm`) | 500 | -0.01em |
| Form label | 14 / 20 | 500 | |
| Field text | 16 / 24 (iOS zoom guard `max(16px, 1em)`) | 400 | |
| Footer column label | 13 / 19.5, uppercase | 400 mono | 1.56 px (0.12em) |
| Eyebrow, stat label | 12 / 16, uppercase | 400 mono | 1.2 px (0.1em, `tracking-widest`) |

Base: `html` 16 px, line height 1.6; `body` 1.625, `font-synthesis-weight: none`, `text-rendering: optimizeLegibility`, `antialiased`. Headings take `text-balance`, ledes `text-pretty`; long-form measure 60 to 75 characters.

### Font files and licences

The site loads all three through `next/font/google`, which downloads them at build time and self-hosts them under `/_next/static/media` (no runtime Google call). Live `document.fonts`: `Nunito 200 1000`, `Inter 100 900`, `Geist Mono 100 900`, each variable, latin subset; Nunito and Inter also in italic.

| Family | Licence | Self-host source for open-toolbar | Notes |
|---|---|---|---|
| Inter | SIL OFL 1.1 | `@fontsource-variable/inter` 5.3.0 (npm licence `OFL-1.1`) | Bundling and modifying allowed; keep the licence text with the files; do not sell the font on its own. |
| Nunito | SIL OFL 1.1 | `@fontsource-variable/nunito` 5.3.0 (`OFL-1.1`) | Same terms. |
| Geist Mono | SIL OFL 1.1 | `@fontsource-variable/geist-mono` 5.3.0 (`OFL-1.1`), or Vercel's `geist` 1.7.2 | Same terms. Reserved Font Name: a modified build must not be called "Geist". |

All three are compatible with open-toolbar's MIT licence when the OFL text ships beside the `.woff2` files (for example `packages/ui/fonts/OFL-*.txt`). Use the latin subset of the variable `wght` axis only; the fontsource 5.3.0 `*-latin-wght-normal.woff2` files are 48 KB (Inter), 39 KB (Nunito) and 23 KB (Geist Mono), small enough for the extension zip. Load them from the extension's own `web_accessible_resources` and from the server's static files; never from `fonts.googleapis.com`.

## 4. Spacing, layout and grid

- Spacing is Tailwind's 4 px scale. Live use clusters on 4, 8, 12, 16, 20, 24, 32, 40, 48 px (`gap-2`, `p-4`, `p-5`, `gap-6`, `gap-8`); 6 and 10 appear inside controls.
- Container: `max-w-7xl` (1280 px), side padding 16 / 24 / 32 px at base / `sm` / `lg`. Vertical section padding 32 to 48 px default, up to 64 to 96 px on the home page.
- Nav: fixed, 48 px tall bar (`h-12`), content starts at `pt-20` (80 px). Links spaced 28 px (`gap-7`).
- Grids: 1 / 2 / 3 columns (`md`, `lg`), gaps 20 px for solution cards and 24 to 32 px for blog cards. Footer: 2 columns on mobile, 4 at `md`, 40 px gaps, 64 to 80 px top padding.
- Density: generous. Cards pad 20 to 28 px, fields are 48 px, buttons 40 px. This is the part open-toolbar must not copy wholesale (section 10).
- A `bg-grid` utility draws 1 px `edge` lines on a 48 px grid for technical backdrops.

## 5. Radii

| Value | Where |
|---|---|
| 6 px (`rounded-md`) | `sm` buttons, nav dropdown trigger |
| 8 px (`rounded-lg`) | Default buttons, fields, menu items, the phone-input group |
| 12 px (`rounded-xl`) | `Card` primitive, nav dropdown panel, phone country dropdown |
| 16 px (`rounded-[1rem]`) | Toasts |
| 18 to 20 px (`--radius-media` 1.25rem) | Media inside a card, the 16:10 illustration stage |
| 28 px (`rounded-[28px]`) | Blog and solution cards (outer = media 20 + 8 to 12 gutter) |
| 36 px (`--radius-card` 2.25rem) | Defined for concentric media-in-card; rare |
| full | Capsule buttons, filter chips, avatars, dots |

Rule from the site: nested curves stay concentric (outer radius = inner radius + gap), and a field (8) is one step tighter than the card holding it (12). `corner-shape: squircle` is applied where supported. Shape splits by purpose: capsules for content actions and invitations (hero, filters, back links, form submit), rounded rectangles for site chrome (nav Contact, code-block utilities, 404).

## 6. Borders and shadows

- Borders are 1 px. `edge` (`#e5e7eb`) separates quiet structure: cards, section rules, the form card's header divider, the nav bottom rule once scrolled. `border` (`#d1d5db`) outlines things you operate.
- Cards carry no shadow. Elevation comes from the white card on the `#fafafa` canvas plus the edge.
- Buttons carry a hairline lift plus an inset top highlight:
  - primary: `0 1px 2px rgba(0,0,0,.20), inset 0 1px 0 rgba(255,255,255,.16)`
  - secondary: `0 1px 2px rgba(23,23,23,.06), inset 0 1px 0 rgba(255,255,255,.8)`
  - inverted (white on dark): `0 1px 2px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.7)`
- Floating layers (toasts, phone dropdown): `0 18px 40px rgba(23,23,23,.12)`. Nav dropdown: Tailwind `shadow-xl` on glass.
- Focus: 3 px ring of `ring` at 25 percent (`0 0 0 3px color-mix(in srgb, #000 25%, transparent)`) plus the border turning `ring`. On dark surfaces, `white/40`. Footer links use a 2 px ring with a 4 px offset.
- The isometric kit's layered lift, for anything that must float in dark: `inset 0 1px 0 #ffffff0a, inset 0 0 0 1px #ffffff06, 0 0 0 1px #00000026, 0 1px 1px -.5px #00000014, 0 3px 3px -1.5px #00000014, 0 6px 6px -3px #00000014, 0 12px 12px -6px #00000014`.

## 7. Motion

| Use | Duration | Easing |
|---|---|---|
| Button colour, border, shadow, transform | 150 ms | Tailwind default `cubic-bezier(.4,0,.2,1)` |
| Nav link colour | 150 ms | default |
| Dropdown open (opacity, `scale-95` to `100`), chevron rotate, accordion `grid-template-rows` | 200 ms | default |
| Nav background on scroll | 300 ms | default |
| Dropdown close delay after pointer leaves | 150 ms timeout | |
| Section fade-in (`AnimateEnter`, opacity only, once in view) | 400 ms | `easeOut` |
| Illustration performance | under 1 s total, steps of 40 to 80 ms | iso kit `cubic-bezier(.32,.72,0,1)` |
| Carousel settle | about 460 ms | ease-in-out, ease-out after a drag |

Rules the site enforces: list the properties that transition (no `transition-all` on buttons), pressed state is `translate-y-px`, `motion-reduce` drops transitions and movement but keeps state changes, hover effects sit behind `(hover: hover)`.

## 8. Iconography

`lucide-react` outline icons, 16 px inside buttons (`[&_svg]:size-4`), 12 px for nav chevrons and the external-link arrow, stroke 2 (1.5 for a few larger custom marks). Icons in use: `ArrowRight`, `ArrowLeft`, `ArrowUpRight`, `ExternalLink`, `ChevronDown/Right/Up`, `Copy`, `Check`, `Play`. Illustrations are isometric line art in `currentColor`-driven tokens: three face tones from tokens, 1 px quiet strokes, exactly one accent element, dashed (`3 4`) meaning "not yet connected". No filled or two-tone icon sets, no gradients, no colour in icons.

## 9. Component patterns

**Buttons** (`ui/button.tsx`). Heights 32 (`sm`, 12 px text, 6 px radius), 40 (default), 44 (`lg`), icon 40 x 40. Padding 12 / 16 / 20 px; a pill widens to 16 / 20 / 24 (half its height). Gap 8 px. Variants: `primary` black, `secondary` white with `border` and lift, `ghost` transparent with `muted-foreground` text and `secondary` wash on hover, `inverted` white on dark, `inverted-secondary` `white/15` fill + `border-white/30` + `backdrop-blur-sm`, `inverted-ghost`. Disabled is 50 percent opacity with no pointer events. One primary per action group. Loading: `aria-busy`, stable min width, spinner, disabled.

**Inputs** (contact form). 48 px tall, 8 px radius, 16 px horizontal padding, white fill, `border` 1 px, 16 px text, `muted-foreground`-ish placeholder (`#9ca3af` rendered). Labels above, Inter 14 / 500, sentence case, 8 px gap. Focus: border turns black plus the 3 px ring at 25 percent (see `form-focus.png`).

**Cards.** Primitive: white, `edge` border, 12 px radius, 20 px padding, header and body separated by an `edge` rule (`contact-1440.png`). Marketing cards: 28 px radius, 12 px outer padding around a 20 px-radius media stage, text inset 16 to 32 px, no shadow, hover only strengthens the border slightly.

**Nav.** 48 px fixed bar, wordmark left (20 px high), centred 14 px links with -0.05em tracking, a black `sm` rectangular "Contact" button right. Transparent with white text over the hero; `background/80` glass with blur and an `edge` bottom rule once scrolled. Dropdown: 12 px radius panel, 6 px inner padding, items 14 px text in 8 x 12 px padding on an 8 px radius with `muted` hover. Mobile: full-screen sheet, 20 px links in 48 px rows, accordions with rotating chevrons.

**Filter chips.** Capsule `ghost` buttons 40 px tall, 20 px padding; the selected one becomes a `secondary` capsule (white, border, lift) with `aria-pressed`. Horizontal scroll with snap on mobile (`filters-chips.png`).

**Toasts** (`sonner`, unstyled + classes). Top right, 64 px from top, 16 px from the edge, up to 4 visible, 5 s. White card, `edge` border, 16 px radius, 12 x 16 px padding, `0 18px 40px rgba(23,23,23,.12)`; title Inter 14 / 500 `foreground`, description 14 / 24 `muted-foreground`.

**Accordion (FAQ).** `divide-y divide-edge`, 20 px vertical rows, 16 / 500 question, 14 px `muted-foreground` answer, chevron rotates in 200 ms.

**Footer.** `edge` top rule, mono uppercase 13 px column labels in `muted-foreground`, Nunito 16 px links in `foreground` that dim to `muted-foreground` on hover, 36 px tall link targets.

**Tables and badges.** None on the site. Section 10 proposes them from the tokens above.

**Code blocks.** Black header strip (`primary`, white semibold label), One Dark syntax theme, `inverted-ghost` copy control.

## 10. Adapting to a dense tool UI

open-toolbar is a dashboard, an in-page toolbar inside a shadow root, an extension popup 400 px wide and a viewer with dev-tools panels. The marketing site's proportions would waste half the screen there. Keep the language (neutral canvas, white surfaces, 1 px edges, black as the action, three type roles, restrained shadow, 150 to 200 ms motion); change the density.

| Aspect | Marketing site | Tool UI |
|---|---|---|
| Base text | 16 px body, 14 px small | 13 to 14 px body (current `--nb-text-base` 14), 12 px secondary, 11 px for timestamps and counters |
| Title face | Nunito 36 to 46 px | Nunito only for page titles (20 to 24 px, weight 500 to 600) and empty-state headings; Inter 13 to 14 / 600 for panel and section titles. Nunito below 16 px reads soft and loses rhythm in tables. |
| Mono | Uppercase eyebrows | Network rows, console, timings, IDs, keyboard shortcuts at 11 to 12 px, `tabular-nums`; uppercase mono 10 to 11 px with 0.08em tracking for column headers and panel eyebrows only |
| Controls | 40 / 44 px, 48 px fields | 28 px (`sm`), 32 px (default), 36 px (`lg`, forms), fields 32 to 36 px. 6 px radius on 28 to 32 px controls, 8 px above. Keep 40 px targets on touch and on the popup's main actions. |
| Capsules | Content actions, filters | Only for status pills, filter chips and segmented toggles; all chrome stays rectangular, matching the site's chrome rule |
| Cards | 28 px radius, 20 to 28 px padding | 8 to 12 px radius, 12 to 16 px padding; panels inside panels use rules, not nested cards |
| Shadows | None on cards | None on in-page surfaces; the toolbar, popovers and menus over a host page need the floating shadow (`0 18px 40px rgba(23,23,23,.12)` light, the iso layered lift in dark) because they sit on unknown backgrounds |
| Spacing | 24 to 96 px sections | 4 / 8 / 12 / 16 px; 24 px between dashboard sections |
| Motion | 400 ms fades | 120 to 150 ms for hover and press, 200 ms for menus; no entrance fades on data |

**Tables** (feedback lists, network panel). Header row: mono 11 px uppercase, `muted-foreground`, `secondary` fill or none, `edge` bottom rule. Rows 32 px in the dashboard, 22 to 24 px in dev-tools panels (current `--nb-row-dense` 22), `edge` dividers, hover `secondary`, selected row `accent-tint` with a 2 px accent bar on the left. Numbers right-aligned and tabular.

**Badges and status.** 20 px capsule, 11 to 12 px Inter 500, tinted fill at 10 to 14 percent. The site has no status colours; use AA-safe Tailwind steps that sit with its `gray` scale: danger `#dc2626` (4.8:1 on white; replace the site's `#ef4444`, which fails for text), success `#15803d` (5.0:1), warning `#b45309` (5.0:1), info `#1d4ed8` (6.7:1). Those ratios hold on white only: on their own tint the first three drop to 4.1 to 4.2:1, so text on a tint takes the `-text` step, one darker (danger `#b91c1c`, success `#166534`, warning `#92400e`, info `#1d4ed8`; 5.3 to 6.2:1 on the tint). Dark: `#f87171`, `#4ade80`, `#fbbf24`, `#60a5fa` (6.7 to 11:1 on `#131313`, 5.5:1 or more on their tints), the same values for `-text` (D-178).

**Dev-tools panels.** Console and network on `card` with `edge` splitters; log levels by a 2 px left bar and an icon; mono 12 px with 1.5 line height. Error, warning and navigation rows and failed requests also keep a quiet row tint (10 to 14 percent), because parity with Jam asks for it (`docs/parity.md` J-055, J-105). On a tinted row secondary text (timestamps, faint columns) takes `muted` instead of `faint`, and red or amber text its `-text` step, so 12 px text stays at 4.5:1 or more on the tint (D-178).

**Small popups** (extension popup, menus, the toolbar). 400 px popup: 16 px padding, 12 px radius on menus, 8 px items 28 to 32 px tall, the site's dropdown recipe (`card`, `edge` border, floating shadow, 6 px inner padding). The in-page toolbar is chrome: rectangular buttons, black primary, `inverted` and `inverted-ghost` variants when it sits on its dark bar.

**Muted text on grey.** `#6b7280` drops to 4.4:1 on `#f3f4f6`. In zebra rows, sunken panels and hover states use `#4b5563` (6.9:1) for secondary text.

## 11. Dark mode for open-toolbar

The site gives no dark rules, so these follow from its light structure and the iso kit's dark values:

| Role | Light | Dark |
|---|---|---|
| Canvas | `#fafafa` | `#0b0b0b` |
| Surface (card) | `#ffffff` | `#131313` |
| Raised / hover | `#f3f4f6` | `#1b1b1b` |
| Edge | `#e5e7eb` | `#262626` |
| Control border | `#d1d5db` | `#3e3e3e` |
| Heading text | `#111827` | `#e6e6e6` |
| Body text | `#374151` (10.3:1 on surface) | `#c2c2c2` (10.4:1 on surface; was `#a3a3a3` here, see below) |
| Muted text | `#6b7280` | `#8a8a8f` (5.7:1); `#6e6e6e` only for decoration |
| Primary (default accent) | `#000000` on `#ffffff` text | `#fafafa` with `#0b0b0b` text (inverts, as Linear and Vercel do) |
| Primary hover / active | `#1a1a1a` / `#333333` | `#e6e6e6` / `#d4d4d4` |
| Focus ring | black at 25 % | white at 40 % |

As built (D-175, D-179): `packages/ui` has four text steps, one more than this table. Light: text `#111827`, body `#374151`, muted `#4b5563`, faint `#6b7280`. Dark: text `#e6e6e6`, body `#c2c2c2`, muted `#a3a3a3`, faint `#8a8a8f`. D-175 moved muted one step darker in light so it passes AA on sunken fills, which pushed the dark steps down by one as well: `#a3a3a3` became muted, and body took `#c2c2c2`, which keeps it a step above muted and at the light body's contrast.

Rules: surfaces get lighter as they rise (canvas, surface, raised), never darker; borders do the separation that shadows cannot in dark; keep shadows only on floating layers; the neutral blacks are hue-free while the light greys are cool, which matches the site's iso kit and keeps an admin accent from clashing.

## 12. Brand overlay: accent and logo

- teKsafari's accent is black. Its only identity marks are the wordmark (with capital K) and the umbrella-acacia square logo; open-toolbar takes neither. The name stays `open-toolbar`, the default logo stays a filled rectangle.
- Recommendation: the default accent moves from `#3446cf` to black (`#000000` light, `#fafafa` dark), so a fresh instance looks like the reference; the default logo is a filled rectangle in `primary`. Black passes the server's white-or-near-black text check (21:1), but the "lighter shade for dark pages" rule must invert pure black to near-white rather than produce a dark grey.
- An admin accent replaces `primary`, `primary-hover`, `primary-active`, `link`, `ring` and `accent-tint` and nothing else. Canvas, surfaces, borders and text stay neutral, so any accent sits on the same calm base. Hover and active derive from the accent with `color-mix` as `branding/head.ts` already does; the focus ring stays a 25 percent mix of the accent.
- Status colours never follow the accent, so a red or green brand cannot be mistaken for an error or a success.
- An admin logo replaces the rectangle at the same 20 px nav height; the Nunito product name beside it stays in `foreground`.
