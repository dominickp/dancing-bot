import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ChangeEvent, FocusEvent } from 'react';
import type { SimfileDocument, TimedChart, TimedNoteEvent } from './lib/simfile';
import { getBpmAtBeat } from './lib/simfile';
import {
  getBundledNoteskinOptions,
  getPanelRotation,
  loadResolvedDanceNoteskin,
} from './lib/noteskin';
import type { ResolvedDanceNoteskin, ResolvedSpriteAsset } from './lib/noteskin';
import {
  buildBotTimeline,
  defaultBotFootStyle,
  defaultBotPadStyle,
  BotWindowRect,
  BotWindowInteraction,
  clampBotWindowRect,
  defaultBotFormStyle,
  DancingBotWindow,
} from './components/DancingBotWindow';
import type { BotFootStyleId, BotFormStyleId, BotPadStyleId } from './components/DancingBotWindow';
import type { BotStep } from './components/DancingBotWindow';
import { NotefieldPreview } from './components/NotefieldPreview';
import { useChartPlayback } from './hooks/useChartPlayback';
import type { PlaybackClock } from './hooks/useChartPlayback';
import type { StepParityConfig } from './lib/parity';
import { bundledSongSources, loadLocalSongSource, releaseLoadedSongSource } from './lib/songSource';
import type { LoadedSongSource } from './lib/songSource';
import { buildParityAssignmentMap } from './lib/parity';

const panelOrder = ['left', 'down', 'up', 'right'] as const;
const receptorTopInset = 20;
const viewportHeight = 760;
const minVisibleBeats = 0.25;
const maxVisibleBeats = 32;
const defaultVisibleBeats = 10;
const minPlaybackRate = 0.2;
const maxPlaybackRate = 1.5;
const playbackRateStep = 0.1;
const renderBufferBeats = 4;
const settingsStorageKey = 'dancing-bot:ui-settings';
const baseLaneWidth = 72;
const baseLaneGap = 0;
const baseSidePadding = 12;
const baseNoteWidth = 44;
const baseNoteHeight = 44;
const baseReceptorHeight = 56;
const baseExplosionSize = 110;
const minVisualScale = 0.68;
const maxVisualScale = 1.24;

type PanelName = (typeof panelOrder)[number];

interface HoldSegment {
  panel: PanelName;
  startBeat: number;
  endBeat: number;
  kind: 'hold' | 'roll';
}

interface MinimapMeasure {
  measureIndex: number;
  startBeat: number;
  density: number;
}

interface NotefieldParityHint {
  beat: number;
  rowIndex: number;
  labels: string[];
}

interface PlayfieldInteraction {
  pointerId: number;
  originX: number;
  startOffsetX: number;
}

interface PersistedUiSettings {
  selectedBotFormStyle: BotFormStyleId;
  selectedBotFootStyle: BotFootStyleId;
  selectedBotPadStyle: BotPadStyleId;
  playbackRate: number;
  isBotPanelGlowEnabled: boolean;
  isBotPanelLightsEnabled: boolean;
  isBotCrossoverEnabled: boolean;
  isBotBracketEnabled: boolean;
  isBotFootswitchEnabled: boolean;
  isParityHintOverlayEnabled: boolean;
  visibleBeats: number;
  playfieldOffsetX: number;
  botWindowRect: BotWindowRect;
  isAppearanceSectionOpen: boolean;
  isBehaviorSectionOpen: boolean;
}

const bundledNoteskinOptions = getBundledNoteskinOptions();
const genericArrowClipPath = 'polygon(50% 100%, 100% 50%, 72% 50%, 72% 0%, 28% 0%, 28% 50%, 0% 50%)';
const emptyTimedChart: TimedChart = { events: [], lastBeat: 0, lastTimeSeconds: 0 };
const emptySimfileDocument: SimfileDocument = {
  metadata: {
    title: '',
    subtitle: '',
    artist: '',
    credit: '',
    banner: '',
    background: '',
    music: '',
    offset: 0,
  },
  bpms: [],
  stops: [],
  charts: [],
};

const defaultBotWindowRect: BotWindowRect = {
  x: 26,
  y: 24,
  width: 460,
  height: 800,
};

const defaultUiSettings: PersistedUiSettings = {
  selectedBotFormStyle: defaultBotFormStyle,
  selectedBotFootStyle: defaultBotFootStyle,
  selectedBotPadStyle: defaultBotPadStyle,
  playbackRate: 1,
  isBotPanelGlowEnabled: true,
  isBotPanelLightsEnabled: true,
  isBotCrossoverEnabled: true,
  isBotBracketEnabled: true,
  isBotFootswitchEnabled: true,
  isParityHintOverlayEnabled: true,
  visibleBeats: defaultVisibleBeats,
  playfieldOffsetX: 0,
  botWindowRect: defaultBotWindowRect,
  isAppearanceSectionOpen: true,
  isBehaviorSectionOpen: true,
};

const botFormStyleIds: readonly BotFormStyleId[] = ['straight-wide', 'straight-minimal', 'heels-out', 'toes-out', 'slanted-right'];
const botFootStyleIds: readonly BotFootStyleId[] = ['default', 'silhouette-white', 'shoe'];
const botPadStyleIds: readonly BotPadStyleId[] = ['itg', 'ddr'];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const clampPlaybackRate = (value: number): number =>
  clamp(Math.round(value / playbackRateStep) * playbackRateStep, minPlaybackRate, maxPlaybackRate);
const getHoldSegmentKey = (panel: PanelName, startBeat: number): string => `${panel}:${startBeat.toFixed(6)}`;

const readPersistedUiSettings = (): PersistedUiSettings => {
  if (typeof window === 'undefined') {
    return defaultUiSettings;
  }

  try {
    const rawValue = window.localStorage.getItem(settingsStorageKey);

    if (!rawValue) {
      return defaultUiSettings;
    }

    const parsedValue: unknown = JSON.parse(rawValue);

    if (!isRecord(parsedValue)) {
      return defaultUiSettings;
    }

    const parsedBotWindowRect = isRecord(parsedValue.botWindowRect) ? parsedValue.botWindowRect : null;

    return {
      selectedBotFormStyle: botFormStyleIds.includes(parsedValue.selectedBotFormStyle as BotFormStyleId)
        ? (parsedValue.selectedBotFormStyle as BotFormStyleId)
        : defaultUiSettings.selectedBotFormStyle,
      selectedBotFootStyle: botFootStyleIds.includes(parsedValue.selectedBotFootStyle as BotFootStyleId)
        ? (parsedValue.selectedBotFootStyle as BotFootStyleId)
        : defaultUiSettings.selectedBotFootStyle,
      selectedBotPadStyle: botPadStyleIds.includes(parsedValue.selectedBotPadStyle as BotPadStyleId)
        ? (parsedValue.selectedBotPadStyle as BotPadStyleId)
        : defaultUiSettings.selectedBotPadStyle,
      playbackRate:
        typeof parsedValue.playbackRate === 'number'
          ? clampPlaybackRate(parsedValue.playbackRate)
          : defaultUiSettings.playbackRate,
      isBotPanelGlowEnabled:
        typeof parsedValue.isBotPanelGlowEnabled === 'boolean'
          ? parsedValue.isBotPanelGlowEnabled
          : defaultUiSettings.isBotPanelGlowEnabled,
      isBotPanelLightsEnabled:
        typeof parsedValue.isBotPanelLightsEnabled === 'boolean'
          ? parsedValue.isBotPanelLightsEnabled
          : defaultUiSettings.isBotPanelLightsEnabled,
      isBotCrossoverEnabled:
        typeof parsedValue.isBotCrossoverEnabled === 'boolean'
          ? parsedValue.isBotCrossoverEnabled
          : defaultUiSettings.isBotCrossoverEnabled,
      isBotBracketEnabled:
        typeof parsedValue.isBotBracketEnabled === 'boolean'
          ? parsedValue.isBotBracketEnabled
          : defaultUiSettings.isBotBracketEnabled,
      isBotFootswitchEnabled:
        typeof parsedValue.isBotFootswitchEnabled === 'boolean'
          ? parsedValue.isBotFootswitchEnabled
          : defaultUiSettings.isBotFootswitchEnabled,
      isParityHintOverlayEnabled:
        typeof parsedValue.isParityHintOverlayEnabled === 'boolean'
          ? parsedValue.isParityHintOverlayEnabled
          : defaultUiSettings.isParityHintOverlayEnabled,
      visibleBeats:
        typeof parsedValue.visibleBeats === 'number'
          ? clamp(parsedValue.visibleBeats, minVisibleBeats, maxVisibleBeats)
          : defaultUiSettings.visibleBeats,
      playfieldOffsetX:
        typeof parsedValue.playfieldOffsetX === 'number' ? parsedValue.playfieldOffsetX : defaultUiSettings.playfieldOffsetX,
      botWindowRect: {
        x: typeof parsedBotWindowRect?.x === 'number' ? parsedBotWindowRect.x : defaultBotWindowRect.x,
        y: typeof parsedBotWindowRect?.y === 'number' ? parsedBotWindowRect.y : defaultBotWindowRect.y,
        width: typeof parsedBotWindowRect?.width === 'number' ? parsedBotWindowRect.width : defaultBotWindowRect.width,
        height: typeof parsedBotWindowRect?.height === 'number' ? parsedBotWindowRect.height : defaultBotWindowRect.height,
      },
      isAppearanceSectionOpen:
        typeof parsedValue.isAppearanceSectionOpen === 'boolean'
          ? parsedValue.isAppearanceSectionOpen
          : defaultUiSettings.isAppearanceSectionOpen,
      isBehaviorSectionOpen:
        typeof parsedValue.isBehaviorSectionOpen === 'boolean'
          ? parsedValue.isBehaviorSectionOpen
          : defaultUiSettings.isBehaviorSectionOpen,
    };
  } catch {
    return defaultUiSettings;
  }
};

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
  ...getSpriteFillStyle(sprite),
  ...baseStyle,
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
  const activeHeads = new Map<PanelName, { startBeat: number; kind: HoldSegment['kind'] }>();
  const segments: HoldSegment[] = [];

  for (const event of events) {
    if (event.kind === 'hold-head' || event.kind === 'roll-head') {
      activeHeads.set(event.panel, {
        startBeat: event.beat,
        kind: event.kind === 'roll-head' ? 'roll' : 'hold',
      });
      continue;
    }

    if (event.kind !== 'hold-tail') {
      continue;
    }

    const activeHead = activeHeads.get(event.panel);

    if (!activeHead) {
      continue;
    }

    segments.push({
      panel: event.panel,
      startBeat: activeHead.startBeat,
      endBeat: event.beat,
      kind: activeHead.kind,
    });
    activeHeads.delete(event.panel);
  }

  return segments;
}

function App() {
  const persistedUiSettings = useMemo(readPersistedUiSettings, []);
  const [isMobileUnsupported, setIsMobileUnsupported] = useState(false);
  const [selectedSongId, setSelectedSongId] = useState(bundledSongSources[0]?.id ?? '');
  const [selectedChartIndex, setSelectedChartIndex] = useState(0);
  const [selectedBotFormStyle, setSelectedBotFormStyle] = useState<BotFormStyleId>(persistedUiSettings.selectedBotFormStyle);
  const [selectedBotFootStyle, setSelectedBotFootStyle] = useState<BotFootStyleId>(persistedUiSettings.selectedBotFootStyle);
  const [selectedBotPadStyle, setSelectedBotPadStyle] = useState<BotPadStyleId>(persistedUiSettings.selectedBotPadStyle);
  const [playbackRate, setPlaybackRate] = useState(persistedUiSettings.playbackRate);
  const [isBotPanelGlowEnabled, setIsBotPanelGlowEnabled] = useState(persistedUiSettings.isBotPanelGlowEnabled);
  const [isBotPanelLightsEnabled, setIsBotPanelLightsEnabled] = useState(persistedUiSettings.isBotPanelLightsEnabled);
  const [isBotCrossoverEnabled, setIsBotCrossoverEnabled] = useState(persistedUiSettings.isBotCrossoverEnabled);
  const [isBotBracketEnabled, setIsBotBracketEnabled] = useState(persistedUiSettings.isBotBracketEnabled);
  const [isBotFootswitchEnabled, setIsBotFootswitchEnabled] = useState(persistedUiSettings.isBotFootswitchEnabled);
  const [isParityHintOverlayEnabled, setIsParityHintOverlayEnabled] = useState(persistedUiSettings.isParityHintOverlayEnabled);
  const [localSongSource, setLocalSongSource] = useState<LoadedSongSource | null>(null);
  const [resolvedNoteskin, setResolvedNoteskin] = useState<ResolvedDanceNoteskin | null>(null);
  const [songLoadError, setSongLoadError] = useState<string | null>(null);
  const [visibleBeats, setVisibleBeats] = useState(persistedUiSettings.visibleBeats);
  const [frameWidth, setFrameWidth] = useState(0);
  const [playfieldOffsetX, setPlayfieldOffsetX] = useState(persistedUiSettings.playfieldOffsetX);
  const [isPlayfieldDragging, setIsPlayfieldDragging] = useState(false);
  const [botWindowRect, setBotWindowRect] = useState<BotWindowRect>(persistedUiSettings.botWindowRect);
  const [isAppearanceSectionOpen, setIsAppearanceSectionOpen] = useState(persistedUiSettings.isAppearanceSectionOpen);
  const [isBehaviorSectionOpen, setIsBehaviorSectionOpen] = useState(persistedUiSettings.isBehaviorSectionOpen);
  const songImportRef = useRef<HTMLInputElement | null>(null);
  const notefieldFrameRef = useRef<HTMLDivElement | null>(null);
  const minimapRef = useRef<HTMLDivElement | null>(null);
  const playfieldInteractionRef = useRef<PlayfieldInteraction | null>(null);
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

  const availableSongSources = useMemo(
    () => (localSongSource ? [...bundledSongSources, localSongSource] : bundledSongSources),
    [localSongSource],
  );
  const selectedSong =
    availableSongSources.find((songSource) => songSource.id === selectedSongId) ?? availableSongSources[0] ?? null;
  const simfile = selectedSong?.document ?? emptySimfileDocument;
  const displayTitle = [simfile.metadata.title, simfile.metadata.subtitle].filter(Boolean).join(' ') || 'Dancing Bot';
  const selectedChart = simfile.charts[selectedChartIndex] ?? simfile.charts[0] ?? null;
  const selectedTimedChart = selectedSong?.timedCharts[selectedChartIndex] ?? selectedSong?.timedCharts[0] ?? emptyTimedChart;
  const selectedNoteskinOption = bundledNoteskinOptions[0] ?? null;
  const holdSegments = useMemo(() => buildHoldSegments(selectedTimedChart.events), [selectedTimedChart.events]);
  const holdEndBeatMap = useMemo(() => buildHoldEndBeatMap(holdSegments), [holdSegments]);
  const botParityConfig = useMemo<Partial<StepParityConfig>>(
    () => ({
      allowCrossovers: isBotCrossoverEnabled,
      allowBrackets: isBotBracketEnabled,
      allowFootswitches: isBotFootswitchEnabled,
      favorJumpsOverBrackets: !isBotBracketEnabled,
    }),
    [isBotBracketEnabled, isBotCrossoverEnabled, isBotFootswitchEnabled],
  );
  const botTimeline = useMemo(
    () => buildBotTimeline(selectedTimedChart.events, holdEndBeatMap, simfile, botParityConfig),
    [botParityConfig, holdEndBeatMap, selectedTimedChart.events, simfile],
  );
  const parityHintDiagnostics = useMemo<NotefieldParityHint[]>(() => {
    if (!isParityHintOverlayEnabled) {
      return [];
    }

    const result = buildParityAssignmentMap(selectedTimedChart.events, holdEndBeatMap, simfile, botParityConfig);
    const labelByKind: Record<string, string> = {
      bracket: 'Bracket',
      crossover: 'Crossover',
      'double-step': 'Double-step',
      footswitch: 'Footswitch',
      spin: 'Spin',
    };

    return result.diagnostics.map((diagnostic) => ({
      beat: diagnostic.beat,
      rowIndex: diagnostic.rowIndex,
      labels: diagnostic.kinds.map((kind) => labelByKind[kind] ?? kind),
    }));
  }, [botParityConfig, holdEndBeatMap, isParityHintOverlayEnabled, selectedTimedChart.events, simfile]);
  const pixelsPerBeat = viewportHeight / visibleBeats;
  const visualScale = clamp(Math.sqrt(defaultVisibleBeats / visibleBeats), minVisualScale, maxVisualScale);
  const laneGap = Math.round(baseLaneGap * visualScale);
  const sidePadding = Math.round(baseSidePadding * visualScale);
  const measureGuideGutter = Math.max(Math.round(64 * visualScale), 48);
  const playfieldWidth = Math.round(
    baseLaneWidth * visualScale * panelOrder.length + laneGap * (panelOrder.length - 1) + sidePadding * 2,
  );
  const totalPlayfieldWidth = playfieldWidth + measureGuideGutter;
  const noteWidth = Math.max(Math.round(baseNoteWidth * visualScale), 28);
  const noteHeight = Math.max(Math.round(baseNoteHeight * visualScale), 12);
  const receptorHeight = Math.max(Math.round(baseReceptorHeight * visualScale), 28);
  const receptorOffset = receptorTopInset + receptorHeight / 2;
  const holdWidth = receptorHeight;
  const receptorRadius = Math.max(Math.round(14 * visualScale), 10);
  const explosionSize = Math.round(receptorHeight * 1.28);
  const chartContentHeight = (selectedTimedChart.lastBeat + renderBufferBeats * 2) * pixelsPerBeat + receptorOffset;
  const totalChartBeats = Math.max(selectedTimedChart.lastBeat, 1);
  const maxPlayfieldOffsetX = Math.max(0, (frameWidth - totalPlayfieldWidth) / 2);
  const playfieldStyle = {
    '--playfield-width': `${totalPlayfieldWidth}px`,
    '--lane-track-width': `${playfieldWidth}px`,
    '--playfield-offset-x': `${playfieldOffsetX}px`,
    '--lane-gap': `${laneGap}px`,
    '--playfield-gutter': `${sidePadding}px`,
    '--measure-guide-gutter': `${measureGuideGutter}px`,
    '--note-width': `${noteWidth}px`,
    '--note-height': `${noteHeight}px`,
    '--hold-width': `${holdWidth}px`,
    '--receptor-height': `${receptorHeight}px`,
    '--receptor-radius': `${receptorRadius}px`,
    '--explosion-size': `${explosionSize}px`,
    '--receptor-offset': `${receptorOffset}px`,
    '--receptor-top': `${receptorTopInset}px`,
  } as CSSProperties;

  const {
    displayBeat,
    isLoading,
    isPlaying,
    measureGuideLayerRef,
    playbackClockRef,
    renderBeatAnchor,
    scrollLayerRef,
    seekToBeat,
    setIsPlaying,
  } = useChartPlayback({
    audioSource: selectedSong?.audioUrl ?? null,
    chartIndex: selectedChartIndex,
    events: selectedTimedChart.events,
    lastBeat: selectedTimedChart.lastBeat,
    playbackRate,
    pixelsPerBeat,
    visibleBeats,
    minVisibleBeats,
    maxVisibleBeats,
    setVisibleBeats,
    receptorOffset,
    simfile,
    onTriggerPanelFeedback: (event) => {
      const receptor = receptorRefs.current[event.panel];
      const explosion = explosionRefs.current[event.panel];
      const panelAssets = resolvedNoteskin?.panelAssets[event.panel];
      const explosionSprite =
        event.kind === 'hold-head' || event.kind === 'roll-head'
          ? panelAssets?.holdExplosion ?? panelAssets?.tapExplosionDim ?? panelAssets?.tapExplosionBright ?? null
          : panelAssets?.tapExplosionDim ?? panelAssets?.tapExplosionBright ?? null;
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
  const currentBpm = getBpmAtBeat(displayBeat, simfile.bpms);
  const effectiveBpm = currentBpm * playbackRate;
  const bpmPrecision = effectiveBpm >= 100 ? 0 : 1;

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
          event.kind !== 'hold-tail' &&
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

  const measureStart = Math.max(0, Math.floor((renderBeatAnchor - renderBufferBeats) / 4) * 4);
  const measureEnd = Math.ceil((renderBeatAnchor + visibleBeats + renderBufferBeats) / 4) * 4;
  const visibleBeatGuides = useMemo(() => {
    const beats: Array<{ beat: number; isMeasure: boolean }> = [];

    for (let beat = measureStart; beat <= measureEnd; beat += 1) {
      beats.push({ beat, isMeasure: beat % 4 === 0 });
    }

    return beats;
  }, [measureEnd, measureStart]);
  const visibleParityHints = useMemo(
    () =>
      parityHintDiagnostics.filter(
        (hint) => hint.beat >= renderBeatAnchor - renderBufferBeats && hint.beat <= renderBeatAnchor + visibleBeats + renderBufferBeats,
      ),
    [parityHintDiagnostics, renderBeatAnchor, visibleBeats],
  );

  useEffect(() => {
    const updateUnsupportedState = () => {
      const hasCoarsePointer = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
      setIsMobileUnsupported(hasCoarsePointer || window.innerWidth <= 900);
    };

    updateUnsupportedState();
    window.addEventListener('resize', updateUnsupportedState);

    return () => {
      window.removeEventListener('resize', updateUnsupportedState);
    };
  }, []);

  useEffect(() => {
    return () => {
      releaseLoadedSongSource(localSongSource);
    };
  }, [localSongSource]);

  useEffect(() => {
    if (selectedSong) {
      return;
    }

    if (bundledSongSources[0]) {
      setSelectedSongId(bundledSongSources[0].id);
    }
  }, [selectedSong]);

  useEffect(() => {
    setSelectedChartIndex(0);
  }, [selectedSong?.id]);

  useEffect(() => {
    const frame = notefieldFrameRef.current;

    if (!frame) {
      return undefined;
    }

    const syncBotWindowRect = () => {
      const bounds = frame.getBoundingClientRect();
      const nextMaxPlayfieldOffsetX = Math.max(0, (bounds.width - totalPlayfieldWidth) / 2);

      setFrameWidth(bounds.width);
      setPlayfieldOffsetX((previousOffsetX) => clamp(previousOffsetX, -nextMaxPlayfieldOffsetX, nextMaxPlayfieldOffsetX));
      setBotWindowRect((previousRect) => clampBotWindowRect(previousRect, bounds.width, bounds.height));
    };

    syncBotWindowRect();
    window.addEventListener('resize', syncBotWindowRect);

    return () => {
      window.removeEventListener('resize', syncBotWindowRect);
    };
  }, [totalPlayfieldWidth]);

  useEffect(() => {
    if (frameWidth <= 0) {
      return;
    }

    setPlayfieldOffsetX((previousOffsetX) => clamp(previousOffsetX, -maxPlayfieldOffsetX, maxPlayfieldOffsetX));
  }, [frameWidth, maxPlayfieldOffsetX]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      settingsStorageKey,
      JSON.stringify({
        selectedBotFormStyle,
        selectedBotFootStyle,
        selectedBotPadStyle,
        playbackRate,
        isBotPanelGlowEnabled,
        isBotPanelLightsEnabled,
        isBotCrossoverEnabled,
        isBotBracketEnabled,
        isBotFootswitchEnabled,
        isParityHintOverlayEnabled,
        visibleBeats,
        playfieldOffsetX,
        botWindowRect,
        isAppearanceSectionOpen,
        isBehaviorSectionOpen,
      } satisfies PersistedUiSettings),
    );
  }, [
    botWindowRect,
    isAppearanceSectionOpen,
    isBehaviorSectionOpen,
    isBotBracketEnabled,
    isBotCrossoverEnabled,
    isBotFootswitchEnabled,
    isBotPanelGlowEnabled,
    isBotPanelLightsEnabled,
    isParityHintOverlayEnabled,
    playbackRate,
    playfieldOffsetX,
    selectedBotFootStyle,
    selectedBotFormStyle,
    selectedBotPadStyle,
    visibleBeats,
  ]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const playfieldInteraction = playfieldInteractionRef.current;

      if (playfieldInteraction) {
        setIsPlayfieldDragging(true);
        setPlayfieldOffsetX(
          clamp(
            playfieldInteraction.startOffsetX + (event.clientX - playfieldInteraction.originX),
            -maxPlayfieldOffsetX,
            maxPlayfieldOffsetX,
          ),
        );
        return;
      }

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
      if (playfieldInteractionRef.current?.pointerId === event.pointerId) {
        playfieldInteractionRef.current = null;
        setIsPlayfieldDragging(false);
      }

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
  }, [maxPlayfieldOffsetX]);

  useEffect(() => {
    let isDisposed = false;

    if (!selectedNoteskinOption) {
      setResolvedNoteskin(null);
      return undefined;
    }

    void loadResolvedDanceNoteskin(selectedNoteskinOption, bundledNoteskinOptions)
      .then((nextResolvedNoteskin) => {
        if (!isDisposed) {
          setResolvedNoteskin(nextResolvedNoteskin);
        }
      })
      .catch(() => {
        if (!isDisposed) {
          setResolvedNoteskin(null);
        }
      });

    return () => {
      isDisposed = true;
    };
  }, [selectedNoteskinOption]);

  const restoreNotefieldFocus = () => {
    window.requestAnimationFrame(() => {
      notefieldFrameRef.current?.focus({ preventScroll: true });
    });
  };

  const handleDropdownBlur = (event: FocusEvent<HTMLSelectElement>) => {
    if (event.relatedTarget instanceof HTMLElement) {
      return;
    }

    restoreNotefieldFocus();
  };

  const handleSongChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setSelectedSongId(event.target.value);
    event.currentTarget.blur();
    restoreNotefieldFocus();
  };

  const handleChartChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setSelectedChartIndex(Number.parseInt(event.target.value, 10) || 0);
    event.currentTarget.blur();
    restoreNotefieldFocus();
  };

  const handlePlaybackRateChange = (event: ChangeEvent<HTMLInputElement>) => {
    setPlaybackRate(clampPlaybackRate(Number.parseFloat(event.target.value)));
  };

  const handleBotFormStyleChange = (nextStyle: BotFormStyleId) => {
    setSelectedBotFormStyle(nextStyle);
    restoreNotefieldFocus();
  };

  const handleBotFootStyleCycle = () => {
    setSelectedBotFootStyle((currentStyle) => {
      if (currentStyle === 'default') {
        return 'silhouette-white';
      }

      if (currentStyle === 'silhouette-white') {
        return 'shoe';
      }

      return 'default';
    });
    restoreNotefieldFocus();
  };

  const handleBotPadStyleToggle = () => {
    setSelectedBotPadStyle((currentStyle) => (currentStyle === 'itg' ? 'ddr' : 'itg'));
    restoreNotefieldFocus();
  };

  const handleBotPanelGlowToggle = () => {
    setIsBotPanelGlowEnabled((currentValue) => !currentValue);
    restoreNotefieldFocus();
  };

  const handleBotPanelLightsToggle = () => {
    setIsBotPanelLightsEnabled((currentValue) => !currentValue);
    restoreNotefieldFocus();
  };

  const handleBotCrossoverToggle = () => {
    setIsBotCrossoverEnabled((currentValue) => !currentValue);
    restoreNotefieldFocus();
  };

  const handleBotBracketToggle = () => {
    setIsBotBracketEnabled((currentValue) => !currentValue);
    restoreNotefieldFocus();
  };

  const handleBotFootswitchToggle = () => {
    setIsBotFootswitchEnabled((currentValue) => !currentValue);
    restoreNotefieldFocus();
  };

  const handleParityHintOverlayToggle = () => {
    setIsParityHintOverlayEnabled((currentValue) => !currentValue);
  };

  const handleAppearanceSectionOpenChange = (isOpen: boolean) => {
    setIsAppearanceSectionOpen(isOpen);
  };

  const handleBehaviorSectionOpenChange = (isOpen: boolean) => {
    setIsBehaviorSectionOpen(isOpen);
  };

  const handleImportSongFolder = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';

    if (files.length === 0) {
      return;
    }

    try {
      const nextSongSource = await loadLocalSongSource(files);

      setSongLoadError(null);
      setLocalSongSource(nextSongSource);
      setSelectedSongId(nextSongSource.id);
    } catch (error) {
      setSongLoadError(error instanceof Error ? error.message : 'Unable to load the selected simfile folder.');
    }
  };

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

  const handlePlayfieldPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();

    playfieldInteractionRef.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      startOffsetX: playfieldOffsetX,
    };
    setIsPlayfieldDragging(true);
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

  const getHoldStyle = (segment: HoldSegment): CSSProperties => {
    const panelAssets = resolvedNoteskin?.panelAssets[segment.panel];
    const bodySprite =
      segment.kind === 'roll'
        ? panelAssets?.rollBodyInactive ?? panelAssets?.holdBodyInactive ?? null
        : panelAssets?.holdBodyInactive ?? panelAssets?.rollBodyInactive ?? null;
    const bodyTop = segment.startBeat * pixelsPerBeat;
    const capHeight = Math.max(Math.round(holdWidth / 2), 12);
    const bodyBottom = segment.endBeat * pixelsPerBeat - capHeight / 2;
    const bodyHeight = Math.max(bodyBottom - bodyTop, 8);

    return getSpriteBackgroundStyle(bodySprite, 0, {
      top: bodyTop,
      height: bodyHeight,
      left: '50%',
      backgroundRepeat: 'repeat-y',
      backgroundSize: '100% auto',
      backgroundPosition: '0% 100%',
      transform: 'translateX(-50%)',
    });
  };

  const getHoldCapStyle = (segment: HoldSegment): CSSProperties => {
    const panelAssets = resolvedNoteskin?.panelAssets[segment.panel];
    const capSprite =
      segment.kind === 'roll'
        ? panelAssets?.rollBottomCapInactive ?? panelAssets?.holdBottomCapInactive ?? null
        : panelAssets?.holdBottomCapInactive ?? panelAssets?.rollBottomCapInactive ?? null;
    const capHeight = Math.max(Math.round(holdWidth / 2), 12);

    return getSpriteBackgroundStyle(capSprite, 0, {
      top: segment.endBeat * pixelsPerBeat,
      left: '50%',
      width: holdWidth,
      height: capHeight,
      backgroundSize: '100% 100%',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
      transform: 'translate(-50%, -50%)',
    });
  };

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

  if (isMobileUnsupported) {
    return (
      <main className="mobile-warning-screen">
        <div className="mobile-warning-card">
          <p className="eyebrow">Desktop Only</p>
          <h1>Dancing Bot is not supported on mobile yet.</h1>
          <p className="mobile-warning-copy">
            Dancing Bot needs a larger screen and a mouse and keyboard for controls. Open it on a laptop or desktop browser to use
            the notefield and bot window properly.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="toolbar">
        <div className="toolbar-title">
          <p className="eyebrow">Dancing Bot</p>
          <h1>{displayTitle}</h1>
          <p className="toolbar-subtitle">{simfile.metadata.artist}</p>
          {songLoadError ? <p className="toolbar-message toolbar-message-error">{songLoadError}</p> : null}
        </div>

        <div className="toolbar-controls">
          <a
            className="toolbar-link"
            href="https://github.com/dominickp/dancing-bot"
            target="_blank"
            rel="noreferrer"
          >
            View source on GitHub
          </a>

          <div className="toolbar-control-row">
            <label className="toolbar-field">
              <span>Song</span>
              <select value={selectedSong?.id ?? ''} onChange={handleSongChange} onBlur={handleDropdownBlur}>
                {availableSongSources.map((songSource) => (
                  <option key={songSource.id} value={songSource.id}>
                    {songSource.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="toolbar-field">
              <span>Chart</span>
              <select value={selectedChartIndex} disabled={simfile.charts.length === 0} onChange={handleChartChange} onBlur={handleDropdownBlur}>
                {simfile.charts.map((chart, chartIndex) => (
                  <option key={`${chart.stepType}-${chart.difficulty}-${chartIndex}`} value={chartIndex}>
                    {chart.difficulty} {chart.meter} - {chart.description || chart.stepType}
                  </option>
                ))}
              </select>
            </label>

            <label className="toolbar-field toolbar-field-action">
              <span>Import Simfile</span>
              <button type="button" className="toolbar-button" onClick={() => songImportRef.current?.click()}>
                Load song folder
              </button>
              <input
                ref={(element) => {
                  songImportRef.current = element;

                  if (element) {
                    element.setAttribute('webkitdirectory', '');
                    element.setAttribute('directory', '');
                  }
                }}
                hidden
                type="file"
                multiple
                onChange={handleImportSongFolder}
              />
            </label>

          </div>
        </div>
      </header>

      <section className="thin-toolbar" aria-label="Playback controls">
        <div className="thin-toolbar-group" aria-label="Tempo metrics">
          <span className="toolbar-metric-chip">BPM {currentBpm.toFixed(bpmPrecision)}</span>
          <span className="toolbar-metric-chip toolbar-metric-chip-highlight">
            Effective {effectiveBpm.toFixed(bpmPrecision)}
          </span>
        </div>

        <label className="thin-toolbar-rate" htmlFor="playback-rate-slider">
          <span className="thin-toolbar-label">Rate</span>
          <div className="thin-toolbar-rate-control">
            <input
              id="playback-rate-slider"
              className="thin-toolbar-slider"
              type="range"
              min={minPlaybackRate}
              max={maxPlaybackRate}
              step={playbackRateStep}
              value={playbackRate}
              onChange={handlePlaybackRateChange}
            />
            <span className="thin-toolbar-rate-value">{playbackRate.toFixed(1)}x</span>
          </div>
        </label>

        <button
          type="button"
          className={`toolbar-button thin-toolbar-button${isParityHintOverlayEnabled ? ' is-enabled' : ''}`}
          aria-pressed={isParityHintOverlayEnabled}
          onClick={handleParityHintOverlayToggle}
        >
          {isParityHintOverlayEnabled
            ? `Pattern hints on (${parityHintDiagnostics.length})`
            : 'Pattern hints off'}
        </button>
      </section>

      <NotefieldPreview
        botWindow={
          <DancingBotWindow
            botTimeline={botTimeline}
            botWindowRect={botWindowRect}
            currentBeat={displayBeat}
            isPlaying={isPlaying}
            simfile={simfile}
            resolvedNoteskin={resolvedNoteskin}
            playbackClockRef={playbackClockRef}
            selectedFormStyle={selectedBotFormStyle}
            selectedFootStyle={selectedBotFootStyle}
            selectedPadStyle={selectedBotPadStyle}
            isPanelGlowEnabled={isBotPanelGlowEnabled}
            isPanelLightsEnabled={isBotPanelLightsEnabled}
            isCrossoverEnabled={isBotCrossoverEnabled}
            isBracketEnabled={isBotBracketEnabled}
            isFootswitchEnabled={isBotFootswitchEnabled}
            isAppearanceSectionOpen={isAppearanceSectionOpen}
            isBehaviorSectionOpen={isBehaviorSectionOpen}
            onFormStyleChange={handleBotFormStyleChange}
            onFootStyleCycle={handleBotFootStyleCycle}
            onPadStyleToggle={handleBotPadStyleToggle}
            onPanelGlowToggle={handleBotPanelGlowToggle}
            onPanelLightsToggle={handleBotPanelLightsToggle}
            onCrossoverToggle={handleBotCrossoverToggle}
            onBracketToggle={handleBotBracketToggle}
            onFootswitchToggle={handleBotFootswitchToggle}
            onAppearanceSectionOpenChange={handleAppearanceSectionOpenChange}
            onBehaviorSectionOpenChange={handleBehaviorSectionOpenChange}
            beginBotWindowInteraction={beginBotWindowInteraction}
          />
        }
        chartContentHeight={chartContentHeight}
        displayBeat={displayBeat}
        explosionRefs={explosionRefs}
        getNoteDetailStyle={getEventDetailStyle}
        getHoldStyle={getHoldStyle}
        getHoldCapStyle={getHoldCapStyle}
        getNoteFrameStyle={getEventFrameStyle}
        getNoteStyle={getEventStyle}
        getNoteUnderlayStyle={getEventUnderlayStyle}
        getReceptorStyle={getReceptorStyle}
        handleMinimapPointerDown={handleMinimapPointerDown}
        handleMinimapPointerMove={handleMinimapPointerMove}
        handlePlayfieldPointerDown={handlePlayfieldPointerDown}
        measureGuideLayerRef={measureGuideLayerRef}
        minimapMeasures={minimapMeasures}
        minimapRef={minimapRef}
        notefieldFrameRef={notefieldFrameRef}
        isLoading={isLoading}
        panelOrder={panelOrder}
        pixelsPerBeat={pixelsPerBeat}
        playfieldStyle={playfieldStyle}
        isPlayfieldDragging={isPlayfieldDragging}
        receptorOffset={receptorOffset}
        receptorRefs={receptorRefs}
        scrollLayerRef={scrollLayerRef}
        totalChartBeats={totalChartBeats}
        viewportHeight={viewportHeight}
        visibleBeatGuides={visibleBeatGuides}
        visibleParityHints={visibleParityHints}
        visibleEvents={visibleEvents}
        visibleHolds={visibleHolds}
      />
    </main>
  );
}

export default App;
