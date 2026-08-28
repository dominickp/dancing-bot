import { describe, expect, it } from "vitest";
import ferrariSource from "../../example-simfiles/Ferrari/Ferrari.sm?raw";
import {
  buildParityAssignmentMap,
  getFootSideFromFootPart,
  getTimedEventKey,
} from "./parity";
import { buildTimedChart, parseSimfile } from "./simfile";
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
