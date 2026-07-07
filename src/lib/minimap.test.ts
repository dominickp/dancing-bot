import { describe, expect, it } from "vitest";
import {
  buildMinimapHoldBands,
  buildMinimapQuantizationSegments,
  buildMinimapRows,
  getMinimapQuantizationKind,
} from "./minimap";
import type { TimedNoteEvent } from "./simfile";

const event = (overrides: Partial<TimedNoteEvent>): TimedNoteEvent => ({
  beat: 0,
  timeSeconds: 0,
  panel: "left",
  kind: "tap",
  measureIndex: 0,
  rowIndex: 0,
  rowCount: 16,
  ...overrides,
});

describe("buildMinimapRows", () => {
  it("groups rows by exact beat and ignores hold tails", () => {
    const rows = buildMinimapRows([
      event({ beat: 1, panel: "left", kind: "tap" }),
      event({ beat: 1, panel: "down", kind: "hold-head" }),
      event({ beat: 1, panel: "up", kind: "hold-tail" }),
      event({ beat: 2, panel: "right", kind: "tap" }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      beat: 1,
      noteCount: 2,
      density: 1,
      quantizationKind: "quarter",
      quantizationColor: "#c94a5d",
    });
    expect(rows[1]?.beat).toBe(2);
    expect(rows[1]?.noteCount).toBe(1);
    expect(rows[1]?.density).toBeLessThan(1);
    expect(rows[1]?.quantizationKind).toBe("quarter");
  });

  it("widens rows inside dense streams more than isolated rows", () => {
    const rows = buildMinimapRows([
      event({ beat: 0, kind: "tap" }),
      event({ beat: 0.25, kind: "tap" }),
      event({ beat: 0.5, kind: "tap" }),
      event({ beat: 0.75, kind: "tap" }),
      event({ beat: 4, kind: "tap" }),
    ]);

    const streamMidRow = rows.find((row) => row.beat === 0.5);
    const isolatedRow = rows.find((row) => row.beat === 4);

    expect(streamMidRow).toBeTruthy();
    expect(isolatedRow).toBeTruthy();
    expect(streamMidRow!.noteCount).toBe(isolatedRow!.noteCount);
    expect(streamMidRow!.density).toBeGreaterThan(isolatedRow!.density);
  });

  it("compresses very long charts into a bounded row count", () => {
    const rows = buildMinimapRows(
      Array.from({ length: 1400 }, (_, index) =>
        event({
          beat: index * 0.25,
          panel: ["left", "down", "up", "right"][
            index % 4
          ] as TimedNoteEvent["panel"],
          kind: "tap",
          rowIndex: index,
        }),
      ),
    );

    expect(rows.length).toBeLessThanOrEqual(900);
    expect(rows[0]?.beat).toBe(0);
    expect(rows.at(-1)?.beat).toBeLessThanOrEqual(1399 * 0.25);
  });
});

describe("buildMinimapHoldBands", () => {
  it("creates visible bands only for non-zero hold spans", () => {
    expect(
      buildMinimapHoldBands([
        { startBeat: 4, endBeat: 6, kind: "hold" },
        { startBeat: 8, endBeat: 9.5, kind: "roll" },
        { startBeat: 10, endBeat: 10, kind: "hold" },
      ]),
    ).toEqual([
      { startBeat: 4, endBeat: 6, kind: "hold", intensity: 0.42 },
      { startBeat: 8, endBeat: 9.5, kind: "roll", intensity: 0.58 },
    ]);
  });
});

describe("getMinimapQuantizationKind", () => {
  it("classifies common dance subdivisions", () => {
    expect(getMinimapQuantizationKind(0)).toBe("quarter");
    expect(getMinimapQuantizationKind(0.5)).toBe("eighth");
    expect(getMinimapQuantizationKind(1 / 3)).toBe("twelfth");
    expect(getMinimapQuantizationKind(0.25)).toBe("sixteenth");
    expect(getMinimapQuantizationKind(1 / 6)).toBe("twentyFourth");
    expect(getMinimapQuantizationKind(0.125)).toBe("twelfth");
    expect(getMinimapQuantizationKind(1 / 12)).toBe("fortyEighth");
  });
});

describe("buildMinimapQuantizationSegments", () => {
  it("groups note snaps into compact time slices with ratios", () => {
    const segments = buildMinimapQuantizationSegments(
      [
        event({ beat: 0, kind: "tap" }),
        event({ beat: 0.5, kind: "tap" }),
        event({ beat: 1 / 3, kind: "tap" }),
        event({ beat: 2.5, kind: "tap" }),
        event({ beat: 2.75, kind: "tap" }),
      ],
      4,
      2,
    );

    expect(segments).toHaveLength(2);
    expect(segments[0]?.startBeat).toBe(0);
    expect(segments[0]?.endBeat).toBe(2);
    expect(segments[0]?.dominantKind).toBe("quarter");
    expect(segments[0]?.slices).toEqual([
      { kind: "quarter", count: 1, ratio: 1 / 3, color: "#c94a5d" },
      { kind: "eighth", count: 1, ratio: 1 / 3, color: "#3f82c7" },
      { kind: "twelfth", count: 1, ratio: 1 / 3, color: "#9f6dc2" },
    ]);
    expect(segments[1]?.dominantKind).toBe("eighth");
    expect(segments[1]?.slices).toEqual([
      { kind: "eighth", count: 1, ratio: 0.5, color: "#3f82c7" },
      { kind: "sixteenth", count: 1, ratio: 0.5, color: "#4da363" },
    ]);
  });
});
