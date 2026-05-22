import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { TimedNoteEvent } from './lib/simfile';
import { beatToSeconds } from './lib/simfile';
import { getSampleTimedChart, sampleChart } from './data/sampleChart';
import {
  buildImportedNoteskinOption,
  getBundledNoteskinOptions,
  getPanelRotation,
  loadResolvedDanceNoteskin,
  releaseNoteskinOption,
} from './lib/noteskin';
import type { NoteskinOption, ResolvedDanceNoteskin, ResolvedSpriteAsset } from './lib/noteskin';
import {
  buildBotTimeline,
  BotWindowRect,
  BotWindowInteraction,
  clampBotWindowRect,
  defaultBotFormStyle,
  DancingBotWindow,
} from './components/DancingBotWindow';
import type { BotFormStyleId } from './components/DancingBotWindow';
import type { BotStep } from './components/DancingBotWindow';
import { NotefieldPreview } from './components/NotefieldPreview';
import { useChartPlayback } from './hooks/useChartPlayback';
import type { PlaybackClock } from './hooks/useChartPlayback';

const panelOrder = ['left', 'down', 'up', 'right'] as const;
const receptorOffset = 72;
const viewportHeight = 760;
const minVisibleBeats = 0.25;
const maxVisibleBeats = 32;
const defaultVisibleBeats = 10;
const renderBufferBeats = 4;
const baseLaneWidth = 72;
const baseLaneGap = 0;
const baseSidePadding = 12;
const baseNoteWidth = 44;
const baseNoteHeight = 44;
const baseHoldWidth = 18;
const baseReceptorHeight = 56;
const baseExplosionSize = 110;
const minVisualScale = 0.68;
const maxVisualScale = 1.24;

type PanelName = (typeof panelOrder)[number];

interface HoldSegment {
  panel: PanelName;
  startBeat: number;
  endBeat: number;
}

interface MinimapMeasure {
  measureIndex: number;
  startBeat: number;
  density: number;
}

const displayTitle = [sampleChart.metadata.title, sampleChart.metadata.subtitle]
  .filter(Boolean)
  .join(' ');
const bundledNoteskinOptions = getBundledNoteskinOptions();
const genericArrowClipPath = 'polygon(50% 100%, 100% 50%, 72% 50%, 72% 0%, 28% 0%, 28% 50%, 0% 50%)';

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const getHoldSegmentKey = (panel: PanelName, startBeat: number): string => `${panel}:${startBeat.toFixed(6)}`;

const buildHoldEndBeatMap = (segments: HoldSegment[]): Map<string, number> => {
  const map = new Map<string, number>();

  for (const segment of segments) {
    map.set(getHoldSegmentKey(segment.panel, segment.startBeat), segment.endBeat);
  }

  return map;
};

const getQuantizationColor = (beat: number): string => {
  const ticksPerBeat = 192;
  const tick = ((Math.round(beat * ticksPerBeat) % ticksPerBeat) + ticksPerBeat) % ticksPerBeat;

  if (tick === 0) {
    return '#ff5d73';
  }

  if (tick % 96 === 0) {
    return '#51a8ff';
  }

  if (tick % 64 === 0) {
    return '#d08cff';
  }

  if (tick % 48 === 0) {
    return '#63d17c';
  }

  if (tick % 32 === 0) {
    return '#efd166';
  }

  if (tick % 24 === 0) {
    return '#d08cff';
  }

  if (tick % 16 === 0) {
    return '#63e6d8';
  }

  if (tick % 12 === 0) {
    return '#d08cff';
  }

  return '#d08cff';
};

const getSpriteFillStyle = (sprite: ResolvedSpriteAsset | null): CSSProperties => {
  if (!sprite) {
    return {};
  }

  const x = sprite.columns > 1 ? `${(sprite.frameX / Math.max(sprite.columns - 1, 1)) * 100}%` : '0%';
  const y = sprite.rows > 1 ? `${(sprite.frameY / Math.max(sprite.rows - 1, 1)) * 100}%` : '0%';

  if (sprite.renderMode === 'mask') {
    if (sprite.maskStrategy === 'clip') {
      return {
        clipPath: genericArrowClipPath,
        overflow: 'hidden',
      } as CSSProperties;
    }

    return {
      WebkitMaskImage: `url("${sprite.url}")`,
      maskImage: `url("${sprite.url}")`,
      WebkitMaskRepeat: 'no-repeat',
      maskRepeat: 'no-repeat',
      WebkitMaskSize: `${sprite.columns * 100}% ${sprite.rows * 100}%`,
      maskSize: `${sprite.columns * 100}% ${sprite.rows * 100}%`,
      WebkitMaskPosition: `${x} ${y}`,
      maskPosition: `${x} ${y}`,
    } as CSSProperties;
  }

  return {
    backgroundImage: `url("${sprite.url}")`,
    backgroundSize: `${sprite.columns * 100}% ${sprite.rows * 100}%`,
    backgroundPosition: `${x} ${y}`,
  };
};

const getSpriteBackgroundStyle = (
  sprite: ResolvedSpriteAsset | null,
  rotation: number,
  baseStyle: CSSProperties = {},
): CSSProperties => ({
  ...baseStyle,
  ...getSpriteFillStyle(sprite),
  transform: baseStyle.transform ?? `rotate(${rotation}deg)`,
});

const getTintedSpriteMaskStyle = (sprite: ResolvedSpriteAsset | null, color: string): CSSProperties => {
  if (!sprite) {
    return {};
  }

  const x = sprite.columns > 1 ? `${(sprite.frameX / Math.max(sprite.columns - 1, 1)) * 100}%` : '0%';
  const y = sprite.rows > 1 ? `${(sprite.frameY / Math.max(sprite.rows - 1, 1)) * 100}%` : '0%';

  return {
    backgroundColor: color,
    WebkitMaskImage: `url("${sprite.url}")`,
    maskImage: `url("${sprite.url}")`,
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    WebkitMaskSize: `${sprite.columns * 100}% ${sprite.rows * 100}%`,
    maskSize: `${sprite.columns * 100}% ${sprite.rows * 100}%`,
    WebkitMaskPosition: `${x} ${y}`,
    maskPosition: `${x} ${y}`,
  };
};

const getSpriteDetailFillStyle = (sprite: ResolvedSpriteAsset | null): CSSProperties | null => {
  if (!sprite?.detailUrl) {
    return null;
  }

  const columns = sprite.detailColumns ?? 1;
  const rows = sprite.detailRows ?? 1;
  const frameX = Math.min(Math.max(sprite.detailFrameX ?? 0, 0), Math.max(columns - 1, 0));
  const frameY = Math.min(Math.max(sprite.detailFrameY ?? 0, 0), Math.max(rows - 1, 0));
  const x = columns > 1 ? `${(frameX / Math.max(columns - 1, 1)) * 100}%` : '0%';
  const y = rows > 1 ? `${(frameY / Math.max(rows - 1, 1)) * 100}%` : '0%';

  return {
    ...getSpriteFillStyle(sprite),
    backgroundImage: `url("${sprite.detailUrl}")`,
    backgroundSize: `${columns * 100}% ${rows * 100}%`,
    backgroundPosition: `${x} ${y}`,
  };
};

const applySpriteStyleToElement = (element: HTMLDivElement, spriteStyle: CSSProperties | null): void => {
  element.style.backgroundImage = '';
  element.style.backgroundSize = '';
  element.style.backgroundPosition = '';
  element.style.backgroundColor = '';
  element.style.webkitMaskImage = '';
  element.style.maskImage = '';
  element.style.webkitMaskRepeat = '';
  element.style.maskRepeat = '';
  element.style.webkitMaskSize = '';
  element.style.maskSize = '';
  element.style.webkitMaskPosition = '';
  element.style.maskPosition = '';
  element.style.clipPath = '';
  element.style.overflow = '';

  if (!spriteStyle) {
    return;
  }

  Object.assign(element.style, spriteStyle);
};

const getNoteSprite = (
  panelAssets: ResolvedDanceNoteskin['panelAssets'][PanelName] | undefined,
  event: TimedNoteEvent,
): ResolvedSpriteAsset | null => {
  if (!panelAssets) {
    return null;
  }

  if (event.kind === 'mine') {
    return panelAssets.tapMine;
  }

  return panelAssets.tapNote;
};

const getNoteColor = (sprite: ResolvedSpriteAsset | null, beat: number): string => {
  if (sprite && sprite.renderMode === 'image') {
    return 'transparent';
  }

  return getQuantizationColor(beat);
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
}

function App() {
  const [selectedChartIndex, setSelectedChartIndex] = useState(0);
  const [selectedNoteskinId, setSelectedNoteskinId] = useState(bundledNoteskinOptions[0]?.id ?? 'metal');
  const [selectedBotFormStyle, setSelectedBotFormStyle] = useState<BotFormStyleId>(defaultBotFormStyle);
  const [localNoteskinOption, setLocalNoteskinOption] = useState<NoteskinOption | null>(null);
  const [resolvedNoteskin, setResolvedNoteskin] = useState<ResolvedDanceNoteskin | null>(null);
  const [noteskinLoading, setNoteskinLoading] = useState(false);
  const [visibleBeats, setVisibleBeats] = useState(defaultVisibleBeats);
  const [botWindowRect, setBotWindowRect] = useState<BotWindowRect>({
    x: 26,
    y: 24,
    width: 460,
    height: 700,
  });
  const noteskinImportRef = useRef<HTMLInputElement | null>(null);
  const notefieldFrameRef = useRef<HTMLDivElement | null>(null);
  const minimapRef = useRef<HTMLDivElement | null>(null);
  const botWindowInteractionRef = useRef<BotWindowInteraction | null>(null);
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
  const noteskinOptions = useMemo(
    () => (localNoteskinOption ? [...bundledNoteskinOptions, localNoteskinOption] : bundledNoteskinOptions),
    [localNoteskinOption],
  );
  const selectedNoteskinOption =
    noteskinOptions.find((option) => option.id === selectedNoteskinId) ?? noteskinOptions[0] ?? bundledNoteskinOptions[0];
  const holdSegments = useMemo(() => buildHoldSegments(selectedTimedChart.events), [selectedTimedChart.events]);
  const holdEndBeatMap = useMemo(() => buildHoldEndBeatMap(holdSegments), [holdSegments]);
  const botTimeline = useMemo(
    () => buildBotTimeline(selectedTimedChart.events, holdEndBeatMap),
    [holdEndBeatMap, selectedTimedChart.events],
  );
  const pixelsPerBeat = viewportHeight / visibleBeats;
  const visualScale = clamp(Math.sqrt(defaultVisibleBeats / visibleBeats), minVisualScale, maxVisualScale);
  const laneGap = Math.round(baseLaneGap * visualScale);
  const sidePadding = Math.round(baseSidePadding * visualScale);
  const playfieldWidth = Math.round(
    baseLaneWidth * visualScale * panelOrder.length + laneGap * (panelOrder.length - 1) + sidePadding * 2,
  );
  const noteWidth = Math.max(Math.round(baseNoteWidth * visualScale), 28);
  const noteHeight = Math.max(Math.round(baseNoteHeight * visualScale), 12);
  const holdWidth = Math.max(Math.round(baseHoldWidth * visualScale), 12);
  const receptorHeight = Math.max(Math.round(baseReceptorHeight * visualScale), 28);
  const receptorRadius = Math.max(Math.round(14 * visualScale), 10);
  const explosionSize = Math.round(receptorHeight * 1.28);
  const chartContentHeight = (selectedTimedChart.lastBeat + renderBufferBeats * 2) * pixelsPerBeat + receptorOffset;
  const totalChartBeats = Math.max(selectedTimedChart.lastBeat, 1);
  const playfieldStyle = {
    '--playfield-width': `${playfieldWidth}px`,
    '--lane-gap': `${laneGap}px`,
    '--playfield-gutter': `${sidePadding}px`,
    '--note-width': `${noteWidth}px`,
    '--note-height': `${noteHeight}px`,
    '--hold-width': `${holdWidth}px`,
    '--receptor-height': `${receptorHeight}px`,
    '--receptor-radius': `${receptorRadius}px`,
    '--explosion-size': `${explosionSize}px`,
    '--receptor-offset': `${receptorOffset}px`,
  } as CSSProperties;

  const {
    audioReady,
    displayBeat,
    isPlaying,
    playbackClockRef,
    renderBeatAnchor,
    scrollLayerRef,
    seekToBeat,
    setIsPlaying,
  } = useChartPlayback({
    chartIndex: selectedChartIndex,
    events: selectedTimedChart.events,
    lastBeat: selectedTimedChart.lastBeat,
    pixelsPerBeat,
    visibleBeats,
    minVisibleBeats,
    maxVisibleBeats,
    setVisibleBeats,
    receptorOffset,
    onTriggerPanelFeedback: (event) => {
      const receptor = receptorRefs.current[event.panel];
      const explosion = explosionRefs.current[event.panel];
      const panelAssets = resolvedNoteskin?.panelAssets[event.panel];
      const explosionSprite =
        event.kind === 'hold-head' || event.kind === 'roll-head'
          ? panelAssets?.holdExplosion ?? panelAssets?.tapExplosionBright ?? panelAssets?.tapExplosionDim ?? null
          : panelAssets?.tapExplosionBright ?? panelAssets?.tapExplosionDim ?? null;
      const explosionRotation = getPanelRotation(resolvedNoteskin, event.panel);

      receptor?.animate(
        [
          { transform: 'scale(1)', filter: 'brightness(1)' },
          { transform: 'scale(1.08)', filter: 'brightness(1.35)' },
          { transform: 'scale(1)', filter: 'brightness(1)' },
        ],
        { duration: 140, easing: 'ease-out' },
      );

      if (explosion) {
        applySpriteStyleToElement(explosion, explosionSprite ? getSpriteFillStyle(explosionSprite) : null);
      }

      explosion?.animate(
        [
          { opacity: 0, transform: `translate(-50%, -50%) rotate(${explosionRotation}deg) scale(0.3)` },
          { opacity: 0.95, transform: `translate(-50%, -50%) rotate(${explosionRotation}deg) scale(1)` },
          { opacity: 0, transform: `translate(-50%, -50%) rotate(${explosionRotation}deg) scale(1.5)` },
        ],
        { duration: 180, easing: 'ease-out' },
      );
    },
  });

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
  const visibleBeatGuides = useMemo(() => {
    const beats: Array<{ beat: number; isMeasure: boolean }> = [];

    for (let beat = measureStart; beat <= measureEnd; beat += 1) {
      beats.push({ beat, isMeasure: beat % 4 === 0 });
    }

    return beats;
  }, [measureEnd, measureStart]);

  useEffect(() => {
    const frame = notefieldFrameRef.current;

    if (!frame) {
      return undefined;
    }

    const syncBotWindowRect = () => {
      const bounds = frame.getBoundingClientRect();

      setBotWindowRect((previousRect) => clampBotWindowRect(previousRect, bounds.width, bounds.height));
    };

    syncBotWindowRect();
    window.addEventListener('resize', syncBotWindowRect);

    return () => {
      window.removeEventListener('resize', syncBotWindowRect);
    };
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const interaction = botWindowInteractionRef.current;
      const frame = notefieldFrameRef.current;

      if (!interaction || !frame) {
        return;
      }

      const bounds = frame.getBoundingClientRect();
      const deltaX = event.clientX - interaction.originX;
      const deltaY = event.clientY - interaction.originY;

      setBotWindowRect(() => {
        const nextRect =
          interaction.mode === 'drag'
            ? {
                ...interaction.startRect,
                x: interaction.startRect.x + deltaX,
                y: interaction.startRect.y + deltaY,
              }
            : {
                ...interaction.startRect,
                width: interaction.startRect.width + deltaX,
                height: interaction.startRect.height + deltaY,
              };

        return clampBotWindowRect(nextRect, bounds.width, bounds.height);
      });
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (botWindowInteractionRef.current?.pointerId !== event.pointerId) {
        return;
      }

      botWindowInteractionRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, []);

  useEffect(() => {
    let isDisposed = false;

    if (!selectedNoteskinOption) {
      setResolvedNoteskin(null);
      return undefined;
    }

    setNoteskinLoading(true);

    void loadResolvedDanceNoteskin(selectedNoteskinOption, noteskinOptions)
      .then((nextResolvedNoteskin) => {
        if (!isDisposed) {
          setResolvedNoteskin(nextResolvedNoteskin);
        }
      })
      .catch(() => {
        if (!isDisposed) {
          setResolvedNoteskin(null);
        }
      })
      .finally(() => {
        if (!isDisposed) {
          setNoteskinLoading(false);
        }
      });

    return () => {
      isDisposed = true;
    };
  }, [noteskinOptions, selectedNoteskinOption]);

  useEffect(() => {
    return () => {
      releaseNoteskinOption(localNoteskinOption);
    };
  }, [localNoteskinOption]);

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

  const handleImportNoteskin = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextOption = buildImportedNoteskinOption(event.target.files ?? []);
    event.target.value = '';

    if (!nextOption) {
      return;
    }

    setLocalNoteskinOption((previousOption) => {
      releaseNoteskinOption(previousOption);
      return nextOption;
    });
    setSelectedNoteskinId(nextOption.id);
  };

  const beginBotWindowInteraction = (
    event: React.PointerEvent<HTMLElement>,
    mode: BotWindowInteraction['mode'],
  ) => {
    event.preventDefault();
    event.stopPropagation();

    botWindowInteractionRef.current = {
      mode,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      startRect: botWindowRect,
    };
  };

  const getReceptorStyle = (panel: PanelName): CSSProperties =>
    getSpriteBackgroundStyle(
      resolvedNoteskin?.panelAssets[panel].receptor ?? null,
      getPanelRotation(resolvedNoteskin, panel),
    );

  const getHoldStyle = (segment: HoldSegment): CSSProperties =>
    getSpriteBackgroundStyle(
      resolvedNoteskin?.panelAssets[segment.panel].holdBodyActive ?? null,
      getPanelRotation(resolvedNoteskin, segment.panel),
      {
        top: segment.startBeat * pixelsPerBeat,
        height: Math.max((segment.endBeat - segment.startBeat) * pixelsPerBeat, 10),
        left: '50%',
        transform: `translateX(-50%) rotate(${getPanelRotation(resolvedNoteskin, segment.panel)}deg)`,
      },
    );

  const getEventStyle = (event: TimedNoteEvent): CSSProperties => {
    const noteSprite = getNoteSprite(resolvedNoteskin?.panelAssets[event.panel], event);

    if (noteSprite?.renderMode === 'mask') {
      return getSpriteFillStyle(resolvedNoteskin?.panelAssets[event.panel].receptor ?? null);
    }

    return {
      ...getSpriteFillStyle(noteSprite),
      backgroundColor: getNoteColor(noteSprite, event.beat),
    } as CSSProperties;
  };

  const getEventDetailStyle = (event: TimedNoteEvent): CSSProperties | null => {
    const noteSprite = getNoteSprite(resolvedNoteskin?.panelAssets[event.panel], event);

    if (!noteSprite || noteSprite.renderMode !== 'mask') {
      return null;
    }

    return null;
  };

  const getEventFrameStyle = (event: TimedNoteEvent): CSSProperties => ({
    top: event.beat * pixelsPerBeat,
    left: '50%',
    width: receptorHeight,
    height: receptorHeight,
    transform: `translate(-50%, -50%) rotate(${getPanelRotation(resolvedNoteskin, event.panel)}deg)`,
  });

  const getEventUnderlayStyle = (event: TimedNoteEvent): CSSProperties | null => {
    const noteSprite = getNoteSprite(resolvedNoteskin?.panelAssets[event.panel], event);

    if (!noteSprite || noteSprite.renderMode !== 'mask') {
      return null;
    }

    return getTintedSpriteMaskStyle(
      resolvedNoteskin?.panelAssets[event.panel].receptor ?? null,
      getQuantizationColor(event.beat),
    );
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

          <label className="toolbar-field">
            <span>Noteskin</span>
            <select value={selectedNoteskinOption?.id ?? ''} onChange={(event) => setSelectedNoteskinId(event.target.value)}>
              {noteskinOptions.map((noteskin) => (
                <option key={noteskin.id} value={noteskin.id}>
                  {noteskin.label}
                </option>
              ))}
            </select>
          </label>

          <label className="toolbar-field toolbar-field-action">
            <span>Import Noteskin</span>
            <button type="button" className="toolbar-button" onClick={() => noteskinImportRef.current?.click()}>
              Load folder
            </button>
            <input
              ref={(element) => {
                noteskinImportRef.current = element;

                if (element) {
                  element.setAttribute('webkitdirectory', '');
                  element.setAttribute('directory', '');
                }
              }}
              className="toolbar-file-input"
              type="file"
              multiple
              onChange={handleImportNoteskin}
            />
          </label>

          <div className="toolbar-badges">
            <span>{selectedChart?.difficulty} {selectedChart?.meter ?? 0}</span>
            <span>{selectedNoteskinOption?.label ?? 'Noteskin'} noteskin</span>
            <span>{visibleBeats.toFixed(2)} beats visible</span>
            <span>Beat {displayBeat.toFixed(2)}</span>
            <span>{noteskinLoading ? 'Noteskin loading' : 'Noteskin ready'}</span>
            <span>{audioReady ? 'Audio ready' : 'Audio loading'}</span>
          </div>
        </div>
      </header>

      <NotefieldPreview
        botWindow={
          <DancingBotWindow
            botTimeline={botTimeline}
            botWindowRect={botWindowRect}
            currentBeat={displayBeat}
            isPlaying={isPlaying}
            resolvedNoteskin={resolvedNoteskin}
            playbackClockRef={playbackClockRef}
            selectedFormStyle={selectedBotFormStyle}
            onFormStyleChange={setSelectedBotFormStyle}
            beginBotWindowInteraction={beginBotWindowInteraction}
          />
        }
        chartContentHeight={chartContentHeight}
        chartDifficultyLabel={`${selectedChart?.difficulty} ${selectedChart?.meter ?? 0}`}
        chartEventCount={selectedTimedChart.events.length}
        chartOffsetSeconds={sampleChart.metadata.offset}
        displayBeat={displayBeat}
        explosionRefs={explosionRefs}
        getNoteDetailStyle={getEventDetailStyle}
        getHoldStyle={getHoldStyle}
        getNoteFrameStyle={getEventFrameStyle}
        getNoteStyle={getEventStyle}
        getNoteUnderlayStyle={getEventUnderlayStyle}
        getReceptorStyle={getReceptorStyle}
        handleMinimapPointerDown={handleMinimapPointerDown}
        handleMinimapPointerMove={handleMinimapPointerMove}
        isPlaying={isPlaying}
        minimapMeasures={minimapMeasures}
        minimapRef={minimapRef}
        notefieldFrameRef={notefieldFrameRef}
        panelOrder={panelOrder}
        pixelsPerBeat={pixelsPerBeat}
        playfieldStyle={playfieldStyle}
        receptorOffset={receptorOffset}
        receptorRefs={receptorRefs}
        scrollLayerRef={scrollLayerRef}
        totalChartBeats={totalChartBeats}
        viewportHeight={viewportHeight}
        visibleBeatGuides={visibleBeatGuides}
        visibleEvents={visibleEvents}
        visibleHolds={visibleHolds}
      />
    </main>
  );
}

export default App;
