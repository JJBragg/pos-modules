# 08 — White-label branding

Requirements: WL-1..WL-9. Decision D-11. Prototype: use the "Host app" switcher; every screen re-themes from the host's variables, name and logo.

## 1. Layout — `views/layouts/support.liquid`

```liquid
<!DOCTYPE html>
<html class="pos-app {{ theme_class }}" lang="{{ context.language }}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{{ page_title }} · {{ brand.app_name }}</title>
  <link rel="manifest" href="/support-desk/manifest.json">
  <meta name="theme-color" content="{{ brand.theme_color }}">
  <link rel="icon" href="{{ brand.favicon_url }}">
  {% render 'modules/common-styling/init', reset: true %}
  <link rel="stylesheet" href="{{ 'modules/support/style/pos-support.css' | asset_url }}">
  {% function host_head = 'modules/core/queries/headscripts/search' %}{{ host_head }}
  {% render 'modules/push_notifications/init', service_worker_path: '/support-desk/sw.js' %}
</head>
<body class="pos-support">
  {% render 'modules/support/shell', brand: brand, current: current, counts: counts, content: content_for_layout %}
</body>
</html>
```
- Order matters: common-styling → module CSS → **host headscripts last**, so host variable overrides win (WL-2).
- `theme_class`: the host's preference (`pos-theme-darkEnabled` or `pos-theme-dark`) from `brand.theme_mode`; default automatic (WL-3).
- The layout reads `brand` from `helpers/branding` once per request (settings come from the per-request memo in `helpers/settings`).
- Verify `function` inside the layout `<head>` renders before use (Playbook: put `graphql`/`function` above every use).

## 2. Styling rules (WL-1)

- Only common-styling classes (`pos-button`, `pos-form`, `pos-table`, `pos-tag`, `pos-card`, `pos-toast`, `pos-dialog`, `pos-popover`, `pos-avatar`, `pos-collapsible`…) and module classes prefixed `pos-support-`.
- `pos-support.css` uses only `var(--pos-*)` tokens for colour, font, radius and spacing, inside `@layer` so hosts override easily. No hex values except in §4.
- Module-specific derived tokens are defined from common-styling ones, e.g.:
  ```css
  :root {
    --pos-support-rail-background: var(--pos-color-content-background);
    --pos-support-rail-active: var(--pos-color-button-primary-background);
  }
  ```
  A host can restyle the rail (e.g. dark sidebar) by overriding `--pos-support-*` in its headscripts stylesheet — document all of them in the README.
- Verify every token name exists in the installed common-styling version (`/style-guide` lists them); a missing variable falls back silently.

## 3. Branding hook (WL-4, WL-5)

`lib/helpers/branding.liquid` builds `brand` with this precedence per key: Branding-settings override (`setting.branding_override`) → host hook → defaults.

Host hook (fired with `modules/core/commands/hook/fire`, `hook: 'support_branding'`, `merge_to_object: true`): the host adds `app/lib/hooks/hook_support_branding.liquid` returning:
```json
{
  "app_name": "Harbor City Permits",
  "short_name": "Harbor City",
  "logo_url": "…", "logo_dark_url": "…",
  "icon_url": "…512px png…", "favicon_url": "…",
  "theme_color": "#1d4f91", "background_color": "#ffffff",
  "theme_mode": "auto|light|dark",
  "support_email_name": "Harbor City Support"
}
```
The sidebar logo follows the rail's actual background: with both logos, `pos-support-ui.js` measures it and picks the light- or dark-background logo (a brand-coloured rail is dark in both colour schemes). Optional `rail_theme` (`auto|light|dark`) pins the choice. Defaults: `app_name` = the instance domain (`helpers/default_app_name`: the first label of a `*.platform-os.com` host, capitalised; otherwise the domain without `www.`); monogram icon generated from the first letter (module asset set); colours from common-styling.

The same `brand` feeds (WL-6): page titles and favicon, the rail logo, customer email templates (sender name, logo, link colour inline), agent alert emails, the PWA manifest, push `icon`, and the chat widget (I3).

## 4. Fixed semantic colours (WL-8)

Statuses, priorities and SLA states use module tokens defined once in `pos-support.css`, with light and dark values that keep 4.5:1 on both light and dark content backgrounds. Hosts may override them, but the README warns against it. Category → token:

| Token | Use | Light fg / bg |
|---|---|---|
| `--pos-support-status-new` | new | #07727a / #e2f4f5 |
| `--pos-support-status-open` | open | #175890 / #e6eef8 |
| `--pos-support-status-pending` | pending | #6b4300 / #fff3dc |
| `--pos-support-status-onhold-eng` | Waiting on deploy | #a3164f / #fdecf3 |
| `--pos-support-status-onhold` | on_hold | #405568 / #eff2f6 |
| `--pos-support-status-solved` | solved | #167b16 / #e8f5e8 |
| `--pos-support-priority-p0..p3` | priorities | #ffffff on #b62324 · #9a4410 / #fdeee2 · #175890 / #e6eef8 · #405568 / #eff2f6 |
| `--pos-support-sla-overdue/soon/ok/paused` | SLA text and bar | #b62324 · #9a4410 · text colour · supplementary |

Each badge also carries a triangle glyph and text, so meaning never depends on colour alone.

## 5. Branding settings page (WL-7)

`support-desk/settings/branding`: three source rows (host theme detected = headscripts hook returned content; host hook detected = `support_branding` returned keys; overrides), live preview (rail, button, link, status badge, install card, email "From"), and "Use the host app's branding" switch (on by default) that unlocks overrides for name, logos and icon (uploads go to a `setting`-owned upload via presigned URL).
