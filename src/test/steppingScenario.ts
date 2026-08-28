import { buildTimedChart, parseSimfile } from "../lib/simfile";
import type { BpmSegment, Panel, SimfileDocument, StopSegment, TimedChart } from "../lib/simfile";

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