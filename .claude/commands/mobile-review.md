Review all frontend components for mobile-first compliance.

1. Check `client/` for all React/Next.js components and pages.

2. For each component that renders visible UI, verify:
   - **Base styles target 375px** — no styles that assume a wide viewport as default
   - **Responsive breakpoints used correctly** — `md:` for tablet (768px), `lg:` for desktop (1280px)
   - **No fixed pixel widths** that would overflow on mobile (e.g., `w-[800px]` without responsive override)
   - **Touch targets** are at least 44×44px (buttons, links, map controls)
   - **Text is readable at 375px** — minimum 14px equivalent, no text that gets clipped

3. **Leaflet map specifically:**
   - Map is wrapped in `dynamic` with `ssr: false`
   - Map container has a defined height (not just `h-full` without a parent height)
   - Touch/pan controls work on mobile
   - Map loads and renders at 375px viewport

4. **SSE Agent Activity panel:**
   - Scrollable on mobile without breaking page layout
   - Text does not overflow container

5. **Recent Alerts feed:**
   - Cards are readable at 375px
   - Species names and threat levels are visible without horizontal scroll

6. **Refiner chart:**
   - Chart is responsive (not a fixed-width SVG)
   - Labels are readable on mobile

Report each issue with component file name and line number. Mark items PASS / FAIL / WARNING.
