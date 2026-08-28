# dancing-bot

A dancing bot, based off of ArrowVortex's dancing bot but with support for different "forms".

The app ships with bundled example simfiles, so users can immediately try the preview without importing their own song folder first. But you can also load your own chart.

## Controls
Controls are based on ArrowVortex. Everything can be used without a mouse — all wheel/drag interactions have keyboard equivalents. Press `?` in the app anytime (or use the `Controls` toolbar button) for the full reference dialog.

Keyboard (works with only a trackpad, or no pointing device at all):
- `SPACE` toggles playback
- `↑` / `↓` navigate through the chart (`Page Up` / `Page Down` for bigger jumps, `Home` / `End` for start / end)
- `-` / `+` zoom the notefield in / out (spaces the notes out)
- `←` / `→` slide the notefield side to side to recenter it (hold `SHIFT` for fine steps)
- Minimap: focus it with `TAB` and use `↑` / `↓` (±1 beat), `Page Up` / `Page Down` (±4 beats), `Home` / `End`
- Bot window: focus the header with `TAB` and use the arrow keys to move it, or focus the resize corner to resize it (`SHIFT` for fine steps); the header `Reset` button restores the default position

Mouse / trackpad:
- Scroll wheel (or two-finger trackpad scroll) navigates through the chart
- CTRL + scroll zooms you in to the chart (spaces out the notes)
- Click-drag the notefield to move it side to side
- Click or drag the minimap to seek
- Drag the bot window header to move it; drag the bottom-right corner to resize it

## TODO / Known issues
- Add assist tick sound
- Hands not yet supported

## Run
```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
```

## Test

```bash
npm test
npm run test:coverage
npm run perf
```

Use `src/test/steppingScenario.ts` for compact, table-driven parity and bot-motion scenarios. The performance suite measures production hot paths against bundled charts and labels each chart with its event count.

