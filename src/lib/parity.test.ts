import { describe, expect, it } from "vitest";
import chiaroscuroSource from "../../example-simfiles/Chiaroscuro/Chiaroscuro.sm?raw";
import ferrariSource from "../../example-simfiles/Ferrari/Ferrari.sm?raw";
import glitterSource from "../../example-simfiles/Glitter/Glitter.sm?raw";
import {
  buildParityAssignmentMap,
  getFootSideFromFootPart,
  getTimedEventKey,
} from "./parity";
import {
  buildTimedChart,
  parseSimfile,
  type Panel,
  type TimedNoteEvent,
} from "./simfile";
import { buildSteppingScenario } from "../test/steppingScenario";

const createSimfile = (measureRows: string[]): string =>
  `#TITLE:Test;\n#OFFSET:0;\n#BPMS:0.000=120.000;\n#STOPS:;\n#NOTES:\n     dance-single:\n     test:\n     Challenge:\n     9:\n     0,0,0,0,0:\n${measureRows.join("\n")}\n;`;

const getAssignmentKey = (
  panel: string,
  beat: number,
  rowIndex: number,
  measureIndex = 0,
): string => `${panel}:${beat.toFixed(6)}:tap:${measureIndex}:${rowIndex}`;

const parityConfig = {
  allowBrackets: true,
  allowCrossovers: true,
  allowFootswitches: true,
  favorJumpsOverBrackets: false,
};

const buildHoldEndBeatMap = (
  events: readonly TimedNoteEvent[],
): Map<string, number> => {
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
      holdEndBeats.set(
        `${event.panel}:${startBeat.toFixed(6)}`,
        event.beat,
      );
      activeHeads.delete(event.panel);
    }
  }

  return holdEndBeats;
};

describe.each([
  {
    name: "alternates a quarter-note left-right stream",
    steps: [
      { beat: 0, notes: "L" },
      { beat: 1, notes: "R" },
      { beat: 2, notes: "L" },
      { beat: 3, notes: "R" },
    ],
    expectedSides: ["left", "right", "left", "right"],
  },
  {
    name: "keeps a jump on separate feet",
    steps: [{ beat: 0, notes: "LR" }],
    expectedSides: ["left", "right"],
  },
])("stepping scenario: $name", ({ steps, expectedSides }) => {
  it("assigns the expected feet", () => {
    const { document, holdEndBeats, timedChart } = buildSteppingScenario({ steps });
    const result = buildParityAssignmentMap(
      timedChart.events,
      holdEndBeats,
      document,
      parityConfig,
    );

    expect(timedChart.events.map((event) =>
      getFootSideFromFootPart(result.assignments.get(getTimedEventKey(event))!),
    )).toEqual(expectedSides);
  });
});

describe("buildParityAssignmentMap", () => {
  it("keeps the right hold stationary through Chiaroscuro Hard 12's mine run", () => {
    const simfile = parseSimfile(chiaroscuroSource);
    const chart = simfile.charts.find(
      ({ difficulty, meter }) => difficulty === "Hard" && meter === 12,
    );

    expect(chart).toBeTruthy();

    const timedChart = buildTimedChart(simfile, chart!);
    const result = buildParityAssignmentMap(
      timedChart.events,
      buildHoldEndBeatMap(timedChart.events),
      simfile,
      parityConfig,
    );
    const rightHoldHead = timedChart.events.find(
      (event) =>
        event.kind === "hold-head" &&
        event.panel === "right" &&
        event.beat === 127.5,
    );
    const leftTapAfterMineRun = timedChart.events.find(
      (event) =>
        event.kind === "tap" && event.panel === "left" && event.beat === 132,
    );

    expect(rightHoldHead).toBeTruthy();
    expect(leftTapAfterMineRun).toBeTruthy();
    expect(
      getFootSideFromFootPart(
        result.assignments.get(getTimedEventKey(rightHoldHead!))!,
      ),
    ).toBe("right");
    expect(
      getFootSideFromFootPart(
        result.assignments.get(getTimedEventKey(leftTapAfterMineRun!))!,
      ),
    ).toBe("left");
    expect(
      result.diagnostics
        .filter((diagnostic) => diagnostic.beat >= 127.5 && diagnostic.beat <= 132)
        .some((diagnostic) =>
          diagnostic.kinds.some(
            (kind) => kind === "crossover" || kind === "double-step",
          ),
        ),
    ).toBe(false);
  });

  it("does not infer footswitches in Chiaroscuro measure 25's mine jumps", () => {
    const simfile = parseSimfile(chiaroscuroSource);
    const chart = simfile.charts[0];

    expect(chart).toBeTruthy();

    const timedChart = buildTimedChart(simfile, chart!);
    const result = buildParityAssignmentMap(
      timedChart.events,
      new Map(),
      simfile,
      parityConfig,
    );
    const measureDiagnostics = result.diagnostics.filter(
      (diagnostic) => diagnostic.beat >= 96 && diagnostic.beat < 100,
    );

    expect(measureDiagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kinds: expect.arrayContaining(["footswitch"]),
        }),
      ]),
    );
  });

  it("does not report Glitter's right-hold transition to down as a footswitch", () => {
    const simfile = parseSimfile(glitterSource);
    const chart = simfile.charts.find(
      ({ difficulty, meter }) => difficulty === "Challenge" && meter === 12,
    );

    expect(chart).toBeTruthy();

    const timedChart = buildTimedChart(simfile, chart!);
    const result = buildParityAssignmentMap(
      timedChart.events,
      buildHoldEndBeatMap(timedChart.events),
      simfile,
      parityConfig,
    );

    expect(
      result.diagnostics.filter(
        (diagnostic) =>
          diagnostic.beat === 120.5 && diagnostic.kinds.includes("footswitch"),
      ),
    ).toEqual([]);
  });

  it("does not flag Glitter Challenge 12's first row after the mine intro", () => {
    const simfile = parseSimfile(glitterSource);
    const chart = simfile.charts.find(
      ({ difficulty, meter }) => difficulty === "Challenge" && meter === 12,
    );

    expect(chart).toBeTruthy();

    const timedChart = buildTimedChart(simfile, chart!);
    const result = buildParityAssignmentMap(
      timedChart.events,
      buildHoldEndBeatMap(timedChart.events),
      simfile,
      parityConfig,
    );
    const beat24Diagnostics = result.diagnostics.filter(
      (diagnostic) => diagnostic.beat === 24 || diagnostic.beat === 24.5,
    );

    expect(beat24Diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kinds: expect.arrayContaining(["crossover"]),
        }),
      ]),
    );
    expect(beat24Diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kinds: expect.arrayContaining(["footswitch"]),
        }),
      ]),
    );

    const firstRowTaps = timedChart.events.filter(
      (event) => event.kind === "tap" && event.beat === 24,
    );

    expect(firstRowTaps.map((event) => event.panel)).toEqual(["left", "down"]);
    expect(
      result.assignments.get(
        getTimedEventKey(firstRowTaps.find((event) => event.panel === "left")!),
      ),
    ).toBe("left-heel");
    expect(
      result.assignments.get(
        getTimedEventKey(firstRowTaps.find((event) => event.panel === "down")!),
      ),
    ).toBe("right-heel");
  });

  it("keeps adjacent left-side pairs free of double-step regressions", () => {
    const source = createSimfile([
      "0001",
      "0000",
      "1100",
      "0000",
      "0001",
      "0000",
      "1010",
      "0000",
    ]);
    const simfile = parseSimfile(source);
    const chart = simfile.charts[0];

    expect(chart).toBeTruthy();

    const timedChart = buildTimedChart(simfile, chart!);
    const result = buildParityAssignmentMap(
      timedChart.events,
      new Map(),
      simfile,
      {
        allowBrackets: true,
        allowCrossovers: true,
        allowFootswitches: true,
        favorJumpsOverBrackets: false,
      },
    );

    expect(
      result.diagnostics.some((diagnostic) =>
        diagnostic.kinds.includes("double-step"),
      ),
    ).toBe(false);
  });

  it("still detects a simple crossover pattern", () => {
    const source = createSimfile([
      "1000",
      "0000",
      "0010",
      "0000",
      "0100",
      "0000",
      "1000",
      "0000",
    ]);
    const simfile = parseSimfile(source);
    const chart = simfile.charts[0];

    expect(chart).toBeTruthy();

    const timedChart = buildTimedChart(simfile, chart!);
    const result = buildParityAssignmentMap(
      timedChart.events,
      new Map(),
      simfile,
      {
        allowBrackets: true,
        allowCrossovers: true,
        allowFootswitches: true,
        favorJumpsOverBrackets: false,
      },
    );

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          beat: 3,
          kinds: expect.arrayContaining(["crossover"]),
        }),
      ]),
    );
  });

  it("starts simple crossover charts from a left-right home stance", () => {
    const source = createSimfile([
      "1000",
      "0010",
      "0001",
      "0000",
      "0000",
      "0000",
      "0000",
      "0000",
    ]);
    const simfile = parseSimfile(source);
    const chart = simfile.charts[0];

    expect(chart).toBeTruthy();

    const timedChart = buildTimedChart(simfile, chart!);
    const result = buildParityAssignmentMap(
      timedChart.events,
      new Map(),
      simfile,
      {
        allowBrackets: true,
        allowCrossovers: true,
        allowFootswitches: true,
        favorJumpsOverBrackets: false,
      },
    );

    expect(result.assignments.get(getAssignmentKey("left", 0, 0))).toBe(
      "left-heel",
    );
    expect(result.assignments.get(getAssignmentKey("up", 0.5, 1))).toMatch(
      /^right-/,
    );
    expect(result.assignments.get(getAssignmentKey("right", 1, 2))).toMatch(
      /^left-/,
    );
  });

  it("does not manufacture a crossover after a DR bracket followed by LDDU", () => {
    const source = createSimfile([
      "0101",
      "1000",
      "0100",
      "0100",
      "0010",
      "0000",
      "0000",
      "0000",
    ]);
    const simfile = parseSimfile(source);
    const chart = simfile.charts[0];

    expect(chart).toBeTruthy();

    const timedChart = buildTimedChart(simfile, chart!);
    const withoutBrackets = buildParityAssignmentMap(
      timedChart.events,
      new Map(),
      simfile,
      {
        allowBrackets: false,
        allowCrossovers: true,
        allowFootswitches: true,
        favorJumpsOverBrackets: true,
      },
    );
    const withBrackets = buildParityAssignmentMap(
      timedChart.events,
      new Map(),
      simfile,
      {
        allowBrackets: true,
        allowCrossovers: true,
        allowFootswitches: true,
        favorJumpsOverBrackets: false,
      },
    );

    expect(
      withBrackets.diagnostics.filter((diagnostic) => diagnostic.rowIndex >= 1),
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kinds: expect.arrayContaining(["crossover"]),
        }),
      ]),
    );

    const followupKeys = [
      getAssignmentKey("left", 0.5, 1),
      getAssignmentKey("down", 1, 2),
      getAssignmentKey("down", 1.5, 3),
      getAssignmentKey("up", 2, 4),
    ];

    expect(
      followupKeys.map((key) =>
        getFootSideFromFootPart(withBrackets.assignments.get(key)!),
      ),
    ).toEqual(
      followupKeys.map((key) =>
        getFootSideFromFootPart(withoutBrackets.assignments.get(key)!),
      ),
    );
  });

  it("keeps Ferrari's DR bracket as heel-down toe-right", () => {
    const simfile = parseSimfile(ferrariSource);
    const chart = simfile.charts[0];

    expect(chart).toBeTruthy();

    const timedChart = buildTimedChart(simfile, chart!);
    const result = buildParityAssignmentMap(
      timedChart.events,
      new Map(),
      simfile,
      {
        allowBrackets: true,
        allowCrossovers: true,
        allowFootswitches: true,
        favorJumpsOverBrackets: false,
      },
    );

    const downBracketEvent = timedChart.events.find(
      (event, index, events) =>
        event.kind === "tap" &&
        event.panel === "down" &&
        events.some(
          (candidate, candidateIndex) =>
            candidateIndex !== index &&
            candidate.kind === "tap" &&
            candidate.beat === event.beat &&
            candidate.panel === "right",
        ),
    );
    const rightBracketEvent = timedChart.events.find(
      (event) =>
        downBracketEvent !== undefined &&
        event.kind === "tap" &&
        event.beat === downBracketEvent.beat &&
        event.panel === "right",
    );

    expect(downBracketEvent).toBeTruthy();
    expect(rightBracketEvent).toBeTruthy();
    expect(result.assignments.get(getTimedEventKey(downBracketEvent!))).toBe(
      "right-heel",
    );
    expect(result.assignments.get(getTimedEventKey(rightBracketEvent!))).toBe(
      "right-toe",
    );
  });

  it("keeps an established LD bracket anchored when expanding into LDR and LDUR", () => {
    const source = createSimfile(["1000", "1100", "1101", "1111"]);
    const simfile = parseSimfile(source);
    const chart = simfile.charts[0];

    expect(chart).toBeTruthy();

    const timedChart = buildTimedChart(simfile, chart!);
    const result = buildParityAssignmentMap(
      timedChart.events,
      new Map(),
      simfile,
      {
        allowBrackets: true,
        allowCrossovers: true,
        allowFootswitches: true,
        favorJumpsOverBrackets: false,
      },
    );

    expect(
      getFootSideFromFootPart(
        result.assignments.get(getAssignmentKey("left", 1, 1))!,
      ),
    ).toBe("left");
    expect(
      getFootSideFromFootPart(
        result.assignments.get(getAssignmentKey("down", 1, 1))!,
      ),
    ).toBe("left");

    expect(result.assignments.get(getAssignmentKey("left", 2, 2))).toBe(
      "left-toe",
    );
    expect(result.assignments.get(getAssignmentKey("down", 2, 2))).toBe(
      "left-heel",
    );
    expect(result.assignments.get(getAssignmentKey("right", 2, 2))).toMatch(
      /^right-/,
    );

    expect(result.assignments.get(getAssignmentKey("left", 3, 3))).toBe(
      "left-toe",
    );
    expect(result.assignments.get(getAssignmentKey("down", 3, 3))).toBe(
      "left-heel",
    );
    expect(result.assignments.get(getAssignmentKey("up", 3, 3))).toBe(
      "right-toe",
    );
    expect(result.assignments.get(getAssignmentKey("right", 3, 3))).toBe(
      "right-heel",
    );
  });
});
