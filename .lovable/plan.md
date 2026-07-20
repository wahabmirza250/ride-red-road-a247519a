## Goal

Turn the RedArt logo palette (yellow `#F4C430`, red `#C8354E`, blue `#1E6FB8`, green `#1F9D6A`) into a **unified, meaningful color system** used everywhere — passenger, driver, admin/dispatch, auth, and billing — in both dark and light mode. Not four colors sprinkled randomly, but one color per surface so the app has a consistent visual language.

## Color-to-surface mapping

Each area of the app gets an "identity" color. Users learn it fast: yellow = a driver context, blue = dispatch, green = a rider context, red = billing/alerts.

- **Red (`--brand-red`)** — global primary CTAs, destructive/alert states, Medicaid Billing surface
- **Blue (`--brand-blue`)** — Admin / Dispatch console, live-ops, maps
- **Yellow (`--brand-yellow`)** — Driver app (go-online, offers, earnings)
- **Green (`--brand-green`)** — Passenger/Rider app (booking, tracking, success states)

Red stays the global primary because it's the strongest brand tie. The other three become the "surface accent" for their app section — used on kickers, icon tiles, hero glows, stat labels, section headers, and hover borders.

## What changes

1. **Design tokens (`src/styles.css`)** — the brand tokens already exist. Add surface-accent tokens (`--surface-accent`, `--surface-accent-foreground`, `--surface-accent-soft`) that resolve to the right brand color per route via a body/root class. Tune each color for light mode (slightly deeper/less saturated) so contrast holds on white.

2. **Route-level accent switch** — each top-level layout sets its surface class on the outermost wrapper:
   - `_authenticated/route.tsx` (admin/dispatch) → `surface-blue`
   - `driver.tsx` → `surface-yellow`
   - `passenger.tsx` → `surface-green`
   - `_authenticated/medicaid-billing.tsx` → `surface-red` override
   - `auth.tsx` / `driver.signin.tsx` / `passenger.signup.tsx` → inherit their target surface color

3. **Shared component refresh** — replace hard-coded `primary` accents in the pieces users see most, so the surface accent shows through:
   - `Brand` wordmark accent bar
   - `LoadingScreen` pulsing dots (cycle through all 4)
   - Section kickers, stat labels, empty-state icons, hover borders on cards
   - `Button` gets a `variant="brand-gradient"` for hero CTAs (red→yellow, or matches surface)

4. **Landing page** — already done; leaves it as the "showcase" of all four colors.

5. **Multi-color moments** kept intentional: page loaders, the landing hero, the footer dot cluster, and the auth split screen show all four colors together. Everywhere else uses one accent so screens don't feel chaotic.

## What stays the same

- No layout/copy changes. Only color, borders, and glow shifts.
- shadcn primitives keep their existing tokens; the change is one layer up (surface accent).
- No new dependencies.

## Technical notes

- Tailwind v4 CSS-first tokens in `src/styles.css` (`@theme inline`), light + dark blocks.
- Add `--surface-accent` + soft/foreground variants; expose as `bg-surface-accent`, `text-surface-accent`, `border-surface-accent`, `ring-surface-accent`.
- Each route wrapper sets one of `surface-red | surface-yellow | surface-blue | surface-green` classes that rewrite `--surface-accent*` for its subtree. Nothing global changes when a user moves between apps — the accent just swaps.
- Light-mode brand values will be re-tuned in `oklch` for AA contrast on white; dark-mode uses the current hex values that already work.
- Audit and swap `text-primary` / `bg-primary/10` / `border-primary/30` in shared components (`Brand`, `LoadingScreen`, section headers, empty states) to `surface-accent` equivalents so the accent follows the route.

## Out of scope (ask before doing)

- Reskinning charts, marketing PDFs, email templates.
- Rewriting shadcn primitives themselves (Button/Input/Card internals).
- Changing typography, spacing, or layout.

## Rollout order

1. Tokens + surface-accent utility in `src/styles.css` (light + dark tuned).
2. Route wrappers set their surface class.
3. Sweep shared components (`Brand`, `LoadingScreen`, dashboard cards, auth screens, billing tabs) to use `surface-accent` instead of hard-coded `primary`.
4. Visual QA per surface in both modes.
