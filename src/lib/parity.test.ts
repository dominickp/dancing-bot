import { describe, expect, it } from "vitest";
import ferrariSource from "../../example-simfiles/Ferrari/Ferrari.sm?raw";
import { buildParityAssignmentMap, getFootSideFromFootPart } from "./parity";
import { buildTimedChart, parseSimfile } from "./simfile";

const createSimfile = (measureRows: string[]): string =>
  `#TITLE:Test;\n#OFFSET:0;\n#BPMS:0.000=120.000;\n#STOPS:;\n#NOTES:\n     dance-single:\n     test:\n     Challenge:\n     9:\n     0,0,0,0,0:\n${measureRows.join("\n")}\n;`;

const getAssignmentKey = (
  panel: string,
  beat: number,
  rowIndex: number,
  measureIndex = 0,
): string => `${panel}:${beat.toFixed(6)}:tap:${measureIndex}:${rowIndex}`;

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

  it("keeps Ferrari beat 10 LD bracket as toe-left heel-down", () => {
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

    expect(result.assignments.get(getAssignmentKey("left", 10, 4, 2))).toBe(
      "left-toe",
    );
    expect(result.assignments.get(getAssignmentKey("down", 10, 4, 2))).toBe(
      "left-heel",
    );
  });

  it("keeps an established LD bracket anchored when expanding into LDR and LDUR", () => {
    const source = createSimfile([
      "1000",
      "1100",
      "1101",
      "1111",
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
