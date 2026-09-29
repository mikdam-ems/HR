# Kadr brand kit

Everything for **Kadr by EMS**: logos, app icons, colours, fonts, social images and the Slack app.
The full guidelines are in the [Kadr Brand Book](https://claude.ai/artifact/G9offKCj1BEQp3zFnLXHJX), also here as
[`kadr-brand-book.pdf`](kadr-brand-book.pdf).

> **Draft.** The name still needs trademark clearance (Saudi Arabia and the GCC). A logo designer should refine
> the mark and draw a custom Arabic wordmark before a public launch.

## What's in the folder

```
kadr/
├── kadr-brand-book.pdf       The guidelines, offline
├── logo/
│   ├── svg/                  Vector logos, lettering outlined (no fonts needed)
│   └── png/                  The same, transparent background (1200 px wide; marks 512 px)
├── app-icon/
│   ├── kadr-app-icon.svg          Rounded tile, for general use
│   ├── kadr-app-icon-square.svg   Full-bleed square, for app stores and Slack (they round it)
│   ├── kadr-favicon.svg           Tighter version that stays readable at 16–48 px
│   ├── favicon.ico                16, 32 and 48 px in one file
│   └── png/                       1024, 512, 192 (Android), 180 (Apple touch), 64 → 16
├── colour/
│   ├── kadr-tokens.css       CSS variables (the app uses the same values)
│   └── kadr-tokens.json      Design tokens for Figma (Tokens Studio / variables import)
├── fonts/README.md           The five font families, weights and download links
├── social/                   Link preview 1200×630, LinkedIn post 1080×1080, LinkedIn banner 1584×396
└── slack/                    App icon, manifest and a paste-by-field guide to rebrand the Slack app
```

## Logos

Every logo comes in four colourways:

| Suffix | Use on |
|---|---|
| `-color` | White or light backgrounds (cobalt grid, saffron square, graphite lettering) |
| `-reversed` | Cobalt, graphite or photos (white grid and lettering, saffron square) |
| `-black` | One colour, dark: stamps, fax, engraving, single-colour print |
| `-white` | One colour, light: the same on dark backgrounds |

| Logo | When |
|---|---|
| `kadr-logo-horizontal-*` | The default. Website header, documents, email signature |
| `kadr-logo-stacked-*` | Square-ish spaces: profile pictures, merchandise, title slides |
| `kadr-logo-arabic-*` | Arabic-only material. The mark stays on the right and is never mirrored |
| `kadr-logo-bilingual-*` | Where both languages are read: events, signage, the sales deck cover |
| `kadr-logo-endorsed-*` | Sales and contracts, where EMS stands behind the product |
| `kadr-mark-*` | When the name is already on the page, or space is small |

**Rules (short version):**

- **Clear space:** keep a gap of at least one third of the mark's height around the logo.
- **Minimum size:** 20 px (6 mm) for the mark, 96 px (25 mm) for the horizontal logo.
- **Placed square:** the saffron square is always saffron, or the single colour in one-colour versions. It never goes back into the grid.
- **No white text on saffron:** it fails contrast (1.8:1). Use graphite on saffron.

## Colours

| | Hex | RGB | Use |
|---|---|---|---|
| Cobalt | `#1B3BD1` | 27 59 209 | Primary: buttons, brand surfaces. Text on it is white (8.1:1) |
| Saffron | `#F5B82E` | 245 184 46 | The placed person, overtime, one highlight. Text on it is graphite (9.5:1) |
| Graphite | `#1A1D24` | 26 29 36 | Text, dark surfaces |
| Cloud | `#F3F5F9` | 243 245 249 | Backgrounds |
| Steel | `#6A7385` | 106 115 133 | Secondary text (4.8:1 on white) |
| White | `#FFFFFF` | 255 255 255 | Cards |

The split is roughly 60% Cloud and white, 30% cobalt and graphite, 10% saffron. The full cobalt and saffron
ranges, status colours and dark mode are in `colour/`.

## Where each file goes

| Place | File |
|---|---|
| Slack app icon | `slack/kadr-slack-app-icon-1024.png` (details in `slack/README.md`) |
| Website favicon | `app-icon/favicon.ico` + `app-icon/kadr-favicon.svg` |
| Apple home screen | `app-icon/png/kadr-app-icon-square-180.png` |
| Android / PWA | `app-icon/png/kadr-app-icon-square-192.png` and `-512.png` |
| Google Workspace / Microsoft 365 app tile | `app-icon/png/kadr-app-icon-512.png` |
| Link previews (Open Graph) | `social/kadr-og-1200x630.png` |
| LinkedIn page | Logo: `app-icon/png/kadr-app-icon-square-512.png` · Cover: `social/kadr-linkedin-banner-1584x396.png` |
| Email signature | `logo/png/kadr-logo-horizontal-color.png`, shown at about 120 px wide |
| Word / PowerPoint | `logo/png/…` (or the SVGs in Office 365) |
| Figma | Import `colour/kadr-tokens.json`, drag in the SVGs, install the fonts from `fonts/README.md` |

## In the app

The live app already carries Kadr as a theme: everyone can switch between EMS and Kadr in their avatar menu.
The theme is the `html[data-brand='kadr']` block at the end of `src/app/globals.css`. The favicon and Apple
touch icon it serves are copies of the files here, in `public/brand/`.
