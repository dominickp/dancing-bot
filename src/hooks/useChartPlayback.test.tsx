// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildAssistHitEvents,
  reconcilePlaybackAudioTime,
  useChartPlayback,
} from "./useChartPlayback";
import type { SimfileDocument, TimedNoteEvent } from "../lib/simfile";

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
});