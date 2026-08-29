#!/usr/bin/env tsx
/**
 * debug-scenario.ts — Run a simfile chart excerpt through the
 * parity solver and bot timeline builder, printing per-step
 * diagnostics so the AI agent can explain what the bot does
 * and why it might be wrong.
 *
 * Usage:
 *   npx tsx scripts/debug-scenario.ts --file example-simfiles/Ferrari/Ferrari.sm \
 *       --difficulty Challenge --meter 9 --from 4 --to 10
 *
 * Options:
 *   --no-crossover     Disable crossover moves
 *   --no-bracket       Disable bracket moves
 *   --no-footswitch    Disable footswitch moves
 *   --favor-jumps      Prefer jumps over brackets
 *   --json             Output as JSON for machine consumption
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

import { parseSimfile, beatToSeconds } from "../src/lib/simfile";
import type { SimfileDocument, TimedNoteEvent } from "../src/lib/simfile";
import { buildSteppingScenario, extractScenarioFromSimfile } from "../src/test/steppingScenario";
import type { SteppingScenario, StepAtBeat } from "../src/test/steppingScenario";
import { buildBotTimeline, sampleBotStateAtBeat } from "../src/components/DancingBotWindow";
import type { BotStep } from "../src/components/DancingBotWindow";
import { buildParityAssignmentMap } from "../src/lib/parity";
import type { ParityFootPart, ParityRowDiagnostic, StepParityConfig } from "../src/lib/parity";

// ---- Types ----

interface DebugStepInfo {
  beat: number;
  timeSeconds: number;
  events: TimedNoteEvent[];
  leftFoot: {
    panel: string;
    footPart: string;
    isLifted: boolean;
    isHolding: boolean;
    isCentered: boolean;
    angle: number;
    x: number;
    y: number;
  } | null;
  rightFoot: {
    panel: string;
    footPart: string;
    isLifted: boolean;
    isHolding: boolean;
    isCentered: boolean;
    angle: number;
    x: number;
    y: number;
  } | null;
  parityDiags: string[];
}

interface DebugOutput {
  title: string;
  measures: string;
  config: StepParityConfig;
  steps: DebugStepInfo[];
}

// ---- CLI ----

interface DebugArgs {
  file: string;
  difficulty?: string;
  meter?: number;
  chartIndex?: number;
  fromMeasure: number;
  toMeasure: number;
  config: StepParityConfig;
  json: boolean;
}

function parseArgs(argv: string[]): DebugArgs {
  const flags = new Set([
    "--json",
    "--no-crossover",
    "--no-bracket",
    "--no-footswitch",
    "--favor-jumps",
  ]);
  const args: Record<string, string | boolean> = {};

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === undefined) continue;

    if (flags.has(arg)) {
      const key = arg.slice(2).replace(/-./g, (m) => m[1]!.toUpperCase());
      args[key] = arg === "--favor-jumps" ? true : false;
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
  const chartIndexRaw = args["chartIndex"] as string | undefined;
  const fromRaw = args.from as string | undefined;
  const toRaw = args.to as string | undefined;

  if (!file) {
    console.error("Missing --file");
    process.exit(1);
  }

  if (!fromRaw || !toRaw) {
    console.error("Missing --from and --to");
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

  const result: DebugArgs = {
    file: path.resolve(file),
    fromMeasure,
    toMeasure,
    config: {
      allowBrackets: args.noBracket === undefined ? true : !args.noBracket,
      allowCrossovers: args.noCrossover === undefined ? true : !args.noCrossover,
      allowFootswitches: args.noFootswitch === undefined ? true : !args.noFootswitch,
      favorJumpsOverBrackets: args.favorJumps === undefined ? true : Boolean(args.favorJumps),
    },
    json: Boolean(args.json),
  };

  if (chartIndexRaw !== undefined) {
    result.chartIndex = Number(chartIndexRaw);
  } else {
    result.difficulty = difficulty;

    if (meterRaw !== undefined) {
      result.meter = Number(meterRaw);
    }
  }

  return result;
}

// ---- Core analysis ----

function analyze(
  source: string,
  fromMeasure: number,
  toMeasure: number,
  config: StepParityConfig,
  chartIndex?: number,
  difficulty?: string,
  meter?: number,
): DebugOutput {
  const scenario = extractScenarioFromSimfile(source, {
    chartIndex,
    difficulty,
    meter,
    fromMeasure,
    toMeasure,
  });

  const simfile = parseSimfile(source);
  const { document, timedChart, holdEndBeats } = buildSteppingScenario(scenario);
  const botTimeline = buildBotTimeline(timedChart.events, holdEndBeats, document, config);

  // Build parity diagnostic map
  const parityResult = buildParityAssignmentMap(timedChart.events, holdEndBeats, document, config);
  const diagMap = new Map<number, string[]>();

  for (const diag of parityResult.diagnostics) {
    const key = Math.round(diag.beat * 1000);
    const kinds = diag.kinds.map((k) => k.replace(/-/g, " "));

    diagMap.set(key, (diagMap.get(key) ?? []).concat(kinds));
  }

  // Collect unique beat points (every distinct event beat)
  const beatSet = new Set<number>();

  for (const event of timedChart.events) {
    beatSet.add(event.beat);
  }

  const sortedBeats = Array.from(beatSet).sort((a, b) => a - b);

  // Sample bot state at each beat
  const steps: DebugStepInfo[] = [];

  for (const beat of sortedBeats) {
    const timeSeconds = beatToSeconds(
      beat,
      document.bpms,
      document.stops,
      document.metadata.offset,
    );
    const events = timedChart.events.filter(
      (e) => Math.abs(e.beat - beat) < 0.0001,
    );

    // Sample bot state a tiny bit after the beat (so step traversal picks up the step)
    const snapshot = sampleBotStateAtBeat(botTimeline, document, beat + 0.001);

    const diagKey = Math.round(beat * 1000);
    const parityDiags = diagMap.get(diagKey) ?? [];

    steps.push({
      beat,
      timeSeconds,
      events,
      leftFoot: snapshot.feet.left
        ? {
            panel: snapshot.feet.left.panel,
            footPart: snapshot.feet.left.footPart ?? "unknown",
            isLifted: snapshot.feet.left.isLifted,
            isHolding: snapshot.feet.left.isHolding,
            isCentered: snapshot.feet.left.isCentered,
            angle: Math.round(snapshot.feet.left.angle),
            x: Math.round(snapshot.feet.left.x),
            y: Math.round(snapshot.feet.left.y),
          }
        : null,
      rightFoot: snapshot.feet.right
        ? {
            panel: snapshot.feet.right.panel,
            footPart: snapshot.feet.right.footPart ?? "unknown",
            isLifted: snapshot.feet.right.isLifted,
            isHolding: snapshot.feet.right.isHolding,
            isCentered: snapshot.feet.right.isCentered,
            angle: Math.round(snapshot.feet.right.angle),
            x: Math.round(snapshot.feet.right.x),
            y: Math.round(snapshot.feet.right.y),
          }
        : null,
      parityDiags,
    });
  }

  const fullSimfile = parseSimfile(source);
  let title = fullSimfile.metadata.title || path.basename(args.file);

  return {
    title,
    measures: `${fromMeasure}–${toMeasure - 1}`,
    config,
    steps,
  };
}

// ---- Text formatting ----

const panelShort: Record<string, string> = {
  left: "L",
  down: "D",
  up: "U",
  right: "R",
  center: "·",
};

function eventSummary(events: TimedNoteEvent[]): string {
  const parts: string[] = [];

  for (const e of events) {
    const short = panelShort[e.panel] ?? e.panel;
    const kind = e.kind.replace(/-/g, " ");

    parts.push(`${short}:${kind}`);
  }

  return parts.join(" ") || "(empty)";
}

function printText(output: DebugOutput): void {
  console.log("=".repeat(70));
  console.log(`Chart excerpt: ${output.title}`);
  console.log(`Measures: ${output.measures}`);
  console.log(`Config: crossovers=${output.config.allowCrossovers}, ` +
    `brackets=${output.config.allowBrackets}, ` +
    `footswitches=${output.config.allowFootswitches}, ` +
    `favorJumpsOverBrackets=${output.config.favorJumpsOverBrackets}`);
  console.log("=".repeat(70));

  // Print timeline
  console.log("");
  console.log("BOT TIMELINE (per step):");
  console.log("");

  for (const step of output.steps) {
    const eventsStr = eventSummary(step.events);
    const leftStr = step.leftFoot
      ? `${panelShort[step.leftFoot.panel] ?? step.leftFoot.panel} ` +
        `part=${step.leftFoot.footPart} ` +
        `angle=${step.leftFoot.angle}° ` +
        `(${step.leftFoot.x},${step.leftFoot.y})` +
        (step.leftFoot.isLifted ? " LIFTED" : "") +
        (step.leftFoot.isHolding ? " HOLDING" : "") +
        (step.leftFoot.isCentered ? " CENTERED" : "")
      : "—";
    const rightStr = step.rightFoot
      ? `${panelShort[step.rightFoot.panel] ?? step.rightFoot.panel} ` +
        `part=${step.rightFoot.footPart} ` +
        `angle=${step.rightFoot.angle}° ` +
        `(${step.rightFoot.x},${step.rightFoot.y})` +
        (step.rightFoot.isLifted ? " LIFTED" : "") +
        (step.rightFoot.isHolding ? " HOLDING" : "") +
        (step.rightFoot.isCentered ? " CENTERED" : "")
      : "—";

    const diagStr = step.parityDiags.length > 0
      ? `⚠ ${step.parityDiags.join(", ")}`
      : "";

    console.log(
      `beat ${step.beat.toFixed(3).padEnd(8)} ` +
      `(t=${step.timeSeconds.toFixed(2)}s)`.padEnd(14) +
      ` events: ${eventsStr.padEnd(24)} ` +
      `| L: ${leftStr.padEnd(40)} ` +
      `| R: ${rightStr.padEnd(40)} ` +
      `${diagStr}`,
    );
  }

  // Print foot timeline summary
  console.log("");
  console.log("FOOT ASSIGNMENT SUMMARY:");
  console.log("");

  const leftSteps = output.steps
    .filter((s) => s.leftFoot && !s.leftFoot.isLifted && !s.leftFoot.isCentered)
    .map((s) => ({
      beat: s.beat,
      panel: panelShort[s.leftFoot!.panel] ?? s.leftFoot!.panel,
      part: s.leftFoot!.footPart,
    }));
  const rightSteps = output.steps
    .filter((s) => s.rightFoot && !s.rightFoot.isLifted && !s.rightFoot.isCentered)
    .map((s) => ({
      beat: s.beat,
      panel: panelShort[s.rightFoot!.panel] ?? s.rightFoot!.panel,
      part: s.rightFoot!.footPart,
    }));

  console.log(
    "Left:  " +
      leftSteps
        .map((s) => `${s.panel}(${s.part})`)
        .join(" → ") || "none",
  );
  console.log(
    "Right: " +
      rightSteps
        .map((s) => `${s.panel}(${s.part})`)
        .join(" → ") || "none",
  );

  // Summary statistics
  const parityIssues = output.steps.filter((s) => s.parityDiags.length > 0);

  if (parityIssues.length > 0) {
    console.log("");
    console.log(`PARITY ISSUES (${parityIssues.length} rows):`);

    for (const issue of parityIssues) {
      console.log(
        `  beat ${issue.beat.toFixed(3)}: ${issue.parityDiags.join(", ")}`,
      );
    }
  }

  console.log("");
  console.log("=".repeat(70));

  // Suggestion for next steps
  console.log("");
  console.log("To test programmatically:");
  console.log("");
  console.log(`npx tsx scripts/extract-chart.ts \\`);
  console.log(`  --file ${path.relative(process.cwd(), args.file)} \\`);
  console.log(`  --difficulty "${args.difficulty ?? 'Challenge'}" \\`);
  if (args.meter !== undefined) console.log(`  --meter ${args.meter} \\`);
  console.log(`  --from ${args.fromMeasure} --to ${args.toMeasure}`);
  console.log("");
}

function printJson(output: DebugOutput): void {
  console.log(JSON.stringify(output, null, 2));
}

// ---- Main ----

let args: ReturnType<typeof parseArgs>;

function main(): void {
  args = parseArgs(process.argv);
  const source = fs.readFileSync(args.file, "utf-8");
  const output = analyze(
    source,
    args.fromMeasure,
    args.toMeasure,
    args.config,
    args.chartIndex,
    args.difficulty,
    args.meter,
  );

  if (args.json) {
    printJson(output);
  } else {
    printText(output);
  }
}

main();