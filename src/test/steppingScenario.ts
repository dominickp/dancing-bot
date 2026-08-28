import { buildTimedChart, parseSimfile } from "../lib/simfile";
import type { Panel, SimfileDocument, TimedChart } from "../lib/simfile";

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
  notes: string;
}

export interface SteppingScenario {
  bpm?: number;
  offset?: number;
  steps: readonly StepAtBeat[];
}

export interface BuiltSteppingScenario {
  document: SimfileDocument;
  timedChart: TimedChart;
  holdEndBeats: Map<string, number>;
}

const toNoteRow = (notes: string): string => {
  const row = ["0", "0", "0", "0"];

  for (const symbol of notes.toUpperCase()) {
    const panel = panels[symbol];

    if (!panel) {
      throw new Error(`Unknown step symbol: ${symbol}`);
    }

    row[panelIndexes[panel]] = "1";
  }

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
  bpm = 120,
  offset = 0,
  steps,
}: SteppingScenario): BuiltSteppingScenario => {
  const rowsByMeasure = new Map<number, string[]>();

  for (const { beat, notes } of steps) {
    const measureIndex = Math.floor(beat / 4);
    const rowIndex = Math.round((beat - measureIndex * 4) * 48);

    if (measureIndex < 0 || Math.abs(beat - (measureIndex * 4 + rowIndex / 48)) > 0.000001) {
      throw new Error(`Step beat must fall on a 1/48 beat boundary: ${beat}`);
    }

    const rows = rowsByMeasure.get(measureIndex) ?? Array.from({ length: 192 }, () => "0000");
    rows[rowIndex] = toNoteRow(notes);
    rowsByMeasure.set(measureIndex, rows);
  }

  const lastMeasureIndex = Math.max(...rowsByMeasure.keys(), 0);
  const measureRows = Array.from({ length: lastMeasureIndex + 1 }, (_, measureIndex) =>
    (rowsByMeasure.get(measureIndex) ?? Array.from({ length: 192 }, () => "0000")).join("\n"),
  );
  const source = `#TITLE:Stepping Scenario;\n#OFFSET:${offset};\n#BPMS:0.000=${bpm};\n#STOPS:;\n#NOTES:\n     dance-single:\n     scenario:\n     Challenge:\n     9:\n     0,0,0,0,0:\n${measureRows.join(",\n")}\n;`;
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