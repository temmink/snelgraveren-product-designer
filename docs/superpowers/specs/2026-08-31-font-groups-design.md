# Font Groups — Design

Date: 2026-08-31. Approved by Martin ("groepen + losse fonts", "alle fonts", "eigen admin-pagina", "Pro onder custom_fonts", "ik wil zelf bepalen wat er in een groep zit en hoe die heet").

## Goal

The merchant creates named font groups in the plugin admin and selects one or more groups per
template (alongside the existing individual font selection). Adding a font to a group later
propagates automatically to every template using that group — including existing ones.

## Core mechanism: resolve at read time, never store the expanded list

Templates store only group ids in `global_config.allowed_font_groups` (int[]). The server expands
groups to concrete family names in `RestTemplates::get_public_template()` — the same place color
palettes are already resolved — producing the flat `allowed_fonts` string array the customer
designer already consumes. The frontend designer needs **no changes**. Group edits are live
everywhere immediately; no migration of existing templates.

Merge rule: resolved `allowed_fonts` = union(individual `allowed_fonts`, members of every existing
group in `allowed_font_groups`), deduplicated, original order preserved (individual first, then
group members). Missing/deleted group ids are silently skipped.

## Database (Migration1300)

- `wp_pf_font_groups`: `id` BIGINT UNSIGNED AI PK, `name` VARCHAR(255), `created_at` DATETIME.
- `wp_pf_font_group_members`: `id` BIGINT UNSIGNED AI PK, `group_id` BIGINT UNSIGNED,
  `family` VARCHAR(191), `created_at` DATETIME; UNIQUE `(group_id, family)`; FK to
  `wp_pf_font_groups(id)` ON DELETE CASCADE (raw ALTER after dbDelta, like Migration500).
  Members are **family-name strings** so web-safe, Google and custom fonts can all belong to a
  group (Google/web-safe fonts have no `wp_pf_fonts` row).
- `FontGroupRepository` (static, mirrors `ClipartRepository`): `list_groups()` (with members),
  `get_group(id)`, `create_group(name)`, `rename_group(id, name)`, `delete_group(id)`,
  `set_members(id, families)` (replace whole list), `remove_family(family)` (cleanup on font
  family delete), `resolve_families(ids)` (for template resolution).
- Update: `DbManager` (version 1300), `Uninstaller` drop list, `SystemStatus` table check (11 → 13),
  CLAUDE.md table list.

## REST

- Free (`RestFonts`): `GET pf/v1/font-groups` — groups incl. members, public (mirrors clipart
  collections; used by the template builder and the new admin page).
- Premium (`RestFontsAdmin`, already `@fs_premium_only`): `POST /font-groups`,
  `PUT /font-groups/{id}` (name and/or members), `DELETE /font-groups/{id}` —
  `edit_sgpd_templates` + `Plugin::has_feature('custom_fonts')`. No `free-build.sh` changes needed.
- `FontRepository::delete_family()` also removes matching group member rows.

## Admin page "Fonts" (submenu `sgpd-fonts`)

New React app `admin/js/fonts/` (fifth Vite entry `admin-fonts`), pattern of the Clipart app:
font upload + library (web-safe / Google / custom with preview) and group management (create,
rename, delete, tick fonts per group). Client-side `UpgradePrompt` gate when not premium, like
Clipart. The upload UI inside the template builder (Settings → Fonts) stays.

## Template builder

`SettingsFonts.jsx` gains a "Fontgroepen" section above the individual selection: checkbox list of
groups → `global_config.allowed_font_groups`, plus a preview of the resolved total list. Store
default `allowed_font_groups: []`. Builder-internal font dropdowns (`TreePanel`, `ZoneForm`)
use the same resolved union client-side.

## Edge cases

- Delete group → members cascade; templates referencing the id skip it silently.
- Delete custom font family → member rows cleaned up.
- Empty selection (no groups, no fonts) → behavior unchanged (designer hides the picker).
- Free build: tables, resolution and GET exist (harmless); management endpoints are stripped,
  admin page shows UpgradePrompt.
