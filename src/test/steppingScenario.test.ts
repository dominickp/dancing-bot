import { describe, expect, it } from "vitest";
import { buildSteppingScenario } from "./steppingScenario";

describe("buildSteppingScenario", () => {
  it("builds every dance-single note kind and pairs hold end beats", () => {
    const { holdEndBeats, timedChart } = buildSteppingScenario({
      steps: [
        { beat: 0, taps: "L", holdHeads: "D", rollHeads: "U", mines: "R" },
        { beat: 1, holdTails: "D" },
        { beat: 1.5, holdTails: "U" },
      ],
    });

    expect(timedChart.events.map(({ beat, panel, kind }) => ({ beat, panel, kind }))).toEqual([
      { beat: 0, panel: "left", kind: "tap" },
      { beat: 0, panel: "down", kind: "hold-head" },
      { beat: 0, panel: "up", kind: "roll-head" },
      { beat: 0, panel: "right", kind: "mine" },
      { beat: 1, panel: "down", kind: "hold-tail" },
      { beat: 1.5, panel: "up", kind: "hold-tail" },
    ]);
    expect(holdEndBeats).toEqual(new Map([
      ["down:0.000000", 1],
      ["up:0.000000", 1.5],
    ]));
  });

  it("passes offsets, BPM changes, and stops through to chart timing", () => {
    const { document, timedChart } = buildSteppingScenario({
      offset: 0.25,
      bpms: [
        { beat: 0, bpm: 120 },
        { beat: 4, bpm: 60 },
      ],
      stops: [{ beat: 2, durationSeconds: 0.5 }],
      steps: [{ beat: 4, notes: "L" }],
    });

    expect(document.metadata.offset).toBe(0.25);
    expect(document.bpms).toEqual([{ beat: 0, bpm: 120 }, { beat: 4, bpm: 60 }]);
    expect(document.stops).toEqual([{ beat: 2, durationSeconds: 0.5 }]);
    expect(timedChart.events[0]?.timeSeconds).toBeCloseTo(2.25, 6);
  });

  it("rejects multiple note kinds on one panel at the same beat", () => {
    expect(() => buildSteppingScenario({
      steps: [{ beat: 2, taps: "L", mines: "L" }],
    })).toThrow("Multiple note kinds assigned to L at beat 2");
  });
});