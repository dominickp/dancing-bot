#!/usr/bin/env tsx
/**
 * extract-chart.ts — Extract a measure range from a simfile chart
 * and output it as a TypeScript SteppingScenario literal.
 *
 * Usage:
 *   npx tsx scripts/extract-chart.ts --file example-simfiles/Ferrari/Ferrari.sm \
 *       --difficulty Challenge --meter 9 --from 4 --to 10
 *
 * Options:
 *   --file <path>         Path to .sm or .ssc file
 *   --difficulty <name>   Chart difficulty (Challenge, Hard, Medium, Easy, Beginner, Edit)
 *   --meter <number>      Chart meter (level number)
 *   --chart-index <n>     Alternative to --difficulty/--meter: 0-based chart index
 *   --from <measure>      Starting measure (inclusive, 0-based)
 *   --to <measure>        Ending measure (exclusive)
 *   --json                Output as JSON instead of TypeScript
 *   --summary             Print a human-readable summary of the excerpt
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the project root relative to this script
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

// We import from the compiled/transpiled source — tsx handles .ts resolution
import { parseSimfile, type Panel, type SimfileChart } from "../src/lib/simfile";

// ---- CLI argument parsing ----

interface CliArgs {
  file: string;
  difficulty?: string;
  meter?: number;
  chartIndex?: number;
  fromMeasure: number;
  toMeasure: number;
  json: boolean;
  summary: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: Record<string, string | boolean> = {};
  const flags = new Set(["--json", "--summary"]);

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === undefined) continue;

    if (flags.has(arg)) {
      args[arg.slice(2)] = true;
      continue;
    }

    const next = argv[i + 1];

    if (next !== undefined && !next.startsWith("-")) {
      args[arg.slice(2)] = next;
      i++;
    }
  }

  const file = args.file as string | undefined;
  const difficulty = args.difficulty as string | undefined;
  const meterRaw = args.meter as string | undefined;
  const chartIndexRaw = args["chart-index"] as string | undefined;
  const fromRaw = args.from as string | undefined;
  const toRaw = args.to as string | undefined;

  if (!file) {
    console.error("Missing required argument: --file");
    process.exit(1);
  }

  if (!fromRaw || !toRaw) {
    console.error("Missing required arguments: --from and --to");
    process.exit(1);
  }

  const fromMeasure = Number(fromRaw);
  const toMeasure = Number(toRaw);

  if (!Number.isInteger(fromMeasure) || fromMeasure < 0) {
    console.error("--from must be a non-negative integer");
    process.exit(1);
  }

  if (!Number.isInteger(toMeasure) || toMeasure <= fromMeasure) {
    console.error("--to must be an integer greater than --from");
    process.exit(1);
  }

  const result: CliArgs = {
    file: path.resolve(file),
    fromMeasure,
    toMeasure,
    json: Boolean(args.json),
    summary: Boolean(args.summary),
  };

  if (chartIndexRaw !== undefined) {
    const chartIndex = Number(chartIndexRaw);

    if (!Number.isInteger(chartIndex) || chartIndex < 0) {
      console.error("--chart-index must be a non-negative integer");
      process.exit(1);
    }

    result.chartIndex = chartIndex;
  } else {
    if (!difficulty) {
      console.error("Missing --difficulty (or use --chart-index)");
      process.exit(1);
    }

    result.difficulty = difficulty;

    if (meterRaw !== undefined) {
      const meter = Number(meterRaw);

      if (!Number.isInteger(meter) || meter < 1) {
        console.error("--meter must be a positive integer");
        process.exit(1);
      }

      result.meter = meter;
    }
  }

  return result;
}

// ---- Chart finding ----

function findChart(
  charts: SimfileChart[],
  args: CliArgs,
): { chart: SimfileChart; index: number } {
  if (args.chartIndex !== undefined) {
    const chart = charts[args.chartIndex];

    if (!chart) {
      console.error(
        `Chart index ${args.chartIndex} not found. Available: 0..${charts.length - 1}`,
      );

      for (let i = 0; i < charts.length; i++) {
        const c = charts[i]!;
        console.error(`  [${i}] ${c.difficulty} ${c.meter} — "${c.description}"`);
      }

      process.exit(1);
    }

    return { chart, index: args.chartIndex };
  }

  const candidates = charts
    .map((chart, index) => ({ chart, index }))
    .filter(
      ({ chart }) =>
        chart.difficulty.toLowerCase() === args.difficulty!.toLowerCase(),
    );

  if (candidates.length === 0) {
    console.error(
      `No chart found with difficulty "${args.difficulty}". Available difficulties:`,
    );

    for (const c of charts) {
      console.error(`  ${c.difficulty} ${c.meter} — "${c.description}"`);
    }

    process.exit(1);
  }

  if (args.meter !== undefined) {
    const byMeter = candidates.filter(
      ({ chart }) => chart.meter === args.meter,
    );

    if (byMeter.length === 1) {
      return byMeter[0]!;
    }

    if (byMeter.length > 1) {
      console.error(
        `Multiple charts with difficulty "${args.difficulty}" meter ${args.meter}. Use --chart-index:`,
      );

      for (const { chart, index } of byMeter) {
        console.error(`  [${index}] ${chart.difficulty} ${chart.meter} — "${chart.description}"`);
      }

      process.exit(1);
    }

    console.error(
      `No ${args.difficulty} chart with meter ${args.meter}. Available:`,
    );

    for (const { chart } of candidates) {
      console.error(`  ${chart.meter} — "${chart.description}"`);
    }

    process.exit(1);
  }

  if (candidates.length === 1) {
    return candidates[0]!;
  }

  console.error(
    `Multiple charts with difficulty "${args.difficulty}". Use --meter to disambiguate or --chart-index:`,
  );

  for (const { chart, index } of candidates) {
    console.error(`  [${index}] ${chart.meter} — "${chart.description}"`);
  }

  process.exit(1);
}

// ---- Note row parsing helpers ----

const PANEL_SYMBOLS: Panel[] = ["left", "down", "up", "right"];

interface RowNote {
  beat: number;
  taps: string[];
  holdHeads: string[];
  rollHeads: string[];
  holdTails: string[];
  mines: string[];
}

function parseRow(row: string, beat: number): RowNote | null {
  const result: RowNote = {
    beat,
    taps: [],
    holdHeads: [],
    rollHeads: [],
    holdTails: [],
    mines: [],
  };
  let hasNotes = false;

  for (let i = 0; i < Math.min(row.length, 4); i++) {
    const symbol = PANEL_SYMBOLS[i]!;
    const ch = row[i]!;

    switch (ch) {
      case "1":
        result.taps.push(symbol);
        hasNotes = true;
        break;
      case "2":
        result.holdHeads.push(symbol);
        hasNotes = true;
        break;
      case "3":
        result.holdTails.push(symbol);
        hasNotes = true;
        break;
      case "4":
        result.rollHeads.push(symbol);
        hasNotes = true;
        break;
      case "M":
      case "m":
        result.mines.push(symbol);
        hasNotes = true;
        break;
    }
  }

  return hasNotes ? result : null;
}

function panelSymbol(panel: Panel): string {
  switch (panel) {
    case "left": return "L";
    case "down": return "D";
    case "up": return "U";
    case "right": return "R";
  }
}

function panelsToString(panels: string[]): string {
  return panels.map((p) => panelSymbol(p as Panel)).join("");
}

// ---- Extraction ----

interface ExtractedStep {
  beat: number;
  taps?: string;
  notes?: string;
  holdHeads?: string;
  holdTails?: string;
  rollHeads?: string;
  mines?: string;
}

interface ExtractedScenario {
  bpms: { beat: number; bpm: number }[];
  offset: number;
  stops: { beat: number; durationSeconds: number }[];
  steps: ExtractedStep[];
}

function extractScenario(
  chart: SimfileChart,
  simfile: ReturnType<typeof parseSimfile>,
  fromMeasure: number,
  toMeasure: number,
): ExtractedScenario {
  const steps: ExtractedStep[] = [];

  for (const measure of chart.measures) {
    if (measure.index < fromMeasure || measure.index >= toMeasure) {
      continue;
    }

    const rowCount = measure.rows.length;

    measure.rows.forEach((row, rowIndex) => {
      const beat = measure.index * 4 + (rowIndex * 4) / rowCount;
      const parsed = parseRow(row, beat);

      if (!parsed) return;

      const step: ExtractedStep = { beat };

      if (parsed.taps.length > 0) {
        step.notes = panelsToString(parsed.taps);
      }

      if (parsed.holdHeads.length > 0) {
        step.holdHeads = panelsToString(parsed.holdHeads);
      }

      if (parsed.rollHeads.length > 0) {
        step.rollHeads = panelsToString(parsed.rollHeads);
      }

      if (parsed.holdTails.length > 0) {
        step.holdTails = panelsToString(parsed.holdTails);
      }

      if (parsed.mines.length > 0) {
        step.mines = panelsToString(parsed.mines);
      }

      steps.push(step);
    });
  }

  // Filter BPMS and STOPS to relevant range
  const endBeat = toMeasure * 4;
  const relevantBpms = simfile.bpms.filter((b) => b.beat < endBeat);

  // Ensure there's at least one BPM entry at beat 0
  if (relevantBpms.length === 0 || relevantBpms[0]!.beat > 0) {
    const lastBefore = simfile.bpms
      .filter((b) => b.beat <= fromMeasure * 4)
      .at(-1);

    relevantBpms.unshift({
      beat: 0,
      bpm: lastBefore?.bpm ?? 120,
    });
  }

  const relevantStops = simfile.stops.filter(
    (s) => s.beat >= fromMeasure * 4 && s.beat < endBeat,
  );

  return {
    bpms: relevantBpms,
    offset: simfile.metadata.offset,
    stops: relevantStops,
    steps,
  };
}

// ---- Output formatting ----

function formatStepTs(step: ExtractedStep): string {
  const parts: string[] = [];

  parts.push(`beat: ${step.beat.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`);

  if (step.notes) {
    parts.push(`notes: "${step.notes}"`);
  }

  if (step.holdHeads) {
    parts.push(`holdHeads: "${step.holdHeads}"`);
  }

  if (step.rollHeads) {
    parts.push(`rollHeads: "${step.rollHeads}"`);
  }

  if (step.holdTails) {
    parts.push(`holdTails: "${step.holdTails}"`);
  }

  if (step.mines) {
    parts.push(`mines: "${step.mines}"`);
  }

  return `      { ${parts.join(", ")} },`;
}

function formatScenarioTs(
  scenario: ExtractedScenario,
  title: string,
  fromMeasure: number,
  toMeasure: number,
): string {
  const lines: string[] = [];

  lines.push(`// ${title} — measures ${fromMeasure}–${toMeasure - 1}`);
  lines.push("// Generated by extract-chart.ts");
  lines.push("");

  if (scenario.offset !== 0) {
    lines.push(`// offset: ${scenario.offset}`);
  }

  lines.push("const scenario: SteppingScenario = {");

  if (scenario.offset !== 0) {
    lines.push(`  offset: ${scenario.offset},`);
  }

  if (scenario.bpms.length > 1 || (scenario.bpms.length === 1 && scenario.bpms[0]!.bpm !== 120)) {
    lines.push("  bpms: [");
    for (const bpm of scenario.bpms) {
      lines.push(`    { beat: ${bpm.beat}, bpm: ${bpm.bpm} },`);
    }
    lines.push("  ],");
  }

  if (scenario.stops.length > 0) {
    lines.push("  stops: [");
    for (const stop of scenario.stops) {
      lines.push(`    { beat: ${stop.beat}, durationSeconds: ${stop.durationSeconds} },`);
    }
    lines.push("  ],");
  }

  lines.push("  steps: [");

  for (const step of scenario.steps) {
    lines.push(formatStepTs(step));
  }

  lines.push("  ],");
  lines.push("};");
  lines.push("");
  lines.push("// To use in a test:");
  lines.push("// import { buildSteppingScenario } from \"../test/steppingScenario\";");
  lines.push("// const { document, timedChart, holdEndBeats } = buildSteppingScenario(scenario);");
  lines.push("// const botTimeline = buildBotTimeline(timedChart.events, holdEndBeats, document);");

  return lines.join("\n");
}

function formatScenarioJson(scenario: ExtractedScenario): string {
  return JSON.stringify(scenario, null, 2);
}

// ---- Summary ----

function printSummary(
  chart: SimfileChart,
  scenario: ExtractedScenario,
  fromMeasure: number,
  toMeasure: number,
): void {
  console.log(`Chart: ${chart.difficulty} ${chart.meter} — "${chart.description}"`);
  console.log(`Measures: ${fromMeasure}–${toMeasure - 1} (${scenario.steps.length} note rows)`);
  console.log("");

  // Group steps by measure
  for (let m = fromMeasure; m < toMeasure; m++) {
    const measureSteps = scenario.steps.filter(
      (s) => Math.floor(s.beat / 4) === m,
    );

    if (measureSteps.length === 0) continue;

    console.log(`Measure ${m} (${measureSteps.length} rows):`);

    for (const step of measureSteps) {
      const beatInMeasure = step.beat - m * 4;
      const kinds: string[] = [];

      if (step.notes) kinds.push(`tap[${step.notes}]`);
      if (step.holdHeads) kinds.push(`hold-head[${step.holdHeads}]`);
      if (step.rollHeads) kinds.push(`roll-head[${step.rollHeads}]`);
      if (step.holdTails) kinds.push(`hold-tail[${step.holdTails}]`);
      if (step.mines) kinds.push(`mine[${step.mines}]`);

      console.log(`  beat ${beatInMeasure.toFixed(3).padEnd(7)} ${kinds.join(" ")}`);
    }

    console.log("");
  }

  // Pattern analysis
  console.log("Pattern analysis:");

  const tapOnly = scenario.steps.filter((s) => s.notes && !s.holdHeads && !s.rollHeads && !s.mines);
  const jumps = tapOnly.filter((s) => s.notes && s.notes.length >= 2);
  const holds = scenario.steps.filter((s) => s.holdHeads);
  const mines = scenario.steps.filter((s) => s.mines);

  console.log(`  Taps: ${tapOnly.length} (${jumps.length} jumps)`);
  console.log(`  Holds: ${holds.length}`);
  console.log(`  Mines: ${mines.length}`);

  // Check for crossover patterns (adjacent taps on opposite sides)
  let crossoverCount = 0;

  for (let i = 1; i < scenario.steps.length; i++) {
    const prev = scenario.steps[i - 1]!;
    const curr = scenario.steps[i]!;

    if (!prev.notes || !curr.notes) continue;
    if (prev.notes.length !== 1 || curr.notes.length !== 1) continue;

    const prevPanel = prev.notes;
    const currPanel = curr.notes;
    const leftRight = new Set(["L", "R"]);
    const bothSides = leftRight.has(prevPanel) && leftRight.has(currPanel) && prevPanel !== currPanel;

    if (bothSides) crossoverCount++;
  }

  if (crossoverCount > 0) {
    console.log(`  Potential crossovers: ${crossoverCount}`);
  }
}

// ---- Main ----

function main(): void {
  const args = parseArgs(process.argv);
  const source = fs.readFileSync(args.file, "utf-8");
  const simfile = parseSimfile(source);
  const { chart } = findChart(simfile.charts, args);

  const scenario = extractScenario(
    chart,
    simfile,
    args.fromMeasure,
    args.toMeasure,
  );

  if (args.summary) {
    printSummary(chart, scenario, args.fromMeasure, args.toMeasure);
  }

  if (args.json) {
    console.log(formatScenarioJson(scenario));
  } else {
    const title = `${simfile.metadata.title || path.basename(args.file)} — ${chart.difficulty} ${chart.meter}`;

    console.log(formatScenarioTs(scenario, title, args.fromMeasure, args.toMeasure));
  }
}

main();