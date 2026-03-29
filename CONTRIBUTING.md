# Contributing to benapps

A personal collection of single-purpose mini-apps. Each app is self-contained, minimal, and works well in dark and light mode.

## Tech stack

- React 18 + TypeScript
- Vite (dev server + build)
- React Router v6 (client-side routing)
- CSS Modules (no CSS-in-JS, no Tailwind)

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc + vite build
```

---

## Design principles

- **Single purpose.** Each app does one thing. No feature creep.
- **Minimal UI.** No decorative elements. Every pixel earns its place.
- **Monochrome palette.** The design system is black/white with semantic shades — no accent colors except where content demands it (e.g., dice faces).
- **Everything interactive feels physical.** Drag to adjust numbers, sliders that respond to touch, values that copy on click.
- **Dark mode default.** Light mode is a toggle, not an afterthought.

---

## Design system

### CSS variables

Defined in `src/styles/global.css`. Always use these — never hardcode colors.

| Variable | Dark | Light | Role |
|----------|------|-------|------|
| `--bg` | `#0a0a0a` | `#f5f5f5` | Page background |
| `--fg` | `#efefef` | `#0a0a0a` | Primary text, active elements |
| `--muted` | `#999999` | `#7d7d7d` | Secondary text, idle labels |
| `--dim` | `#616161` | `#aeaeae` | Tertiary text, idle borders |
| `--rule` | `#2a2a2a` | `#d0d0d0` | Dividers, rules |

Light mode is applied by setting `data-theme="light"` on `<html>`.

### Fonts

```css
--font-display: 'Playfair Display', Georgia, serif;  /* weight 900 only */
--font-mono:    'Courier Prime', 'Courier New', monospace;
```

- `--font-display` — large numbers, time displays, prominent headings
- `--font-mono` — everything else: labels, values, body text, buttons

### Labels

Small uppercase labels follow this pattern throughout:

```css
font-family: var(--font-mono);
font-size: 0.6rem;
letter-spacing: 0.15em;
text-transform: uppercase;
color: var(--muted);  /* or var(--dim) for quieter labels */
```

### Buttons

There are two tiers:

**Primary (`ActionButton` component)** — used for the main action on a screen. Fills solid on hover.

```css
background: none;
border: 1px solid var(--fg);
color: var(--fg);
/* hover: background: var(--fg); color: var(--bg); */
```

**Secondary (inline app buttons)** — used for controls, presets, mode toggles. Color-only change on hover.

```css
background: none;
border: 1px solid var(--dim);
color: var(--muted);
/* hover: border-color: var(--muted); color: var(--fg); */
/* active/selected: border-color: var(--fg); color: var(--fg); */
```

All transitions are `0.15s`: `transition: border-color 0.15s, color 0.15s`.

---

## Code conventions

### File structure

```
src/pages/MyApp/
  index.tsx          # Default export. All state and logic lives here.
  MyApp.module.css   # Page-scoped styles only.

src/components/MyComponent/
  index.tsx          # Typed Props interface. Default export.
  MyComponent.module.css
```

- CSS Modules throughout — use camelCase class names
- No barrel/index re-exports for components; import by path: `import Foo from './components/Foo'`
- No style sharing between pages — duplicate the CSS rather than coupling pages

### State management

Choose the right tool:

| Situation | Use |
|-----------|-----|
| 1–3 independent values | `useState` |
| 4+ related values or 4+ action types | `useReducer` |
| Changes during events, must not re-render | `useRef` |

**`useReducer` pattern** — define above the component, in this order:

```ts
type State = { ... }
type Action = { type: 'FOO' } | { type: 'BAR'; payload: number }
const initial: State = { ... }
function reducer(state: State, action: Action): State { ... }

export default function MyApp() {
  const [state, dispatch] = useReducer(reducer, initial)
  ...
}
```

### TypeScript

- Always define a `Props` interface for components
- Prefer explicit return types on reducers
- Avoid `any` — use `unknown` with a type guard if the type is genuinely unknown

---

## UX patterns

### Copy-on-click

Click a displayed value → copy to clipboard → show "copied" in place of the value for ~1.2 seconds, then restore.

```ts
const [copied, setCopied] = useState(false)

function handleCopy() {
  navigator.clipboard.writeText(value)
  setCopied(true)
  setTimeout(() => setCopied(false), 1200)
}
```

### Drag-to-adjust numbers

Use the `DragNumber` component instead of a plain `<input type="number">` when you want vertical drag-to-change-value behavior.

```tsx
<DragNumber
  value={count}
  min={1}
  max={99}
  onChange={setCount}
  pixelsPerUnit={2}   // pixels of drag per unit change (default 1.5)
/>
```

Internally it uses `setPointerCapture` for reliable tracking across elements.

### Vertical sliders

To orient a range slider with bottom = min and top = max:

```css
writing-mode: vertical-lr;
direction: rtl;
touch-action: none;  /* required */
```

### Touch support

- Add `touch-action: none` to any draggable or custom-gesture element
- Use pointer events (`onPointerDown`, `onPointerMove`, `onPointerUp`) rather than separate mouse and touch handlers
- `touch-action: manipulation` on tap targets removes the 300ms delay

### Landscape / focus mode on mobile

When a touch device rotates to landscape, hide secondary chrome and expand the primary content to fill the screen. Use the media query `(orientation: landscape) and (pointer: coarse)` to target touch devices only — desktop browsers in a narrow window won't be affected.

At minimum, remove the `max-width` constraint and tighten padding. Beyond that, think about what the user is actually doing in landscape: hide forms, settings, or input areas they don't need while focused on the core task. The goal is a distraction-free view where the content earns every pixel of the wider screen.

```css
/* ---- Focus mode (landscape on touch devices) ---- */
@media (orientation: landscape) and (pointer: coarse) {
  .app {
    max-width: 100%;
    padding: 1.5rem;
  }

  /* hide anything that isn't the primary content */
  .inputForm {
    display: none;
  }
}
```

Not every app needs this — only add it where landscape genuinely improves the experience (e.g., a list you're reading, a score you're watching, a timer counting down).

---

### Number inputs — hide spinners

```css
input[type="number"] {
  -moz-appearance: textfield;
}
input[type="number"]::-webkit-inner-spin-button,
input[type="number"]::-webkit-outer-spin-button {
  -webkit-appearance: none;
}
```

---

## Adding a new app

1. **Create the page files**
   ```
   src/pages/NewApp/index.tsx
   src/pages/NewApp/NewApp.module.css
   ```

2. **Add the route** in `src/App.tsx` (inside the `children` array of the Layout route):
   ```tsx
   import NewApp from './pages/NewApp'
   // ...
   { path: '/newapp', element: <NewApp /> }
   ```

3. **Add to the landing page** in `src/pages/Landing/index.tsx`:
   ```ts
   { path: '/newapp', name: 'newapp' }  // lowercase name
   ```

4. **Use `AppHeader`** at the top of your app:
   ```tsx
   <AppHeader title="newapp" />  // lowercase, matches the landing name
   ```

5. **Follow the `.app` container pattern**:
   ```css
   .app {
     max-width: 620px;
     margin: 0 auto;
     padding: 1.5rem 2rem 4rem;
     min-height: 100vh;
   }
   ```

6. Check it works in both dark and light mode.
