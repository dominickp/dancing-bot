# Agent Notes — dancing-bot

## Debugging the bot on a real chart

Two CLI tools let you extract and analyze the bot's behavior on specific simfile excerpts.

### `npm run extract` — chart excerpt → SteppingScenario

Pulls a measure range from any `.sm`/`.ssc` file and writes a ready-to-paste `SteppingScenario` TypeScript literal.

```bash
npm run extract -- \
  --file example-simfiles/Ferrari/Ferrari.sm \
  --difficulty Challenge --meter 9 \
  --from 4 --to 10
```

**When to use:** The user asks you to "look at X chart, the Y chart, between measures A and B." Run this to get the exact notes in the range as a compact `SteppingScenario`. Paste the output into a test or use it to reason about patterns.

**Flags:**
- `--summary` — human-readable breakdown (jump count, crossover hints, mines)
- `--json` — machine-readable output
- `--chart-index N` — alternative to `--difficulty`/`--meter`

### `npm run debug` — bot timeline analyzer

Runs the chart excerpt through the parity solver and bot timeline, printing per-step foot assignments, positions, angles, and parity diagnostics.

```bash
npm run debug -- \
  --file example-simfiles/Ferrari/Ferrari.sm \
  --difficulty Challenge --meter 9 \
  --from 7 --to 10
```

**When to use:** The user asks "explain what the bot is doing and what's wrong." Run this, read the output, and describe:
- Which foot goes where at each beat
- Where crossovers, brackets, footswitches, or double-steps occur (⚠ markers)
- Whether the foot assignment looks reasonable

**Config toggles** (test behavior changes):
- `--no-crossover` — forbid crossover moves
- `--no-bracket` — forbid bracket moves  
- `--no-footswitch` — forbid footswitch moves
- `--favor-jumps` — prefer jumps over brackets
- `--json` — machine-readable output

### `extractScenarioFromSimfile()` — programmatic helper

Exported from `src/test/steppingScenario.ts`. Use in tests to extract a measure range:

```ts
const source = fs.readFileSync("Ferrari.sm", "utf-8");
const scenario = extractScenarioFromSimfile(source, {
  difficulty: "Challenge", meter: 9,
  fromMeasure: 4, toMeasure: 10,
});
const { document, timedChart } = buildSteppingScenario(scenario);
```

### Test helpers

- `src/test/steppingScenario.ts` — `buildSteppingScenario()` for compact chart scenarios in tests: taps, holds, rolls, mines, BPM changes, stops.
- `src/components/DancingBotWindow.test.ts` — animation regression tests using `buildAnimationSnapshot()` and `sampleBotStateAtBeat()`.
- `src/components/DancingBotWindow.tsx` — exports `buildBotTimeline()` (runs parity solver, falls back to greedy), `sampleBotStateAtBeat()` (snapshot bot state at any beat).

### Quick commands

| Command | What |
|---------|------|
| `npm test` | Run all Vitest tests |
| `npm run build` | Type-check + Vite production build |
| `npm run dev` | Vite dev server |
| `npm run extract -- --help` | Extract CLI (args printed by script) |
| `npm run debug -- --help` | Debug CLI |