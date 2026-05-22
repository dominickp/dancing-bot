import { useEffect, useMemo, useRef, useState } from 'react';
import type { TimedNoteEvent } from './lib/simfile';
import { beatToSeconds, secondsToBeat } from './lib/simfile';
import { getSampleTimedChart, sampleAudioSource, sampleChart } from './data/sampleChart';

const panelOrder = ['left', 'down', 'up', 'right'] as const;
const receptorOffset = 72;
const viewportHeight = 760;
const minVisibleBeats = 0.75;
const maxVisibleBeats = 32;
const defaultVisibleBeats = 10;
const renderBufferBeats = 4;
const renderWindowStepBeats = 2;
const displayRefreshMs = 80;
const hitWindowBeats = 0.18;

type PanelName = (typeof panelOrder)[number];

interface HoldSegment {
  panel: PanelName;
  startBeat: number;
  endBeat: number;
}

interface PlaybackClock {
  audioTime: number;
  perfTime: number;
}

interface MinimapMeasure {
  measureIndex: number;
  startBeat: number;
  density: number;
}

const displayTitle = [sampleChart.metadata.title, sampleChart.metadata.subtitle]
  .filter(Boolean)
  .join(' ');

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const getQuantizationClass = (beat: number): string => {
  const rounded = Math.round(beat * 48) / 48;
  const fraction = ((rounded % 1) + 1) % 1;

  if (fraction === 0) {
    return 'quant-quarter';
  }

  if (fraction % 0.5 === 0) {
    return 'quant-eighth';
  }

  if (fraction % 0.25 === 0) {
    return 'quant-sixteenth';
  }

  if (fraction % (1 / 3) === 0) {
    return 'quant-twelfth';
  }

  return 'quant-other';
};

const buildHoldSegments = (events: TimedNoteEvent[]): HoldSegment[] => {
  const activeHeads = new Map<PanelName, number>();
  const segments: HoldSegment[] = [];

  for (const event of events) {
    if (event.kind === 'hold-head' || event.kind === 'roll-head') {
      activeHeads.set(event.panel, event.beat);
      continue;
    }

    if (event.kind !== 'hold-tail') {
      continue;
    }

    const startBeat = activeHeads.get(event.panel);

    if (startBeat === undefined) {
      continue;
    }

    segments.push({
      panel: event.panel,
      startBeat,
      endBeat: event.beat,
    });
    activeHeads.delete(event.panel);
  }

  return segments;
};

function App() {
  const [selectedChartIndex, setSelectedChartIndex] = useState(0);
  const [displayBeat, setDisplayBeat] = useState(0);
  const [renderBeatAnchor, setRenderBeatAnchor] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [visibleBeats, setVisibleBeats] = useState(defaultVisibleBeats);
  const [audioReady, setAudioReady] = useState(false);
  const animationFrameRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrollLayerRef = useRef<HTMLDivElement | null>(null);
  const minimapRef = useRef<HTMLDivElement | null>(null);
  const currentBeatRef = useRef(0);
  const renderBeatAnchorRef = useRef(0);
  const playbackClockRef = useRef<PlaybackClock | null>(null);
  const lastDisplayUpdateRef = useRef(0);
  const lastAnimatedBeatRef = useRef(0);
  const triggeredHitKeysRef = useRef(new Set<string>());
  const isPlayingRef = useRef(isPlaying);
  const receptorRefs = useRef<Record<PanelName, HTMLDivElement | null>>({
    left: null,
    down: null,
    up: null,
    right: null,
  });
  const explosionRefs = useRef<Record<PanelName, HTMLDivElement | null>>({
    left: null,
    down: null,
    up: null,
    right: null,
  });

  const selectedChart = sampleChart.charts[selectedChartIndex] ?? sampleChart.charts[0];
  const selectedTimedChart = useMemo(() => getSampleTimedChart(selectedChartIndex), [selectedChartIndex]);
  const holdSegments = useMemo(() => buildHoldSegments(selectedTimedChart.events), [selectedTimedChart.events]);
  const pixelsPerBeat = viewportHeight / visibleBeats;
  const chartContentHeight = (selectedTimedChart.lastBeat + renderBufferBeats * 2) * pixelsPerBeat + receptorOffset;
  const totalChartBeats = Math.max(selectedTimedChart.lastBeat, 1);

  const minimapMeasures = useMemo<MinimapMeasure[]>(() => {
    const byMeasure = new Map<number, number>();

    for (const event of selectedTimedChart.events) {
      if (event.kind === 'hold-tail') {
        continue;
      }

      byMeasure.set(event.measureIndex, (byMeasure.get(event.measureIndex) ?? 0) + 1);
    }

    const maxDensity = Math.max(...byMeasure.values(), 1);
    const totalMeasures = selectedChart?.summary.totalMeasures ?? 0;

    return Array.from({ length: totalMeasures }, (_, measureIndex) => ({
      measureIndex,
      startBeat: measureIndex * 4,
      density: (byMeasure.get(measureIndex) ?? 0) / maxDensity,
    }));
  }, [selectedChart, selectedTimedChart.events]);

  const triggerPanelFeedback = (panel: PanelName) => {
    const receptor = receptorRefs.current[panel];
    const explosion = explosionRefs.current[panel];

    receptor?.animate(
      [
        { transform: 'scale(1)', filter: 'brightness(1)' },
        { transform: 'scale(1.08)', filter: 'brightness(1.35)' },
        { transform: 'scale(1)', filter: 'brightness(1)' },
      ],
      { duration: 140, easing: 'ease-out' },
    );

    explosion?.animate(
      [
        { opacity: 0, transform: 'translate(-50%, -50%) scale(0.3)' },
        { opacity: 0.95, transform: 'translate(-50%, -50%) scale(1)' },
        { opacity: 0, transform: 'translate(-50%, -50%) scale(1.5)' },
      ],
      { duration: 180, easing: 'ease-out' },
    );
  };

  const applyScrollPosition = (beat: number) => {
    const nextBeat = clamp(beat, 0, selectedTimedChart.lastBeat);
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
      beatToSeconds(beat, sampleChart.bpms, sampleChart.stops, sampleChart.metadata.offset),
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
    const nextBeat = clamp(beat, 0, selectedTimedChart.lastBeat);
    renderBeatAnchorRef.current = nextBeat;
    setRenderBeatAnchor(nextBeat);
    setDisplayBeat(nextBeat);
    applyScrollPosition(nextBeat);
  };

  const seekToBeat = (beat: number) => {
    const nextBeat = clamp(beat, 0, selectedTimedChart.lastBeat);
    lastAnimatedBeatRef.current = nextBeat;
    triggeredHitKeysRef.current.clear();
    refreshRenderWindow(nextBeat);
    syncAudioToBeat(nextBeat);
  };

  const updateHitFeedback = (previousBeat: number, nextBeat: number) => {
    const minBeat = Math.min(previousBeat, nextBeat) - hitWindowBeats * 0.35;
    const maxBeat = Math.max(previousBeat, nextBeat) + hitWindowBeats * 0.35;

    for (const event of selectedTimedChart.events) {
      if (event.kind === 'hold-tail' || event.beat < minBeat || event.beat > maxBeat) {
        continue;
      }

      const hitKey = `${event.panel}-${event.measureIndex}-${event.rowIndex}-${event.kind}`;

      if (triggeredHitKeysRef.current.has(hitKey)) {
        continue;
      }

      triggeredHitKeysRef.current.add(hitKey);
      triggerPanelFeedback(event.panel);
    }

    for (const event of selectedTimedChart.events) {
      if (event.beat < nextBeat - 2 || event.beat > nextBeat + 2) {
        continue;
      }

      const hitKey = `${event.panel}-${event.measureIndex}-${event.rowIndex}-${event.kind}`;

      if (event.beat < nextBeat - hitWindowBeats * 2) {
        triggeredHitKeysRef.current.delete(hitKey);
      }
    }
  };

  const visibleEvents = useMemo(
    () =>
      selectedTimedChart.events.filter(
        (event) =>
          event.beat >= renderBeatAnchor - renderBufferBeats &&
          event.beat <= renderBeatAnchor + visibleBeats + renderBufferBeats,
      ),
    [renderBeatAnchor, selectedTimedChart.events, visibleBeats],
  );

  const visibleHolds = useMemo(
    () =>
      holdSegments.filter(
        (segment) =>
          segment.endBeat >= renderBeatAnchor - renderBufferBeats &&
          segment.startBeat <= renderBeatAnchor + visibleBeats + renderBufferBeats,
      ),
    [holdSegments, renderBeatAnchor, visibleBeats],
  );

  const measureStart = Math.floor((renderBeatAnchor - renderBufferBeats) / 4) * 4;
  const measureEnd = Math.ceil((renderBeatAnchor + visibleBeats + renderBufferBeats) / 4) * 4;
  const visibleMeasures = useMemo(() => {
    const beats: number[] = [];

    for (let beat = measureStart; beat <= measureEnd; beat += 4) {
      beats.push(beat);
    }

    return beats;
  }, [measureEnd, measureStart]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    const audio = new Audio(sampleAudioSource);
    audio.preload = 'auto';

    const handleLoadedMetadata = () => setAudioReady(true);
    const handleEnded = () => {
      setIsPlaying(false);
      refreshRenderWindow(selectedTimedChart.lastBeat);
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);
    audioRef.current = audio;

    return () => {
      audio.pause();
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
      audioRef.current = null;
    };
  }, [selectedTimedChart.lastBeat]);

  useEffect(() => {
    applyScrollPosition(currentBeatRef.current);
  }, [pixelsPerBeat]);

  useEffect(() => {
    setIsPlaying(false);
    setAudioReady(false);
    triggeredHitKeysRef.current.clear();
    seekToBeat(0);
  }, [selectedChartIndex]);

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
      let estimatedAudioTime = previousClock.audioTime + (timestamp - previousClock.perfTime) / 1000;
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
        setDisplayBeat(clamp(nextBeat, 0, selectedTimedChart.lastBeat));
        lastDisplayUpdateRef.current = timestamp;
      }

      if (Math.abs(nextBeat - renderBeatAnchorRef.current) >= renderWindowStepBeats) {
        renderBeatAnchorRef.current = nextBeat;
        setRenderBeatAnchor(nextBeat);
      }

      animationFrameRef.current = requestAnimationFrame(tick);
    };

    void audio.play()
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
  }, [isPlaying, pixelsPerBeat, selectedTimedChart.lastBeat]);

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
        setVisibleBeats((value) => clamp(value * Math.exp(event.deltaY * 0.0025), minVisibleBeats, maxVisibleBeats));
        return;
      }

      const nextBeat = currentBeatRef.current + event.deltaY * 0.01;

      if (isPlayingRef.current) {
        seekToBeat(nextBeat);
        return;
      }

      const clampedBeat = clamp(nextBeat, 0, selectedTimedChart.lastBeat);
      refreshRenderWindow(clampedBeat);
      syncAudioToBeat(clampedBeat);
      lastAnimatedBeatRef.current = clampedBeat;
      triggeredHitKeysRef.current.clear();
    };

    window.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      window.removeEventListener('wheel', handleWheel);
    };
  }, [pixelsPerBeat, selectedTimedChart.lastBeat]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space') {
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

      if (!isPlaying && currentBeatRef.current >= selectedTimedChart.lastBeat) {
        seekToBeat(0);
      }

      setIsPlaying((value) => !value);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, selectedTimedChart.lastBeat]);

  const seekFromMinimapPointer = (clientY: number) => {
    const minimap = minimapRef.current;

    if (!minimap) {
      return;
    }

    const bounds = minimap.getBoundingClientRect();
    const ratio = clamp((clientY - bounds.top) / bounds.height, 0, 1);
    seekToBeat(selectedTimedChart.lastBeat * ratio);
  };

  const handleMinimapPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    seekFromMinimapPointer(event.clientY);
  };

  const handleMinimapPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.buttons & 1) !== 1) {
      return;
    }

    seekFromMinimapPointer(event.clientY);
  };

  return (
    <main className="app-shell">
      <header className="toolbar">
        <div className="toolbar-title">
          <p className="eyebrow">Dancing Bot</p>
          <h1>{displayTitle}</h1>
          <p className="toolbar-subtitle">{sampleChart.metadata.artist}</p>
        </div>

        <div className="toolbar-controls">
          <label className="toolbar-field">
            <span>Chart</span>
            <select
              value={selectedChartIndex}
              onChange={(event) => setSelectedChartIndex(Number.parseInt(event.target.value, 10) || 0)}
            >
              {sampleChart.charts.map((chart, chartIndex) => (
                <option key={`${chart.stepType}-${chart.difficulty}-${chartIndex}`} value={chartIndex}>
                  {chart.difficulty} {chart.meter} - {chart.description || chart.stepType}
                </option>
              ))}
            </select>
          </label>

          <div className="toolbar-badges">
            <span>{selectedChart?.difficulty} {selectedChart?.meter ?? 0}</span>
            <span>{visibleBeats.toFixed(2)} beats visible</span>
            <span>Beat {displayBeat.toFixed(2)}</span>
            <span>{audioReady ? 'Audio ready' : 'Audio loading'}</span>
          </div>
        </div>
      </header>

      <section className="notefield-panel" aria-label="Interactive notefield preview">
        <div className="notefield-header">
          <p className="notefield-caption">Space toggles playback. Scroll scrubs anywhere on the page. Ctrl + scroll changes note spacing everywhere except form controls.</p>
        </div>

        <div className="notefield-layout">
          <div className="notefield-frame">
            <div className="receptor-row" aria-hidden="true">
              {panelOrder.map((panel) => (
                <div
                  key={panel}
                  className={`receptor receptor-${panel}`}
                  ref={(element) => {
                    receptorRefs.current[panel] = element;
                  }}
                >
                  <div
                    className={`receptor-explosion receptor-explosion-${panel}`}
                    ref={(element) => {
                      explosionRefs.current[panel] = element;
                    }}
                  />
                  {panel[0].toUpperCase()}
                </div>
              ))}
            </div>

            <div className="lane-grid" style={{ height: receptorOffset + viewportHeight }}>
              <div className="chart-scroll-layer" ref={scrollLayerRef} style={{ height: chartContentHeight }}>
                {visibleMeasures.map((beat) => (
                  <div key={beat} className="measure-guide" style={{ top: beat * pixelsPerBeat }}>
                    <span>Measure {beat / 4 + 1}</span>
                  </div>
                ))}

                {panelOrder.map((panel) => (
                  <div key={panel} className="lane-column" data-panel={panel} style={{ height: chartContentHeight }}>
                    {visibleHolds
                      .filter((segment) => segment.panel === panel)
                      .map((segment) => (
                        <div
                          key={`${segment.panel}-${segment.startBeat}-${segment.endBeat}`}
                          className="hold-body"
                          style={{
                            top: segment.startBeat * pixelsPerBeat,
                            height: Math.max((segment.endBeat - segment.startBeat) * pixelsPerBeat, 10),
                          }}
                        />
                      ))}
                    {visibleEvents
                      .filter((event) => event.panel === panel)
                      .map((event) => (
                        <div
                          key={`${event.panel}-${event.measureIndex}-${event.rowIndex}-${event.kind}`}
                          className={`lane-note ${getQuantizationClass(event.beat)} ${event.kind}`}
                          style={{ top: event.beat * pixelsPerBeat }}
                          title={`${event.panel} ${event.kind} @ beat ${event.beat.toFixed(3)}`}
                        />
                      ))}
                  </div>
                ))}
              </div>

              <div className="playhead-status">
                <span>{isPlaying ? 'Playing' : 'Paused'}</span>
                <span>{selectedTimedChart.events.length} events</span>
                <span>{selectedChart?.difficulty} {selectedChart?.meter ?? 0}</span>
                <span>{sampleChart.metadata.offset.toFixed(3)}s offset</span>
              </div>
            </div>
          </div>

          <aside className="minimap-panel" aria-label="Song minimap">
            <div className="minimap-header">
              <h3>Minimap</h3>
              <p>Click or drag to seek</p>
            </div>

            <div
              className="minimap-track"
              ref={minimapRef}
              onPointerDown={handleMinimapPointerDown}
              onPointerMove={handleMinimapPointerMove}
            >
              {minimapMeasures.map((measure) => (
                <div
                  key={measure.measureIndex}
                  className="minimap-measure"
                  style={{
                    top: `${(measure.startBeat / totalChartBeats) * 100}%`,
                    opacity: 0.18 + measure.density * 0.82,
                    transform: `scaleX(${0.35 + measure.density * 0.65})`,
                  }}
                />
              ))}
              <div className="minimap-playhead" style={{ top: `${(displayBeat / totalChartBeats) * 100}%` }} />
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}

export default App;
