import { buildTimedChart, parseSimfile } from "../lib/simfile";
import type { BpmSegment, Panel, SimfileChart, SimfileDocument, StopSegment, TimedChart } from "../lib/simfile";

const panels: Record<string, Panel> = {
  L: "left",
  D: "down",
  U: "up",
  R: "right",
};

const panelIndexes: Record<Panel, number> = {
  left: 0,
  down: 1,
  up: 2,
  right: 3,
};

export interface StepAtBeat {
  beat: number;
  /** Tap panels. `notes` is retained as a shorthand for this property. */
  taps?: string;
  notes?: string;
  holdHeads?: string;
  holdTails?: string;
  rollHeads?: string;
  mines?: string;
}

export interface SteppingScenario {
  bpms?: readonly BpmSegment[];
  offset?: number;
  stops?: readonly StopSegment[];
  steps: readonly StepAtBeat[];
}

export interface BuiltSteppingScenario {
  document: SimfileDocument;
  timedChart: TimedChart;
  holdEndBeats: Map<string, number>;
}

const setNoteRowPanels = (
  row: string[],
  panelsToSet: string | undefined,
  value: string,
  beat: number,
): void => {
  if (!panelsToSet) {
    return;
  }

  for (const symbol of panelsToSet.toUpperCase()) {
    const panel = panels[symbol];

    if (!panel) {
      throw new Error(`Unknown step symbol: ${symbol}`);
    }

    const panelIndex = panelIndexes[panel];

    if (row[panelIndex] !== "0") {
      throw new Error(`Multiple note kinds assigned to ${symbol} at beat ${beat}`);
    }

    row[panelIndex] = value;
  }
};

const toNoteRow = (step: StepAtBeat): string => {
  const row = ["0", "0", "0", "0"];

  setNoteRowPanels(row, step.notes ?? step.taps, "1", step.beat);
  setNoteRowPanels(row, step.holdHeads, "2", step.beat);
  setNoteRowPanels(row, step.holdTails, "3", step.beat);
  setNoteRowPanels(row, step.rollHeads, "4", step.beat);
  setNoteRowPanels(row, step.mines, "M", step.beat);

  return row.join("");
};

const buildHoldEndBeats = (events: TimedChart["events"]): Map<string, number> => {
  const activeHeads = new Map<Panel, number>();
  const holdEndBeats = new Map<string, number>();

  for (const event of events) {
    if (event.kind === "hold-head" || event.kind === "roll-head") {
      activeHeads.set(event.panel, event.beat);
      continue;
    }

    if (event.kind !== "hold-tail") {
      continue;
    }

    const startBeat = activeHeads.get(event.panel);

    if (startBeat !== undefined) {
      holdEndBeats.set(`${event.panel}:${startBeat.toFixed(6)}`, event.beat);
      activeHeads.delete(event.panel);
    }
  }

  return holdEndBeats;
};

export const buildSteppingScenario = ({
  bpms = [{ beat: 0, bpm: 120 }],
  offset = 0,
  stops = [],
  steps,
}: SteppingScenario): BuiltSteppingScenario => {
  const rowsByMeasure = new Map<number, string[]>();

  for (const step of steps) {
    const { beat } = step;
    const measureIndex = Math.floor(beat / 4);
    const rowIndex = Math.round((beat - measureIndex * 4) * 48);

    if (measureIndex < 0 || Math.abs(beat - (measureIndex * 4 + rowIndex / 48)) > 0.000001) {
      throw new Error(`Step beat must fall on a 1/48 beat boundary: ${beat}`);
    }

    const rows = rowsByMeasure.get(measureIndex) ?? Array.from({ length: 192 }, () => "0000");
    rows[rowIndex] = toNoteRow(step);
    rowsByMeasure.set(measureIndex, rows);
  }

  const lastMeasureIndex = Math.max(...rowsByMeasure.keys(), 0);
  const measureRows = Array.from({ length: lastMeasureIndex + 1 }, (_, measureIndex) =>
    (rowsByMeasure.get(measureIndex) ?? Array.from({ length: 192 }, () => "0000")).join("\n"),
  );
  const bpmTag = bpms.map(({ beat, bpm }) => `${beat}=${bpm}`).join(",");
  const stopTag = stops.map(({ beat, durationSeconds }) => `${beat}=${durationSeconds}`).join(",");
  const source = `#TITLE:Stepping Scenario;\n#OFFSET:${offset};\n#BPMS:${bpmTag};\n#STOPS:${stopTag};\n#NOTES:\n     dance-single:\n     scenario:\n     Challenge:\n     9:\n     0,0,0,0,0:\n${measureRows.join(",\n")}\n;`;
  const document = parseSimfile(source);
  const chart = document.charts[0];

  if (!chart) {
    throw new Error("Scenario did not produce a dance-single chart.");
  }

  const timedChart = buildTimedChart(document, chart);

  return {
    document,
    timedChart,
    holdEndBeats: buildHoldEndBeats(timedChart.events),
  };
};

// ---- Chart excerpt extraction ----

const PANEL_SYMBOLS = ["L", "D", "U", "R"] as const;

/**
 * Extract a measure range from a parsed simfile chart as a `SteppingScenario`.
 *
 * Each non-empty row in the measure range becomes a `StepAtBeat` entry,
 * preserving taps, holds, rolls, and mines. BPM changes and stops that
 * affect the excerpt are included automatically.
 *
 * @example
 * const source = fs.readFileSync("Ferrari.sm", "utf-8");
 * const scenario = extractScenarioFromSimfile(source, {
 *   difficulty: "Challenge",
 *   meter: 9,
 *   fromMeasure: 4,
 *   toMeasure: 10,
 * });
 * const { document, timedChart } = buildSteppingScenario(scenario);
 */
export function extractScenarioFromSimfile(
  simfileSource: string,
  options: {
    /** 0-based chart index (alternative to difficulty/meter) */
    chartIndex?: number;
    /** Chart difficulty tag to match */
    difficulty?: string;
    /** Chart meter to disambiguate multiple charts with the same difficulty */
    meter?: number;
    /** Starting measure index (inclusive, 0-based) */
    fromMeasure: number;
    /** Ending measure index (exclusive) */
    toMeasure: number;
  },
): SteppingScenario {
  const simfile = parseSimfile(simfileSource);
  let chart: SimfileChart;

  if (options.chartIndex !== undefined) {
    const c = simfile.charts[options.chartIndex];

    if (!c) {
      throw new Error(
        `Chart index ${options.chartIndex} not found (${simfile.charts.length} charts available)`,
      );
    }

    chart = c;
  } else if (options.difficulty) {
    const candidates = simfile.charts.filter(
      (c) => c.difficulty.toLowerCase() === options.difficulty!.toLowerCase(),
    );

    if (candidates.length === 0) {
      throw new Error(
        `No chart found with difficulty "${options.difficulty}". ` +
          `Available: ${simfile.charts.map((c) => `${c.difficulty} ${c.meter}`).join(", ")}`,
      );
    }

    if (options.meter !== undefined) {
      const byMeter = candidates.find((c) => c.meter === options.meter);

      if (!byMeter) {
        throw new Error(
          `No ${options.difficulty} chart with meter ${options.meter}. ` +
            `Available: ${candidates.map((c) => c.meter).join(", ")}`,
        );
      }

      chart = byMeter;
    } else if (candidates.length === 1) {
      chart = candidates[0]!;
    } else {
      throw new Error(
        `Multiple ${options.difficulty} charts found. Specify meter: ` +
          candidates.map((c) => c.meter).join(", "),
      );
    }
  } else {
    throw new Error("Either chartIndex or difficulty must be provided");
  }

  const steps: StepAtBeat[] = [];
  const { fromMeasure, toMeasure } = options;

  for (const measure of chart.measures) {
    if (measure.index < fromMeasure || measure.index >= toMeasure) continue;

    const rowCount = measure.rows.length;

    measure.rows.forEach((row, rowIndex) => {
      // Check if the row has any notes
      if (!/[1234M]/i.test(row)) return;

      const beat = measure.index * 4 + (rowIndex * 4) / rowCount;
      const step: StepAtBeat = { beat };

      const taps: string[] = [];
      const holdHeads: string[] = [];
      const rollHeads: string[] = [];
      const holdTails: string[] = [];
      const mines: string[] = [];

      for (let i = 0; i < Math.min(row.length, 4); i++) {
        const ch = row[i]!;
        const symbol = PANEL_SYMBOLS[i]!;

        switch (ch) {
          case "1": taps.push(symbol); break;
          case "2": holdHeads.push(symbol); break;
          case "3": holdTails.push(symbol); break;
          case "4": rollHeads.push(symbol); break;
          case "M":
          case "m": mines.push(symbol); break;
        }
      }

      if (taps.length > 0) step.notes = taps.join("");
      if (holdHeads.length > 0) step.holdHeads = holdHeads.join("");
      if (rollHeads.length > 0) step.rollHeads = rollHeads.join("");
      if (holdTails.length > 0) step.holdTails = holdTails.join("");
      if (mines.length > 0) step.mines = mines.join("");

      steps.push(step);
    });
  }

  // Filter BPM changes and stops to those relevant to the excerpt
  const endBeat = toMeasure * 4;
  const relevantBpms = simfile.bpms.filter((b) => b.beat < endBeat);

  // Ensure we have at least one BPM entry at beat 0
  if (relevantBpms.length === 0 || relevantBpms[0]!.beat > 0) {
    const lastBefore = simfile.bpms
      .filter((b) => b.beat <= fromMeasure * 4)
      .at(-1);

    relevantBpms.unshift({ beat: 0, bpm: lastBefore?.bpm ?? 120 });
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