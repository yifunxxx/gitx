# gitx — Base tech stack & UI style (from dbx)

**Status:** Adopted base for Project gitx  
**Source:** [t8y2/dbx](https://github.com/t8y2/dbx) (cloned/inspected at v0.6.66 tree)  
**Scope:** Stack + visual/interaction language only. Product features for Git are out of scope here.

---

## 1. Base tech stack (adopted)

| Layer | Choice | Notes |
| --- | --- | --- |
| Desktop shell | **Tauri 2** (`tauri` ~2.10–2.11, `@tauri-apps/api` 2.11) | Frameless/overlay titlebar; tray; native menu (macOS-oriented); deep links; updater plugins |
| Backend language | **Rust** (edition 2021, rust-toolchain via workspace; app crate `rust-version` 1.88) | Cargo workspace: `src-tauri` + many `crates/*` |
| Frontend language | **TypeScript** (~6) + **Vue 3** (^3.5) | SFC `.vue`; `vue-tsc` typecheck |
| UI primitives | **reka-ui** (^2.10) + **shadcn-vue** (style `reka-nova`, baseColor `neutral`) | Components under `apps/desktop/src/components/ui/*` |
| Icons | **@lucide/vue** | Consistent stroke icons |
| Styling | **Tailwind CSS v4** (`@tailwindcss/vite`) + CSS variables + `tw-animate-css` | Tokens in `tokens.css` / `globals.css`; CVA + `clsx` + `tailwind-merge` |
| State | **Pinia** (^3) | Domain stores (`connectionStore`, `settingsStore`, …) |
| Utilities | **@vueuse/core** | Reactive helpers |
| i18n | **vue-i18n** | Multi-locale under `i18n/locales` |
| Editor (domain) | CodeMirror 6 | dbx-specific; gitx may keep or replace for Git diffs — stack pattern is “embed specialized editor in Vue” |
| Layout split | **splitpanes** | Resizable sidebar / editor / results |
| Virtual lists | **vue-virtual-scroller** | Dense trees/grids |
| Build | **Vite 8** + `@vitejs/plugin-vue` | Desktop entry `apps/desktop` |
| Package manager | **pnpm** (workspace) + Node **≥22.13** (`.nvmrc` 22.23.3) | Root scripts drive desktop/Tauri |
| Lint/format | **oxlint** + **oxfmt** + husky lint-staged | |
| Test | **vitest** + happy-dom | Frontend unit/bench; Rust crates separately |
| Packaging | Tauri bundle (all targets); NSIS/deb/rpm/macOS entitlements; WebView2 offline variants | Cross-platform desktop distribution |
| Optional runtime | Same frontend can run `dev:web` against HTTP backend | Dual Tauri/web backend adapters (`lib/backend/tauri` / `http`) |

**Adopted for gitx:** Vue 3 + TypeScript + Tauri 2 + Pinia + Tailwind v4 + shadcn-vue/reka-ui + Lucide + Vite + pnpm. Domain crates/drivers in dbx are database-specific and are **not** product scope for gitx; only the app-shell pattern is.

---

## 2. UI design style summary

### Visual language

- **shadcn / neutral** look: near-black primary on light pearl; soft zinc/neutral surfaces; not purple-glow marketing UI.
- **Dense productivity chrome**: toolbar ~40px, default button `h-8`, sidebar + multi-panel workbench.
- **Surfaces hierarchy**:
  - `--background` / `--dbx-content` — main content
  - `--dbx-chrome` / `--muted` / `--sidebar` — chrome & lists
  - `--popover` / `--card` — floating & panels
  - inverted `--foreground` on solid toast/tooltip for contrast (including wallpaper/transparency via `--background-solid`)
- **Light + dark** via `.dark` class; many **named palettes** (`pearl` default, `mist`/`theme-soft`, `graphite`, `cobalt`, `sage`, `amber`, `blush`, IDE-inspired `vscode`/`idea`/`xcode`/`jetbrains`/`cursor`/`claude`, plus `custom`).
- **Corners**: user-selectable `data-corner-style` = `small` (default) | `large` | `none`. Default radii are **tight** (4–6px), not pill-heavy.
- **Borders**: subtle `rgb(229 229 229)` light; translucent borders in dark (`… / 0.28`).
- **Menus**: opaque solid panels with `0 12px 32px` shadow (not heavy glass blur in final menu rules); `ring-1 ring-foreground/10` on custom context menus.
- **Motion**: short (100–250ms) fade/zoom for dialogs, dropdowns, toasts; `prefers-reduced-motion` respected for some highlights; submenu pointer “grace area” for diagonal targeting.
- **Typography**: **Geist Variable** (sans) + CJK fallbacks (PingFang / YaHei / etc.); mono stack Fira/Cascadia/JetBrains/SF Mono. Default editor font size **13px**; UI scale setting.

### Windows / chrome

- Tauri window: **1280×800**, min **900×600**, initially hidden then shown.
- **Windows / Linux**: frameless (`decorations: false` in `tauri.conf.json`) so only the in-app **TitleBar** + **WindowControls** show — Overlay alone still leaves the native Windows title bar.
- **macOS**: platform merge `tauri.macos.conf.json` keeps `decorations: true`, **`titleBarStyle: Overlay`**, `hiddenTitle: true`, traffic lights inset `(16, 18)`.
- Custom drag region (`data-tauri-drag-region`) + **WindowControls** (Windows rectangular hover hit targets; Linux GNOME-style circular buttons; macOS native lights, custom buttons hidden).
- Optional drawn frame on some Linux floating layouts; zen mode hides sidebar chrome.

### Buttons

Variants (CVA): `default` | `outline` | `secondary` | `ghost` | `destructive` | `link`.  
Sizes: `default` h-8, `xs` h-6, `sm` h-7, `lg` h-9, icon sizes 6/7/8/9.  
Focus: `focus-visible:ring-3` + `ring-ring/50`. Destructive is soft fill (`bg-destructive/10`) not solid red bars by default.

### Menus & context menus

- Dropdown/select: reka-ui + shadcn wrappers; translucent/opaque menu surface class `cn-menu-translucent`.
- **CustomContextMenu**: Teleport to body, fixed position, submenu with delayed switch (300ms) + grace wedge; items 13px, check/icon column, `kbd` shortcut chips, destructive variant, optional switch-style checks.
- Global registry so only one context menu is open.

### Tooltips / toasts / dialogs

- **Tooltip**: default inverted (`bg-foreground text-background-solid`) or `popover` surface; small arrow; `text-xs`.
- **Toast**: bottom-centered stack; inverted pill `rounded-lg shadow-lg`; default auto-dismiss **2s**; persistent + loading + action + dismiss; enter/leave slide+scale 0.25s.
- **Dialog**: centered portal, `rounded-lg border p-4 shadow-lg`, zoom-in 100ms, max height tied to `--dbx-viewport-height`; layered z-index (`--dbx-dialog-top-z-index: 50`, floating `51`); Cmd/Ctrl+W closes modal surface before tearing down tabs (`modalSurface`).

### Density

- Sidebar density `default` | `compact`.
- Structure editor / column width densities: `compact` | `standard` | `comfortable`.
- Compact tab titles on by default; UI zoom shortcuts `Mod+=` / `Mod+-` / `Mod+0`.

---

## 3. Interface / operation logic patterns (mirror as base interaction)

| Pattern | dbx behavior | Mirror in gitx |
| --- | --- | --- |
| App shell | Top **AppToolbar** (logo, actions, theme, settings, window controls) + left **AppSidebar** (tree) + center tabbed workspace + optional right auxiliary panels (AI/history/library) | Same chrome: toolbar + sidebar tree + tabbed main + optional inspectors |
| Sidebar | Hover-reveal when collapsed; resizable width; multi-select; Delete/Backspace delete shortcut; Escape exits multi-select | Repo/branch/file tree with same selection + keyboard affordances |
| Tabs | App tab bar + editor group tabs; close / reopen / close others / close all; detachable tab windows; compact titles | Commit/diff/file tabs with identical close/reopen/switch shortcuts |
| Context menu | Right-click → `CustomContextMenu` with shortcuts, separators, submenus, destructive actions | Primary Git object actions via right-click (stage, discard, checkout, …) |
| Native menu | Tauri menu: App / File (close tab) / Edit (predefined) / View / Window / Help; tray show/quit | Keep thin native menu + tray; put rich actions in UI menus |
| Selection | Tree + grid selection models; Cmd/Ctrl-click navigation in editors | Multi-select files; click/cmd-click navigation into diffs |
| Panels | splitpanes; toggle sidebar / results / zen; panel resize persistence | Diff vs history vs staging splits with persisted sizes |
| Dialogs vs shortcuts | Modal owns Cmd/Ctrl+W; Escape dismisses layers | Same modal/shortcut ownership rules |
| Toasts | Non-blocking feedback for copy/save/errors; persistent for long jobs | Same for fetch/pull/push/clone progress |
| Quick open / search | `Mod+P` quick open, `Mod+F` find, global search / connection pickers | Quick open files, find in repo, command palette style |
| Theme | Mode light/dark/system + palette + corner style + custom colors | Adopt same appearance model |
| i18n | All chrome strings via vue-i18n | Start with zh/en at least |

### Representative shortcuts (Mod = Cmd on macOS / Ctrl elsewhere)

| Action | Default |
| --- | --- |
| New tab / query | `Mod+T` |
| Close tab | `Mod+W` |
| Reopen closed tab | `Shift+Mod+T` |
| Close all tabs | `Shift+Mod+W` |
| Settings | `Mod+,` |
| Find | `Mod+F` |
| Quick open | `Mod+P` |
| Toggle sidebar | `Mod+B` |
| Toggle zen | `Shift+Mod+F12` |
| Switch tab 1–9 | `Mod+1`…`Mod+9` |
| Prev/next tab | `Shift+Mod+[` / `]` |
| Tab switcher | `Ctrl+Tab` |
| UI zoom | `Mod+=` / `Mod+-` / `Mod+0` |
| Refresh | `F5` / `Mod+R` (context-dependent) |

Full registry: dbx `apps/desktop/src/lib/editor/shortcutRegistry.ts` (scopes: global / editor / grid / sidebar / …).

---

## 4. Tokens / concrete values

### Typography

```text
--font-sans: "Geist Variable", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif
--font-mono: 'Fira Code', 'Cascadia Code', 'Cascadia Mono', 'JetBrains Mono', ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace, + CJK fallbacks
Default editor fontSize: 13
Button text: text-sm (sm size ≈ 0.8rem); context menu item: 13px / leading-4
```

### Radius (default `small` / unset)

| Token | Value |
| --- | --- |
| `--dbx-radius-sm` / `md` / default | **4px** |
| `--dbx-radius-lg` / `xl` | **6px** |
| `large` corner style | sm/md 6px; lg 10px; xl 14px |
| `none` | all 0 |

Mapped to Tailwind `--radius-sm|md|lg|xl`.

### Pearl light (`:root` in `tokens.css`)

| Token | RGB |
| --- | --- |
| `--background` / `--card` / `--popover` | `255 255 255` |
| `--foreground` | `10 10 10` |
| `--primary` | `23 23 23` |
| `--primary-foreground` | `250 250 250` |
| `--secondary` / `--muted` / `--accent` | `245 245 245` |
| `--muted-foreground` | `115 115 115` |
| `--destructive` | `231 0 11` |
| `--border` / `--input` | `229 229 229` |
| `--ring` | `161 161 161` |
| `--sidebar` | `250 250 250` |
| `--success` | `22 163 74` |
| `--warning` | `217 119 6` |
| `--info` | `37 99 235` |
| `--dbx-chrome` | `245 245 245` |
| `--dbx-content` | `255 255 255` |

### Pearl dark (`.dark`)

| Token | RGB |
| --- | --- |
| `--background` | `19 20 22` |
| `--foreground` | `215 215 219` |
| `--card` | `27 27 30` |
| `--popover` | `30 30 32` |
| `--primary` | `208 208 214` |
| `--muted` / `--secondary` | `42 42 45` |
| `--muted-foreground` | `151 152 157` |
| `--accent` | `46 47 51` |
| `--destructive` | `243 98 95` |
| `--border` | `110 110 114 / 0.28` |
| `--sidebar` | `25 25 28` |
| `--dbx-chrome` | `27 27 30` |
| `--dbx-content` | `19 20 22` |

(Alternate palettes redefine the same token names under `html.theme-*` in `globals.css`.)

### Z-index / layers

| Layer | Approx |
| --- | --- |
| Dialog | z-50 / `--dbx-dialog-top-z-index` |
| Floating (menus/tooltips) | ≥51 / `--dbx-floating-layer-z-index` |
| Context menu | 9999 / submenu 10000 |
| Toast host | z-99999 |

### Menu / toast chrome

- Context menu: `min-w-40`, `rounded-md`, `p-1`, `shadow-lg`, `ring-1 ring-foreground/10`
- Dropdown menus: solid white / `#171717` dark, border `rgba(0,0,0,0.1)` / `rgba(255,255,255,0.12)`, shadow `0 12px 32px`
- Toast: `rounded-lg bg-foreground px-4 py-2 text-sm text-background-solid shadow-lg`

### Window

- Default 1280×800; min 900×600  
- Win/Linux: undecorated + custom TitleBar/WindowControls; macOS: Overlay titlebar, traffic light inset x=16 y=18  


---

## 5. How to apply in gitx (checklist)

1. **Scaffold** a Tauri 2 + Vue 3 + Vite + pnpm app with Pinia, vue-i18n, Tailwind v4.
2. **Install UI kit** via shadcn-vue `reka-nova` / neutral / Lucide — port or regenerate `components/ui` (button, dialog, dropdown, tooltip, input, tabs, select, scroll-area).
3. **Copy token approach**: `tokens.css` + `:root` / `.dark` + `@theme inline` mapping; start with **pearl** light/dark; keep corner-style data attribute.
4. **Shell layout**: Overlay titlebar + AppToolbar + Sidebar + Tabbed Content + ToastHost + AppDialogs pattern.
5. **Interaction**: Implement `CustomContextMenu` (or equivalent) for tree/file lists; wire Mod-key shortcuts registry with scopes; modal owns close shortcut.
6. **Density**: Prefer compact defaults (h-8 controls, 13px type, tight 4px radius).
7. **Do not** import dbx database drivers/crates; only reuse shell/UI patterns and token values.
8. **Verify** light/dark, Windows/macOS/Linux window controls, reduced-motion toasts/dialogs before building Git-specific views.

---

## 6. Source map (dbx paths)

| Concern | Path |
| --- | --- |
| Root scripts / deps | `package.json` |
| Tauri config | `src-tauri/tauri.conf.json`, `src-tauri/tauri.macos.conf.json` (Overlay + traffic lights), `src-tauri/src/lib.rs` (menu/tray) |
| Desktop app | `apps/desktop/` |
| Tokens | `apps/desktop/src/styles/tokens.css` |
| Globals / themes / menus CSS | `apps/desktop/src/styles/globals.css` |
| shadcn config | `apps/desktop/components.json` |
| Button / dialog / menu / tooltip | `apps/desktop/src/components/ui/**` |
| Context menu | `apps/desktop/src/components/ui/CustomContextMenu.vue` |
| Toast | `apps/desktop/src/composables/useToast.ts`, `components/common/ToastHost.vue` |
| Theme | `apps/desktop/src/composables/useTheme.ts`, `lib/app/appTheme.ts` |
| Shortcuts | `apps/desktop/src/lib/editor/shortcutRegistry.ts` |
| Shell | `App.vue`, `components/layout/AppToolbar.vue`, `AppSidebar.vue`, `WindowControls.vue` |

---

## Uncertainty

- **Runtime look** was inferred from source tokens/components, not a live GUI session in this research pass (screenshots in README confirm overall IDE-like density).
- **Platform-native menu completeness** is intentionally thin on non-macOS; most UX is in-app.
- **Vendor WebView / Win7 patches** in dbx are packaging concerns — optional for early gitx.
- Exact **gitx product IA** (which panels map to status/diff/history) is intentionally undecided here.
