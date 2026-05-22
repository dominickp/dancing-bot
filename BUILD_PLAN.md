# Dancing Bot Build Plan

## Goal
Build a desktop-style web app that loads a StepMania simfile, plays the chart and audio in sync, renders a scrolling notefield, and animates two feet on a 4-panel pad using configurable foot-assignment rules.

## Proposed Stack
- TypeScript
- React + Vite for UI
- Canvas or PixiJS for note/foot animation rendering
- Web Audio API for playback timing
- StepMania `.sm` parser built in-repo first, with room to expand later

## Reference Baseline
- Use ITGMania behavior as the timing and playback reference.
- Use Simply Love as the primary UI and notefield reference for receptor placement, note colors, explosions, and minimap behavior where applicable.
- Start by matching observable behavior first; noteskin/theme file compatibility can follow after the core renderer is stable.

## Delivery Phases

### 1. Project foundation
Status: In progress
- Scaffold the app and set up TypeScript, linting, and basic test coverage.
- Define core domain models: song metadata, timing data, notes, holds, mines, jumps, measures, foot states.
- Add a sample import path using the provided example simfile.
- Capture a short reference checklist from ITGMania/Simply Love so visual and timing comparisons stay concrete during implementation.
Progress update: App scaffold is in place and the sample simfile is wired into the UI. Linting, tests, and the reference checklist still need to be added before this phase is complete.

### 2. Simfile and timing engine
Status: In progress
- Parse `.sm` files into normalized chart data.
- Build beat-to-time and time-to-beat conversion from BPM stops/warps as needed.
- Validate parsed output against the sample chart before UI work expands.
Progress update: Initial metadata, BPM, stop parsing, beat-to-time conversion, timed note-event generation, and time-to-beat conversion are implemented. Warps and broader timing edge cases still need work.

### 3. Playback and notefield
Status: In progress
- Render a StepMania-style scrolling notefield with fixed receptors.
- Support play/pause from current position, mouse-wheel scrubbing, and `Ctrl + scroll` speed changes.
- Show measure counters, quantization colors, hold notes, mines, and target hit effects.
- Add a minimap for fast seeking.
Progress update: The app now exposes a timed event stream and renders a toolbar-plus-full-page notefield preview with fixed receptors, measure guides, quantization colors, chart difficulty switching, basic hold bodies, receptor hit explosions, play/pause via Space, page-wide scroll scrubbing, page-wide Ctrl + wheel zoom, sample audio playback synced to the playhead, a clickable minimap for fast seeking, a transform-based scroll layer, and an interpolated playback clock that reduces per-frame React work for smoother zoomed playback. Full hold behavior and richer hit effects still need work.

### 4. Foot assignment engine
Status: Not started
- Implement the default rules from the README:
  - feet stay on their last panel
  - left prefers left, right prefers right
  - up/down are chosen from prior state
  - streams alternate feet when appropriate
  - jacks reuse the same foot
- Represent state transitions explicitly so they can drive animation and later rule variants.

### 5. Pad and foot animation
Status: Not started
- Render a top-down 4-panel pad with two shoe silhouettes.
- Animate lift, travel, press, and release states.
- Keep arrows lighting and foot motion synchronized to chart timing.
- Support holds by pinning the foot to the active panel until release.

### 6. Advanced movement rules
Status: Not started
- Add toggles for footswitches and crossovers.
- Define conflict-resolution rules when multiple interpretations are possible.
- Add form presets starting with a basic/straight form and structure the code so heels out, toes out, and slanted can be added later.

### 7. Noteskin and asset compatibility
Status: Not started
- Start with an internal default noteskin.
- Research the minimum subset needed for StepMania noteskin compatibility and add an import layer after the base renderer is stable.
- Keep the rendering abstraction separate from parsing so noteskin support does not block core playback.
- Use the local ITGMania and Simply Love installations as the first source for checking actual file layout and asset conventions during this phase.

## Initial Milestone
First milestone should be a thin vertical slice:
- load the sample `.sm`
- play audio in sync
- render the scrolling chart
- animate basic left/right/up/down foot placement without advanced patterns

This slice will prove the timing model, rendering approach, and foot-state architecture before adding noteskin compatibility and advanced movement logic.

## Build Order Rationale
- Timing correctness is the foundation for both the notefield and the foot animation.
- Foot assignment should be a pure engine with deterministic outputs before animation polish.
- Noteskin compatibility is valuable but should come after the core playback/animation loop works.
- A defined StepMania/ITGMania reference reduces guesswork and keeps the project aligned with expected chart-player behavior.

## Open Decisions To Confirm
- Web app only, or Electron/Tauri wrapper later for a desktop app feel.
- Whether StepMania noteskin compatibility means full file compatibility or a supported subset first.
- Whether advanced timing features beyond standard BPM/stop handling are required in v1.