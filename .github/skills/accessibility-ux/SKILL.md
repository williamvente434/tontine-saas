---
name: accessibility-ux
description: "Use when designing or reviewing interface flows, loading states, forms, navigation, responsive layouts, keyboard access, screen-reader feedback, or motion preferences."
---

# Accessible UX

## Workflow

1. Identify the primary task, user role, and empty, loading, success, and error states.
2. Keep labels associated with controls and preserve semantic landmarks and heading order.
3. Make every action keyboard reachable; provide visible focus and a clear active navigation state.
4. Announce asynchronous status through concise `role="status"` or `aria-live` text. Do not communicate status through color alone.
5. Keep layouts readable on narrow screens; allow wide tables and navigation to scroll without clipping controls.
6. Respect `prefers-reduced-motion` and avoid animation that delays or blocks completion.
7. Render user-provided data with `textContent` or safe DOM APIs, never interpolated HTML.

## Validation

- Check keyboard navigation and visible focus.
- Check that loading, success, errors, and empty states are understandable without color.
- Check desktop and mobile layouts and reduced-motion behavior.
- Run the narrowest available syntax, lint, or UI test after edits.
