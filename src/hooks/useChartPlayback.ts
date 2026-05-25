import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { beatToSeconds, secondsToBeat } from "../lib/simfile";
import type { Panel, SimfileDocument, TimedNoteEvent } from "../lib/simfile";

const renderWindowStepBeats = 2;
const displayRefreshMs = 80;
const hitWindowBeats = 0.18;

export interface PlaybackClock {
  audioTime: number;
  perfTime: number;
  playbackRate: number;
}

interface UseChartPlaybackArgs {
  audioSource: string | null;
  chartIndex: number;
  events: TimedNoteEvent[];
  lastBeat: number;
  playbackRate: number;
  pixelsPerBeat: number;
  visibleBeats: number;
  minVisibleBeats: number;
  maxVisibleBeats: number;
  setVisibleBeats: Dispatch<SetStateAction<number>>;
  receptorOffset: number;
  simfile: SimfileDocument;
  onTriggerPanelFeedback: (event: TimedNoteEvent) => void;
}

interface UseChartPlaybackResult {
  audioReady: boolean;
  displayBeat: number;
  isLoading: boolean;
  isPlaying: boolean;
  measureGuideLayerRef: MutableRefObject<HTMLDivElement | null>;
  playbackClockRef: MutableRefObject<PlaybackClock | null>;
  renderBeatAnchor: number;
  scrollLayerRef: MutableRefObject<HTMLDivElement | null>;
  seekToBeat: (beat: number) => void;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const getScrollStepBeats = (visibleBeats: number): number => {
  if (visibleBeats <= 3) {
    return 0.25;
  }

  if (visibleBeats <= 7) {
    return 0.5;
  }

  if (visibleBeats <= 14) {
    return 1;
  }

  return 2;
};

const getWheelStepCount = (event: WheelEvent): number => {
  const deltaMagnitude = Math.abs(event.deltaY);

  if (deltaMagnitude < 80) {
    return 1;
  }

  if (deltaMagnitude < 200) {
    return 2;
  }

  return Math.max(1, Math.round(deltaMagnitude / 120));
};

export function useChartPlayback({
  audioSource,
  chartIndex,
  events,
  lastBeat,
  playbackRate,
  pixelsPerBeat,
  visibleBeats,
  minVisibleBeats,
  maxVisibleBeats,
  setVisibleBeats,
  receptorOffset,
  simfile,
  onTriggerPanelFeedback,
}: UseChartPlaybackArgs): UseChartPlaybackResult {
  const [audioReady, setAudioReady] = useState(false);
  const [displayBeat, setDisplayBeat] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [renderBeatAnchor, setRenderBeatAnchor] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRequested, setPlaybackRequested] = useState(false);
  const animationFrameRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const measureGuideLayerRef = useRef<HTMLDivElement | null>(null);
  const scrollLayerRef = useRef<HTMLDivElement | null>(null);
  const currentBeatRef = useRef(0);
  const renderBeatAnchorRef = useRef(0);
  const playbackClockRef = useRef<PlaybackClock | null>(null);
  const lastDisplayUpdateRef = useRef(0);
  const lastAnimatedBeatRef = useRef(0);
  const triggeredHitKeysRef = useRef(new Set<string>());
  const isPlayingRef = useRef(isPlaying);
  const playbackRequestedRef = useRef(playbackRequested);
  const panelFeedbackRef = useRef(onTriggerPanelFeedback);

  const setPlaybackIntent = useCallback((value: SetStateAction<boolean>) => {
    setPlaybackRequested((previousValue) => {
      const nextValue =
        typeof value === "function"
          ? (value as (previousState: boolean) => boolean)(previousValue)
          : value;

      if (!nextValue) {
        setIsLoading(false);
      }

      return nextValue;
    });
  }, []);

  const applyScrollPosition = useCallback(
    (beat: number) => {
      const nextBeat = clamp(beat, 0, lastBeat);
      currentBeatRef.current = nextBeat;

      const translateY = receptorOffset - nextBeat * pixelsPerBeat;

      if (measureGuideLayerRef.current) {
        measureGuideLayerRef.current.style.transform = `translate3d(0, ${translateY}px, 0)`;
      }

      if (scrollLayerRef.current) {
        scrollLayerRef.current.style.transform = `translate3d(0, ${translateY}px, 0)`;
      }
    },
    [lastBeat, pixelsPerBeat, receptorOffset],
  );

  const syncAudioToBeat = useCallback(
    (beat: number) => {
      const audio = audioRef.current;

      if (!audio) {
        return;
      }

      const nextTime = Math.max(
        0,
        beatToSeconds(
          beat,
          simfile.bpms,
          simfile.stops,
          simfile.metadata.offset,
        ),
      );

      if (Number.isFinite(audio.duration)) {
        audio.currentTime = clamp(nextTime, 0, audio.duration);
      } else {
        audio.currentTime = nextTime;
      }

      audio.playbackRate = playbackRate;

      playbackClockRef.current = {
        audioTime: audio.currentTime,
        perfTime: performance.now(),
        playbackRate,
      };
    },
    [playbackRate, simfile.bpms, simfile.metadata.offset, simfile.stops],
  );

  const refreshRenderWindow = useCallback(
    (beat: number) => {
      const nextBeat = clamp(beat, 0, lastBeat);
      renderBeatAnchorRef.current = nextBeat;
      setRenderBeatAnchor(nextBeat);
      setDisplayBeat(nextBeat);
      applyScrollPosition(nextBeat);
    },
    [applyScrollPosition, lastBeat],
  );

  const seekToBeat = useCallback(
    (beat: number) => {
      const nextBeat = clamp(beat, 0, lastBeat);
      lastAnimatedBeatRef.current = nextBeat;
      triggeredHitKeysRef.current.clear();
      refreshRenderWindow(nextBeat);
      syncAudioToBeat(nextBeat);
    },
    [lastBeat, refreshRenderWindow, syncAudioToBeat],
  );

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
      panelFeedbackRef.current(event);
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
    playbackRequestedRef.current = playbackRequested;
  }, [playbackRequested]);

  useEffect(() => {
    if (!audioSource) {
      setAudioReady(false);
      setIsLoading(false);
      setIsPlaying(false);
      setPlaybackRequested(false);
      audioRef.current = null;
      return undefined;
    }

    const audio = new Audio(audioSource);
    audio.preload = "auto";
    audio.playbackRate = playbackRate;

    const handleLoadedMetadata = () => setAudioReady(true);
    const handleEnded = () => {
      setIsPlaying(false);
      setPlaybackRequested(false);
      setIsLoading(false);
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
  }, [audioSource, lastBeat, refreshRenderWindow]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    audio.playbackRate = playbackRate;

    const previousClock = playbackClockRef.current;

    playbackClockRef.current = {
      audioTime: audio.currentTime,
      perfTime: performance.now(),
      playbackRate,
    };

    if (previousClock && isPlayingRef.current) {
      lastDisplayUpdateRef.current = 0;
    }
  }, [playbackRate]);

  useEffect(() => {
    applyScrollPosition(currentBeatRef.current);
  }, [applyScrollPosition]);

  useEffect(() => {
    setAudioReady(false);
    setIsLoading(false);
    setIsPlaying(false);
    setPlaybackRequested(false);
    currentBeatRef.current = 0;
    lastAnimatedBeatRef.current = 0;
    triggeredHitKeysRef.current.clear();
    renderBeatAnchorRef.current = 0;
    setRenderBeatAnchor(0);
    setDisplayBeat(0);

    if (measureGuideLayerRef.current) {
      measureGuideLayerRef.current.style.transform = `translate3d(0, ${receptorOffset}px, 0)`;
    }

    if (scrollLayerRef.current) {
      scrollLayerRef.current.style.transform = `translate3d(0, ${receptorOffset}px, 0)`;
    }

    const audio = audioRef.current;

    if (audio) {
      const nextTime = Math.max(
        0,
        beatToSeconds(0, simfile.bpms, simfile.stops, simfile.metadata.offset),
      );

      audio.currentTime = Number.isFinite(audio.duration)
        ? clamp(nextTime, 0, audio.duration)
        : nextTime;
      playbackClockRef.current = {
        audioTime: audio.currentTime,
        perfTime: performance.now(),
        playbackRate: audio.playbackRate,
      };
    }
  }, [
    audioSource,
    chartIndex,
    receptorOffset,
    simfile.bpms,
    simfile.metadata.offset,
    simfile.stops,
  ]);

  useEffect(() => {
    if (!isPlayingRef.current) {
      refreshRenderWindow(currentBeatRef.current);
    }
  }, [refreshRenderWindow, visibleBeats]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!playbackRequested) {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }

      setIsLoading(false);
      setIsPlaying(false);
      audio?.pause();
      return;
    }

    if (!audio) {
      setPlaybackRequested(false);
      setIsLoading(false);
      setIsPlaying(false);
      return;
    }

    syncAudioToBeat(currentBeatRef.current);
    lastAnimatedBeatRef.current = currentBeatRef.current;
    setIsLoading(true);

    let isCancelled = false;

    const tick = (timestamp: number) => {
      const previousClock = playbackClockRef.current ?? {
        audioTime: audio.currentTime,
        perfTime: timestamp,
        playbackRate: audio.playbackRate,
      };
      let estimatedAudioTime =
        previousClock.audioTime +
        ((timestamp - previousClock.perfTime) / 1000) *
          previousClock.playbackRate;
      const actualAudioTime = audio.currentTime;

      if (Math.abs(actualAudioTime - estimatedAudioTime) > 0.03) {
        estimatedAudioTime = actualAudioTime;
        playbackClockRef.current = {
          audioTime: actualAudioTime,
          perfTime: timestamp,
          playbackRate: audio.playbackRate,
        };
      } else {
        playbackClockRef.current = {
          audioTime: estimatedAudioTime,
          perfTime: timestamp,
          playbackRate: previousClock.playbackRate,
        };
      }

      const nextBeat = secondsToBeat(
        estimatedAudioTime,
        simfile.bpms,
        simfile.stops,
        simfile.metadata.offset,
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
        if (isCancelled || !playbackRequestedRef.current) {
          audio.pause();
          return;
        }

        setIsPlaying(true);
        setIsLoading(false);
        playbackClockRef.current = {
          audioTime: audio.currentTime,
          perfTime: performance.now(),
          playbackRate: audio.playbackRate,
        };
        animationFrameRef.current = requestAnimationFrame(tick);
      })
      .catch(() => {
        if (isCancelled) {
          return;
        }

        setPlaybackRequested(false);
        setIsLoading(false);
        setIsPlaying(false);
      });

    return () => {
      isCancelled = true;

      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [
    applyScrollPosition,
    events,
    lastBeat,
    playbackRequested,
    playbackRate,
    pixelsPerBeat,
    receptorOffset,
    simfile,
  ]);

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

      const scrollDirection = Math.sign(event.deltaY);

      if (scrollDirection === 0) {
        return;
      }

      const scrollStepBeats = getScrollStepBeats(visibleBeats);
      const stepCount = getWheelStepCount(event);
      const nextBeat =
        currentBeatRef.current + scrollDirection * scrollStepBeats * stepCount;

      if (playbackRequestedRef.current) {
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
  }, [
    lastBeat,
    maxVisibleBeats,
    minVisibleBeats,
    refreshRenderWindow,
    seekToBeat,
    setVisibleBeats,
    syncAudioToBeat,
    visibleBeats,
  ]);

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

      if (!playbackRequestedRef.current && currentBeatRef.current >= lastBeat) {
        seekToBeat(0);
      }

      setPlaybackIntent((value) => !value);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lastBeat]);

  return {
    audioReady,
    displayBeat,
    isLoading,
    isPlaying,
    measureGuideLayerRef,
    playbackClockRef,
    renderBeatAnchor,
    scrollLayerRef,
    seekToBeat,
    setIsPlaying: setPlaybackIntent,
  };
}
