import { describe, expect, it } from "vitest";
import { buildParityAssignmentMap } from "./parity";
import { buildTimedChart, parseSimfile } from "./simfile";

const createSimfile = (measureRows: string[]): string =>
  `#TITLE:Test;\n#OFFSET:0;\n#BPMS:0.000=120.000;\n#STOPS:;\n#NOTES:\n     dance-single:\n     test:\n     Challenge:\n     9:\n     0,0,0,0,0:\n${measureRows.join("\n")}\n;`;

const getAssignmentKey = (
  panel: string,
  beat: number,
  rowIndex: number,
): string => `${panel}:${beat.toFixed(6)}:tap:0:${rowIndex}`;

describe("buildParityAssignmentMap", () => {
  it("detects adjacent left brackets with directionally correct heel and toe assignments", () => {
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

    expect(result.assignments.get(getAssignmentKey("left", 1, 2))).toBe(
      "left-toe",
    );
    expect(result.assignments.get(getAssignmentKey("down", 1, 2))).toBe(
      "left-heel",
    );
    expect(result.assignments.get(getAssignmentKey("left", 3, 6))).toBe(
      "left-heel",
    );
    expect(result.assignments.get(getAssignmentKey("up", 3, 6))).toBe(
      "left-toe",
    );

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        { beat: 1, rowIndex: 1, kinds: ["bracket"] },
        { beat: 3, rowIndex: 3, kinds: ["bracket"] },
      ]),
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
});
