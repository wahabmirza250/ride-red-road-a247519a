# RedArt Presentation Deck

A new public page at `/showcase` that walks through every app in the platform, one at a time, with real screenshots of the live UI and smooth animated transitions — built for presenting on a screen in a meeting.

## What it looks like

A fullscreen slide deck, RedArt-branded (dark, red accent, the existing wordmark):

1. **Title** — RedArt logo, "One platform. Six apps." tagline.
2. **Platform overview** — animated diagram of how Passenger → Dispatch → Driver → Billing → Admin → Owner connect.
3. **Passenger app** — booking flow, live tracking.
4. **Driver app** — Uber-style trip flow, in-app navigation, signature + HCPF form.
5. **Dispatch app** — fleet map, route builder, schedule.
6. **Billing app** — paper-bill AI chat, claim review, portal submission, claims history.
7. **Admin dashboard** — trips, payroll, earnings, reports.
8. **Owner panel** — multi-company control, seat limits, branding, subscriptions.
9. **Security & isolation** — per-company data isolation, role gates.
10. **Closing** — contact / call to action.

Each app slide: a device mockup (phone for passenger/driver, laptop for dispatch/billing/admin/owner) holding the real screenshot, with 3–4 short bullet callouts that fade in one by one.

## How it behaves

- Arrow keys, on-screen prev/next, swipe on touch, and a slide-number strip.
- URL carries the slide (`/showcase?slide=4`) so you can jump straight to one and refresh safely.
- `F` enters real fullscreen; `Esc` exits.
- Animated: slides cross-fade and slide in, bullets stagger, the flow diagram animates its connectors. All CSS/Tailwind driven — no new animation dependency.
- Fully responsive so it also reads well if you present from a phone.
- Public route (no login) so the link can be shared in the meeting.

## Screenshots

I capture real screenshots of the running app myself, using the Demo Transit Co tenant, at both phone and desktop sizes:
passenger home + booking + tracking, driver home + active trip, dispatch board + route builder, billing workspace + paper-bill chat + claims history, admin dashboard + payroll, owner panel.

They get uploaded as CDN assets and referenced from the deck, so the page stays fast and no login is needed to view it. Any screen that can't be captured cleanly gets a labeled placeholder you can swap later.

## Technical notes

- New route `src/routes/showcase.tsx` (public, its own SEO `head()`), plus `src/components/showcase/` for `Deck.tsx`, `Slide.tsx`, `DeviceFrame.tsx`, and a `slides.ts` content file so text/screenshots are easy to edit later.
- Screenshots captured with Playwright against the local dev server, uploaded via `lovable-assets`, referenced through `.asset.json` pointers.
- Slide index in a search param via TanStack Router; keyboard handlers scoped to the deck.
- Styling reuses existing semantic tokens and animation utilities in `src/styles.css`; a few deck-specific keyframes added there.
- No changes to any existing app, route, or backend logic.
