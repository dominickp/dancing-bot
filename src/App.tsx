import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { TimedNoteEvent } from './lib/simfile';
import { beatToSeconds, secondsToBeat } from './lib/simfile';
import { getSampleTimedChart, sampleAudioSource, sampleChart } from './data/sampleChart';
import {
  buildImportedNoteskinOption,
  getBundledNoteskinOptions,
  getPanelRotation,
  loadResolvedDanceNoteskin,
  releaseNoteskinOption,
} from './lib/noteskin';
import type { NoteskinOption, ResolvedDanceNoteskin, ResolvedSpriteAsset } from './lib/noteskin';

const panelOrder = ['left', 'down', 'up', 'right'] as const;
const receptorOffset = 72;
const viewportHeight = 760;
const minVisibleBeats = 0.25;
const maxVisibleBeats = 32;
const defaultVisibleBeats = 10;
const renderBufferBeats = 4;
const renderWindowStepBeats = 2;
const displayRefreshMs = 80;
const hitWindowBeats = 0.18;
const baseLaneWidth = 88;
const baseLaneGap = 14;
const baseSidePadding = 24;
const baseNoteWidth = 44;
const baseNoteHeight = 44;
const baseHoldWidth = 18;
const baseReceptorHeight = 56;
const baseExplosionSize = 110;
const minVisualScale = 0.68;
const maxVisualScale = 1.24;

type PanelName = (typeof panelOrder)[number];
type FootName = 'left' | 'right';
type BotFormStyleId = 'straight-wide' | 'straight-minimal' | 'heels-out' | 'toes-out';

interface BotPanelTarget {
  x: number;
  y: number;
}

type BotFootTargetMap = Record<FootName, Record<PanelName, BotPanelTarget>>;
type BotFootAngleMap = Record<FootName, Record<PanelName, number>>;

interface HoldSegment {
  panel: PanelName;
  startBeat: number;
  endBeat: number;
}

interface BotFootState {
  foot: FootName;
  panel: PanelName;
  lastStepBeat: number;
  holdUntilBeat: number | null;
  lastEventKind: TimedNoteEvent['kind'] | null;
}

interface BotStep {
  foot: FootName;
  fromPanel: PanelName;
  toPanel: PanelName;
  hitBeat: number;
  hitTimeSeconds: number;
  moveStartTimeSeconds: number;
  moveEndTimeSeconds: number;
  holdUntilTimeSeconds: number | null;
}

interface BotFootPose {
  foot: FootName;
  panel: PanelName;
  x: number;
  y: number;
  angle: number;
  scale: number;
  isHolding: boolean;
  isPressing: boolean;
  lastStepBeat: number;
}

interface BotViewState {
  feet: Record<FootName, BotFootPose>;
  activePanels: Record<PanelName, boolean>;
}

interface BotPlaybackSnapshot {
  beat: number;
  timeSeconds: number;
}

interface BotWindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface BotWindowInteraction {
  mode: 'drag' | 'resize';
  pointerId: number;
  originX: number;
  originY: number;
  startRect: BotWindowRect;
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
const bundledNoteskinOptions = getBundledNoteskinOptions();
const genericArrowClipPath = 'polygon(50% 100%, 100% 50%, 72% 50%, 72% 0%, 28% 0%, 28% 50%, 0% 50%)';
const footNames = ['left', 'right'] as const;
const botWideFootTargets: BotFootTargetMap = {
  left: {
    left: { x: 18, y: 50 },
    down: { x: 50, y: 82 },
    up: { x: 50, y: 18 },
    right: { x: 82, y: 50 },
  },
  right: {
    left: { x: 18, y: 50 },
    down: { x: 50, y: 82 },
    up: { x: 50, y: 18 },
    right: { x: 82, y: 50 },
  },
};
const botMinimalFootTargets: BotFootTargetMap = {
  left: {
    left: { x: 31, y: 50 },
    down: { x: 42, y: 64 },
    up: { x: 42, y: 38 },
    right: { x: 69, y: 50 },
  },
  right: {
    left: { x: 31, y: 50 },
    down: { x: 58, y: 64 },
    up: { x: 58, y: 38 },
    right: { x: 69, y: 50 },
  },
};
const botHeelsOutFootTargets: BotFootTargetMap = {
  left: {
    left: { x: 32, y: 46 },
    down: { x: 43, y: 66 },
    up: { x: 39, y: 38 },
    right: { x: 68, y: 50 },
  },
  right: {
    left: { x: 32, y: 50 },
    down: { x: 57, y: 66 },
    up: { x: 61, y: 38 },
    right: { x: 68, y: 46 },
  },
};
const botToesOutFootTargets: BotFootTargetMap = {
  left: {
    left: { x: 40, y: 44 },
    down: { x: 48, y: 64 },
    up: { x: 44, y: 39 },
    right: { x: 64, y: 47 },
  },
  right: {
    left: { x: 36, y: 47 },
    down: { x: 52, y: 64 },
    up: { x: 56, y: 39 },
    right: { x: 60, y: 44 },
  },
};
const botFootTargetsByForm: Record<BotFormStyleId, BotFootTargetMap> = {
  'straight-wide': botWideFootTargets,
  'straight-minimal': botMinimalFootTargets,
  'heels-out': botHeelsOutFootTargets,
  'toes-out': botToesOutFootTargets,
};
const botFootAnglesByForm: Record<BotFormStyleId, BotFootAngleMap> = {
  'straight-wide': {
    left: {
      left: -16,
      down: -16,
      up: -16,
      right: -16,
    },
    right: {
      left: 16,
      down: 16,
      up: 16,
      right: 16,
    },
  },
  'straight-minimal': {
    left: {
      left: -9,
      down: -9,
      up: -9,
      right: -9,
    },
    right: {
      left: 9,
      down: 9,
      up: 9,
      right: 9,
    },
  },
  'heels-out': {
    left: {
      left: 38,
      down: 14,
      up: 16,
      right: 24,
    },
    right: {
      left: -24,
      down: -14,
      up: -16,
      right: -38,
    },
  },
  'toes-out': {
    left: {
      left: -40,
      down: -6,
      up: -10,
      right: -26,
    },
    right: {
      left: 26,
      down: 6,
      up: 10,
      right: 40,
    },
  },
};
const botWindowMinWidth = 248;
const botWindowMinHeight = 232;
const botStreamWindowBeats = 0.75;
const botMoveLeadSeconds = 0.16;
const botSamePanelLeadSeconds = 0.1;
const botMinMoveLeadSeconds = 0.045;
const botAdaptiveLeadRatio = 0.72;
const botFastMoveDurationScale = 0.72;
const botPressWindowSeconds = 0.08;
const botHoldScale = 1.06;
const botPressScale = 1.12;
const botTravelLiftScale = 0.08;
const botPadArrowColors: Record<PanelName, string> = {
  left: '#51a8ff',
  right: '#51a8ff',
  up: '#ff5d73',
  down: '#ff5d73',
};
const botStaticPadTiles = [
  'corner-top-left',
  'corner-top-right',
  'corner-bottom-left',
  'corner-bottom-right',
  'center',
] as const;
const botFormStyleOptions = [
  { id: 'straight-wide', label: 'Straight Form (Wide)' },
  { id: 'straight-minimal', label: 'Straight Form (Minimal)' },
  { id: 'heels-out', label: 'Heels Out' },
  { id: 'toes-out', label: 'Toes Out' },
] as const;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const lerp = (start: number, end: number, amount: number): number => start + (end - start) * amount;
const getOtherFoot = (foot: FootName): FootName => (foot === 'left' ? 'right' : 'left');
const getHoldSegmentKey = (panel: PanelName, startBeat: number): string => `${panel}:${startBeat.toFixed(6)}`;
const getBotPadArrowColor = (panel: PanelName): string => botPadArrowColors[panel];
const getBotFootTargets = (formStyle: string): BotFootTargetMap =>
  botFootTargetsByForm[(formStyle as BotFormStyleId)] ?? botWideFootTargets;
const getBotFootAngles = (formStyle: BotFormStyleId): BotFootAngleMap =>
  botFootAnglesByForm[formStyle] ?? botFootAnglesByForm['straight-wide'];

const isFootLocked = (foot: BotFootState, beat: number, targetPanel: PanelName): boolean =>
  foot.holdUntilBeat !== null && foot.holdUntilBeat > beat && foot.panel !== targetPanel;

const canUseFoot = (
  footName: FootName,
  feet: Record<FootName, BotFootState>,
  beat: number,
  targetPanel: PanelName,
  reservedFeet: Set<FootName>,
): boolean => !reservedFeet.has(footName) && !isFootLocked(feet[footName], beat, targetPanel);

const chooseFootForEvent = (
  event: TimedNoteEvent,
  feet: Record<FootName, BotFootState>,
  previousStep: { foot: FootName; panel: PanelName; beat: number } | null,
  reservedFeet: Set<FootName>,
): FootName => {
  if (event.panel === 'left') {
    return canUseFoot('left', feet, event.beat, event.panel, reservedFeet) ? 'left' : 'right';
  }

  if (event.panel === 'right') {
    return canUseFoot('right', feet, event.beat, event.panel, reservedFeet) ? 'right' : 'left';
  }

  if (
    previousStep &&
    previousStep.panel === event.panel &&
    event.beat - previousStep.beat <= botStreamWindowBeats &&
    canUseFoot(previousStep.foot, feet, event.beat, event.panel, reservedFeet)
  ) {
    return previousStep.foot;
  }

  if (previousStep && event.beat - previousStep.beat <= botStreamWindowBeats) {
    const alternatingFoot = getOtherFoot(previousStep.foot);

    if (canUseFoot(alternatingFoot, feet, event.beat, event.panel, reservedFeet)) {
      return alternatingFoot;
    }
  }

  const footOnPanel = footNames.find(
    (footName) => feet[footName].panel === event.panel && canUseFoot(footName, feet, event.beat, event.panel, reservedFeet),
  );

  if (footOnPanel) {
    return footOnPanel;
  }

  const defaultFoot = event.panel === 'down' ? 'left' : 'right';

  if (canUseFoot(defaultFoot, feet, event.beat, event.panel, reservedFeet)) {
    return defaultFoot;
  }

  return getOtherFoot(defaultFoot);
};

const clampBotWindowRect = (rect: BotWindowRect, width: number, height: number): BotWindowRect => {
  const nextWidth = clamp(rect.width, botWindowMinWidth, Math.max(botWindowMinWidth, width));
  const nextHeight = clamp(rect.height, botWindowMinHeight, Math.max(botWindowMinHeight, height));
  const maxX = Math.max(0, width - nextWidth);
  const maxY = Math.max(0, height - nextHeight);

  return {
    width: nextWidth,
    height: nextHeight,
    x: clamp(rect.x, 0, maxX),
    y: clamp(rect.y, 0, maxY),
  };
};

const buildHoldEndBeatMap = (segments: HoldSegment[]): Map<string, number> => {
  const map = new Map<string, number>();

  for (const segment of segments) {
    map.set(getHoldSegmentKey(segment.panel, segment.startBeat), segment.endBeat);
  }

  return map;
};

const buildBotTimeline = (
  events: TimedNoteEvent[],
  holdEndBeatMap: Map<string, number>,
): Record<FootName, BotStep[]> => {
  const feet: Record<FootName, BotFootState & { availableTimeSeconds: number }> = {
    left: {
      foot: 'left',
      panel: 'left',
      lastStepBeat: Number.NEGATIVE_INFINITY,
      holdUntilBeat: null,
      lastEventKind: null,
      availableTimeSeconds: Number.NEGATIVE_INFINITY,
    },
    right: {
      foot: 'right',
      panel: 'right',
      lastStepBeat: Number.NEGATIVE_INFINITY,
      holdUntilBeat: null,
      lastEventKind: null,
      availableTimeSeconds: Number.NEGATIVE_INFINITY,
    },
  };
  const stepsByFoot: Record<FootName, BotStep[]> = {
    left: [],
    right: [],
  };
  let previousStep: { foot: FootName; panel: PanelName; beat: number } | null = null;

  for (let index = 0; index < events.length; ) {
    const beat = events[index]?.beat ?? 0;

    const stepEvents: TimedNoteEvent[] = [];

    while (index < events.length && events[index]?.beat === beat) {
      const nextEvent = events[index];

      if (nextEvent && nextEvent.kind !== 'hold-tail' && nextEvent.kind !== 'mine') {
        stepEvents.push(nextEvent);
      }

      index += 1;
    }

    if (stepEvents.length === 0) {
      continue;
    }

    stepEvents.sort((left, right) => panelOrder.indexOf(left.panel) - panelOrder.indexOf(right.panel));
    const reservedFeet = new Set<FootName>();

    for (const event of stepEvents) {
      const footName = chooseFootForEvent(event, feet, previousStep, reservedFeet);
      const foot = feet[footName];
      const hitTimeSeconds = beatToSeconds(beat, sampleChart.bpms, sampleChart.stops, sampleChart.metadata.offset);
      const holdUntilBeat =
        event.kind === 'hold-head' || event.kind === 'roll-head'
          ? holdEndBeatMap.get(getHoldSegmentKey(event.panel, event.beat)) ?? event.beat
          : null;
      const holdUntilTimeSeconds =
        holdUntilBeat === null
          ? null
          : beatToSeconds(holdUntilBeat, sampleChart.bpms, sampleChart.stops, sampleChart.metadata.offset);
      const preferredLeadSeconds = foot.panel === event.panel ? botSamePanelLeadSeconds : botMoveLeadSeconds;
      const secondsSinceLastStep = Number.isFinite(foot.availableTimeSeconds)
        ? Math.max(hitTimeSeconds - foot.availableTimeSeconds, 0)
        : Number.POSITIVE_INFINITY;
      const adaptiveLeadSeconds = Number.isFinite(secondsSinceLastStep)
        ? clamp(secondsSinceLastStep * botAdaptiveLeadRatio, botMinMoveLeadSeconds, preferredLeadSeconds)
        : preferredLeadSeconds;
      const moveStartTimeSeconds = Math.max(hitTimeSeconds - adaptiveLeadSeconds, foot.availableTimeSeconds);
      const availableMoveWindowSeconds = Math.max(hitTimeSeconds - moveStartTimeSeconds, 0.001);
      const compressedMoveRatio =
        foot.panel === event.panel || preferredLeadSeconds <= 0
          ? 0
          : clamp(1 - adaptiveLeadSeconds / preferredLeadSeconds, 0, 1);
      const moveDurationScale = lerp(1, botFastMoveDurationScale, compressedMoveRatio);
      const moveEndTimeSeconds = Math.min(
        hitTimeSeconds,
        moveStartTimeSeconds + availableMoveWindowSeconds * moveDurationScale,
      );

      stepsByFoot[footName].push({
        foot: footName,
        fromPanel: foot.panel,
        toPanel: event.panel,
        hitBeat: event.beat,
        hitTimeSeconds,
        moveStartTimeSeconds,
        moveEndTimeSeconds,
        holdUntilTimeSeconds,
      });

      feet[footName] = {
        ...foot,
        panel: event.panel,
        lastStepBeat: event.beat,
        holdUntilBeat: holdUntilBeat ?? (foot.holdUntilBeat !== null && foot.holdUntilBeat > event.beat ? foot.holdUntilBeat : null),
        lastEventKind: event.kind,
        availableTimeSeconds: hitTimeSeconds,
      };
      previousStep = {
        foot: footName,
        panel: event.panel,
        beat: event.beat,
      };
      reservedFeet.add(footName);
    }
  }

  return stepsByFoot;
};

const sampleBotState = (
  stepsByFoot: Record<FootName, BotStep[]>,
  footTargets: BotFootTargetMap,
  footAngles: BotFootAngleMap,
  currentTimeSeconds: number,
): BotViewState => {
  const sampleFootPose = (footName: FootName): BotFootPose => {
    const initialPanel: PanelName = footName === 'left' ? 'left' : 'right';
    const steps = stepsByFoot[footName];
    let completedStep: BotStep | null = null;
    let upcomingStep: BotStep | null = null;

    for (const step of steps) {
      if (step.hitTimeSeconds <= currentTimeSeconds) {
        completedStep = step;
        continue;
      }

      upcomingStep = step;
      break;
    }

    const restingPanel = completedStep?.toPanel ?? initialPanel;
    const restingPosition = footTargets[footName][restingPanel];
    let x = restingPosition.x;
    let y = restingPosition.y;
    let angle = footAngles[footName][restingPanel];
    let panel = restingPanel;
    let scale = 1;
    let isHolding =
      completedStep !== null &&
      completedStep.holdUntilTimeSeconds !== null &&
      completedStep.holdUntilTimeSeconds > currentTimeSeconds;
    const pressEndTimeSeconds = completedStep
      ? Math.min(completedStep.hitTimeSeconds + botPressWindowSeconds, upcomingStep?.moveStartTimeSeconds ?? Number.POSITIVE_INFINITY)
      : Number.NEGATIVE_INFINITY;
    let isPressing =
      completedStep !== null &&
      currentTimeSeconds >= completedStep.hitTimeSeconds &&
      currentTimeSeconds <= pressEndTimeSeconds;

    if (upcomingStep && currentTimeSeconds >= upcomingStep.moveStartTimeSeconds) {
      const fromPosition = footTargets[footName][upcomingStep.fromPanel];
      const toPosition = footTargets[footName][upcomingStep.toPanel];
      const fromAngle = footAngles[footName][upcomingStep.fromPanel];
      const toAngle = footAngles[footName][upcomingStep.toPanel];
      const moveDurationSeconds = Math.max(upcomingStep.moveEndTimeSeconds - upcomingStep.moveStartTimeSeconds, 0.001);
      const moveProgress = clamp(
        (currentTimeSeconds - upcomingStep.moveStartTimeSeconds) / moveDurationSeconds,
        0,
        1,
      );
      const liftStrength = clamp(moveDurationSeconds / botMoveLeadSeconds, 0.45, 1);

      x = lerp(fromPosition.x, toPosition.x, moveProgress);
      y = lerp(fromPosition.y, toPosition.y, moveProgress);
      angle = lerp(fromAngle, toAngle, moveProgress);
      panel = upcomingStep.toPanel;
      scale = Math.max(scale, 1 + Math.sin(moveProgress * Math.PI) * botTravelLiftScale * liftStrength);
    }

    if (isHolding) {
      scale = Math.max(scale, botHoldScale);
    } else if (isPressing) {
      scale = Math.max(scale, botPressScale);
    }

    return {
      foot: footName,
      panel,
      x,
      y,
      angle,
      scale,
      isHolding,
      isPressing,
      lastStepBeat: completedStep?.hitBeat ?? Number.NEGATIVE_INFINITY,
    };
  };

  const feet: Record<FootName, BotFootPose> = {
    left: sampleFootPose('left'),
    right: sampleFootPose('right'),
  };
  const activePanels: Record<PanelName, boolean> = {
    left: false,
    down: false,
    up: false,
    right: false,
  };

  for (const footName of footNames) {
    const foot = feet[footName];

    if (foot.isHolding || foot.isPressing) {
      activePanels[foot.panel] = true;
    }
  }

  return { feet, activePanels };
};

const getBotFootTransform = (foot: BotFootPose): string =>
  `translate(-50%, -50%) rotate(${foot.angle}deg) scale(${foot.scale})`;

const getQuantizationColor = (beat: number): string => {
  const rounded = Math.round(beat * 48) / 48;
  const fraction = ((rounded % 1) + 1) % 1;

  if (fraction === 0) {
    return '#ff5d73';
  }

  if (fraction % 0.5 === 0) {
    return '#47d7ac';
  }

  if (fraction % 0.25 === 0) {
    return '#51a8ff';
  }

  if (fraction % (1 / 3) === 0) {
    return '#ffd84f';
  }

  return '#d08cff';
};

const getSpriteBackgroundStyle = (
  sprite: ResolvedSpriteAsset | null,
  rotation: number,
  baseStyle: CSSProperties = {},
): CSSProperties => {
  const style: CSSProperties = {
    ...baseStyle,
    transform: baseStyle.transform ?? `rotate(${rotation}deg)`,
  };

  if (!sprite) {
    return style;
  }

  const x = sprite.columns > 1 ? `${(sprite.frameX / Math.max(sprite.columns - 1, 1)) * 100}%` : '0%';
  const y = sprite.rows > 1 ? `${(sprite.frameY / Math.max(sprite.rows - 1, 1)) * 100}%` : '0%';

  if (sprite.renderMode === 'mask') {
    if (sprite.maskStrategy === 'clip') {
      return {
        ...style,
        clipPath: genericArrowClipPath,
        overflow: 'hidden',
      } as CSSProperties;
    }

    return {
      ...style,
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
    ...style,
    backgroundImage: `url("${sprite.url}")`,
    backgroundSize: `${sprite.columns * 100}% ${sprite.rows * 100}%`,
    backgroundPosition: `${x} ${y}`,
  };
};

const getSpriteDetailStyle = (sprite: ResolvedSpriteAsset | null): CSSProperties => {
  if (!sprite?.detailUrl) {
    return {};
  }

  const x = sprite.detailColumns && sprite.detailColumns > 1
    ? `${((sprite.detailFrameX ?? 0) / Math.max(sprite.detailColumns - 1, 1)) * 100}%`
    : '0%';
  const y = sprite.detailRows && sprite.detailRows > 1
    ? `${((sprite.detailFrameY ?? 0) / Math.max(sprite.detailRows - 1, 1)) * 100}%`
    : '0%';

  return {
    backgroundImage: `url("${sprite.detailUrl}")`,
    backgroundSize: `${(sprite.detailColumns ?? 1) * 100}% ${(sprite.detailRows ?? 1) * 100}%`,
    backgroundPosition: `${x} ${y}`,
  };
};

const getTintedSpriteMaskStyle = (sprite: ResolvedSpriteAsset | null, color: string, rotation: number): CSSProperties => {
  if (!sprite) {
    return {};
  }

  const x = sprite.columns > 1 ? `${(sprite.frameX / Math.max(sprite.columns - 1, 1)) * 100}%` : '0%';
  const y = sprite.rows > 1 ? `${(sprite.frameY / Math.max(sprite.rows - 1, 1)) * 100}%` : '0%';

  return {
    backgroundColor: color,
    transform: `rotate(${rotation}deg)`,
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
};

interface DancingBotWindowProps {
  botTimeline: Record<FootName, BotStep[]>;
  botWindowRect: BotWindowRect;
  currentBeat: number;
  isPlaying: boolean;
  resolvedNoteskin: ResolvedDanceNoteskin | null;
  playbackClockRef: { current: PlaybackClock | null };
  selectedFormStyle: BotFormStyleId;
  onFormStyleChange: (nextStyle: BotFormStyleId) => void;
  beginBotWindowInteraction: (
    event: React.PointerEvent<HTMLElement>,
    mode: BotWindowInteraction['mode'],
  ) => void;
}

function DancingBotWindow({
  botTimeline,
  botWindowRect,
  currentBeat,
  isPlaying,
  resolvedNoteskin,
  playbackClockRef,
  selectedFormStyle,
  onFormStyleChange,
  beginBotWindowInteraction,
}: DancingBotWindowProps) {
  const [playbackSnapshot, setPlaybackSnapshot] = useState<BotPlaybackSnapshot>(() => ({
    beat: currentBeat,
    timeSeconds: beatToSeconds(currentBeat, sampleChart.bpms, sampleChart.stops, sampleChart.metadata.offset),
  }));

  useEffect(() => {
    if (isPlaying) {
      return undefined;
    }

    setPlaybackSnapshot({
      beat: currentBeat,
      timeSeconds: beatToSeconds(currentBeat, sampleChart.bpms, sampleChart.stops, sampleChart.metadata.offset),
    });

    return undefined;
  }, [currentBeat, isPlaying]);

  useEffect(() => {
    if (!isPlaying) {
      return undefined;
    }

    let animationFrameId: number | null = null;

    const tick = (timestamp: number) => {
      const clock = playbackClockRef.current;
      const timeSeconds = clock ? clock.audioTime + (timestamp - clock.perfTime) / 1000 : 0;
      const beat = secondsToBeat(timeSeconds, sampleChart.bpms, sampleChart.stops, sampleChart.metadata.offset);

      setPlaybackSnapshot({ beat, timeSeconds });
      animationFrameId = requestAnimationFrame(tick);
    };

    animationFrameId = requestAnimationFrame(tick);

    return () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [isPlaying, playbackClockRef]);

  const botFootTargets = useMemo(() => getBotFootTargets(selectedFormStyle), [selectedFormStyle]);
  const botFootAngles = useMemo(() => getBotFootAngles(selectedFormStyle), [selectedFormStyle]);

  const botState = useMemo(
    () => sampleBotState(botTimeline, botFootTargets, botFootAngles, playbackSnapshot.timeSeconds),
    [botFootAngles, botFootTargets, botTimeline, playbackSnapshot.timeSeconds],
  );

  return (
    <aside
      className="bot-window"
      style={{
        left: botWindowRect.x,
        top: botWindowRect.y,
        width: botWindowRect.width,
        height: botWindowRect.height,
      }}
      aria-label="Dancing bot preview"
    >
      <header className="bot-window-header" onPointerDown={(event) => beginBotWindowInteraction(event, 'drag')}>
        <div>
          <p className="bot-window-eyebrow">Virtual Window</p>
          <h3>Dancing Bot</h3>
        </div>
        <span className="bot-window-beat">Beat {playbackSnapshot.beat.toFixed(2)}</span>
      </header>

      <div className="bot-window-body">
        <label className="bot-form-picker">
          <span>Form Style</span>
          <select value={selectedFormStyle} onChange={(event) => onFormStyleChange(event.target.value as BotFormStyleId)}>
            {botFormStyleOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className="bot-pad-stage">
          <div className="bot-pad-surface">
            {botStaticPadTiles.map((tile) => (
              <div
                key={tile}
                className={`bot-pad-static-tile bot-pad-static-tile-${tile}`}
                aria-hidden="true"
              />
            ))}

            {panelOrder.map((panel) => (
              <div
                key={panel}
                className={`bot-pad-panel bot-pad-panel-${panel}${botState.activePanels[panel] ? ' is-active' : ''}`}
              >
                {resolvedNoteskin?.panelAssets[panel].receptor ? (
                  <div className="bot-pad-panel-icon" aria-hidden="true">
                    <div
                      className="bot-pad-panel-icon-layer bot-pad-panel-icon-tint"
                      style={getTintedSpriteMaskStyle(
                        resolvedNoteskin.panelAssets[panel].receptor,
                        getBotPadArrowColor(panel),
                        getPanelRotation(resolvedNoteskin, panel),
                      )}
                    />
                    <div
                      className="bot-pad-panel-icon-layer bot-pad-panel-icon-original"
                      style={getSpriteBackgroundStyle(
                        resolvedNoteskin.panelAssets[panel].receptor,
                        getPanelRotation(resolvedNoteskin, panel),
                      )}
                    />
                  </div>
                ) : (
                  <span className="bot-pad-panel-fallback">{panel.slice(0, 1).toUpperCase()}</span>
                )}
              </div>
            ))}

            {footNames.map((footName) => {
              const foot = botState.feet[footName];

              return (
                <div
                  key={footName}
                  className={`bot-foot bot-foot-${footName}${foot.isHolding ? ' is-holding' : ''}${foot.isPressing ? ' is-pressing' : ''}`}
                  style={{
                    left: `${foot.x}%`,
                    top: `${foot.y}%`,
                    transform: getBotFootTransform(foot),
                  }}
                  title={`${footName} foot on ${foot.panel}`}
                >
                  <span>{footName === 'left' ? 'L' : 'R'}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bot-foot-readout" aria-label="Current foot placement">
          {footNames.map((footName) => {
            const foot = botState.feet[footName];

            return (
              <span key={footName}>
                {footName === 'left' ? 'Left' : 'Right'} foot: {foot.panel}
                {foot.isHolding ? ' hold' : ''}
              </span>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        className="bot-window-resize"
        aria-label="Resize dancing bot window"
        onPointerDown={(event) => beginBotWindowInteraction(event, 'resize')}
      />
    </aside>
  );
}

function App() {
  const [selectedChartIndex, setSelectedChartIndex] = useState(0);
  const [selectedNoteskinId, setSelectedNoteskinId] = useState(bundledNoteskinOptions[0]?.id ?? 'metal');
  const [selectedBotFormStyle, setSelectedBotFormStyle] = useState<BotFormStyleId>(botFormStyleOptions[0].id);
  const [localNoteskinOption, setLocalNoteskinOption] = useState<NoteskinOption | null>(null);
  const [resolvedNoteskin, setResolvedNoteskin] = useState<ResolvedDanceNoteskin | null>(null);
  const [noteskinLoading, setNoteskinLoading] = useState(false);
  const [displayBeat, setDisplayBeat] = useState(0);
  const [renderBeatAnchor, setRenderBeatAnchor] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [visibleBeats, setVisibleBeats] = useState(defaultVisibleBeats);
  const [audioReady, setAudioReady] = useState(false);
  const [botWindowRect, setBotWindowRect] = useState<BotWindowRect>({
    x: 26,
    y: 24,
    width: 460,
    height: 700,
  });
  const animationFrameRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const noteskinImportRef = useRef<HTMLInputElement | null>(null);
  const notefieldFrameRef = useRef<HTMLDivElement | null>(null);
  const scrollLayerRef = useRef<HTMLDivElement | null>(null);
  const minimapRef = useRef<HTMLDivElement | null>(null);
  const botWindowInteractionRef = useRef<BotWindowInteraction | null>(null);
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
  const explosionSize = Math.max(Math.round(baseExplosionSize * visualScale), 72);
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

      <section className="notefield-panel" aria-label="Interactive notefield preview">
        <div className="notefield-header">
          <div className="notefield-status" aria-label="Playback status">
            <span>{isPlaying ? 'Playing' : 'Paused'}</span>
            <span>{selectedTimedChart.events.length} events</span>
            <span>{selectedChart?.difficulty} {selectedChart?.meter ?? 0}</span>
            <span>{sampleChart.metadata.offset.toFixed(3)}s offset</span>
          </div>

          <p className="notefield-caption">Space toggles playback. Scroll scrubs anywhere on the page. Ctrl + scroll changes note spacing everywhere except form controls.</p>
        </div>

        <div className="notefield-layout">
          <div className="notefield-frame" ref={notefieldFrameRef}>
            <div className="notefield-playfield" style={playfieldStyle}>
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
                      className="receptor-sprite"
                      style={getSpriteBackgroundStyle(
                        resolvedNoteskin?.panelAssets[panel].receptor ?? null,
                        getPanelRotation(resolvedNoteskin, panel),
                      )}
                    />
                    <div
                      className={`receptor-explosion receptor-explosion-${panel}`}
                      ref={(element) => {
                        explosionRefs.current[panel] = element;
                      }}
                    />
                  </div>
                ))}
              </div>

              <div className="lane-grid" style={{ height: receptorOffset + viewportHeight }}>
                <div className="chart-scroll-layer" ref={scrollLayerRef} style={{ height: chartContentHeight }}>
                  {visibleBeatGuides.map(({ beat, isMeasure }) => (
                    <div
                      key={beat}
                      className={`measure-guide${isMeasure ? ' measure-guide-major' : ' measure-guide-minor'}`}
                      style={{ top: beat * pixelsPerBeat }}
                    >
                      {isMeasure ? <span>Measure {beat / 4 + 1}</span> : null}
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
                            style={
                              getSpriteBackgroundStyle(
                                resolvedNoteskin?.panelAssets[segment.panel].holdBodyActive ?? null,
                                getPanelRotation(resolvedNoteskin, segment.panel),
                                {
                                top: segment.startBeat * pixelsPerBeat,
                                height: Math.max((segment.endBeat - segment.startBeat) * pixelsPerBeat, 10),
                                left: '50%',
                                transform: `translateX(-50%) rotate(${getPanelRotation(resolvedNoteskin, segment.panel)}deg)`,
                              },
                              )
                            }
                          />
                        ))}
                      {visibleEvents
                        .filter((event) => event.panel === panel)
                        .map((event) => {
                          const noteSprite = getNoteSprite(resolvedNoteskin?.panelAssets[event.panel], event);

                          return (
                            <div
                              key={`${event.panel}-${event.measureIndex}-${event.rowIndex}-${event.kind}`}
                              className={`lane-note ${event.kind}`}
                              style={
                                {
                                  ...getSpriteBackgroundStyle(
                                    noteSprite,
                                    getPanelRotation(resolvedNoteskin, event.panel),
                                    {
                                      top: event.beat * pixelsPerBeat,
                                      left: '50%',
                                      transform: `translate(-50%, -50%) rotate(${getPanelRotation(resolvedNoteskin, event.panel)}deg)`,
                                    },
                                  ),
                                  backgroundColor: getNoteColor(noteSprite, event.beat),
                                } as CSSProperties
                              }
                              title={`${event.panel} ${event.kind} @ beat ${event.beat.toFixed(3)}`}
                            />
                          );
                        })}
                    </div>
                  ))}
                </div>
              </div>
            </div>

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
