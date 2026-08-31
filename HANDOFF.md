# Handoff

_Last updated: 2026-08-31._

## Where things stand

- **Live site runs 1.12.0** (snelgraveren.nl), uploaded by Martin on 2026-08-31 and verified as
  guest the same day: readme Stable tag 1.12.0; `GET /pf/v1/font-groups` returns Martin's first
  two real groups ("Display", "Handwriting") — so Migration1300 ran; the designer product page
  (hondenpenning) serves 200 with the no-cache headers intact and the hashed bundle
  `frontend-designer.1cc7e481.js`, md5-identical to the local `dist/frontend-designer.js`.
  Single plugin folder `snelgraveren-product-designer/`. The `…-1.12.0.zip` in the project dir is
  the live build (keep as rollback anchor next to 1.11.x).
- **Groups are live but not yet attached to templates** — per template: builder → Settings →
  Fonts → tick group(s). Nothing changes for a template until that's done (opt-in by design).
- **`master` is current, NOT pushed** since `b7299ef` (1.11.4). Local commits on top:
  `feat(fonts)` fontgroepen, `chore(release): 1.12.0`, plus this docs commit. Push when convenient.
- **wordpress.org still has 1.7.8** (r3657251). A wp.org release would now also ship font groups
  to free users minus management (mutations live in the already-stripped
  `class-rest-fonts-admin.php`, so the three premium strip lists needed NO changes — verified).
- **Freemius Deployment**: neither 1.11.x nor 1.12.0 confirmed pushed to Freemius — live updates
  happen via direct ZIP upload only (dev-licence site, Freemius pushes nothing).

## What shipped in 1.12.0 (2026-08-31)

**Font groups** — spec `docs/superpowers/specs/2026-08-31-font-groups-design.md`, design details
in CLAUDE.md ("Font groups resolve at READ time" under Database Tables).

- New admin page **Product Designer → Fonts** (`sgpd-fonts`, React app `admin/js/fonts/`, fifth
  Vite entry `admin-fonts`): create/rename/delete groups, tick fonts per group (web-safe, Google
  and custom uploads alike, each previewed in its own face), plus central custom-font upload.
- Template builder Settings → Fonts: tick groups alongside the individual font list; preview of
  the resolved union. `TreePanel`/`ZoneForm`/Google-font loading use the same
  `resolveAllowedFonts()` union.
- **Core mechanism**: templates store only group ids (`global_config.allowed_font_groups`);
  `get_public_template()` expands them into `allowed_fonts` at read time (union, dedup, deleted
  ids skipped, ids stripped from the payload). Adding a font to a group therefore reaches every
  template using that group instantly — existing ones included. The customer designer is
  untouched. Verified end-to-end on dev through the real UI (group → builder → save → public
  payload; then group edited → payload updated without touching the template).
- Tables 11 → 13: `wp_pf_font_groups` + `wp_pf_font_group_members` (family-name strings, UNIQUE
  (group_id, family), FK cascade). `FontRepository::delete_family()` also removes the family from
  every group. Uninstaller/SystemStatus updated.
- **Drive-by fix**: the uninstaller listed `pf_clipart_items` instead of the real `pf_clipart`, so
  that table was never dropped on uninstall-with-data-deletion. Fixed.

## Open — needs Martin, not code

1. **Tick font groups on the templates that should use them** (builder → Settings → Fonts) — the
   groups themselves ("Display", "Handwriting") already exist on live.
2. **Guest-design retention still at 30 days** — Martin asked about 14; setting exists under
   Product Designer → Settings.
3. **Five live templates still have the claiming `Imported` zone**: tpl 22 acacia (2630), tpl 7
   leeuwtje (1979), tpl 6 olifantje (1988), tpl 4 wolfje (1991), tpl 5 vosje (2007).
4. **Nearly every design zone is `behavior: clip`, not `restrict`** — a decision, not a bug.
5. **Modal display mode still off on all designer products** (`_pf_display_mode`).
6. **wordpress-mcp token is expired** (server rejected it with 403 this session) — renew it if
   Claude should reach the live site directly.

## Open — code, deliberately deferred

- **Proof flow browser route still unverified end-to-end** (send → logged-out open → request
  change → resend → approve → checkout). PHPUnit-green only.
- **12 pre-existing jest failures** in `AddTab.test.js` / `Sidebar.test.js` — predate 1.11.x.
- **lbrn writer limits** (wave/circle presets, rasters, open 2-point paths) — explicit, reported
  in `skipped`; see the 1.11 handoff history in git if needed.
- **Template transfer & font groups**: exported templates carry `allowed_font_groups` ids that
  mean nothing on another site — harmless (resolution skips unknown ids silently), but a future
  import warning à la the unknown-font warning would be friendlier.

## Environment notes (updated 2026-08-31 — the previous note was half wrong)

- **Two Docker stacks with different databases.** The repo's `docker compose up` runs as project
  `productforge` (symlink-derived name) with its OWN volume: NOT the live-DB copy. That stack is
  where 1.12.0 was verified; it has admin `pf-dev-test` / `pf-dev-test-2026` and
  `SGPD_LICENSE_KEY` (dev hash) in wp-config so premium gates pass in CLI and browser. The
  live-copy DB lives in the `productdesigner` stack (admin `martin.temmink`); both can't run at
  once (port 3306). `docker ps` tells you which is up. Details in CLAUDE.md → Development
  Environment.
- The productforge stack's system status complains about non-writable `uploads/pf-*` dirs —
  container permission quirk of that fresh volume, unrelated to code.
