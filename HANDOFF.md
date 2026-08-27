# Handoff

_Last updated: 2026-08-27._

## Where things stand

- **Live site runs 1.11.2** (snelgraveren.nl), uploaded by Martin on 2026-08-27, single plugin
  folder `snelgraveren-product-designer/`. The 1.11.x cycle shipped in one day, driven by a real
  incident: a paying customer's borrelplank (order 2678) exported as a bitmap instead of vectors.
- **`master` is current and pushed** (fast-forward merge of `feature/bitmap-ruler-text`,
  2026-08-27, head `59e9345`; both branches pushed to origin). New work can branch from master.
- **wordpress.org still has 1.7.8** (r3657251). Everything since is direct-upload/Freemius only.
  A wp.org release of 1.11.x would ship the export fixes to free users: run
  `bash bin/wporg-release.sh` in a real terminal (see CLAUDE.md release rules). No new premium
  paths were added in 1.11.x (the lbrn writer lives in the shared frontend bundle; only the
  REST/UI gate is Pro), so the free-build strip lists did not need changes — but re-check the
  `chk` lines anyway before any wp.org push.
- **Freemius Deployment for 1.11.2 premium** has not been confirmed done — only the direct upload
  to the live site. If other premium installs ever exist, they update via Freemius.
- ZIPs in the project dir: `…-1.11.2.zip` (live; note it was REBUILT at 15:43 after a
  security-review fix — the 15:41 build lacked the realpath containment), `…-1.11.1.zip`,
  `…-1.11.0.zip`, `…-1.9.0.zip` (kept as rollback anchors; prune the older ones at will).

## What shipped in the 1.11.x cycle (all on 2026-08-27)

| Version | Change |
|---------|--------|
| 1.11.0 | The export overhaul. (1) `fix(export)`: curved-text designs silently exported as bitmaps — Fabric 6.9.1 emits malformed XML for a rotated+styled tspan char, the sanitizer refused it, the empty column was skipped, no error anywhere. Now repaired + validated + loud. Zone overlays/clipPaths/baseline curves stripped; "SVG" = glyph outlines at measured position+rotation (proof-exact, 0.00 mm on all six text blocks of order 2678); "SVG + fonts" = curved text as `<textPath>`; real mm on the root. (2) `feat(export)`: native LightBurn `.lbrn2` as fourth format — editable Text shapes with the bend, placement model CALIBRATED against LightBurn's own SVG re-exports over five iterations (v1→v6, all under ±1.5 mm). New column `export_lbrn` (migration 1200), gate = svg_export. |
| 1.11.1 | Production dashboard bulk ZIP carries every available format per design (was: only the configured default, i.e. PDF). Missing formats land in a LEESMIJ file instead of sinking the download. |
| 1.11.2 | "Delete design" on the Designs page (drafts etc.; ordered designs refused; deletes thumbnails + export files, realpath-contained to uploads/). Automatic guest-draft retention unchanged (Settings, default 30 days — Martin may want 14). |

The knowledge that made the lbrn calibration work (Bend arc model, Av/Ah semantics, the anchor
formula, per-line shapes) lives in memory `project_lbrn_export`; the export-pipeline rules live in
CLAUDE.md → Architecture → Export. The verification harness is `tools/export-check/` — run it
against a saved design JSON before trusting any export change.

## Data state on live (2026-08-27)

- Order 2678 (borrelplank, proof approved, paid cash): design still `status = draft` — the
  ordered-flip only happens on real checkouts. Harmless; flip via the admin REST route if wanted.
- All 5 non-empty `ordered` designs re-saved (content verified unchanged) so their `export_lbrn`
  is filled; exports #72–76 generated. Two July designs (`f9ab6695`, `b5e91851`) have NO views at
  all — deletable with the new button.
- Designs saved before 1.11.0 have no LightBurn data until re-saved (reopen link → save). The
  Production-ZIP LEESMIJ points this out when it happens.

## Open — needs Martin, not code

1. **Guest-design retention still at 30 days** — Martin asked about 14; setting exists under
   Product Designer → Settings. Deliberately not changed by code.
2. **Five live templates still have the claiming `Imported` zone**: tpl 22 acacia (2630), tpl 7
   leeuwtje (1979), tpl 6 olifantje (1988), tpl 4 wolfje (1991), tpl 5 vosje (2007). Fix by hand
   in the builder (untick text/image/svg on that zone).
3. **Nearly every design zone is `behavior: clip`, not `restrict`** — customers can drag elements
   out and order them that way. A decision, not a bug.
4. **Modal display mode still off on all designer products** (`_pf_display_mode`); embedded caps
   the canvas at ~790px under Astra.

## Open — code, deliberately deferred

- **Proof flow browser route still unverified end-to-end** (send → logged-out open → request
  change → resend → approve → checkout). PHPUnit-green only.
- **12 pre-existing jest failures** in `AddTab.test.js` / `Sidebar.test.js` — they predate the
  1.11.x work (verified against a clean HEAD via stash) and are unrelated to exports.
- **lbrn writer limits, all explicit and reported in `skipped`**: wave/circle presets cannot be an
  arc bend (fall back = absent from the file, listed); raster images are never included; open
  2-point paths are dropped BY LIGHTBURN on import (frames/closed paths survive).
- **`minScaleLimit` cached per object**; **`allowed_types` means two things**; **Add tab empty on
  import-only views** — unchanged from the previous handoff.

## Environment notes

- Local Docker stack runs as project `productdesigner` (containers `productdesigner-wordpress-1`
  etc.). A stray `docker compose up` from the repo symlink tries to start a SECOND stack named
  `productforge` and fails on port 3306 — use the running containers via
  `docker exec productdesigner-wordpress-1 …`.
- Local DB is a copy of the live shop; admin is `martin.temmink`, throwaway `pf-dev-test` (ID 18)
  exists locally only. Local db_version is 1200 (migration tested there before live).
