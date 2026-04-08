---
name: restora-design-system
description: >
  ALWAYS apply this skill when building ANY frontend component, screen, page, or UI element for
  Restora POS — the restaurant management software. This skill contains the complete visual design
  language, CSS token system, component patterns, animation rules, and layout architecture for
  the Restora POS brand. Triggers: any request to build, create, design, update, or style a
  POS screen, admin panel page, QR order UI, kitchen display, report view, form, modal, table,
  button, or any other UI element. Also triggers for: "make it match our brand", "use our design
  system", "build the [feature] screen", "add a component for [X]". This skill is MANDATORY for
  all Restora POS frontend work — never write UI code without consulting it first.
---

# Restora POS — Design System Reference

> **Read this file completely before writing any line of UI code.**
> Every design decision — colors, fonts, spacing, components, motion, layout — must align with
> this system. Deviation breaks brand consistency across POS, Admin, KDS, and QR Order surfaces.

---

## 0. Quick Reference Card

| Property | Value |
|---|---|
| Color ratio | White 60% · Black 20% · Red 20% |
| Display font | `'Bebas Neue'` |
| Body font | `'DM Sans'` |
| Mono font | `'DM Mono'` |
| Primary CTA color | `#D62B2B` |
| Primary easing | `cubic-bezier(0.16, 1, 0.3, 1)` |
| Border radius | `0` — This is a sharp, precise system. No rounded corners. |
| Section rhythm | Alternate: White → Dark → White → Dark |
| Body text weight | `300` (light) |

---

## 1. Design Philosophy

Restora POS uses **operational precision aesthetics** — a visual language borrowed from professional equipment brands and financial terminals. The goal is:

- **Instant legibility** — a kitchen order card must be readable at a glance from 2 meters
- **Trust through structure** — sharp edges, clear hierarchy, no decorative noise
- **Red as a signal** — red always means "action required" or "primary interaction"
- **White as clarity** — white space is not empty — it is breathing room that prevents fatigue in high-stress restaurant environments
- **Black as authority** — the KDS, sidebar, and hero sections anchor the experience with weight

---

## 2. Color System

### CSS Variables — Include in EVERY file

```css
:root {
  /* WHITE FAMILY — 60% of UI surface */
  --white:        #FFFFFF;   /* Primary bg, cards, panels */
  --white-warm:   #FAF9F7;   /* Alt sections, sidebar bg, table rows */
  --white-soft:   #F2F1EE;   /* Hover fills, row alternates */
  --white-muted:  #E8E6E2;   /* Dividers, disabled bg */
  --white-border: #DDD9D3;   /* All borders, outlines, separators */

  /* BLACK FAMILY — 20% of UI surface */
  --black:        #0D0D0D;   /* Hero bg, KDS screen, sidebar, footer */
  --black-rich:   #161616;   /* Dark card backgrounds */
  --black-mid:    #1F1F1F;   /* Hover on dark, dark row alt */
  --black-lite:   #2A2A2A;   /* Borders on dark surfaces */
  --black-text:   #111111;   /* Body text on white backgrounds */

  /* RED FAMILY — 20% of UI surface */
  --red:          #D62B2B;   /* Brand red: CTAs, logo mark, status, accents */
  --red-deep:     #A81F1F;   /* Pressed states, active navigation */
  --red-bright:   #F03535;   /* Hover on red buttons */
  --red-dim:      rgba(214,43,43,0.10);  /* Hover fills, focus rings, alert bg */
  --red-glow:     rgba(214,43,43,0.25);  /* Button shadows, glow on dark */

  /* TYPOGRAPHY */
  --ff-display: 'Bebas Neue', sans-serif;
  --ff-body:    'DM Sans', sans-serif;
  --ff-mono:    'DM Mono', monospace;

  /* EASING */
  --ease-expo:  cubic-bezier(0.16, 1, 0.3, 1);    /* ALL hover & reveal transitions */
  --ease-back:  cubic-bezier(0.34, 1.56, 0.64, 1); /* Elastic — toasts, confirmations */

  /* SPACING SCALE */
  --sp-xs:  4px;   --sp-sm:  8px;   --sp-md:  16px;
  --sp-lg:  24px;  --sp-xl:  40px;  --sp-2xl: 64px;  --sp-3xl: 100px;

  /* SHADOWS */
  --shadow-sm:  0 2px 8px rgba(0,0,0,0.06);
  --shadow-md:  0 8px 24px rgba(0,0,0,0.10);
  --shadow-lg:  0 20px 60px rgba(0,0,0,0.12);
  --shadow-red: 0 8px 24px rgba(214,43,43,0.25);
}
```

### Google Fonts Import — Always include:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
```

### Color Usage Rules

| Surface | Color |
|---|---|
| Main content background | `var(--white)` |
| Alternate section / sidebar bg | `var(--white-warm)` |
| Hover fill on white surfaces | `var(--white-soft)` |
| ALL borders and separators | `var(--white-border)` |
| Hero, KDS display, dark sidebar | `var(--black)` |
| Dark card backgrounds | `var(--black-rich)` |
| Hover state on dark cards | `var(--black-mid)` |
| All primary CTA buttons | `var(--red)` |
| Section labels, active nav, logo | `var(--red)` |
| Status badges (cooking, alerts) | `var(--red)` |
| Focus ring on inputs | `var(--red)` 1.5px border |
| Hover fill on light bg elements | `var(--red-dim)` |

---

## 3. Typography

### Type Scale

| Role | Font | Size | Weight | Letter-spacing | Line-height |
|---|---|---|---|---|---|
| Page / hero title | Bebas Neue | `clamp(72px, 11vw, 160px)` | 400 | `0.01em` | `0.92` |
| Section title | Bebas Neue | `clamp(48px, 6vw, 88px)` | 400 | `0` | `1` |
| Card heading | Bebas Neue | `28–40px` | 400 | `0.04em` | `1` |
| Price / number | Bebas Neue | `24–36px` | 400 | normal | `1` |
| Section label | DM Sans | `11px` | 500 | `0.4em` | `1` |
| Navigation links | DM Sans | `12px` | 500 | `0.2em` | `1` |
| Body / description | DM Sans | `14–15px` | **300** | normal | `1.75` |
| Input text | DM Sans | `14px` | 400 | normal | `1` |
| Code / tokens | DM Mono | `12–13px` | 400 | `0.05em` | `1.9` |
| Caption / badge | DM Sans | `10–11px` | 500 | `0.15em` | `1` |

### Section Label Pattern — Use on EVERY section:

```html
<div class="section-label">Section Name</div>
```

```css
.section-label {
  display: flex;
  align-items: center;
  gap: 12px;
  font-family: var(--ff-body);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.4em;
  text-transform: uppercase;
  color: var(--red);
  margin-bottom: 16px;
}
.section-label::before {
  content: '';
  width: 28px;
  height: 1px;
  background: var(--red);
  flex-shrink: 0;
}
/* On dark backgrounds: */
.section-label.on-dark { color: rgba(255,255,255,0.4); }
.section-label.on-dark::before { background: rgba(255,255,255,0.3); }
```

---

## 4. Layout & Spacing

### Page / App Layout Pattern

```
[BLACK]  Top navigation bar (64px height, fixed)
[BLACK]  Left sidebar (240px width, dark) — Admin and POS
[WHITE]  Main content area (flex-1)
```

### Section Background Rhythm — Web / Marketing views

```
[DARK]   Hero — always dark, always first
[WHITE]  First content section
[WARM]   Alternate feature section
[DARK]   Highlight / KDS preview section
[WHITE]  Report or data section
[RED]    CTA band (full width)
[DARK]   Footer
```

Never use the same background for 3+ consecutive sections.

### POS Terminal Layout

```
[BLACK nav top: 64px]
[LEFT: black category rail 72px | CENTER: white menu grid flex-1 | RIGHT: black order panel 340px]
```

### Section Padding

```css
/* Standard full-width section */
padding: var(--sp-3xl) 48px;    /* 100px 48px */

/* Compact section */
padding: 72px 48px;

/* Tablet ≤ 1100px */
padding: 72px 28px;

/* Mobile ≤ 700px */
padding: 56px 20px;

/* Admin content panel (inside sidebar layout) */
padding: 32px 40px;
```

### Grid Patterns

```css
/* Menu item grid — POS */
display: grid;
grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
gap: 12px;

/* Dashboard stat cards */
display: grid;
grid-template-columns: repeat(4, 1fr);
gap: 20px;

/* Report table with sidebar */
display: grid;
grid-template-columns: 240px 1fr;
gap: 0;

/* 3-column content */
display: grid;
grid-template-columns: repeat(3, 1fr);
gap: 24px;
```

---

## 5. Component Patterns

### Navigation Bar (Top)

```css
nav {
  position: fixed;
  top: 0; left: 0; right: 0;
  height: 64px;
  padding: 0 48px;
  background: rgba(255,255,255,0.95);
  backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--white-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  z-index: 100;
}
/* Marketing/admin nav — dark version: */
nav.nav-dark {
  background: var(--black);
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
```

### Sidebar (Admin / POS)

```css
.sidebar {
  width: 240px;
  background: var(--black);
  height: 100vh;
  position: fixed;
  left: 0; top: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgba(255,255,255,0.06);
}

.sidebar-item {
  padding: 12px 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.4);
  border-left: 2px solid transparent;
  transition: all 0.25s var(--ease-expo);
  cursor: pointer;
}
.sidebar-item:hover {
  color: rgba(255,255,255,0.85);
  background: var(--black-rich);
}
.sidebar-item.active {
  color: var(--white);
  border-left-color: var(--red);
  background: var(--black-rich);
}
```

### Cards — Light Context

```css
.card {
  background: var(--white);
  border: 1px solid var(--white-border);
  position: relative;
  overflow: hidden;
  transition: box-shadow 0.35s var(--ease-expo), transform 0.35s var(--ease-expo);
}
.card::after {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 2px;
  background: var(--red);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 0.35s var(--ease-expo);
}
.card:hover {
  box-shadow: var(--shadow-lg);
  transform: translateY(-3px);
}
.card:hover::after { transform: scaleX(1); }
```

### Order / KDS Cards — Dark Context

```css
.order-card {
  background: var(--black-rich);
  border-left: 3px solid var(--red);
  padding: 16px 20px;
  transition: background 0.25s;
}
.order-card:hover { background: var(--black-mid); }

.order-card-inactive {
  border-left-color: rgba(255,255,255,0.08);
}
.order-card-inactive:hover {
  background: var(--black-mid);
  border-left-color: var(--red);
}
```

### Menu Item Card — POS

```css
.menu-item {
  padding: 16px;
  background: var(--white);
  border: 1px solid var(--white-border);
  cursor: pointer;
  position: relative;
  overflow: hidden;
  transition: all 0.25s var(--ease-expo);
}
.menu-item::before {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--red-dim);
  opacity: 0;
  transition: opacity 0.2s;
}
.menu-item:hover { border-color: var(--red); }
.menu-item:hover::before { opacity: 1; }
.menu-item:active { transform: scale(0.98); }

.menu-item-name {
  font-family: var(--ff-display);
  font-size: 18px;
  letter-spacing: 0.04em;
  color: var(--black-text);
}
.menu-item-price {
  font-family: var(--ff-display);
  font-size: 20px;
  color: var(--red);
}
```

### Buttons

```css
/* PRIMARY — Red fill */
.btn-primary {
  background: var(--red);
  color: #fff;
  padding: 14px 28px;
  font-family: var(--ff-body);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  border: none;
  cursor: pointer;
  transition: background 0.2s, transform 0.2s var(--ease-expo), box-shadow 0.2s;
}
.btn-primary:hover {
  background: var(--red-bright);
  transform: translateY(-2px);
  box-shadow: var(--shadow-red);
}
.btn-primary:active { background: var(--red-deep); transform: none; }

/* OUTLINE — Dark border */
.btn-outline {
  background: transparent;
  color: var(--black-text);
  border: 1.5px solid var(--black-lite);
  padding: 13px 28px;
  font-family: var(--ff-body);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.25s var(--ease-expo);
}
.btn-outline:hover { border-color: var(--red); color: var(--red); }

/* GHOST — Red border on white */
.btn-ghost {
  background: transparent;
  color: var(--red);
  border: 1.5px solid var(--red-dim);
  padding: 13px 28px;
  font-family: var(--ff-body);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.25s var(--ease-expo);
}
.btn-ghost:hover { background: var(--red); color: #fff; border-color: var(--red); }

/* DARK — Black fill */
.btn-dark {
  background: var(--black);
  color: #fff;
  padding: 14px 28px;
  font-family: var(--ff-body);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  border: none;
  cursor: pointer;
  transition: background 0.25s;
}
.btn-dark:hover { background: var(--black-lite); }

/* WHITE — On red backgrounds */
.btn-white {
  background: #fff;
  color: var(--red);
  padding: 16px 36px;
  font-family: var(--ff-body);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  border: none;
  cursor: pointer;
  transition: background 0.25s, transform 0.25s;
}
.btn-white:hover { background: var(--white-warm); transform: translateY(-2px); }

/* ICON BUTTON — POS action button */
.btn-icon {
  width: 44px; height: 44px;
  background: var(--white-soft);
  border: 1px solid var(--white-border);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-icon:hover { background: var(--red); border-color: var(--red); color: #fff; }
```

### Form Inputs

```css
.form-group { margin-bottom: 20px; }

.form-label {
  display: block;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #888;
  margin-bottom: 6px;
}

.form-input {
  width: 100%;
  padding: 12px 16px;
  border: 1.5px solid var(--white-border);
  background: var(--white);
  font-family: var(--ff-body);
  font-size: 14px;
  font-weight: 400;
  color: var(--black-text);
  outline: none;
  transition: border-color 0.2s;
}
.form-input:focus { border-color: var(--red); }
.form-input::placeholder { color: #bbb; }
.form-input.error { border-color: var(--red); background: var(--red-dim); }

.form-select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%23888' stroke-width='1.5'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 14px center;
  padding-right: 36px;
}
```

### Status Badges

```css
.badge {
  padding: 3px 10px;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  display: inline-block;
}
.badge-red     { background: var(--red); color: #fff; }
.badge-dark    { background: var(--black); color: rgba(255,255,255,0.7); }
.badge-outline { border: 1px solid var(--white-border); color: #666; }
.badge-success { background: #1a6b3a; color: #fff; }
.badge-warning { background: #b45309; color: #fff; }
.badge-info    { background: #1d4ed8; color: #fff; }

/* Order status specific */
.status-pending   { background: var(--black-lite); color: rgba(255,255,255,0.6); }
.status-accepted  { background: #1d4ed8; color: #fff; }
.status-cooking   { background: var(--red); color: #fff; }
.status-ready     { background: #1a6b3a; color: #fff; }
.status-served    { background: var(--white-soft); color: #666; border: 1px solid var(--white-border); }
.status-cancelled { background: var(--white-muted); color: #999; }
```

### Data Tables

```css
.data-table { width: 100%; border-collapse: collapse; }

.data-table th {
  font-family: var(--ff-body);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: #888;
  padding: 12px 16px;
  text-align: left;
  border-bottom: 1px solid var(--white-border);
  background: var(--white-warm);
}

.data-table td {
  padding: 14px 16px;
  font-size: 13px;
  font-weight: 300;
  color: var(--black-text);
  border-bottom: 1px solid var(--white-soft);
}

.data-table tr:hover td { background: var(--white-warm); }
.data-table tr:hover td:first-child { border-left: 2px solid var(--red); padding-left: 14px; }
```

### Stat / Metric Cards (Dashboard)

```css
.stat-card {
  padding: 24px 28px;
  background: var(--white);
  border: 1px solid var(--white-border);
  position: relative;
  overflow: hidden;
}
.stat-card::before {
  content: '';
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 3px;
  background: var(--red);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 0.5s var(--ease-expo);
}
.stat-card:hover::before { transform: scaleX(1); }

.stat-label {
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: #aaa;
  margin-bottom: 12px;
}
.stat-value {
  font-family: var(--ff-display);
  font-size: 40px;
  color: var(--black-text);
  line-height: 1;
}
.stat-unit {
  font-size: 14px;
  color: #888;
  margin-left: 4px;
}
.stat-delta {
  font-size: 12px;
  font-weight: 500;
  margin-top: 8px;
}
.stat-delta.positive { color: #1a6b3a; }
.stat-delta.negative { color: var(--red); }
```

### Toast / Notification

```css
.toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  min-width: 300px;
  background: var(--black);
  padding: 16px 20px;
  border-left: 3px solid var(--red);
  display: flex;
  align-items: center;
  gap: 14px;
  z-index: 9000;
  animation: toastIn 0.5s var(--ease-back) both;
}
@keyframes toastIn {
  from { transform: translateX(120%); opacity: 0; }
  to   { transform: translateX(0); opacity: 1; }
}
.toast-icon { width: 20px; height: 20px; color: var(--red); flex-shrink: 0; }
.toast-title { font-size: 13px; font-weight: 500; color: #fff; }
.toast-msg { font-size: 12px; color: rgba(255,255,255,0.5); margin-top: 2px; }
```

### Modal / Dialog

```css
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(13,13,13,0.75);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 8000;
  animation: overlayIn 0.3s ease both;
}
@keyframes overlayIn { from { opacity:0; } to { opacity:1; } }

.modal {
  background: var(--white);
  width: 520px;
  max-width: 92vw;
  border-top: 3px solid var(--red);
  animation: modalIn 0.5s var(--ease-expo) both;
}
@keyframes modalIn {
  from { transform: translateY(32px); opacity:0; }
  to   { transform: none; opacity:1; }
}

.modal-header {
  padding: 24px 28px;
  border-bottom: 1px solid var(--white-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.modal-title {
  font-family: var(--ff-display);
  font-size: 28px;
  letter-spacing: 0.04em;
  color: var(--black-text);
}
.modal-body { padding: 28px; }
.modal-footer {
  padding: 20px 28px;
  border-top: 1px solid var(--white-border);
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
```

---

## 6. Motion & Animation

### Page Load — Hero Elements

```css
.fade-up {
  opacity: 0;
  animation: fadeUp 0.9s var(--ease-expo) both;
}
.delay-1 { animation-delay: 0.10s; }
.delay-2 { animation-delay: 0.25s; }
.delay-3 { animation-delay: 0.40s; }
.delay-4 { animation-delay: 0.55s; }
.delay-5 { animation-delay: 0.70s; }

@keyframes fadeUp {
  from { opacity: 0; transform: translateY(32px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

### Scroll Reveal — All Sections

```css
.reveal {
  opacity: 0;
  transform: translateY(28px);
  transition: opacity 0.8s var(--ease-expo), transform 0.8s var(--ease-expo);
}
.reveal.visible { opacity: 1; transform: none; }
.reveal-delay-1 { transition-delay: 0.10s; }
.reveal-delay-2 { transition-delay: 0.20s; }
.reveal-delay-3 { transition-delay: 0.30s; }
```

```javascript
// Always add this IntersectionObserver:
const obs = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add('visible');
      obs.unobserve(e.target);
    }
  });
}, { threshold: 0.06 });
document.querySelectorAll('.reveal').forEach(el => obs.observe(el));
```

### Logo Mark Pulse — Always active

```css
.logo-mark {
  animation: logoPulse 3s ease-in-out infinite;
}
@keyframes logoPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(214,43,43,0.4); }
  50%       { box-shadow: 0 0 0 8px rgba(214,43,43,0); }
}
```

### Loading / Sweep Bar

```css
.sweep-bar {
  height: 2px;
  background: var(--white-border);
  position: relative;
  overflow: hidden;
}
.sweep-bar::after {
  content: '';
  position: absolute;
  top: 0; left: -100%;
  width: 100%; height: 100%;
  background: var(--red);
  animation: sweepBar 1.8s ease-in-out infinite;
}
@keyframes sweepBar { 0% { left: -100%; } 100% { left: 200%; } }
```

### KDS Aging Colors (Real-time order countdown)

```css
.order-fresh   { border-left-color: #1a6b3a; }   /* 0–5 min */
.order-aging   { border-left-color: #b45309; }   /* 5–10 min */
.order-overdue { border-left-color: var(--red); animation: pulseRed 1.5s ease-in-out infinite; }

@keyframes pulseRed {
  0%, 100% { box-shadow: none; }
  50%       { box-shadow: inset 0 0 0 1px var(--red); }
}
```

### Easing Reference

| Name | Value | Use |
|---|---|---|
| Expo Out (Primary) | `cubic-bezier(0.16, 1, 0.3, 1)` | ALL hover states, reveals, slide-ins |
| Back Out (Elastic) | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Toast pop-in, badge appear, confirmations |
| Linear | `linear` | Spinning loaders, scan sweeps |

**Never use:** `ease`, `ease-in-out`, `ease-in` — always use the defined curves above.

---

## 7. Surface-Specific Guidelines

### POS Terminal Screen

- Background: `var(--white)`
- Category rail (left): `var(--black)`, width 72px, icon + label
- Order panel (right): `var(--black-rich)`, width 340px
- Menu grid: `auto-fill minmax(160px,1fr)` on white
- Touch target minimum: 44px × 44px (no exceptions)
- Number input (quantity): Bebas Neue, large (40px), centered, prominent
- Payment confirmation: green checkmark with `cubic-bezier(0.34,1.56,0.64,1)` scale in

### Admin Dashboard

- Sidebar: `var(--black)`, 240px
- Content: `var(--white-warm)`
- Top breadcrumb bar: `var(--white)`, `border-bottom: 1px solid var(--white-border)`
- Stat cards: white, 4-column grid, red sweep on hover
- Charts: use `var(--red)` as primary series, `var(--black-lite)` as secondary

### KDS (Kitchen Display System)

- Full screen: `var(--black)` background
- Order cards: dark, red left border when active, aging color coding
- Font: Bebas Neue for order number (48px), DM Sans for items (16px/500)
- Grid: auto-fill `minmax(280px, 1fr)` columns
- No navigation, no sidebar — full screen only

### QR Order App (Mobile)

- Background: `var(--white)`
- Header: `var(--black)`, sticky, 56px height
- Category tabs: horizontal scroll, `var(--white-soft)` bg, active tab has `border-bottom: 2px solid var(--red)`
- Menu item card: full width, image top, info below
- Cart button: sticky bottom, full width, `var(--red)` fill

---

## 8. Hero / Dark Section Structure

```html
<section class="hero">
  <!-- Animated grid overlay via CSS ::before -->
  <!-- Red glow orb via CSS ::after -->
  <div class="hero-inner">
    <div class="hero-eyebrow fade-up delay-1">Section Label</div>
    <h1 class="hero-title fade-up delay-2">MAIN <span style="color:var(--red)">TITLE</span></h1>
    <p class="hero-desc fade-up delay-3">Supporting description text.</p>
    <div class="hero-ctas fade-up delay-4">
      <button class="btn-primary">Primary Action</button>
      <button class="btn-outline" style="border-color:rgba(255,255,255,0.2);color:rgba(255,255,255,0.6);">Secondary</button>
    </div>
  </div>
</section>
```

```css
.hero {
  background: var(--black);
  position: relative;
  overflow: hidden;
  padding: var(--sp-3xl) 48px;
}
.hero::before {
  content: '';
  position: absolute; inset: 0;
  background-image:
    linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px);
  background-size: 72px 72px;
  mask-image: radial-gradient(ellipse 70% 70% at 50% 50%, black 20%, transparent 100%);
  animation: gridDrift 20s linear infinite;
}
@keyframes gridDrift {
  from { background-position: 0 0; }
  to   { background-position: 72px 72px; }
}
.hero::after {
  content: '';
  position: absolute;
  width: 600px; height: 600px;
  background: radial-gradient(circle, rgba(214,43,43,.18) 0%, transparent 70%);
  top: 50%; right: 10%;
  transform: translateY(-50%);
  pointer-events: none;
  animation: orbFloat 6s ease-in-out infinite;
}
@keyframes orbFloat {
  0%, 100% { transform: translateY(-50%) scale(1); }
  50%       { transform: translateY(-55%) scale(1.08); }
}
.hero-inner { position: relative; z-index: 2; }
.hero-eyebrow {
  display: flex; align-items: center; gap: 12px;
  font-size: 11px; font-weight: 500; letter-spacing: .4em; text-transform: uppercase;
  color: var(--red); margin-bottom: 24px;
}
.hero-eyebrow::before { content:''; width:28px; height:1px; background:var(--red); }
.hero-title {
  font-family: var(--ff-display);
  font-size: clamp(64px, 10vw, 140px);
  line-height: .92; color: var(--white);
}
```

---

## 9. Custom Cursor — Include on All Web Views

```html
<div class="cursor" id="cursor"></div>
<div class="cursor-ring" id="cursorRing"></div>
```

```css
.cursor {
  position: fixed; width: 8px; height: 8px;
  background: var(--red); border-radius: 50%;
  pointer-events: none; z-index: 9999;
  transform: translate(-50%,-50%);
  transition: width .25s var(--ease-expo), height .25s var(--ease-expo);
}
.cursor-ring {
  position: fixed; width: 34px; height: 34px;
  border: 1.5px solid rgba(214,43,43,0.35);
  border-radius: 50%; pointer-events: none; z-index: 9998;
  transform: translate(-50%,-50%);
  transition: width .35s var(--ease-expo), height .35s var(--ease-expo);
}
```

```javascript
const cursor = document.getElementById('cursor');
const ring   = document.getElementById('cursorRing');
let mx=0,my=0,rx=0,ry=0;
document.addEventListener('mousemove', e => {
  mx = e.clientX; my = e.clientY;
  cursor.style.left = mx+'px'; cursor.style.top = my+'px';
});
(function loop() {
  rx += (mx-rx) * .10; ry += (my-ry) * .10;
  ring.style.left = rx+'px'; ring.style.top = ry+'px';
  requestAnimationFrame(loop);
})();
['a','button','.card','.menu-item'].forEach(sel => {
  document.querySelectorAll(sel).forEach(el => {
    el.addEventListener('mouseenter', () => {
      cursor.style.width='14px'; cursor.style.height='14px';
      ring.style.width='52px'; ring.style.height='52px';
    });
    el.addEventListener('mouseleave', () => {
      cursor.style.width='8px'; cursor.style.height='8px';
      ring.style.width='34px'; ring.style.height='34px';
    });
  });
});
```

---

## 10. Responsive Breakpoints

```css
/* Desktop first */

/* Large tablet */
@media (max-width: 1280px) {
  /* 4-col stat grids → 2-col */
  /* Admin sidebar: icon-only mode (72px) */
}

/* Tablet */
@media (max-width: 1100px) {
  nav { padding: 0 24px; }
  section { padding: 72px 24px; }
  /* 3-col → 2-col */
  /* 2-col layouts → 1-col */
}

/* Mobile */
@media (max-width: 700px) {
  section { padding: 56px 20px; }
  /* Single column everywhere */
  /* Hide sidebar, show bottom tab bar instead */
  /* Hero stats hidden */
}
```

---

## 11. Critical DO / DON'T Rules

| ✅ DO | ❌ DON'T |
|---|---|
| Bebas Neue for ALL display/heading text | Use Inter, Roboto, Arial, or system fonts anywhere |
| `border-radius: 0` everywhere | Round any corners (not even slightly) |
| Red only on: CTAs, labels, active states, status badges | Use red on decorative/background elements |
| `cubic-bezier(0.16,1,0.3,1)` for all transitions | Use `ease`, `ease-in-out`, or `ease-in` |
| Card hover: lift + shadow + red border sweep | Opacity-only hover states |
| Alternate light/dark section backgrounds | Same bg for 3+ sections in a row |
| Body text at font-weight 300 | Body text heavier than 400 |
| Section label with red line prefix on every section | Plain text section headers |
| Animate logo mark with pulse | Static logo mark |
| Touch targets ≥ 44px on POS screens | Buttons smaller than 44px on POS |
| Red status = Cooking / Alert / Active | Green = all positive, grey = all neutral (use the full status system) |
| Include the animated grid in hero/dark sections | Flat solid black hero sections |

---

## 12. React / TailwindCSS Integration Notes

When building Restora POS in React with TailwindCSS:

```javascript
// tailwind.config.js — extend with brand tokens
module.exports = {
  theme: {
    extend: {
      colors: {
        'brand-red':    '#D62B2B',
        'brand-red-bright': '#F03535',
        'brand-red-deep': '#A81F1F',
        'brand-black':  '#0D0D0D',
        'brand-black-rich': '#161616',
        'brand-border': '#DDD9D3',
        'brand-warm':   '#FAF9F7',
      },
      fontFamily: {
        display: ['"Bebas Neue"', 'sans-serif'],
        body:    ['"DM Sans"', 'sans-serif'],
        mono:    ['"DM Mono"', 'monospace'],
      },
      transitionTimingFunction: {
        'expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'back': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
    }
  }
}
```

```jsx
// Standard section label component
const SectionLabel = ({ children, dark = false }) => (
  <div className={`flex items-center gap-3 text-[11px] font-medium tracking-[0.4em] uppercase mb-4
    ${dark ? 'text-white/40' : 'text-[#D62B2B]'}
    before:content-[''] before:w-7 before:h-px before:flex-shrink-0
    ${dark ? 'before:bg-white/30' : 'before:bg-[#D62B2B]'}`}>
    {children}
  </div>
);

// Standard card component with hover animation
const Card = ({ children, className = '' }) => (
  <div className={`bg-white border border-[#DDD9D3] relative overflow-hidden
    transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
    hover:-translate-y-1 hover:shadow-[0_20px_60px_rgba(0,0,0,0.12)]
    after:content-[''] after:absolute after:top-0 after:left-0 after:right-0 after:h-0.5
    after:bg-[#D62B2B] after:scale-x-0 after:origin-left
    after:transition-transform after:duration-300 hover:after:scale-x-100 ${className}`}>
    {children}
  </div>
);
```

---

## 12. UI/UX Audit Process (Puppeteer Screenshots)

When asked to audit or fix UI/UX issues, follow this procedure:

### Step 1: Take Screenshots

Run the Puppeteer screenshot script:
```bash
cd "D:\RESTURANT SOFTWARE\restora-pos" && node scripts/screenshot.mjs
```

This captures all Admin pages + POS login/tables to `temporary screenshots/`.

### Step 2: Read & Review Each Screenshot

Use the Read tool to view each PNG file from `temporary screenshots/`. Check for:

| Check | What to Look For |
|-------|------------------|
| **Theme consistency** | All Admin pages must use dark theme: `bg-[#0D0D0D]` outer, `bg-[#161616]` cards, `border-[#2A2A2A]`, `text-white` |
| **No rounded corners** | Zero `rounded-*` classes anywhere. All corners must be sharp. |
| **Font usage** | `font-display` (Bebas Neue) for headings/prices/titles. `font-body` (DM Sans) for body/labels/buttons. |
| **Color system** | Primary text: `text-white`. Secondary: `text-[#999]`. Muted: `text-[#666]`. Accent: `text-[#D62B2B]` / `bg-[#D62B2B]`. |
| **Spacing** | Pages have `p-8` padding. Cards have `p-5` or `p-6`. Tables use `px-4 py-3`. |
| **Status badges** | Green `#4CAF50` = active/approved. Red `#D62B2B` = error/void. Amber `#FFA726` = pending. Blue `#29B6F6` = info. |
| **Tables** | Header row: `text-[#666] text-xs tracking-widest uppercase`. Rows: `border-b border-[#2A2A2A]`. Hover: `hover:bg-[#1F1F1F]`. |
| **Buttons** | Primary: `bg-[#D62B2B] hover:bg-[#F03535] text-white`. Secondary: `bg-[#2A2A2A] hover:bg-[#1F1F1F] text-[#999]`. |
| **Inputs** | `bg-[#0D0D0D] border border-[#2A2A2A] text-white focus:border-[#D62B2B]` |
| **Dialogs** | Backdrop `bg-black/70`. Dialog `bg-[#161616] border border-[#2A2A2A]`. |
| **Sidebar** | Grouped nav with section headers. Active: `bg-[#D62B2B] text-white`. Inactive: `text-[#888] hover:bg-[#1F1F1F]`. |

### Step 3: Fix Issues

Apply the Tailwind class conversion rules:

| Light Class (WRONG) | Dark Class (CORRECT) |
|---------------------|---------------------|
| `bg-white` | `bg-[#161616]` |
| `bg-[#FAF9F7]` | `bg-[#0D0D0D]` |
| `border-[#DDD9D3]` | `border-[#2A2A2A]` |
| `text-[#111]` | `text-white` |
| `text-[#333]` | `text-white` |
| `hover:bg-[#F2F1EE]` | `hover:bg-[#1F1F1F]` |
| `focus:border-[#111]` | `focus:border-[#D62B2B]` |
| `bg-black/40` | `bg-black/70` |
| `placeholder:text-[#DDD9D3]` | `placeholder:text-[#555]` |
| `shadow-xl` | (remove — not needed on dark) |

### Step 4: Re-screenshot and Verify

After fixing, re-run `node scripts/screenshot.mjs` and re-read the PNGs to verify fixes.

---

## 13. Admin Panel — Actual Implementation Reference

### Sidebar Navigation Groups

```
Dashboard
─── RESTAURANT ───
Menu | Tables | Orders | Recipes | Pre-Ready | QR Codes
─── INVENTORY ───
Inventory | Suppliers | Purchasing | Shopping List | Waste
─── FINANCE ───
Reports | Expenses | Accounts
─── PEOPLE ───
Staff | Attendance | Payroll | Leave
───
Settings
```

### Admin Dark Theme (Current Implementation)

| Element | Classes |
|---------|---------|
| Page outer | `bg-[#0D0D0D]` (from layout) |
| Sidebar | `bg-[#111] border-r border-[#2A2A2A]` |
| Content cards | `bg-[#161616] border border-[#2A2A2A]` |
| Table header | `text-[#666] font-body text-xs tracking-widest uppercase` |
| Table rows | `border-b border-[#2A2A2A] hover:bg-[#1F1F1F]` |
| Page title | `font-display text-3xl text-white tracking-widest` |
| Section label | `text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase` |
| KPI card | `bg-[#161616] border border-[#2A2A2A] p-5` with `font-display text-3xl text-white` |

### POS Light Theme (Separate Design)

POS uses a white background with the same fonts but light surface colors:
- Cards: `bg-white border border-[#DDD9D3]`
- Table cards: white with status tinting
- Modals: white background with `#111` text
- Inputs: white background with `border-[#DDD9D3]`
