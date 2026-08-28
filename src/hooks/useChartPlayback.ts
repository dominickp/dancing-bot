import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { buildAssistHitEvents, HitFeedbackTracker } from "../lib/hitFeedback";
import { beatToSeconds, secondsToBeat } from "../lib/simfile";
import type { SimfileDocument, TimedNoteEvent } from "../lib/simfile";

export { buildAssistHitEvents } from "../lib/hitFeedback";

const renderWindowStepBeats = 2;
const displayRefreshMs = 80;
const loadingOverlayDelayMs = 180;
const startPreviewBeats = 0.5;
const audioClockForwardCorrectionSeconds = 0.05;
const seekCompletionToleranceSeconds = 0.01;

export interface PlaybackClock {
  audioTime: number;
  perfTime: number;
  playbackRate: number;
}

interface UseChartPlaybackArgs {
  assistTicksEnabled?: boolean;
  audioSource: string | null;
  chartIndex: number;
  chartVerticalOffset: number;
  events: TimedNoteEvent[];
  lastBeat: number;
  playbackRate: number;
  volume: number;
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

const keyboardZoomFactor = Math.exp(0.25);

const clampDisplayBeat = (beat: number, lastBeat: number): number =>
  clamp(beat, 0, lastBeat);

const clampViewportBeat = (beat: number, lastBeat: number): number =>
  clamp(beat, -startPreviewBeats, lastBeat);

export const reconcilePlaybackAudioTime = (
  estimatedAudioTime: number,
  actualAudioTime: number,
  isSeekPending: boolean,
): number => {
  if (
    isSeekPending ||
    actualAudioTime <= estimatedAudioTime + audioClockForwardCorrectionSeconds
  ) {
    return estimatedAudioTime;
  }

  return actualAudioTime;
};

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

/**
 * Shared guard for global keyboard/wheel shortcuts.
 * Input widgets handle their own keys, and elements marked with
 * `data-keyboard-local` implement their own arrow-key behavior
 * (e.g. the minimap slider and the dancing bot window).
 */
export const isEditableOrLocalKeyboardTarget = (target: EventTarget | null): boolean => {
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true;
  }

  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target.closest("[data-keyboard-local]") !== null
  );
};

export function useChartPlayback({
  assistTicksEnabled = false,
  audioSource,
  chartIndex,
  chartVerticalOffset,
  events,
  lastBeat,
  playbackRate,
  volume,
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
  const assistTickAudioContextRef = useRef<AudioContext | null>(null);
  const measureGuideLayerRef = useRef<HTMLDivElement | null>(null);
  const scrollLayerRef = useRef<HTMLDivElement | null>(null);
  const currentBeatRef = useRef(0);
  const renderBeatAnchorRef = useRef(0);
  const playbackClockRef = useRef<PlaybackClock | null>(null);
  const pendingAudioSeekTimeRef = useRef<number | null>(null);
  const loadingTimeoutRef = useRef<number | null>(null);
  const lastDisplayUpdateRef = useRef(0);
  const lastAnimatedBeatRef = useRef(0);
  const triggeredAssistRowsRef = useRef(new Set<string>());
  const isPlayingRef = useRef(isPlaying);
  const playbackRequestedRef = useRef(playbackRequested);
  const panelFeedbackRef = useRef(onTriggerPanelFeedback);
  const assistTicksEnabledRef = useRef(assistTicksEnabled);
  const hitEvents = useMemo(() => buildAssistHitEvents(events), [events]);
  const hitFeedbackTracker = useMemo(
    () => new HitFeedbackTracker(hitEvents),
    [hitEvents],
  );

  const getAssistTickAudioContext = (): AudioContext => {
    const audioContext =
      assistTickAudioContextRef.current ??
      new AudioContext();
    assistTickAudioContextRef.current = audioContext;

    if (audioContext.state === "suspended") {
      void audioContext.resume().catch(() => undefined);
    }

    return audioContext;
  };

  const playAssistTick = (isJump: boolean) => {
    if (!assistTicksEnabledRef.current) {
      return;
    }

    const audioContext = getAssistTickAudioContext();
    const noiseLength = Math.floor(audioContext.sampleRate * 0.075);
    const noiseBuffer = audioContext.createBuffer(1, noiseLength, audioContext.sampleRate);
    const noise = noiseBuffer.getChannelData(0);
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();
    const source = audioContext.createBufferSource();
    const startTime = audioContext.currentTime;

    for (let index = 0; index < noiseLength; index += 1) {
      noise[index] = Math.random() * 2 - 1;
    }

    source.buffer = noiseBuffer;
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(isJump ? 2600 : 1800, startTime);
    filter.Q.setValueAtTime(0.7, startTime);
    gain.gain.setValueAtTime(isJump ? 1.8 : 1.4, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.07);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(audioContext.destination);
    source.start(startTime);
    source.stop(startTime + 0.075);
  };

  const setPlaybackIntent = useCallback((value: SetStateAction<boolean>) => {
    if (assistTicksEnabledRef.current) {
      getAssistTickAudioContext();
    }

    setPlaybackRequested((previousValue) => {
      const nextValue =
        typeof value === "function"
          ? (value as (previousState: boolean) => boolean)(previousValue)
          : value;

      if (!nextValue) {
        if (loadingTimeoutRef.current !== null) {
          window.clearTimeout(loadingTimeoutRef.current);
          loadingTimeoutRef.current = null;
        }

        setIsLoading(false);
      }

      return nextValue;
    });
  }, []);

  const applyScrollPosition = useCallback(
    (beat: number) => {
      const nextBeat = clampViewportBeat(beat, lastBeat);
      currentBeatRef.current = nextBeat;

      const translateY =
        receptorOffset - chartVerticalOffset - nextBeat * pixelsPerBeat;

      if (measureGuideLayerRef.current) {
        measureGuideLayerRef.current.style.transform = `translate3d(0, ${translateY}px, 0)`;
      }

      if (scrollLayerRef.current) {
        scrollLayerRef.current.style.transform = `translate3d(0, ${translateY}px, 0)`;
      }
    },
    [chartVerticalOffset, lastBeat, pixelsPerBeat, receptorOffset],
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

      const targetTime = Number.isFinite(audio.duration)
        ? clamp(nextTime, 0, audio.duration)
        : nextTime;

      pendingAudioSeekTimeRef.current = targetTime;
      audio.currentTime = targetTime;

      audio.playbackRate = playbackRate;

      playbackClockRef.current = {
        audioTime: targetTime,
        perfTime: performance.now(),
        playbackRate,
      };
    },
    [playbackRate, simfile.bpms, simfile.metadata.offset, simfile.stops],
  );

  const refreshRenderWindow = useCallback(
    (beat: number) => {
      const nextBeat = clampViewportBeat(beat, lastBeat);
      renderBeatAnchorRef.current = nextBeat;
      setRenderBeatAnchor(nextBeat);
      setDisplayBeat(clampDisplayBeat(nextBeat, lastBeat));
      applyScrollPosition(nextBeat);
    },
    [applyScrollPosition, lastBeat],
  );

  const seekToBeat = useCallback(
    (beat: number) => {
      const nextBeat = clampViewportBeat(beat, lastBeat);
      lastAnimatedBeatRef.current = nextBeat;
      hitFeedbackTracker.reset();
      triggeredAssistRowsRef.current.clear();
      refreshRenderWindow(nextBeat);
      syncAudioToBeat(nextBeat);
    },
    [hitFeedbackTracker, lastBeat, refreshRenderWindow, syncAudioToBeat],
  );

  const scrollByBeats = useCallback(
    (deltaBeats: number) => {
      if (deltaBeats === 0) {
        return;
      }

      const nextBeat = currentBeatRef.current + deltaBeats;

      if (playbackRequestedRef.current) {
        seekToBeat(nextBeat);
        return;
      }

      const clampedBeat = clampViewportBeat(nextBeat, lastBeat);
      refreshRenderWindow(clampedBeat);
      syncAudioToBeat(clampedBeat);
      lastAnimatedBeatRef.current = clampedBeat;
      hitFeedbackTracker.reset();
      triggeredAssistRowsRef.current.clear();
    },
    [hitFeedbackTracker, lastBeat, refreshRenderWindow, seekToBeat, syncAudioToBeat],
  );

  const updateHitFeedback = (previousBeat: number, nextBeat: number) => {
    for (const { event, isJump } of hitFeedbackTracker.advance(
      previousBeat,
      nextBeat,
    )) {
      panelFeedbackRef.current(event);
      const assistTickKey = event.beat.toFixed(6);

      if (!isJump || !triggeredAssistRowsRef.current.has(assistTickKey)) {
        triggeredAssistRowsRef.current.add(assistTickKey);
        playAssistTick(isJump);
      }
    }
  };

  useEffect(() => {
    panelFeedbackRef.current = onTriggerPanelFeedback;
  }, [onTriggerPanelFeedback]);

  useEffect(() => {
    assistTicksEnabledRef.current = assistTicksEnabled;
  }, [assistTicksEnabled]);

  useEffect(() => () => {
    void assistTickAudioContextRef.current?.close();
  }, []);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    playbackRequestedRef.current = playbackRequested;
  }, [playbackRequested]);

  useEffect(() => {
    if (!audioSource) {
      if (loadingTimeoutRef.current !== null) {
        window.clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }

      setAudioReady(false);
      setIsLoading(false);
      setIsPlaying(false);
      setPlaybackRequested(false);
      audioRef.current = null;
      pendingAudioSeekTimeRef.current = null;
      return undefined;
    }

    const audio = new Audio(audioSource);
    audio.preload = "auto";
    audio.playbackRate = playbackRate;
    audio.volume = volume;

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
      pendingAudioSeekTimeRef.current = null;
    };
  }, [audioSource, lastBeat, refreshRenderWindow]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) {
      const previousClock = playbackClockRef.current;

      if (previousClock) {
        playbackClockRef.current = {
          audioTime:
            previousClock.audioTime +
            ((performance.now() - previousClock.perfTime) / 1000) * previousClock.playbackRate,
          perfTime: performance.now(),
          playbackRate,
        };
      }

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
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    audio.volume = volume;
  }, [volume]);

  useEffect(() => {
    applyScrollPosition(currentBeatRef.current);
  }, [applyScrollPosition]);

  useEffect(() => {
    if (loadingTimeoutRef.current !== null) {
      window.clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = null;
    }

    setAudioReady(false);
    setIsLoading(false);
    setIsPlaying(false);
    setPlaybackRequested(false);
    currentBeatRef.current = -startPreviewBeats;
    lastAnimatedBeatRef.current = -startPreviewBeats;
    hitFeedbackTracker.reset();
    triggeredAssistRowsRef.current.clear();
    pendingAudioSeekTimeRef.current = null;
    renderBeatAnchorRef.current = -startPreviewBeats;
    setRenderBeatAnchor(-startPreviewBeats);
    setDisplayBeat(0);

    if (measureGuideLayerRef.current) {
      measureGuideLayerRef.current.style.transform = `translate3d(0, ${receptorOffset - chartVerticalOffset}px, 0)`;
    }

    if (scrollLayerRef.current) {
      scrollLayerRef.current.style.transform = `translate3d(0, ${receptorOffset - chartVerticalOffset}px, 0)`;
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

      if (loadingTimeoutRef.current !== null) {
        window.clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }

      setIsLoading(false);
      setIsPlaying(false);
      audio?.pause();
      return;
    }

    if (!audio && !assistTicksEnabled) {
      if (loadingTimeoutRef.current !== null) {
        window.clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }

      setPlaybackRequested(false);
      setIsLoading(false);
      setIsPlaying(false);
      return;
    }

    if (audio) {
      syncAudioToBeat(currentBeatRef.current);
    } else {
      playbackClockRef.current = {
        audioTime: Math.max(
          0,
          beatToSeconds(
            currentBeatRef.current,
            simfile.bpms,
            simfile.stops,
            simfile.metadata.offset,
          ),
        ),
        perfTime: performance.now(),
        playbackRate,
      };
    }
    lastAnimatedBeatRef.current = currentBeatRef.current;

    if (audio) {
      loadingTimeoutRef.current = window.setTimeout(() => {
        if (playbackRequestedRef.current && !isPlayingRef.current) {
          setIsLoading(true);
        }

        loadingTimeoutRef.current = null;
      }, loadingOverlayDelayMs);
    }

    let isCancelled = false;

    const tick = (timestamp: number) => {
      const previousClock = playbackClockRef.current ?? {
        audioTime: audio?.currentTime ?? 0,
        perfTime: timestamp,
        playbackRate: audio?.playbackRate ?? playbackRate,
      };
      let estimatedAudioTime =
        previousClock.audioTime +
        ((timestamp - previousClock.perfTime) / 1000) *
          previousClock.playbackRate;
      const actualAudioTime = audio?.currentTime ?? estimatedAudioTime;
      const pendingSeekTime = pendingAudioSeekTimeRef.current;
      const isSeekPending =
        audio?.seeking === true ||
        (pendingSeekTime !== null &&
          Math.abs(actualAudioTime - pendingSeekTime) > seekCompletionToleranceSeconds);

      if (!isSeekPending) {
        pendingAudioSeekTimeRef.current = null;
      }

      estimatedAudioTime = reconcilePlaybackAudioTime(
        estimatedAudioTime,
        actualAudioTime,
        isSeekPending,
      );
      playbackClockRef.current = {
        audioTime: estimatedAudioTime,
        perfTime: timestamp,
        playbackRate: audio?.playbackRate ?? previousClock.playbackRate,
      };

      const nextBeat = secondsToBeat(
        estimatedAudioTime,
        simfile.bpms,
        simfile.stops,
        simfile.metadata.offset,
      );

      updateHitFeedback(lastAnimatedBeatRef.current, nextBeat);
      lastAnimatedBeatRef.current = nextBeat;
      applyScrollPosition(nextBeat);

      if (!audio && nextBeat >= lastBeat) {
        setPlaybackRequested(false);
        setIsLoading(false);
        setIsPlaying(false);
        refreshRenderWindow(lastBeat);
        return;
      }

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

    if (!audio) {
      setIsPlaying(true);
      setIsLoading(false);
      animationFrameRef.current = requestAnimationFrame(tick);

      return () => {
        isCancelled = true;

        if (animationFrameRef.current !== null) {
          cancelAnimationFrame(animationFrameRef.current);
        }
      };
    }

    void audio
      .play()
      .then(() => {
        if (isCancelled || !playbackRequestedRef.current) {
          audio.pause();
          return;
        }

        if (loadingTimeoutRef.current !== null) {
          window.clearTimeout(loadingTimeoutRef.current);
          loadingTimeoutRef.current = null;
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

        if (loadingTimeoutRef.current !== null) {
          window.clearTimeout(loadingTimeoutRef.current);
          loadingTimeoutRef.current = null;
        }

        setPlaybackRequested(false);
        setIsLoading(false);
        setIsPlaying(false);
      });

    return () => {
      isCancelled = true;

      if (loadingTimeoutRef.current !== null) {
        window.clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }

      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [
    applyScrollPosition,
    assistTicksEnabled,
    hitFeedbackTracker,
    lastBeat,
    playbackRequested,
    playbackRate,
    pixelsPerBeat,
    receptorOffset,
    refreshRenderWindow,
    simfile,
    syncAudioToBeat,
  ]);

  useEffect(() => {
    const handleWheel = (event: WheelEvent) => {
      if (isEditableOrLocalKeyboardTarget(event.target)) {
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

      scrollByBeats(
        scrollDirection * getScrollStepBeats(visibleBeats) * getWheelStepCount(event),
      );
    };

    window.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      window.removeEventListener("wheel", handleWheel);
    };
  }, [
    maxVisibleBeats,
    minVisibleBeats,
    scrollByBeats,
    setVisibleBeats,
    visibleBeats,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Leave browser/OS shortcuts (e.g. CTRL/⌘ +/-, ALT+arrow) untouched.
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      if (isEditableOrLocalKeyboardTarget(event.target)) {
        return;
      }

      switch (event.key) {
        case "ArrowUp":
          event.preventDefault();
          scrollByBeats(-getScrollStepBeats(visibleBeats));
          break;
        case "ArrowDown":
          event.preventDefault();
          scrollByBeats(getScrollStepBeats(visibleBeats));
          break;
        case "PageUp":
          event.preventDefault();
          scrollByBeats(-visibleBeats / 2);
          break;
        case "PageDown":
          event.preventDefault();
          scrollByBeats(visibleBeats / 2);
          break;
        case "Home":
          event.preventDefault();
          seekToBeat(0);
          break;
        case "End":
          event.preventDefault();
          seekToBeat(lastBeat);
          break;
        case "+":
        case "=":
          event.preventDefault();
          setVisibleBeats((value) =>
            clamp(value / keyboardZoomFactor, minVisibleBeats, maxVisibleBeats),
          );
          break;
        case "-":
        case "_":
          event.preventDefault();
          setVisibleBeats((value) =>
            clamp(value * keyboardZoomFactor, minVisibleBeats, maxVisibleBeats),
          );
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    lastBeat,
    maxVisibleBeats,
    minVisibleBeats,
    scrollByBeats,
    seekToBeat,
    setVisibleBeats,
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
