# Canvas LMS visual recon — token + component reference

Read-only recon for re-skinning Nailong Planner. All values below were read from source, not memory.
Sources are cited as `canvas:<path>` = <https://github.com/instructure/canvas-lms/blob/master/>`<path>` and
`instui:<path>` = <https://github.com/instructure/instructure-ui/blob/master/>`<path>` (both `master`, fetched 2026-10-20).
Values marked **UNVERIFIED** or **COMPUTED** are called out rather than guessed silently.

## 1. What Canvas looks like

Canvas reads as a *dense enterprise teaching tool*, not a consumer app: white content on a dark slate rail.
Type is Lato at 16px/1.5, body weight 400, headings only 1.5–1.8× body and **regular weight**, not bold.
Colour is almost monochrome — cool grays (#273540 text, #D7DADE strokes, #F2F4F4 panels) — with one saturated blue
(#2B7ABC) reserved for primary buttons, active nav, and badges, and a *second, darker* blue (#0E68B3) for links.
Corners are nearly square: 3px on legacy buttons, 4px on InstUI controls, 6px on alerts; pills and avatars are the only fully round shapes.
Depth is minimal: 1px borders do the work, shadows appear only on floating things (menus, flash messages, dialogs).
The global nav is a 54px icon rail (84px with labels), #334451, 26px white line icons, active item = white tile + blue icon.
Every page gets a 72px breadcrumb bar with a 1px bottom rule; content is capped at 1366px and padded 36/48px.
Status colour is used as a *tint* (#E0EBF5, #DCEEE4, #FCE4E5) with dark text, never as a full-bleed fill.
Micro-labels are sentence case, 12–14px; Canvas does not use the current “uppercase tracking-wide” SaaS look.
There are effectively two visual languages in one product: legacy `.Button`/jQuery-UI pages and InstUI pages.
This doc gives both, and flags which to copy for a “modern Canvas” look.

## 2. Colour tokens

### 2.1 Brandable variables (tenant-editable; defaults from the repo)

`canvas:app/stylesheets/brandable_variables.json` defines what a school can change. The `default` column is the
shipped value; entries whose default is `$ic-brand-primary` are *aliases* resolved at build time.
`instui:packages/ui-themes/src/themes/canvas/index.ts` maps the same names onto InstUI tokens (values agree).

| Token | Default | Source |
|---|---|---|
| `ic-brand-primary` | `#2B7ABC` | `canvas:app/stylesheets/brandable_variables.json` |
| `ic-brand-font-color-dark` | `#273540` | same |
| `ic-link-color` | `#0E68B3` | same |
| `ic-brand-button--primary-bgd` | `$ic-brand-primary` → `#2B7ABC` | same |
| `ic-brand-button--primary-text` | `#FFFFFF` | same |
| `ic-brand-button--secondary-bgd` | `#273540` (markup calls it “unused!”) | same; `instui:…/canvas/index.ts` |
| `ic-brand-button--secondary-text` | `#FFFFFF` | same |
| `ic-brand-global-nav-bgd` | `#334451` | same |
| `ic-brand-global-nav-ic-icon-svg-fill` | `#FFFFFF` | same |
| `ic-brand-global-nav-ic-icon-svg-fill--active` | `$ic-brand-primary` → `#2B7ABC` | same |
| `ic-brand-global-nav-menu-item__text-color` / `…--active` | `#FFFFFF` / `$ic-link-color` → `#0E68B3` | same |
| `ic-brand-global-nav-avatar-border` | `#FFFFFF` | same |
| `ic-brand-global-nav-menu-item__badge-bgd` / `…--active` | `#FFFFFF` / `$ic-brand-primary` | same |
| `ic-brand-global-nav-menu-item__badge-text` / `…--active` | `#000000` / `#FFFFFF` | same |
| `ic-brand-global-nav-logo-bgd` | `#334451` | same |
| `ic-global-nav-link-hover` | `#273540` (InstUI) / `rgba(0,0,0,.2)` (SCSS) | `instui:…/canvas/index.ts`; `canvas:app/stylesheets/base/_ic_app_header.scss` |

**Resolution:** Canvas SCSS never uses these literals; it uses `var(--ic-brand-…)` and generated shades
`var(--ic-brand-primary-darkened-10)`, `…-lightened-15`, `…-lightened-28`, `--ic-link-color-darkened-10`
(see `canvas:app/stylesheets/base/_variables.scss`). Those shades are produced by Canvas's brandable-CSS build from the
tenant's chosen primary (SASS `darken`/`lighten`), which is why a red-branded school gets dark-red hovers automatically.
The exact emitter (`lib/brandable_css.rb`) was **not** inspected — selector/location of the CSS-var block is **UNVERIFIED**.

### 2.2 Raw palette (InstUI primitives, canonical hex)

`instui:packages/ui-themes/src/legacySharedThemeTokens/colors/primitives.ts`; Canvas aliases them in
`canvas:app/stylesheets/base/_variables.scss` (`$electric`, `$shamrock`, `$crimson`, `$fire`, `$tiara`, `$heather`, …).

| Family | Steps used by Canvas | Hex |
|---|---|---|
| Grey (slate) | `grey11`, `grey12`, `grey14`, `grey24`, `grey30`, `grey45`, `grey57`, `grey70`, `grey82`, `grey100`, `grey125` | `#F2F4F4`, `#E8EAEC`, `#D7DADE`, `#9EA6AD`, `#8D959F`, `#6A7883`, `#586874`, `#4A5B68`, `#3F515E`, `#334451`, `#273540` |
| Blue | `45`, `57`, `70`, `82` | `#2B7ABC`, `#0E68B3`, `#0A5A9E`, `#09508C` |
| Green | `12`, `45`, `57`, `70` | `#DCEEE4`, `#03893D`, `#027634`, `#02672D` |
| Orange | `12`, `30`, `45`, `57` | `#FCE5D9`, `#F06E26`, `#CF4A00`, `#B34000` |
| Red | `12`, `45`, `57`, `70` | `#FCE4E5`, `#E62429`, `#C71F23`, `#AE1B1F` |
| Violet / Plum / Sea | decorative only (data-viz, AI buttons) | `#9E58BD`, `#C54396`, `#00828E` |

Legacy derived values in `canvas:_variables.scss`: `$ic-bg-light-primary: #E0EBF5`, `$ic-bg-light-success: #DCEEE4`,
`$ic-bg-light-alert/danger: #FCE4E5`, `$ic-list-item-background--hover: #eef7ff`, `…--selected: #d9edf9`,
table header `#e4e9ed` (`canvas:app/stylesheets/components/_ic-typography.scss`), nav avatar border `#d3d9d9`
(`canvas:app/stylesheets/components/_avatars.scss`).

### 2.3 Semantic UI roles (use these names in app code)

`instui:packages/ui-themes/src/utils/getUIColors.ts` maps contrasts → roles; hexes resolved via primitives.

| Role | Value | Notes |
|---|---|---|
| `surfacePagePrimary` / `surfaceCardPrimary` | `#FFFFFF` | page and card |
| `surfacePageSecondary` / `surfaceCardSecondary` | `#F2F4F4` | panel/well |
| `surfaceDark` | `#334451` | nav chrome |
| `textTitle` / `textBody` / `textDescription` | `#273540` | |
| `textTimestamp` / `textAuthor` / `textDatapoint` | `#586874` | metadata |
| `textLink` | `#0E68B3` | |
| `textPlaceholder` | `#9EA6AD` | |
| `textSuccess` / `textWarning` / `textError` | `#027634` / `#B34000` / `#C71F23` | text-on-white variants |
| `lineStroke` | `#D7DADE` | component borders |
| `lineDivider` / `surfaceDivider` | `#E8EAEC` | hairlines |
| `surfaceAttention/Success/Warning/Error` | `#2B7ABC` / `#03893D` / `#CF4A00` / `#E62429` | icons, fills |
| `iconDefault` | `#273540` | |
| `surfaceOverlayGrey` | `#334451BF` | 75% scrim |

Muted text is *derived*, not literal: `$ic-font-color--subdued` = 15% lighter than `#273540` (≈`#445C70`),
`$ic-hint-text` = 28% lighter (≈`#5D7E99`) — **COMPUTED**, SASS `lighten()` of the brand text colour.

## 3. Typography

| Token | Value | Source |
|---|---|---|
| Font stack | Canvas `"Lato Extended", "Lato", "Helvetica Neue", Helvetica, Arial, sans-serif`; InstUI `LatoWeb, Lato, …` (same family, different first alias) | `canvas:app/stylesheets/base/_variables.scss`; `instui:…/typography.ts` |
| Mono | `Monaco, Menlo, Consolas, "Courier New", monospace` (Canvas) / `Menlo, Consolas, Monaco, "Andale Mono", monospace` (InstUI) | same |
| Base size / line-height | `16px` (`html { font-size: 100% }`) / `1.5` | `canvas:…/components/_ic-typography.scss`; `$ic-line-height` |
| Body weight | `400` — `_layout.scss` sets 300 but `_ic-typography.scss` is imported *after* it in `bundles/common.scss` and sets `normal` | `canvas:app/stylesheets/bundles/common.scss` |
| Heading weight | `400` (`h1…h6 { font-weight: normal }`) | `_ic-typography.scss` |
| h1, h2 | `1.8em` = **28.8px**, line-height 1.5 | `_ic-typography.scss` |
| h3 | `1.5em` = **24px** | same |
| h4 / h5 / h6 | `1.125em` 18px / `1em` 16px / `0.75em` 12px | same |
| Letter-spacing | `0` normal; condensed `-0.0625rem`, expanded `0.0625rem`; weights 300/400/700 | `instui:…/typography.ts` |

InstUI title scale (new UI): `titlePageDesktop 2.25rem`, `titlePageMobile 2rem`, `titleSection 1.75rem`,
`titleModule 1.5rem`, `titleCardLarge 1.5rem`, `titleCardRegular 1.25rem`, `titleCardMini 1rem`,
`descriptionPage 1.25rem`, `label/content 1rem`, `contentSmall .875rem`, `legend .75rem`; line-heights 1 / 1.25 / 1.5.
Legacy deprecated sizes: `fontSizeXSmall .75rem`, `Small .875`, `Medium 1rem`, `Large 1.375`, `XLarge 1.75`, `XXLarge 2.375`.
Note the collision: Canvas renders `h1` at 28.8px but InstUI's page title is 36px — pick per page type, don't mix.

## 4. Layout metrics

| Metric | Value | Source |
|---|---|---|
| Design unit `$ic-sp` | `12px` (radius = `$ic-sp/2` = 6px) | `canvas:_variables.scss` |
| Global nav rail, collapsed | **54px** (`$ic-header-primary-width: 84px` minus 30) | `canvas:…/_ic_app_header.scss` |
| Global nav rail, expanded | **84px** | same (`body.primary-nav-expanded`) |
| Dead variable | `$ic-header-primary-expanded-width: 180px` — defined but referenced only in `_variables.scss` (code search, 1 hit) | `canvas:_variables.scss` |
| Rail z-index | `100` | `_ic_app_header.scss` |
| Rail logomark height | `75px` (85px expanded) | same; `canvas:…/_SideNav.scss` |
| Rail nav icon | `26px` (`1.625rem`), avatar `30px` → `36px` expanded | same |
| Rail item padding | `9px 0` in legacy `.ic-app-header`; `7px 0` in the InstUI `SideNav` that now renders the rail (`4px` when viewport < 400px tall) | `canvas:…/_ic_app_header.scss`; `canvas:…/_SideNav.scss` |
| Breadcrumb/topbar height | **72px** (`4.5rem`) incl. 1px bottom border | `$ic-breadcrumbs-height`, `_variables.scss` |
| Page max width | **1366px** (`.ic-Layout-wrapper`) | `canvas:…/_ic_app_layout.scss` |
| Main content padding | `36px 48px 48px 48px` (`12*3 12*4 12*4 12*4`); `12px` sides on mobile | same |
| Course sub-nav width | **192px** (`12*16`), absolute, `top:0; right:100%` | `_ic_app_layout.scss` |
| Right sidebar | **288px** (`12*24`) + `24px` left padding | `_variables.scss`, `_ic_app_layout.scss` |
| Secondary pane padding | `24px` | `_ic_app_layout.scss` |
| Legacy widths / box padding (mostly unused) | left `175px`, right `286px`, min main `510px`, max main `1100px`; content padding `15px`, box padding `8px` | `_variables.scss` |
| Breakpoint mixins | `mobile`, `tablet`, `desktop`, `desktop--nav-open` | `canvas:app/stylesheets/base/mixins/_breakpoints.scss` (names only; px values not read — **UNVERIFIED**) |

**Gutter conventions:** Canvas spacing is a 12px grid for chrome (`12/24/36/48`), InstUI a 2/4/8/12/16/24/36/48/60
scale (`instui:…/spacing.ts`). Card padding roles: `paddingCardSmall 12px`, `paddingCardMedium 16px`,
`paddingCardLarge 24px`; `sections 36px`, `sectionElements 1.5em`. Inputs/selects/checkboxes all `1rem`.

## 5. Shape, depth, motion

| Token | Value | Source |
|---|---|---|
| Radius small / medium / large (InstUI) | `2px` / `4px` / `8px` | `instui:…/borders.ts` |
| Legacy button radius | **3px** (`$baseBorderRadius`) | `canvas:app/stylesheets/vendor/bootstrap/_variables.scss` |
| Legacy large button radius | `6px` (`$borderRadiusLarge`) | same |
| Canvas `$ic-border-radius` | `6px` (alerts, focus ring radius) | `canvas:_variables.scss` |
| Border widths | `1px` / `2px` / `4px` | `instui:…/borders.ts` |
| Shadow 1 (resting / card) | `0 1px 2px rgba(0,0,0,.2), 0 1px 3px rgba(0,0,0,.1)` | `instui:…/shadows.ts` |
| Shadow 2 (above / menu) | `0 3px 6px rgba(0,0,0,.1), 0 3px 6px rgba(0,0,0,.15)` | same |
| Shadow 3 (topmost / dialog) | `0 6px 7px rgba(0,0,0,.1), 0 10px 28px rgba(0,0,0,.25)` | same |
| Flash shadow | `0 1px 8px rgba(0,0,0,.25)` | `canvas:…/_alerts.scss` |
| Notification shadow | `0 1px 6px rgba(0,0,0,.2)` | same |
| Popover shadow | `0 5px 10px rgba(0,0,0,.2)` | `canvas:…/_ic-typography.scss` |
| Transition duration/timing | `300ms` / `ease-in-out` (InstUI); Canvas easing `cubic-bezier(0, 1, 0.5, 1)` (`$ic-transition`) | `instui:…/transitions.ts`; `canvas:_variables.scss` |
| Button transition | `background-color .2s ease-in-out`; InstUI content `background .2s, transform .2s` | `canvas:…/_buttons.scss`; `instui:…/BaseButton/v2/styles.ts` |
| Rail item transition | `background-color .3s, padding .3s` | `_ic_app_header.scss` |
| Nav tooltip pop | `transform .3s cubic-bezier(.175,.885,.32,1.275)` with `.3s` delay | same |
| Course menu slide | `transform 1s ease-in-out`, delay `.75s` | `_ic_app_layout.scss` |

## 6. Components

### 6.1 Buttons — two systems, pick one per surface

**Legacy `.Button` / `.btn`** (`canvas:app/stylesheets/components/_buttons.scss`, mixin `canvas-button` in `_ic_mixins.scss`):
height from padding, `padding: 8px 14px`, font-size 16px (`$ic-font-size--small` = 16px), `line-height` bootstrap base,
radius 3px, `transition background-color .2s`, `min-width/min-height 24px`, `overflow: hidden`.
Primary = `background: var(--ic-brand-button--primary-bgd)` (#2B7ABC), text white, `border: 1px solid` the *darkened-15*
shade; hover `darkened-5`; active `darkened-5` + no shadow; focus `box-shadow: inset 0 0 0 2px #fff`; disabled `opacity .5`.
Secondary (`.Button--secondary`, aliased with `.btn-info`) = `--ic-brand-button--secondary-bgd` (#273540) + white;
success #03893D; warning `$ic-color-alert` #F06E26 (orange30);
danger #E62429; size variants change font-size (large 18px, small 14px, mini 10px) and radius (large 6px, mini 2px);
their padding comes from bootstrap `$paddingLarge/Small/Mini`, whose literal values were **not read — UNVERIFIED**.

**InstUI `Button`** (`instui:packages/ui-buttons/src/BaseButton/v1/theme.ts` + `v2/styles.ts`):
`medium` height **38px** (`2.375rem`), padding `9px 12px`, font 16px; `small` height **28px**, padding `6px 8px`, font 14px;
`large` height **48px**, padding `11px 24px`, font 22px; all radius **4px**, border `1px`, weight **400**, line-height
`1.125`, letter-spacing normal, no text-transform. Icons 16/20/26px, gap 8px.
Primary bg `#2B7ABC`, border `darken(#2B7ABC)` (≈`#2468A2`, **COMPUTED**), hover/active bg `#0E68B3`, text white.
Secondary bg `#F2F4F4`, text `#273540`, border `#D7DADE`, hover `#E8EAEC`. Success `#03893D`→`#027634`;
danger `#E62429`→`#C71F23`. Active adds `inset 0 0 3px 1px <color>`. No drop shadow on any button (`primaryBoxShadow: none`).

### 6.2 Text inputs / selects

`instui:packages/ui-text-input/src/TextInput/v1/theme.ts`: height 38px (medium) / 28px (small) / 48px (large),
padding **12px**, border **1px solid `#8D959F`** (grey30 — noticeably darker than card borders), radius **4px**,
font 16px, background `#FFFFFF`, placeholder `#6A7883`; focus **2px outline in `#2B7ABC`** (Canvas override
`focusOutlineColor: ic-brand-primary`); error border+outline `#E62429`. Labels sit above the field, 16px, weight 400.
Hint/help text 12px `$ic-hint-text`. Error text `#E62429` with `outline: 1px solid` on legacy inputs (`canvas:…/_forms.scss`).

### 6.3 Checkboxes / radios

InstUI v2 (`instui:packages/ui-checkbox/src/Checkbox/v2/styles.ts`) builds padding as
`calc(gap + controlSize{Sm,Med,Lg})` with an invisible native input over a rendered control; exact `controlSize*`,
`gap`, checked fill and radius live in the generated `newThemeTokens` theme (**UNVERIFIED** — that folder is not
present in the public tree at this commit). Visually Canvas checkboxes are ~16px squares with a 4px radius, 1px gray
border, brand-blue fill and white check, 8px label gap; treat those as **APPROXIMATE**. Current app already uses a
16px (`h-4 w-4`) box with 5px radius — only the radius and accent colour need to change.

### 6.4 Pills / badges

InstUI Pill (`instui:…/Pill/v2/styles.ts`, `…/designTokensV1/components/pill/canvas.ts`): height **24px**,
`border-radius: full`, `border: 1px solid`, padding `0 8px`, font 14px weight 400 (leading status label weight 700),
max-width 240px, bg `#FFFFFF`, base text `#273540`, base border `#D7DADE`; colour variants swap text/border to the
status tokens in §2.3. Canvas-native `.ic-badge` (`canvas:…/_ic-badge.scss`): 20px circle, 11px text, radius 10px,
padding `0 6px`, bg `#2B7ABC`, white text; neutral `#F2F4F4`/`#273540`; success/alert/danger fills.
Legacy two-part `.pill` (`canvas:…/_pill.scss`): 1em radius, `1px solid rgba(0,0,0,.25)`, shadow `0 1px 0 #fff`,
segments padded `0 10px` with 1px separators.

### 6.5 Avatars

`canvas:…/_avatars.scss`: **50px**, `border: 2px solid #D3D9D9`, `border-radius: 500px`, cover background.
Global-nav avatar: 30px (36px expanded) with 2px `#FFFFFF` border (`_SideNav.scss`); 50px in the rail markup
(`_ic_app_header.scss`). Masquerade/student-view avatar border switches to `#C54396` (`$ic-color-action`).

### 6.6 Breadcrumbs / topbar

`canvas:…/_breadcrumbs.scss` + `_ic_app_layout.scss`: strip min-height **72px**, 1px `#E8EAEC` bottom border,
horizontal margin 24px; crumb text **18px**; separator is a 5×9px arrow SVG with `0 9px` margins; last crumb `#273540`,
ancestors link-blue; first (home) crumb is visually hidden. A 36px×30px nav-toggle button sits left of the crumbs
(`.ic-app-course-nav-toggle`), and action buttons to the right get 12px gaps.

### 6.7 Tabs

Legacy jQuery-UI tabs (`canvas:…/_tabs.scss`): tab links `padding: 8px 14px`, weight normal, link-blue, no shadow;
active tab = white bg + `#E8EAEC` border all round; hover = white bg + border, text `#273540`; panel padding 14px with
`#E8EAEC` border; `--mini` variant `4px 8px`. InstUI Tabs used on newer pages render a 48px-tall tab row with a 2px
bottom indicator in brand blue — **UNVERIFIED** for this repo.

### 6.8 Tables

`canvas:…/_tables.scss` (`.ic-Table`): full width, collapsed borders, cell padding **`14px 7px`**, line-height 1.3,
vertical-align middle, 1px bottom border; `th` border `#6A7883` (dark) bold; `td`/`tbody th` border `#E8EAEC`.
Condensed: `7px` padding, 14px font. Striped odd rows `#F2F4F4`. Hover row `#E0EBF5`, `transition background-color .3s`.
`thead` on legacy `.table` is `#E4E9ED` (`_ic-typography.scss`). Scroll container: 8px scrollbar, `rgba(0,0,0,.5)` thumb.

### 6.9 Alerts, flash messages, toasts

Inline `.alert` (`canvas:…/_alerts.scss`): padding `12px 36px 12px 12px`, radius **6px**, no border in normal contrast;
info `#E0EBF5`/`#334451`, success `#DCEEE4`/`#03893D`, warning & danger `#FCE4E5`/`#CF4A00` resp. `#E62429`.
Flash message: white card, **2px** border in status colour, radius **6px**, shadow `0 1px 8px rgba(0,0,0,.25)`,
padding `6px 40px 6px 48px`, min-width 272px, max-width 512px, line-height 1.3, with a 36px-wide solid colour icon block
bleeding to the left edge and a close link 4px from the right.
Notification (persistent): 2px border, 48px icon block, radius 3px, shadow `0 1px 6px rgba(0,0,0,.2)`, body padding 12px.
The app's current `sonner` toasts should adopt the flash shape (white, 2px status border, 6px radius, left icon block).

### 6.10 Menus, popovers, dialogs

Legacy jQuery-UI menu (`canvas:app/stylesheets/vendor/jqueryui/_jquery.ui.menu.scss`): background `#E6E7E9`,
border `#B0AFAF`, radius **3px**, 8px carat. Popover (`_ic-typography.scss`): width 236px, 1px `rgba(0,0,0,.2)` border,
radius 6px, shadow `0 5px 10px rgba(0,0,0,.2)`, 14px text, padding `1px` (+`9px 14px` when padded).
Modern Canvas uses InstUI Popover/Menu: radius 4px, shadow depth 2, 12–16px item padding — exact item height is in the
generated theme and is **UNVERIFIED**. Dialog radius/shadow for `.ic-Modal`: **UNVERIFIED**; InstUI default would be
4px + shadow depth 3, and the app's current 24px (`rounded-3xl`) dialogs are far rounder than Canvas.

### 6.11 Empty states

`canvas:…/_empty-state.scss`: dashed **2px** border, radius **12px**, padding 12px, centered; icon **13rem (208px)**,
label 18px in link blue; hover/focus turns border+text link-blue. Inline empty lists use 12px vertical padding with
1px dotted `#E8EAEC` separators.

## 7. Iconography

- Set: InstUI `@instructure/ui-icons` — Canvas imports named glyphs such as `IconEditLine`, `IconRefreshLine`,
  `IconWarningLine` (`canvas:ui/features/user_logins/react/SuspendedIcon.jsx`, `ui/shared/context-modules/utils/FetchError.tsx`).
- Style: the Canvas-era `Icon*Line` family is an outline/line-art drawing implemented as **filled SVG paths** (colour
  comes from `fill`), not CSS strokes. Current InstUI `master` also ships stroke-based Lucide icons with a
  size→stroke-width map (`instui:packages/ui-icons/src/styles.ts`, `props.ts`); which family Canvas's pinned InstUI
  exposes is **UNVERIFIED**. For a Canvas look, draw 1.5–2px line icons and colour with `currentColor`.
- Sizes: 16px in buttons (`iconSizeSmall 1rem`), 20px medium, 26px large; global nav **26px**; breadcrumb separator 5×9px;
  empty-state illustration 208px. Icons are `display:inline-block; vertical-align:middle; line-height:0`.
- Semantic icon colours: `baseColor #273540`, `mutedColor` gray, `success #03893D`, `error #E62429`, `warning #CF4A00`, `info/brand #2B7ABC`, `onColor #FFFFFF` (`instui:…/ui-icons/src/styles.ts` token map).
- Legacy Canvas also ships an icon **font** (`icon-*` classes, `canvas:app/stylesheets/components/_canvas-icons.scss`)
  used by `.Button--icon-action` etc. Do not reimplement the font; use SVG.

## 8. Focus and accessibility

| Pattern | Value | Source |
|---|---|---|
| Base focus | `outline: 2px solid transparent` (`ic-focus-base`) | `canvas:…/_ic_mixins.scss` |
| Visible focus | `outline-color: var(--ic-link-color)`, offset `0` (inline) or `2px` (`ic-focus-variant-inst`, adds 6px radius) | same |
| Text input focus | 2px outline `#2B7ABC` (brand), no glow shadow | `instui:…/TextInput/v1/theme.ts` |
| Legacy button focus | `inset 0 0 0 2px` white (on colour) or link-blue (on light) | `button-focus-light/dark`, `_ic_mixins.scss` |
| Rail focus | `inset 0 0 0 2px #6A7883, inset 0 0 0 4px #FFFFFF`; active item uses white + `--ic-brand-…text-color--active` | `_ic_app_header.scss` |
| Content skip target | 2px solid link-blue outline, offset `-2px` | `_ic_app_layout.scss` |
| Contrast claim | Canvas theme “meets WCAG 2.1 AA rules for color contrast” | `instui:…/themes/canvas/index.ts` |

Body text `#273540` on white ≈ 12.6:1; link `#0E68B3` on white ≈ 5.7:1; `#6A7883` on white ≈ 4.54:1 (AA for normal text,
just); white on `#2B7ABC` ≈ 4.55:1 — passes AA at 16px but with no margin, which is why Canvas puts body-size links in the
darker `#0E68B3` and keeps `#2B7ABC` for 16px/700 or large labels only. (Ratios **COMPUTED** with WCAG 2.1 relative luminance.)

## 9. Tailwind CSS 4 `@theme` translation

Strategy: **keep the app's existing semantic token names** (`paper/surface/card/line/ink/accent`) so the 100+ existing
utility usages re-skin without markup edits, and change their *values* to Canvas. Add new names only for chrome/status.

```css
@theme {
  /* surfaces: Canvas page is white, panels are porcelain */
  --color-paper: #f2f4f4;        /* surfacePageSecondary */
  --color-surface: #ffffff;      /* surfacePagePrimary */
  --color-card: #ffffff;
  --color-line: #e8eaec;         /* dividers */
  --color-line-strong: #d7dade;  /* component strokes */
  --color-ink: #273540;          /* textBody */
  --color-ink-soft: #586874;     /* metadata */
  --color-ink-mute: #6a7883;     /* labels, AA on white */
  --color-placeholder: #9ea6ad;

  /* brand: two blues on purpose */
  --color-accent: #2b7abc;       /* buttons, active nav */
  --color-accent-ink: #0a5a9e;   /* blue70: darkened primary for hover / text-on-tint */
  --color-accent-soft: #e0ebf5;  /* info tint */
  --color-accent-soft-ink: #0e68b3;
  --color-link: #0e68b3;         /* links only */
  --color-focus: #2b7abc;

  /* chrome */
  --color-rail: #334451;
  --color-rail-hover: #273540;
  --color-rail-text: #ffffff;
  --color-rail-active: #2b7abc;
  --color-rail-active-bg: #ffffff;

  /* status */
  --color-success: #03893d;  --color-success-soft: #dceee4;  --color-success-ink: #027634;
  --color-warning: #cf4a00;  --color-warning-soft: #fce5d9;  --color-warning-ink: #b34000;
  --color-danger:  #e62429;  --color-danger-soft:  #fce4e5;  --color-danger-ink:  #c71f23;

  /* type */
  --font-sans: "Lato Extended", Lato, "Helvetica Neue", Helvetica, Arial, sans-serif;
  --font-mono: Menlo, Consolas, Monaco, "Andale Mono", monospace;
  --text-h1: 1.8rem;  --text-h1--line-height: 1.5;
  --text-h2: 1.8rem;  --text-h2--line-height: 1.5;
  --text-h3: 1.5rem;  --text-h3--line-height: 1.5;
  --text-h4: 1.125rem;

  /* radius: Canvas is square */
  --radius-sm: 3px;      /* legacy buttons */
  --radius-md: 4px;      /* InstUI buttons, inputs, cards */
  --radius-lg: 6px;      /* alerts, popovers */
  --radius-card: 4px;
  --radius-pill: 9999px;

  /* elevation */
  --shadow-card: 0 1px 2px rgba(0, 0, 0, 0.2), 0 1px 3px rgba(0, 0, 0, 0.1);
  --shadow-menu: 0 3px 6px rgba(0, 0, 0, 0.1), 0 3px 6px rgba(0, 0, 0, 0.15);
  --shadow-dialog: 0 6px 7px rgba(0, 0, 0, 0.1), 0 10px 28px rgba(0, 0, 0, 0.25);

  /* motion */
  --ease-canvas: cubic-bezier(0, 1, 0.5, 1);
  --ease-pop: cubic-bezier(0.175, 0.885, 0.32, 1.275);
}
```

Naming contract for the rest of the app:

| Use | Class | Because |
|---|---|---|
| Page background | `bg-paper` | Canvas secondary surface |
| Cards, sidebar, popovers, inputs | `bg-surface` / `bg-card` | white |
| Any 1px rule | `border-line` | dividers |
| Inputs, outlined buttons, table header | `border-line-strong` | component stroke |
| Body text | `text-ink` | #273540 |
| Metadata, help text | `text-ink-soft` | #586874 |
| Uppercase micro-labels | `text-ink-mute` | 4.5:1 on white |
| Links, inline actions | `text-link hover:underline` | #0E68B3 |
| Primary CTA | `bg-accent text-white rounded-md` | #2B7ABC, 4px |
| Info callout | `bg-accent-soft text-accent-soft-ink` | #E0EBF5 |
| Destructive | `bg-danger text-white` / `text-danger-ink` | |
| Cards | `rounded-card border border-line` | 4px, 1px |
| Floating surfaces | `rounded-lg shadow-menu` | 6px |
| Dialogs | `rounded-md shadow-dialog` | 4px, not 24px |

## 10. Fidelity notes and gotchas

1. **Only ~18 colour variables are brandable** (7 global + 11 nav in `brandable_variables.json`, plus login-page ones).
   Everything else (neutrals, status colours, type, radii, shadows) is hard-coded in SCSS/InstUI tokens. Don't build the
   redesign around “what a school can change”.
2. **Two blues, never one.** `#2B7ABC` = fills/active state; `#0E68B3` = links and link-hover. Collapsing them is the
   single most common giveaway that a skin is not Canvas.
3. **InstUI vs legacy `.Button` differ.** Legacy: 3px radius, 16px text, `8px 14px` padding, no min-height.
   InstUI: 4px radius, 38px tall, `9px 12px`, hover goes to the *link* blue. Choose InstUI for “modern Canvas”.
4. **Headings are regular weight and barely bigger than body.** h1/h2 = 28.8px, h3 = 24px, weight 400. If the app keeps
   bold 32–36px headings it will not read as Canvas.
5. **Radii are the cheapest signal.** Current app uses 12–24px radii everywhere; Canvas uses 3/4/6px. Halving radii plus
   Lato plus the blue swap gets ~80% of the look before any layout change.
6. **Input borders are darker than card borders** (`#8D959F` vs `#D7DADE`). Using one gray for both flattens the forms.
7. **Nav metrics changed over versions.** Current master: 54px collapsed / 84px expanded; `$ic-header-primary-expanded-width:
   180px` is dead code (1 code-search hit, in `_variables.scss` only). Older screenshots showing a 180px expanded rail are
   from the pre-2021 nav — do not copy them.
8. **High-contrast variant rewrites the palette** (`$use_high_contrast`): success `#02672D`, danger `#AE1B1F`,
   medium grays `#4A5B68`, borders forced to `#6A7883`, body background white. If accessibility modes are in scope,
   branch on it instead of copying normal values.
9. **Muted text has no fixed hex.** `--ic-brand-font-color-dark-lightened-15/-28` are generated from the tenant's dark
   colour (`≈#445C70`/`≈#5D7E99` for the default `#273540`) — **COMPUTED, not in the repo**.
10. **Fonts must be self-hosted.** Canvas serves Lato woff2 from its asset pipeline; the repo declares stacks only. Lato is
    SIL OFL, so vendor `Lato-Regular/700` (and optionally 300) locally — do not rely on Google Fonts at runtime.
11. **Canvas is light-content-only.** There is a dark global nav but no dark content theme in the Canvas default; InstUI's
    `dark` theme exists but is not what Canvas ships. Don't invent a dark mode as part of the re-skin.
12. **Legacy icon font will not translate.** Reimplement icons as 1.5–2px-stroke SVGs at 16/20/26px, coloured by
    `currentColor`, rather than copying `icon-*` glyph names.
13. **Canvas’s page is white; the app’s `paper` is not.** Canvas paints the page/card surface white (`surfacePagePrimary`)
    and uses `#F2F4F4` only for wells and secondary panels (`surfacePageSecondary`). A dark 54px rail supplies the visual
    contrast. Nailong Planner has no rail, so mapping `paper → #F2F4F4` is a deliberate adaptation: it preserves
    sidebar/card separation. If a rail is added later, switch `paper` to `#FFFFFF` and let borders do the work.

### Not verified in this pass

- Exact InstUI version Canvas pins (network fetch of `package.json` was blocked in the sandbox; the repo imports
  `@instructure/ui-*` packages directly — version **UNVERIFIED**). Breakpoint pixel values (`mobile`/`tablet`/`desktop`)
  are likewise unread: mixin names confirmed only.
- InstUI component-theme numbers generated into `packages/ui-themes/src/themes/newThemeTokens` (checkbox control sizes,
  menu item heights, modal radius): that folder is absent from the public tree at this commit — **UNVERIFIED/APPROXIMATE**.
- The mechanism/selector that emits `--ic-brand-*` custom properties (`lib/brandable_css.rb` not inspected).
- Course/global header height outside the breadcrumb strip; Canvas uses per-page colored headers whose height was not read.
