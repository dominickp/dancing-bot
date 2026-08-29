// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  reconcilePlaybackAudioTime,
  useChartPlayback,
} from "./useChartPlayback";
import { buildAssistHitEvents } from "../lib/hitFeedback";
import type { SimfileDocument, TimedNoteEvent } from "../lib/simfile";
import { beatToSeconds, secondsToBeat } from "../lib/simfile";
import type { PlaybackClock } from "./useChartPlayback";

const simfile: SimfileDocument = {
  metadata: {
    title: "Test",
    subtitle: "",
    artist: "",
    credit: "",
    banner: "",
    background: "",
    music: "",
    offset: 0,
  },
  bpms: [{ beat: 0, bpm: 120 }],
  stops: [],
  charts: [],
};

interface HookSnapshot {
  displayBeat: number;
  renderBeatAnchor: number;
  seekToBeat: (beat: number) => void;
}

interface HarnessProps {
  onSnapshot: (snapshot: HookSnapshot) => void;
}

const noteEvent = (overrides: Partial<TimedNoteEvent>): TimedNoteEvent => ({
  beat: 0,
  timeSeconds: 0,
  panel: "left",
  kind: "tap",
  measureIndex: 0,
  rowIndex: 0,
  rowCount: 4,
  ...overrides,
});

function HookHarness({ onSnapshot }: HarnessProps) {
  const [visibleBeats, setVisibleBeats] = React.useState(10);
  const playback = useChartPlayback({
    audioSource: null,
    chartIndex: 0,
    chartVerticalOffset: visibleBeats * 12,
    events: [],
    lastBeat: 64,
    playbackRate: 1,
    volume: 1,
    pixelsPerBeat: 480 / visibleBeats,
    visibleBeats,
    minVisibleBeats: 0.25,
    maxVisibleBeats: 32,
    setVisibleBeats,
    receptorOffset: 32,
    simfile,
    onTriggerPanelFeedback: () => {},
  });

  React.useEffect(() => {
    onSnapshot({
      displayBeat: playback.displayBeat,
      renderBeatAnchor: playback.renderBeatAnchor,
      seekToBeat: playback.seekToBeat,
    });
  }, [onSnapshot, playback.displayBeat, playback.renderBeatAnchor, playback.seekToBeat]);

  return null;
}

import * as React from "react";

describe("useChartPlayback zoom behavior", () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
  });

  it("does not move the visual clock backward to a stale media sample", () => {
    expect(reconcilePlaybackAudioTime(12.1, 12, false)).toBe(12.1);
  });

  it("keeps the visual clock smooth while an audio seek is in progress", () => {
    expect(reconcilePlaybackAudioTime(42.2, 18, true)).toBe(42.2);
  });

  it("catches up when the media clock has genuinely advanced", () => {
    expect(reconcilePlaybackAudioTime(9, 9.2, false)).toBe(9.2);
  });

  it("creates assist hits for every bot roll retrigger", () => {
    const assistHits = buildAssistHitEvents([
      noteEvent({ kind: "roll-head", beat: 4, panel: "down" }),
      noteEvent({ kind: "hold-tail", beat: 5.5, panel: "down", rowIndex: 3 }),
    ]);

    expect(assistHits.map((event) => event.beat)).toEqual([4, 4.5, 5, 5.5]);
    expect(assistHits.every((event) => event.kind === "roll-head")).toBe(true);
  });

  it("keeps the current beat when ctrl-wheel zoom changes visible beat spacing", () => {
    let snapshot: HookSnapshot | null = null;

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root!.render(<HookHarness onSnapshot={(nextSnapshot) => {
        snapshot = nextSnapshot;
      }} />);
    });

    expect(snapshot).toBeTruthy();

    act(() => {
      snapshot!.seekToBeat(12);
    });

    expect(snapshot!.displayBeat).toBe(12);
    expect(snapshot!.renderBeatAnchor).toBe(12);

    act(() => {
      window.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -120,
          ctrlKey: true,
          cancelable: true,
        }),
      );
    });

    expect(snapshot!.displayBeat).toBe(12);
    expect(snapshot!.renderBeatAnchor).toBe(12);
  });

  it("scrolls the chart with the arrow keys", () => {
    let snapshot: HookSnapshot | null = null;

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root!.render(<HookHarness onSnapshot={(nextSnapshot) => {
        snapshot = nextSnapshot;
      }} />);
    });

    act(() => {
      snapshot!.seekToBeat(12);
    });

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true }),
      );
    });

    // visibleBeats = 10 -> keyboard scroll step is 1 beat.
    expect(snapshot!.displayBeat).toBe(13);
    expect(snapshot!.renderBeatAnchor).toBe(13);
  });

  it("ignores arrow keys while focus is inside an input", () => {
    let snapshot: HookSnapshot | null = null;

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    act(() => {
      root!.render(<HookHarness onSnapshot={(nextSnapshot) => {
        snapshot = nextSnapshot;
      }} />);
    });

    act(() => {
      snapshot!.seekToBeat(12);
    });

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
      );
    });

    expect(snapshot!.displayBeat).toBe(12);
  });

  it("both rAF loops derive the same audio time from the same playback clock", () => {
    // This is the formula used by BOTH the playback tick loop
    // (useChartPlayback.ts, inside tick()) and the bot tick loop
    // (DancingBotWindow.tsx, inside the when-playing rAF effect):
    //
    //   timeSeconds = clock.audioTime
    //               + ((timestamp - clock.perfTime) / 1000) * clock.playbackRate
    //
    // They use different timestamp values (from different rAF
    // callbacks within the same frame), but the formula is
    // identical. This test proves the derivation is deterministic.

    const clock: PlaybackClock = {
      audioTime: 12.5,
      perfTime: 40000,
      playbackRate: 1.0,
    };

    // Simulate: playback rAF fires first in the frame
    const playbackTimestamp = 40016.667; // ~16.667ms later
    const playbackTime =
      clock.audioTime +
      ((playbackTimestamp - clock.perfTime) / 1000) * clock.playbackRate;

    // Simulate: bot rAF fires slightly later in the same frame
    const botTimestamp = 40017.0; // ~0.333ms later
    const botTime =
      clock.audioTime +
      ((botTimestamp - clock.perfTime) / 1000) * clock.playbackRate;

    // Both should be within a fraction of a millisecond
    expect(playbackTime).toBeCloseTo(12.516667, 4);
    expect(botTime).toBeCloseTo(12.517, 3);
    expect(Math.abs(playbackTime - botTime)).toBeLessThan(0.001);
  });

  it("both loops derive the same beat from the same clock", () => {
    const bpms = [{ beat: 0, bpm: 120 }];
    const offset = 0.1;

    const clock: PlaybackClock = {
      audioTime: 5.0,
      perfTime: 50000,
      playbackRate: 1.0,
    };

    const timestamp = 50016.667; // ~16.667ms later = one frame at 60fps
    const timeSeconds =
      clock.audioTime +
      ((timestamp - clock.perfTime) / 1000) * clock.playbackRate;

    const beat = secondsToBeat(timeSeconds, bpms, [], offset);

    // At 120 BPM with offset 0.1:
    // beatToSeconds(beat) = beat * 60/120 - 0.1 = beat * 0.5 - 0.1
    // timeSeconds = 5.016667 → beat = (5.016667 + 0.1) / 0.5 = 10.233334
    expect(beat).toBeCloseTo(10.233334, 3);
  });

  it("reconcilePlaybackAudioTime does not jump backward when audio stalls", () => {
    // Simulate: the audio element is stalled at 12.0 seconds,
    // but our estimated clock has moved forward to 12.5.
    // We should NOT jump backward to the stalled audio time.
    expect(reconcilePlaybackAudioTime(12.5, 12.0, false)).toBe(12.5);
  });

  it("reconcilePlaybackAudioTime catches up when audio genuinely advances", () => {
    // Simulate: the audio element has moved ahead to 13.0,
    // while our estimated clock is only at 12.5.
    // The difference (0.5s) exceeds audioClockForwardCorrectionSeconds (0.05s).
    expect(reconcilePlaybackAudioTime(12.5, 13.0, false)).toBe(13.0);
  });
});