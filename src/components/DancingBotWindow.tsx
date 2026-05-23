import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { getPanelRotation } from '../lib/noteskin';
import type { ResolvedDanceNoteskin, ResolvedSpriteAsset } from '../lib/noteskin';
import { beatToSeconds, secondsToBeat } from '../lib/simfile';
import type { Panel, SimfileDocument, TimedNoteEvent } from '../lib/simfile';
import type { PlaybackClock } from '../hooks/useChartPlayback';

type FootName = 'left' | 'right';
export type BotFormStyleId = 'straight-wide' | 'straight-minimal' | 'heels-out' | 'toes-out';
export const defaultBotFormStyle: BotFormStyleId = 'straight-wide';

interface BotPanelTarget {
  x: number;
  y: number;
}

type BotFootTargetMap = Record<FootName, Record<Panel, BotPanelTarget>>;
type BotFootAngleMap = Record<FootName, Record<Panel, number>>;

interface BotFootState {
  foot: FootName;
  panel: Panel;
  lastStepBeat: number;
  holdUntilBeat: number | null;
  lastEventKind: TimedNoteEvent['kind'] | null;
}

export interface BotStep {
  foot: FootName;
  fromPanel: Panel;
  toPanel: Panel;
  hitBeat: number;
  hitTimeSeconds: number;
  moveStartTimeSeconds: number;
  moveEndTimeSeconds: number;
  holdUntilTimeSeconds: number | null;
}

interface BotPanelPulse {
  startTimeSeconds: number;
  endTimeSeconds: number;
}

type BotPanelTimeline = Record<Panel, BotPanelPulse[]>;

interface BotFootPose {
  foot: FootName;
  panel: Panel;
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
  activePanels: Record<Panel, boolean>;
}

interface BotPlaybackSnapshot {
  beat: number;
  timeSeconds: number;
}

export interface BotWindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BotWindowInteraction {
  mode: 'drag' | 'resize';
  pointerId: number;
  originX: number;
  originY: number;
  startRect: BotWindowRect;
}

const panelOrder: readonly Panel[] = ['left', 'down', 'up', 'right'] as const;
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
    left: { left: -16, down: -16, up: -16, right: -16 },
    right: { left: 16, down: 16, up: 16, right: 16 },
  },
  'straight-minimal': {
    left: { left: -9, down: -9, up: -9, right: -9 },
    right: { left: 9, down: 9, up: 9, right: 9 },
  },
  'heels-out': {
    left: { left: 38, down: 14, up: 16, right: 24 },
    right: { left: -24, down: -14, up: -16, right: -38 },
  },
  'toes-out': {
    left: { left: -40, down: -6, up: -10, right: -26 },
    right: { left: 26, down: 6, up: 10, right: 40 },
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
const botRepeatedPanelPulseRatio = 0.65;
const botRollRetriggerBeats = 0.5;
const botHoldScale = 1.06;
const botPressScale = 1.12;
const botTravelLiftScale = 0.08;
const botPadArrowColors: Record<Panel, string> = {
  left: '#51a8ff',
  right: '#51a8ff',
  up: '#ff5d73',
  down: '#ff5d73',
};
const botPanelPositions: Record<Panel, { x: number; y: number }> = {
  left: { x: -1, y: 0 },
  down: { x: 0, y: 1 },
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
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
const baseAssetUrl = import.meta.env.BASE_URL;
const botFormIconOptions: Array<{
  id: BotFormStyleId;
  tooltip: string;
  image: string;
  accent: string;
}> = [
  {
    id: 'straight-wide',
    tooltip: 'Straight (Wide)',
    image: `${baseAssetUrl}img/form_straight-wide.png`,
    accent: '#7fc7ff',
  },
  {
    id: 'straight-minimal',
    tooltip: 'Straight (Minimal)',
    image: `${baseAssetUrl}img/form_straight.png`,
    accent: '#f4ca6c',
  },
  {
    id: 'heels-out',
    tooltip: 'Heels Out',
    image: `${baseAssetUrl}img/form_heelsout.png`,
    accent: '#fd8aa0',
  },
  {
    id: 'toes-out',
    tooltip: 'Toes Out (Based)',
    image: `${baseAssetUrl}img/form_toe-out.png`,
    accent: '#80e3bb',
  },
];
const botFutureControlSlots = [
  {
    key: 'future-form',
    label: 'Form',
    description: 'Reserved for the next form style.',
  },
  {
    key: 'panel-glow',
    label: 'Panel Glow',
    description: 'Reserved for the panel glow toggle.',
  },
  {
    key: 'panel-lights',
    label: 'Panel Lights',
    description: 'Reserved for the panel lights toggle.',
  },
  {
    key: 'shoe-image',
    label: 'Shoes',
    description: 'Reserved for shoe image selection.',
  },
] as const;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const lerp = (start: number, end: number, amount: number): number => start + (end - start) * amount;
const getOtherFoot = (foot: FootName): FootName => (foot === 'left' ? 'right' : 'left');
const getBotPadArrowColor = (panel: Panel): string => botPadArrowColors[panel];
const getBotFootTargets = (formStyle: BotFormStyleId): BotFootTargetMap =>
  botFootTargetsByForm[formStyle] ?? botFootTargetsByForm['straight-wide'];
const getBotFootAngles = (formStyle: BotFormStyleId): BotFootAngleMap =>
  botFootAnglesByForm[formStyle] ?? botFootAnglesByForm['straight-wide'];

const buildBotPanelTimeline = (stepsByFoot: Record<FootName, BotStep[]>): BotPanelTimeline => {
  const stepsByPanel: Record<Panel, BotStep[]> = {
    left: [],
    down: [],
    up: [],
    right: [],
  };

  for (const footName of footNames) {
    for (const step of stepsByFoot[footName]) {
      stepsByPanel[step.toPanel].push(step);
    }
  }

  for (const panel of panelOrder) {
    stepsByPanel[panel].sort((left, right) => left.hitTimeSeconds - right.hitTimeSeconds);
  }

  return {
    left: stepsByPanel.left.map((step, index, steps) => {
      const nextStep = steps[index + 1] ?? null;
      const nextHitDelta = nextStep ? nextStep.hitTimeSeconds - step.hitTimeSeconds : Number.POSITIVE_INFINITY;
      const pulseEndTimeSeconds =
        step.holdUntilTimeSeconds ??
        Math.min(
          step.hitTimeSeconds + botPressWindowSeconds,
          step.hitTimeSeconds + nextHitDelta * botRepeatedPanelPulseRatio,
        );

      return {
        startTimeSeconds: step.hitTimeSeconds,
        endTimeSeconds: Math.max(step.hitTimeSeconds, pulseEndTimeSeconds),
      };
    }),
    down: stepsByPanel.down.map((step, index, steps) => {
      const nextStep = steps[index + 1] ?? null;
      const nextHitDelta = nextStep ? nextStep.hitTimeSeconds - step.hitTimeSeconds : Number.POSITIVE_INFINITY;
      const pulseEndTimeSeconds =
        step.holdUntilTimeSeconds ??
        Math.min(
          step.hitTimeSeconds + botPressWindowSeconds,
          step.hitTimeSeconds + nextHitDelta * botRepeatedPanelPulseRatio,
        );

      return {
        startTimeSeconds: step.hitTimeSeconds,
        endTimeSeconds: Math.max(step.hitTimeSeconds, pulseEndTimeSeconds),
      };
    }),
    up: stepsByPanel.up.map((step, index, steps) => {
      const nextStep = steps[index + 1] ?? null;
      const nextHitDelta = nextStep ? nextStep.hitTimeSeconds - step.hitTimeSeconds : Number.POSITIVE_INFINITY;
      const pulseEndTimeSeconds =
        step.holdUntilTimeSeconds ??
        Math.min(
          step.hitTimeSeconds + botPressWindowSeconds,
          step.hitTimeSeconds + nextHitDelta * botRepeatedPanelPulseRatio,
        );

      return {
        startTimeSeconds: step.hitTimeSeconds,
        endTimeSeconds: Math.max(step.hitTimeSeconds, pulseEndTimeSeconds),
      };
    }),
    right: stepsByPanel.right.map((step, index, steps) => {
      const nextStep = steps[index + 1] ?? null;
      const nextHitDelta = nextStep ? nextStep.hitTimeSeconds - step.hitTimeSeconds : Number.POSITIVE_INFINITY;
      const pulseEndTimeSeconds =
        step.holdUntilTimeSeconds ??
        Math.min(
          step.hitTimeSeconds + botPressWindowSeconds,
          step.hitTimeSeconds + nextHitDelta * botRepeatedPanelPulseRatio,
        );

      return {
        startTimeSeconds: step.hitTimeSeconds,
        endTimeSeconds: Math.max(step.hitTimeSeconds, pulseEndTimeSeconds),
      };
    }),
  };
};

const isFootLocked = (foot: BotFootState, beat: number, targetPanel: Panel): boolean =>
  foot.holdUntilBeat !== null && foot.holdUntilBeat > beat && foot.panel !== targetPanel;

const canUseFoot = (
  footName: FootName,
  feet: Record<FootName, BotFootState>,
  beat: number,
  targetPanel: Panel,
  reservedFeet: Set<FootName>,
): boolean => !reservedFeet.has(footName) && !isFootLocked(feet[footName], beat, targetPanel);

const getPanelTravelCost = (fromPanel: Panel, toPanel: Panel): number => {
  const fromPosition = botPanelPositions[fromPanel];
  const toPosition = botPanelPositions[toPanel];

  return Math.abs(fromPosition.x - toPosition.x) + Math.abs(fromPosition.y - toPosition.y);
};

const scoreStepAssignments = (
  assignments: Array<{ event: TimedNoteEvent; foot: FootName }>,
  feet: Record<FootName, BotFootState>,
): number => {
  const leftAssignment = assignments.find((assignment) => assignment.foot === 'left') ?? null;
  const rightAssignment = assignments.find((assignment) => assignment.foot === 'right') ?? null;

  if (leftAssignment && rightAssignment) {
    const leftX = botPanelPositions[leftAssignment.event.panel].x;
    const rightX = botPanelPositions[rightAssignment.event.panel].x;

    if (leftX > rightX) {
      return Number.POSITIVE_INFINITY;
    }
  }

  return assignments.reduce((total, assignment) => {
    const currentFoot = feet[assignment.foot];
    let score = total + getPanelTravelCost(currentFoot.panel, assignment.event.panel);

    if (currentFoot.panel === assignment.event.panel) {
      score -= 0.35;
    }

    if (assignment.event.panel === 'left' && assignment.foot === 'left') {
      score -= 0.15;
    }

    if (assignment.event.panel === 'right' && assignment.foot === 'right') {
      score -= 0.15;
    }

    return score;
  }, 0);
};

const resolveFeetForStepEvents = (
  stepEvents: TimedNoteEvent[],
  feet: Record<FootName, BotFootState>,
  reservedFeet: Set<FootName>,
): Map<TimedNoteEvent, FootName> | null => {
  if (stepEvents.length <= 1 || stepEvents.length > footNames.length) {
    return null;
  }

  let bestAssignments: Array<{ event: TimedNoteEvent; foot: FootName }> | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const currentAssignments: Array<{ event: TimedNoteEvent; foot: FootName }> = [];

  const search = (index: number, usedFeet: Set<FootName>) => {
    if (index >= stepEvents.length) {
      const score = scoreStepAssignments(currentAssignments, feet);

      if (score < bestScore) {
        bestScore = score;
        bestAssignments = [...currentAssignments];
      }

      return;
    }

    const event = stepEvents[index];

    for (const footName of footNames) {
      if (usedFeet.has(footName) || !canUseFoot(footName, feet, event.beat, event.panel, reservedFeet)) {
        continue;
      }

      usedFeet.add(footName);
      currentAssignments.push({ event, foot: footName });
      search(index + 1, usedFeet);
      currentAssignments.pop();
      usedFeet.delete(footName);
    }
  };

  search(0, new Set<FootName>());

  if (!bestAssignments || !Number.isFinite(bestScore)) {
    return null;
  }

  const finalizedAssignments: Array<{ event: TimedNoteEvent; foot: FootName }> = bestAssignments;

  return new Map<TimedNoteEvent, FootName>(
    finalizedAssignments.map((assignment) => [assignment.event, assignment.foot]),
  );
};

const chooseFootForEvent = (
  event: TimedNoteEvent,
  feet: Record<FootName, BotFootState>,
  previousStep: { foot: FootName; panel: Panel; beat: number } | null,
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

const buildRollStepBeats = (startBeat: number, endBeat: number): number[] => {
  if (endBeat <= startBeat) {
    return [startBeat];
  }

  const stepBeats = [startBeat];

  for (
    let nextBeat = startBeat + botRollRetriggerBeats;
    nextBeat < endBeat - 0.000001;
    nextBeat += botRollRetriggerBeats
  ) {
    stepBeats.push(nextBeat);
  }

  stepBeats.push(endBeat);
  return stepBeats;
};

const sampleBotState = (
  stepsByFoot: Record<FootName, BotStep[]>,
  panelTimeline: BotPanelTimeline,
  footTargets: BotFootTargetMap,
  footAngles: BotFootAngleMap,
  currentTimeSeconds: number,
): BotViewState => {
  const sampleFootPose = (footName: FootName): BotFootPose => {
    const initialPanel: Panel = footName === 'left' ? 'left' : 'right';
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
    const isHolding =
      completedStep !== null &&
      completedStep.holdUntilTimeSeconds !== null &&
      completedStep.holdUntilTimeSeconds > currentTimeSeconds;
    const pressEndTimeSeconds = completedStep
      ? Math.min(completedStep.hitTimeSeconds + botPressWindowSeconds, upcomingStep?.moveStartTimeSeconds ?? Number.POSITIVE_INFINITY)
      : Number.NEGATIVE_INFINITY;
    const isPressing =
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
  const activePanels: Record<Panel, boolean> = {
    left: false,
    down: false,
    up: false,
    right: false,
  };

  for (const panel of panelOrder) {
    activePanels[panel] = panelTimeline[panel].some(
      (pulse) => currentTimeSeconds >= pulse.startTimeSeconds && currentTimeSeconds <= pulse.endTimeSeconds,
    );
  }

  return { feet, activePanels };
};

const getBotFootTransform = (foot: BotFootPose): string =>
  `translate(-50%, -50%) rotate(${foot.angle}deg) scale(${foot.scale})`;

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

export const clampBotWindowRect = (rect: BotWindowRect, width: number, height: number): BotWindowRect => {
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

export const buildBotTimeline = (
  events: TimedNoteEvent[],
  holdEndBeatMap: Map<string, number>,
  simfile: SimfileDocument,
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
  let previousStep: { foot: FootName; panel: Panel; beat: number } | null = null;

  for (let index = 0; index < events.length;) {
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
    const resolvedFeet = resolveFeetForStepEvents(stepEvents, feet, reservedFeet);

    for (const event of stepEvents) {
      const footName: FootName = resolvedFeet?.get(event) ?? chooseFootForEvent(event, feet, previousStep, reservedFeet);
      let foot = feet[footName];
      const sustainUntilBeat =
        event.kind === 'hold-head' || event.kind === 'roll-head'
          ? holdEndBeatMap.get(`${event.panel}:${event.beat.toFixed(6)}`) ?? event.beat
          : null;
      const stepBeats =
        event.kind === 'roll-head' && sustainUntilBeat !== null
          ? buildRollStepBeats(event.beat, sustainUntilBeat)
          : [event.beat];

      for (const stepBeat of stepBeats) {
        const hitTimeSeconds = beatToSeconds(stepBeat, simfile.bpms, simfile.stops, simfile.metadata.offset);
        const holdUntilTimeSeconds =
          event.kind === 'hold-head' && sustainUntilBeat !== null
            ? beatToSeconds(sustainUntilBeat, simfile.bpms, simfile.stops, simfile.metadata.offset)
            : null;
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
          hitBeat: stepBeat,
          hitTimeSeconds,
          moveStartTimeSeconds,
          moveEndTimeSeconds,
          holdUntilTimeSeconds,
        });

        foot = {
          ...foot,
          panel: event.panel,
          lastStepBeat: stepBeat,
          holdUntilBeat:
            sustainUntilBeat ?? (foot.holdUntilBeat !== null && foot.holdUntilBeat > stepBeat ? foot.holdUntilBeat : null),
          lastEventKind: event.kind,
          availableTimeSeconds: hitTimeSeconds,
        };
      }

      feet[footName] = foot;
      previousStep = {
        foot: footName,
        panel: event.panel,
        beat: stepBeats.at(-1) ?? event.beat,
      };
      reservedFeet.add(footName);
    }
  }

  return stepsByFoot;
};

interface DancingBotWindowProps {
  botTimeline: Record<FootName, BotStep[]>;
  botWindowRect: BotWindowRect;
  currentBeat: number;
  isPlaying: boolean;
  simfile: SimfileDocument;
  resolvedNoteskin: ResolvedDanceNoteskin | null;
  playbackClockRef: { current: PlaybackClock | null };
  selectedFormStyle: BotFormStyleId;
  onFormStyleChange: (nextStyle: BotFormStyleId) => void;
  beginBotWindowInteraction: (
    event: ReactPointerEvent<HTMLElement>,
    mode: BotWindowInteraction['mode'],
  ) => void;
}

export function DancingBotWindow({
  botTimeline,
  botWindowRect,
  currentBeat,
  isPlaying,
  simfile,
  resolvedNoteskin,
  playbackClockRef,
  selectedFormStyle,
  onFormStyleChange,
  beginBotWindowInteraction,
}: DancingBotWindowProps) {
  const [playbackSnapshot, setPlaybackSnapshot] = useState<BotPlaybackSnapshot>(() => ({
    beat: currentBeat,
    timeSeconds: beatToSeconds(currentBeat, simfile.bpms, simfile.stops, simfile.metadata.offset),
  }));

  useEffect(() => {
    if (isPlaying) {
      return undefined;
    }

    setPlaybackSnapshot({
      beat: currentBeat,
      timeSeconds: beatToSeconds(currentBeat, simfile.bpms, simfile.stops, simfile.metadata.offset),
    });

    return undefined;
  }, [currentBeat, isPlaying, simfile]);

  useEffect(() => {
    if (!isPlaying) {
      return undefined;
    }

    let animationFrameId: number | null = null;

    const tick = (timestamp: number) => {
      const clock = playbackClockRef.current;
      const timeSeconds = clock ? clock.audioTime + (timestamp - clock.perfTime) / 1000 : 0;
      const beat = secondsToBeat(timeSeconds, simfile.bpms, simfile.stops, simfile.metadata.offset);

      setPlaybackSnapshot({ beat, timeSeconds });
      animationFrameId = requestAnimationFrame(tick);
    };

    animationFrameId = requestAnimationFrame(tick);

    return () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [isPlaying, playbackClockRef, simfile]);

  const botFootTargets = useMemo(() => getBotFootTargets(selectedFormStyle), [selectedFormStyle]);
  const botFootAngles = useMemo(() => getBotFootAngles(selectedFormStyle), [selectedFormStyle]);
  const botPanelTimeline = useMemo(() => buildBotPanelTimeline(botTimeline), [botTimeline]);
  const botState = useMemo(
    () => sampleBotState(botTimeline, botPanelTimeline, botFootTargets, botFootAngles, playbackSnapshot.timeSeconds),
    [botFootAngles, botFootTargets, botPanelTimeline, botTimeline, playbackSnapshot.timeSeconds],
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
          <h3>Dancing Bot</h3>
        </div>
        <span className="bot-window-beat">Beat {playbackSnapshot.beat.toFixed(2)}</span>
      </header>

      <div className="bot-window-body">
        <section className="bot-settings-panel" aria-label="Dancing bot settings">
          <div className="bot-settings-group">
            <div className="bot-settings-group-header">
              <span>Form Style</span>
              <small>Choose one active stance.</small>
            </div>

            <div className="bot-icon-toggle-grid" role="radiogroup" aria-label="Bot form style">
              {botFormIconOptions.map((option) => {
                const isSelected = option.id === selectedFormStyle;

                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    aria-label={option.tooltip}
                    className={`bot-icon-toggle${isSelected ? ' is-selected' : ''}`}
                    data-tooltip={option.tooltip}
                    onClick={() => onFormStyleChange(option.id)}
                    style={{ ['--bot-toggle-accent' as string]: option.accent } as CSSProperties}
                  >
                    <span className="bot-icon-toggle-swatch" aria-hidden="true">
                      <img src={option.image} alt="" className="bot-icon-toggle-image" />
                    </span>
                  </button>
                );
              })}

              <div
                className="bot-icon-toggle bot-icon-toggle-placeholder"
                aria-hidden="true"
                data-tooltip="Reserved for an additional form style."
              >
                <span className="bot-icon-toggle-swatch">
                  <span className="bot-icon-toggle-plus">+</span>
                </span>
              </div>
            </div>
          </div>

          <div className="bot-settings-group">
            <div className="bot-settings-group-header">
              <span>More Controls</span>
              <small>Space reserved for upcoming toggles.</small>
            </div>

            <div className="bot-future-control-grid" aria-label="Upcoming controls">
              {botFutureControlSlots.map((slot) => (
                <div
                  key={slot.key}
                  className="bot-future-control-slot"
                  aria-hidden="true"
                  data-tooltip={slot.description}
                >
                  <span className="bot-future-control-label">{slot.label}</span>
                  <span className="bot-future-control-value">Coming soon</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="bot-pad-stage">
          <div className="bot-pad-surface">
            {botStaticPadTiles.map((tile) => (
              <div key={tile} className={`bot-pad-static-tile bot-pad-static-tile-${tile}`} aria-hidden="true" />
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