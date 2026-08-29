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

  it("are accurate inverses across varied offset values", () => {
    const bpms = [{ beat: 0, bpm: 140 }];
    const offsets = [-0.5, -0.1, 0, 0.1, 0.5, 1.2];
    const beats = [0, 1, 4, 16, 64];

    for (const offset of offsets) {
      for (const beat of beats) {
        const time = beatToSeconds(beat, bpms, [], offset);
        const roundTripped = secondsToBeat(time, bpms, [], offset);
        expect(roundTripped).toBeCloseTo(beat, 4);
      }
    }
  });

  it("are accurate inverses with BPM ramp, stops, and offset combined", () => {
    const bpms = [
      { beat: 0, bpm: 100 },
      { beat: 4, bpm: 200 },
      { beat: 8, bpm: 80 },
    ];
    const stops = [
      { beat: 3, durationSeconds: 0.3 },
      { beat: 6, durationSeconds: 1.5 },
    ];
    const offset = 0.15;

    for (const beat of [0, 0.5, 1, 3, 4, 5.5, 7, 8, 10, 16]) {
      const time = beatToSeconds(beat, bpms, stops, offset);
      const roundTripped = secondsToBeat(time, bpms, stops, offset);
      expect(roundTripped).toBeCloseTo(beat, 3);
    }
  });

  it("handles music starting before beat 0 (positive offset)", () => {
    const bpms = [{ beat: 0, bpm: 120 }];
    const offset = 0.2;

    // beat 0 audio-time is -offset = -0.2
    expect(beatToSeconds(0, bpms, [], offset)).toBeCloseTo(-0.2, 6);

    // At audio time 0 we are already at beat 0.4 (60/120 * 0.2 = 0.1s per beat, offset 0.2 → 0.4 beats past beat 0)
    const beatAtAudioZero = secondsToBeat(0, bpms, [], offset);
    expect(beatAtAudioZero).toBeCloseTo(0.4, 3);
    expect(beatToSeconds(beatAtAudioZero, bpms, [], offset)).toBeCloseTo(0, 6);
  });

  it("handles music starting after beat 0 (negative offset)", () => {
    const bpms = [{ beat: 0, bpm: 120 }];
    const offset = -0.3;

    // beat 0 audio-time is -offset = 0.3
    expect(beatToSeconds(0, bpms, [], -0.3)).toBeCloseTo(0.3, 6);

    // At audio time 0 the music hasn't started yet — we clamp to beat 0
    expect(secondsToBeat(0, bpms, [], -0.3)).toBe(0);
  });

  it("is monotonic: more time always means later beat", () => {
    const bpms = [
      { beat: 0, bpm: 200 },
      { beat: 4, bpm: 60 },
    ];
    const stops = [{ beat: 2, durationSeconds: 1 }];
    const offset = 0.1;

    const times = [0, 0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    let previousBeat = -Infinity;

    for (const time of times) {
      const beat = secondsToBeat(time, bpms, stops, offset);
      expect(beat).toBeGreaterThanOrEqual(previousBeat);
      previousBeat = beat;
    }
  });
});