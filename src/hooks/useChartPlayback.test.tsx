// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useChartPlayback } from "./useChartPlayback";
import type { SimfileDocument } from "../lib/simfile";

const simfile: SimfileDocument = {
  metadata: {
    title: "Test",
    artist: "",
    credit: "",
    music: null,
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
});