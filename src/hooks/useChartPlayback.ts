import { useEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { sampleChart, sampleAudioSource } from "../data/sampleChart";
import { beatToSeconds, secondsToBeat } from "../lib/simfile";
import type { Panel, TimedNoteEvent } from "../lib/simfile";

const renderWindowStepBeats = 2;
const displayRefreshMs = 80;
const hitWindowBeats = 0.18;

export interface PlaybackClock {
  audioTime: number;
  perfTime: number;
}

interface UseChartPlaybackArgs {
  chartIndex: number;
  events: TimedNoteEvent[];
  lastBeat: number;
  pixelsPerBeat: number;
  visibleBeats: number;
  minVisibleBeats: number;
  maxVisibleBeats: number;
  setVisibleBeats: Dispatch<SetStateAction<number>>;
  receptorOffset: number;
  onTriggerPanelFeedback: (panel: Panel) => void;
}

interface UseChartPlaybackResult {
  audioReady: boolean;
  displayBeat: number;
  isPlaying: boolean;
  playbackClockRef: MutableRefObject<PlaybackClock | null>;
  renderBeatAnchor: number;
  scrollLayerRef: MutableRefObject<HTMLDivElement | null>;
  seekToBeat: (beat: number) => void;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export function useChartPlayback({
  chartIndex,
  events,
  lastBeat,
  pixelsPerBeat,
  visibleBeats,
  minVisibleBeats,
  maxVisibleBeats,
  setVisibleBeats,
  receptorOffset,
  onTriggerPanelFeedback,
}: UseChartPlaybackArgs): UseChartPlaybackResult {
  const [audioReady, setAudioReady] = useState(false);
  const [displayBeat, setDisplayBeat] = useState(0);
  const [renderBeatAnchor, setRenderBeatAnchor] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const animationFrameRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrollLayerRef = useRef<HTMLDivElement | null>(null);
  const currentBeatRef = useRef(0);
  const renderBeatAnchorRef = useRef(0);
  const playbackClockRef = useRef<PlaybackClock | null>(null);
  const lastDisplayUpdateRef = useRef(0);
  const lastAnimatedBeatRef = useRef(0);
  const triggeredHitKeysRef = useRef(new Set<string>());
  const isPlayingRef = useRef(isPlaying);
  const panelFeedbackRef = useRef(onTriggerPanelFeedback);

  const applyScrollPosition = (beat: number) => {
    const nextBeat = clamp(beat, 0, lastBeat);
    currentBeatRef.current = nextBeat;

    if (scrollLayerRef.current) {
      const translateY = receptorOffset - nextBeat * pixelsPerBeat;
      scrollLayerRef.current.style.transform = `translate3d(0, ${translateY}px, 0)`;
    }
  };

  const syncAudioToBeat = (beat: number) => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    const nextTime = Math.max(
      0,
      beatToSeconds(
        beat,
        sampleChart.bpms,
        sampleChart.stops,
        sampleChart.metadata.offset,
      ),
    );

    if (Number.isFinite(audio.duration)) {
      audio.currentTime = clamp(nextTime, 0, audio.duration);
    } else {
      audio.currentTime = nextTime;
    }

    playbackClockRef.current = {
      audioTime: audio.currentTime,
      perfTime: performance.now(),
    };
  };

  const refreshRenderWindow = (beat: number) => {
    const nextBeat = clamp(beat, 0, lastBeat);
    renderBeatAnchorRef.current = nextBeat;
    setRenderBeatAnchor(nextBeat);
    setDisplayBeat(nextBeat);
    applyScrollPosition(nextBeat);
  };

  const seekToBeat = (beat: number) => {
    const nextBeat = clamp(beat, 0, lastBeat);
    lastAnimatedBeatRef.current = nextBeat;
    triggeredHitKeysRef.current.clear();
    refreshRenderWindow(nextBeat);
    syncAudioToBeat(nextBeat);
  };

  const updateHitFeedback = (previousBeat: number, nextBeat: number) => {
    const minBeat = Math.min(previousBeat, nextBeat) - hitWindowBeats * 0.35;
    const maxBeat = Math.max(previousBeat, nextBeat) + hitWindowBeats * 0.35;

    for (const event of events) {
      if (
        event.kind === "hold-tail" ||
        event.beat < minBeat ||
        event.beat > maxBeat
      ) {
        continue;
      }

      const hitKey = `${event.panel}-${event.measureIndex}-${event.rowIndex}-${event.kind}`;

      if (triggeredHitKeysRef.current.has(hitKey)) {
        continue;
      }

      triggeredHitKeysRef.current.add(hitKey);
      panelFeedbackRef.current(event.panel);
    }

    for (const event of events) {
      if (event.beat < nextBeat - 2 || event.beat > nextBeat + 2) {
        continue;
      }

      const hitKey = `${event.panel}-${event.measureIndex}-${event.rowIndex}-${event.kind}`;

      if (event.beat < nextBeat - hitWindowBeats * 2) {
        triggeredHitKeysRef.current.delete(hitKey);
      }
    }
  };

  useEffect(() => {
    panelFeedbackRef.current = onTriggerPanelFeedback;
  }, [onTriggerPanelFeedback]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    const audio = new Audio(sampleAudioSource);
    audio.preload = "auto";

    const handleLoadedMetadata = () => setAudioReady(true);
    const handleEnded = () => {
      setIsPlaying(false);
      refreshRenderWindow(lastBeat);
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("ended", handleEnded);
    audioRef.current = audio;

    return () => {
      audio.pause();
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("ended", handleEnded);
      audioRef.current = null;
    };
  }, [lastBeat]);

  useEffect(() => {
    applyScrollPosition(currentBeatRef.current);
  }, [pixelsPerBeat]);

  useEffect(() => {
    setIsPlaying(false);
    setAudioReady(false);
    triggeredHitKeysRef.current.clear();
    seekToBeat(0);
  }, [chartIndex]);

  useEffect(() => {
    if (!isPlayingRef.current) {
      refreshRenderWindow(currentBeatRef.current);
    }
  }, [visibleBeats]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!isPlaying) {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }

      audio?.pause();
      return;
    }

    if (!audio) {
      setIsPlaying(false);
      return;
    }

    syncAudioToBeat(currentBeatRef.current);
    lastAnimatedBeatRef.current = currentBeatRef.current;

    const tick = (timestamp: number) => {
      const previousClock = playbackClockRef.current ?? {
        audioTime: audio.currentTime,
        perfTime: timestamp,
      };
      let estimatedAudioTime =
        previousClock.audioTime + (timestamp - previousClock.perfTime) / 1000;
      const actualAudioTime = audio.currentTime;

      if (Math.abs(actualAudioTime - estimatedAudioTime) > 0.03) {
        estimatedAudioTime = actualAudioTime;
        playbackClockRef.current = {
          audioTime: actualAudioTime,
          perfTime: timestamp,
        };
      }

      const nextBeat = secondsToBeat(
        estimatedAudioTime,
        sampleChart.bpms,
        sampleChart.stops,
        sampleChart.metadata.offset,
      );

      updateHitFeedback(lastAnimatedBeatRef.current, nextBeat);
      lastAnimatedBeatRef.current = nextBeat;
      applyScrollPosition(nextBeat);

      if (timestamp - lastDisplayUpdateRef.current >= displayRefreshMs) {
        setDisplayBeat(clamp(nextBeat, 0, lastBeat));
        lastDisplayUpdateRef.current = timestamp;
      }

      if (
        Math.abs(nextBeat - renderBeatAnchorRef.current) >=
        renderWindowStepBeats
      ) {
        renderBeatAnchorRef.current = nextBeat;
        setRenderBeatAnchor(nextBeat);
      }

      animationFrameRef.current = requestAnimationFrame(tick);
    };

    void audio
      .play()
      .then(() => {
        playbackClockRef.current = {
          audioTime: audio.currentTime,
          perfTime: performance.now(),
        };
        animationFrameRef.current = requestAnimationFrame(tick);
      })
      .catch(() => {
        setIsPlaying(false);
      });

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [events, isPlaying, lastBeat, pixelsPerBeat, receptorOffset]);

  useEffect(() => {
    const handleWheel = (event: WheelEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditableTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable;

      if (isEditableTarget) {
        return;
      }

      event.preventDefault();

      if (event.ctrlKey || event.metaKey) {
        setVisibleBeats((value) =>
          clamp(
            value * Math.exp(event.deltaY * 0.0025),
            minVisibleBeats,
            maxVisibleBeats,
          ),
        );
        return;
      }

      const nextBeat = currentBeatRef.current + event.deltaY * 0.01;

      if (isPlayingRef.current) {
        seekToBeat(nextBeat);
        return;
      }

      const clampedBeat = clamp(nextBeat, 0, lastBeat);
      refreshRenderWindow(clampedBeat);
      syncAudioToBeat(clampedBeat);
      lastAnimatedBeatRef.current = clampedBeat;
      triggeredHitKeysRef.current.clear();
    };

    window.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      window.removeEventListener("wheel", handleWheel);
    };
  }, [lastBeat, maxVisibleBeats, minVisibleBeats, setVisibleBeats]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space") {
        return;
      }

      const target = event.target as HTMLElement | null;
      const isTypingTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable;

      if (isTypingTarget) {
        return;
      }

      event.preventDefault();

      if (!isPlayingRef.current && currentBeatRef.current >= lastBeat) {
        seekToBeat(0);
      }

      setIsPlaying((value) => !value);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lastBeat]);

  return {
    audioReady,
    displayBeat,
    isPlaying,
    playbackClockRef,
    renderBeatAnchor,
    scrollLayerRef,
    seekToBeat,
    setIsPlaying,
  };
}
