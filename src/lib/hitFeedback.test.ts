import { describe, expect, it } from "vitest";
import { buildAssistHitEvents, HitFeedbackTracker } from "./hitFeedback";
import type { TimedNoteEvent } from "./simfile";

const event = (overrides: Partial<TimedNoteEvent>): TimedNoteEvent => ({
  beat: 0,
  timeSeconds: 0,
  panel: "left",
  kind: "tap",
  measureIndex: 0,
  rowIndex: 0,
  rowCount: 4,
  ...overrides,
});

describe("HitFeedbackTracker", () => {
  it("triggers each crossed note once and marks simultaneous notes as jumps", () => {
    const tracker = new HitFeedbackTracker([
      event({ beat: 1, panel: "left" }),
      event({ beat: 1, panel: "right" }),
      event({ beat: 2, panel: "down" }),
    ]);

    expect(tracker.advance(0.9, 1.1)).toMatchObject([
      { event: { panel: "left" }, isJump: true },
      { event: { panel: "right" }, isJump: true },
    ]);
    expect(tracker.advance(1, 1.1)).toEqual([]);
    expect(tracker.advance(1.9, 2.1)).toMatchObject([
      { event: { panel: "down" }, isJump: false },
    ]);
  });

  it("marks three- and four-arrow bracket rows as jumps", () => {
    const tracker = new HitFeedbackTracker([
      event({ beat: 1, panel: "left" }),
      event({ beat: 1, panel: "down" }),
      event({ beat: 1, panel: "up" }),
      event({ beat: 2, panel: "left" }),
      event({ beat: 2, panel: "down" }),
      event({ beat: 2, panel: "up" }),
      event({ beat: 2, panel: "right" }),
    ]);
    const threeArrowBracket = tracker.advance(0.9, 1.1);
    const fourArrowBracket = tracker.advance(1.9, 2.1);

    expect(threeArrowBracket).toHaveLength(3);
    expect(threeArrowBracket.every(({ isJump }) => isJump)).toBe(true);
    expect(fourArrowBracket).toHaveLength(4);
    expect(fourArrowBracket.every(({ isJump }) => isJump)).toBe(true);
  });

  it("allows a note to fire again after the tracker is reset for a seek", () => {
    const tracker = new HitFeedbackTracker([event({ beat: 4 })]);

    expect(tracker.advance(3.9, 4.1)).toHaveLength(1);
    tracker.reset();
    expect(tracker.advance(3.9, 4.1)).toHaveLength(1);
  });
});

describe("buildAssistHitEvents", () => {
  it("creates retriggers only for matching roll heads and tails", () => {
    const hits = buildAssistHitEvents([
      event({ beat: 2, panel: "down", kind: "roll-head" }),
      event({ beat: 3, panel: "left", kind: "hold-tail" }),
      event({ beat: 3.5, panel: "down", kind: "hold-tail" }),
    ]);

    expect(hits.map((nextEvent) => nextEvent.beat)).toEqual([2, 2.5, 3, 3.5]);
    expect(hits.every((nextEvent) => nextEvent.panel === "down")).toBe(true);
  });
});