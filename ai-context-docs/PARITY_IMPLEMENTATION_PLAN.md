# Step Parity Implementation Plan

## Goal
Re-implement the ITGMania step parity algorithm in this project so the dancing bot can assign foot and foot part (heel or toe) more accurately, especially for:

- footswitches
- crossovers
- brackets
- hold-related edge cases

## Current Understanding
The existing bot logic assigns feet greedily inside `buildBotTimeline` in `src/components/DancingBotWindow.tsx`.
That heuristic does not search across future rows, so it fails on patterns where the best decision depends on later context.

The imported ITGMania code does three key things:

1. Converts note data into row-based intermediate structures with active holds, mines, and timing context.
2. Generates all legal foot-part placements for each row.
3. Runs a cheapest-path search across row states using a transition cost model.

## Implementation Plan

### Phase 1
- Add TypeScript parity domain types for rows, states, foot parts, and stage layout.
- Add a row builder that groups chart events into parity rows with hold context.
- Add dance-single stage geometry and legal placement permutation generation.

### Phase 2
- Port the ITGMania state transition and cost model.
- Run dynamic programming across chart rows to choose the cheapest path.
- Output per-row foot assignments including heel and toe.

### Phase 3
- Integrate parity output into bot timeline generation.
- Replace greedy left/right assignment with parity-driven motion generation.
- Preserve existing rendering and timing behavior where possible.

### Phase 4
- Add config toggles by altering costs or forbidding behaviors.
- Initial targets:
  - disable crossovers
  - discourage or disable brackets
  - discourage or disable footswitches
  - allow more double-stepping when desired

## Known Gaps
- The current web simfile parser does not yet expose fake and warp timing data.
- First pass should still work for ordinary `.sm` charts and many `.ssc` charts, but full parity fidelity may need parser expansion later.

## Progress Log

### 2026-05-24
- [x] Audited the current bot assignment seam and the copied ITGMania parity sources.
- [x] Identified the integration point: replace greedy assignment inside `buildBotTimeline`.
- [x] Added `src/lib/parity.ts` with row extraction, dance-single stage layout, legal placement generation, state transitions, and costed path search.
- [x] Integrated parity output into `buildBotTimeline` with heuristic fallback if parity assignment fails.
- [x] Added foot-part metadata and bracket-aware foot poses to the bot timeline model.
- [x] Added a config seam for future UI toggles by threading optional parity config through the timeline builder.
- [x] Validated the integration with `npm run build`.
- [x] Wired parity config into visible bot UI toggles for crossovers, brackets, and footswitches.
- [x] Reorganized bot controls into collapsible Appearance and Behavior sections and simplified behavior toggle labels.
- [x] Added optional parity hint markers in the notefield to expose parsed crossover, bracket, footswitch, double-step, and spin rows for debugging.
- [x] Updated bot animation playback so footswitches synthesize a releasing foot handoff, brackets light both panels and span them with one foot, and crossovers rotate both feet as a body turn.
- [x] Fixed synthetic footswitch releases so they only fire when the prior foot still occupies that panel, which avoids false double-landing on Ferrari's second left crossover.
- [x] Refined footswitch animation so the outgoing foot lifts in place over the shared panel during the handoff beat instead of sliding away before its next real step.
- [x] Smoothed crossover turn-in and moved crossed outer-panel landings inward/upward so Ferrari's up-to-left crossover no longer snaps rotation or overextends off the pad.
- [x] Tuned crossover support-foot stance so the planted back foot shifts deeper into the turn and matches the crossed foot's facing angle more closely during Ferrari's step 4-5 body turn.
- [x] Made crossover turn blending and support-foot offsets form-aware so narrower and angled bot forms now inherit the same Ferrari crossover body-turn behavior as Straight Wide.
- [x] Added anticipatory crossover support-foot turning so the planted foot can rotate into its turned down-arrow landing during step-in, instead of landing neutral and snapping afterward.
- [x] Split crossover anticipation from crossing-foot rotation so the support foot can pre-turn into step 4 without making the crossing foot glitch or pre-rotate between Ferrari steps 3 and 4.
- [x] Fixed parity hint double-step labeling to respect the same jump/hold guards as the actual cost model, avoiding false double-step diagnostics on multi-foot rows.
- [x] Made the Bracket behavior toggle actually bias the parity solver toward simple two-note brackets instead of only making brackets legal while still preferring jumps.
- [x] Added a simple adjacent-row bracket override so bracket mode resolves bracketable outer+vertical two-note rows as brackets in both parity hints and bot foot-part assignments.
- [x] Fixed the TypeScript stage-layout bracket geometry check so diagonal pairs like left+down and left+up are actually considered bracketable instead of failing on floating-point comparison.
- [x] Added parity regression tests covering adjacent bracket detection and a simple crossover pattern.
- [x] Corrected directional heel/toe assignment for simple bracket overrides so down-facing brackets place heel on down and toe on the side arrow.
- [x] Fixed crossover turn timing so the crossing foot only starts rotating once its own crossover move begins, avoiding abrupt pre-rotation on the preceding step.
- [x] Limited hard support-foot crossover turning to actual brace phases so the non-crossing foot keeps a readable orientation instead of mirroring the crossing foot.
- [x] Corrected crossover body-facing direction and added immediate support-foot anticipation so right-facing and left-facing crossover states stay visually consistent through entry and exit steps.
- [x] Fixed crossover-facing regression by deriving left-facing versus right-facing body turn from the support foot's up/down setup panel, restoring early left-facing Ferrari crossovers while preserving the later mirrored right-facing case.
- [x] Fixed a beat-16 crossover snap by holding the active crossed stance through the row instead of switching body facing to the support foot's next exit step immediately after the crossover lands.
- [x] Smoothed crossover exit rotations by keeping the crossover state active while the crossing foot walks out, then blending the body turn back to neutral over the exit move progress.
- [x] Added animation regression tests around small purpose-built crossover charts so foot placement, facing direction, separation, and crossover exit smoothing can be checked without relying on manual Ferrari inspection.
- [ ] Expand parser support for fakes and warps if full `.ssc` fidelity is needed.

## Notes
This file will be updated as implementation progresses.
