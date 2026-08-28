import { describe, expect, it } from "vitest";
import { beatToSeconds, buildTimedChart, parseSimfile, secondsToBeat } from "./simfile";

describe("parseSimfile", () => {
  it("parses dance-single SM charts and builds correctly timed note events", () => {
    const document = parseSimfile(`#TITLE:SM Test;\n#OFFSET:0.25;\n#BPMS:0=120,4=60;\n#STOPS:2=0.5;\n#NOTES:\n dance-single:\n test:\n Challenge:\n 9:\n 0,0,0,0,0:\n1000\n0000\n0200\n0000\n,\n0030\n000M\n;`);
    const chart = document.charts[0];

    expect(document.metadata).toMatchObject({ title: "SM Test", offset: 0.25 });
    expect(document.bpms).toEqual([{ beat: 0, bpm: 120 }, { beat: 4, bpm: 60 }]);
    expect(document.stops).toEqual([{ beat: 2, durationSeconds: 0.5 }]);
    expect(chart?.summary).toMatchObject({ totalMeasures: 2, tapRows: 2, holdRows: 2, mineRows: 1 });

    const timedChart = buildTimedChart(document, chart!);

    expect(timedChart.events.map(({ beat, panel, kind }) => ({ beat, panel, kind }))).toEqual([
      { beat: 0, panel: "left", kind: "tap" },
      { beat: 2, panel: "down", kind: "hold-head" },
      { beat: 4, panel: "up", kind: "hold-tail" },
      { beat: 6, panel: "right", kind: "mine" },
    ]);
  });

  it("prefers supported SSC notedata blocks over unsupported charts", () => {
    const document = parseSimfile(`#TITLE:SSC Test;\n#BPMS:0=120;\n#NOTEDATA:;\n#STEPSTYPE:dance-double;\n#DIFFICULTY:Challenge;\n#METER:10;\n#NOTES:\n10000000\n;\n#NOTEDATA:;\n#STEPSTYPE:dance-single;\n#DESCRIPTION:fixture;\n#DIFFICULTY:Hard;\n#METER:8;\n#NOTES:\n1000\n,\n0001\n;`);

    expect(document.charts).toHaveLength(1);
    expect(document.charts[0]).toMatchObject({
      stepType: "dance-single",
      description: "fixture",
      difficulty: "Hard",
      meter: 8,
    });
  });
});

describe("beat and time conversion", () => {
  it("round-trips beats across BPM changes, stops, and offsets", () => {
    const bpms = [{ beat: 0, bpm: 120 }, { beat: 4, bpm: 60 }];
    const stops = [{ beat: 2, durationSeconds: 0.5 }];

    for (const beat of [0, 1, 3, 4, 6]) {
      const time = beatToSeconds(beat, bpms, stops, 0.25);
      expect(secondsToBeat(time, bpms, stops, 0.25)).toBeCloseTo(beat, 4);
    }
  });
});