# Handoff

_Last updated: 2026-08-26._

## Where things stand

- **Live site runs 1.8.5** (snelgraveren.nl), installed by Martin and verified: the served
  `frontend-designer` JS and CSS are byte-identical to the local build.
- **1.8.6 is built and handed over, NOT yet uploaded.** Four fixes from a `/code-review ultra` over
  `master...HEAD`; two of them cost something real (a merchant-added image never reached the
  production file; an empty text field was billed). Verified inside the ZIP itself, not by name or
  date. Uploading it is Martin's next action — check which folder row on `plugins.php` says
  "Deactiveren" afterwards.
- **Branch `feature/bitmap-ruler-text` is 58 commits ahead of `master` and NOT merged.** Master is
  behind by nothing, so a merge would be a clean fast-forward. That is Martin's call.
- **wordpress.org still has 1.7.8** (r3657251, published 2026-08-20). Everything since is Freemius /
  direct-upload only. If a wp.org release is wanted, run `bash bin/wporg-release.sh` in a real
  terminal — see the release rules in CLAUDE.md.
- ZIPs in the project dir: `…-1.8.6.zip` (**upload this one**) and `…-1.8.5.zip` (the version now
  live, kept deliberately so a rollback is one upload away). Older 1.8.x ZIPs were deleted on
  purpose so the wrong one cannot be uploaded — prune 1.8.5 once 1.8.6 is confirmed live.

## What shipped in the 1.8.x cycle

Ten defects through 1.8.5, every one of them found by Martin using the tool — none by the test
suite or by the branch review, which had declared the branch ready. Three were design decisions of
mine, not slips. 1.8.6 breaks that pattern: its four came from a deeper review pass, before a
customer hit them.

| Version | Change |
|---------|--------|
| 1.8.0 | LightBurn bitmap import, mm ruler, centred text placement, minimum font size (mm), shape-aware image placement, per-layer padlock governs customers |
| 1.8.1 | oversized object no longer pinned by the rect clamp; font-size input mangling; selection box measured against the fallback font; builder rendered the wrong typeface; text never re-measured once the font arrived |
| 1.8.2 | svg-boundary clamp no longer teleports mid-drag or pins an oversized object; stale bounding rect let objects drift ~80px outside their zone |
| 1.8.3 | designer fills the room it is given (up to 2x); export pinned to the logical canvas so the customer's window no longer decides the production resolution |
| 1.8.4 | LightBurn bitmaps at the size LightBurn shows; builder canvas takes the import's size without a view switch; locked layers show a red padlock that stays visible |
| 1.8.5 | the imported container zone no longer claims customer element types; an element belonging to no zone is kept on the canvas |
| 1.8.6 | a merchant-added image is customer content again (was locked behind the canvas and stripped from every export); empty text is no longer billed; imported bitmap scale keeps 6 decimals so it still registers with the cut lines; the import reads the store after its uploads, not before |

## Open — needs Martin, not code

1. **Five live templates still have the claiming `Imported` zone**: tpl 22 acacia (2630), tpl 7
   leeuwtje (1979), tpl 6 olifantje (1988), tpl 4 wolfje (1991), tpl 5 vosje (2007). Fix: open that
   zone in the builder and untick text/image/svg. Templates 15, 17 and 20 are already done.
   Existing templates are deliberately NOT migrated by code.
2. **Nearly every design zone is `behavior: clip`, not `restrict`.** Clip only masks what falls
   outside the shape; the customer can still drag an element out and order it that way. Only tpl 15
   (Boundary) and tpl 1 Dog-Tags have a real restrict zone. This is a decision, not a bug.
   Also: tpl 20's GraveerGebied is 605x246 on a 600x245 canvas — larger than the canvas, so it
   bounds nothing.
3. **Modal display mode is still off on all 9 designer products.** It is a per-product setting
   (`_pf_display_mode`). Embedded gains only ~32% from 1.8.3 because Astra caps the product-tab
   column at ~790px; the modal is what actually unlocks the 2x ceiling.
4. **Two plugin folders on live** — `productforge/` active, `snelgraveren-product-designer/` dormant.
   Tidying is safe while `sgpd_delete_data_on_uninstall` is 0 (verified 2026-08-25) but should be a
   deliberate action. See CLAUDE.md → Deployment.

## Open — code, deliberately deferred

- **`minScaleLimit` is cached per object.** Text created before a canvas resize keeps a font floor
  computed against the old mm/px until permissions are re-applied. Only bites when a template
  already contains text and is then imported into. Left alone because it touches font-floor logic
  that several tasks converged on; it deserves its own task.
- **`allowed_types` means two things** — what customers may add, and what the merchant may drag into
  a zone in the tree panel. Nobody is stuck, but they deserve separating.
- **The Add tab goes empty on an import-only view** (no design zone defined). Honest, but abrupt.
  If that needs softening, the fix is a hint in the Add tab, not giving the zone claim back.

## Environment notes

- `admin`/`admin` does NOT exist on the local Docker install any more — it runs a copy of the live
  shop's database, so the administrator is `martin.temmink`. A throwaway `pf-dev-test` administrator
  (ID 18) exists locally only.
- Importing a `.lbrn2` uploads its embedded bitmaps to the media library BEFORE any save, so a
  verification import writes to the DB even when nothing is saved through the UI.
