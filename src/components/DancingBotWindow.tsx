import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { getPanelRotation } from '../lib/noteskin';
import type { ResolvedDanceNoteskin, ResolvedSpriteAsset } from '../lib/noteskin';
import {
  buildParityAssignmentMap,
  getFootSideFromFootPart,
  getTimedEventKey,
} from '../lib/parity';
import type { ParityFootPart, StepParityConfig } from '../lib/parity';
import { beatToSeconds, secondsToBeat } from '../lib/simfile';
import type { Panel, SimfileDocument, TimedNoteEvent } from '../lib/simfile';
import type { PlaybackClock } from '../hooks/useChartPlayback';

type FootName = 'left' | 'right';
export type BotFootPart = ParityFootPart;
export type BotFormStyleId = 'straight-wide' | 'straight-minimal' | 'heels-out' | 'toes-out' | 'slanted-right';
export const defaultBotFormStyle: BotFormStyleId = 'straight-minimal';
export type BotFootStyleId = 'default' | 'silhouette-white' | 'shoe';
export const defaultBotFootStyle: BotFootStyleId = 'silhouette-white';
export type BotPadStyleId = 'itg' | 'ddr';
export const defaultBotPadStyle: BotPadStyleId = 'itg';

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
  footPart: BotFootPart | null;
  fromPanel: Panel;
  toPanel: Panel;
  isLifted: boolean;
  heelPanel: Panel | null;
  toePanel: Panel | null;
  activePanels: Panel[];
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
  isLifted: boolean;
  lastStepBeat: number;
}

export interface BotViewState {
  feet: Record<FootName, BotFootPose>;
  activePanels: Record<Panel, boolean>;
}

interface BotFootMotionSample {
  pose: BotFootPose;
  completedStep: BotStep | null;
  upcomingStep: BotStep | null;
  moveProgress: number;
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
const botSlantedRightFootTargets: BotFootTargetMap = {
  left: botHeelsOutFootTargets.left,
  right: botToesOutFootTargets.right,
};
const botFootTargetsByForm: Record<BotFormStyleId, BotFootTargetMap> = {
  'straight-wide': botWideFootTargets,
  'straight-minimal': botMinimalFootTargets,
  'heels-out': botHeelsOutFootTargets,
  'toes-out': botToesOutFootTargets,
  'slanted-right': botSlantedRightFootTargets,
};
const botHeelsOutFootAngles: BotFootAngleMap = {
  left: { left: 38, down: 14, up: 16, right: 24 },
  right: { left: -24, down: -14, up: -16, right: -38 },
};
const botToesOutFootAngles: BotFootAngleMap = {
  left: { left: -40, down: -6, up: -10, right: -26 },
  right: { left: 26, down: 6, up: 10, right: 40 },
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
  'heels-out': botHeelsOutFootAngles,
  'toes-out': botToesOutFootAngles,
  'slanted-right': {
    left: botHeelsOutFootAngles.left,
    right: botToesOutFootAngles.right,
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
const botFootswitchLiftHeight = 9;
const botPadArrowColorsByStyle: Record<BotPadStyleId, Record<Panel, string>> = {
  itg: {
    left: '#51a8ff',
    right: '#51a8ff',
    up: '#ff5d73',
    down: '#ff5d73',
  },
  ddr: {
    left: '#79cfff',
    right: '#79cfff',
    up: '#ff84bc',
    down: '#ff84bc',
  },
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
  { id: 'slanted-right', label: 'Slanted Form (Right)' },
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
  {
    id: 'slanted-right',
    tooltip: 'Slanted Right',
    image: `${baseAssetUrl}img/form_slanted-right.png`,
    accent: '#d2a9ff',
  },
];
const botFootStyleOptions: Array<{
  id: BotFootStyleId;
  label: string;
  tooltip: string;
  image: string | null;
}> = [
  {
    id: 'default',
    label: 'Classic',
    tooltip: 'Foot Style: Classic. Click to cycle to the next foot style.',
    image: null,
  },
  {
    id: 'silhouette-white',
    label: 'Silhouette',
    tooltip: 'Foot Style: Silhouette White. Click to cycle to the next foot style.',
    image: `${baseAssetUrl}img/foot_sillouette-white.png`,
  },
  {
    id: 'shoe',
    label: 'Shoe',
    tooltip: 'Foot Style: Shoe. Click to cycle to the next foot style.',
    image: `${baseAssetUrl}img/foot_shoe.png`,
  },
];

const botPanelToggleOptions = [
  {
    key: 'pad-style',
    label: 'Pad Style',
  },
  {
    key: 'panel-glow',
    label: 'Glow',
    tooltip: 'Panel Glow: toggles the outer glow around active panels.',
  },
  {
    key: 'panel-lights',
    label: 'Lights',
    tooltip: 'Panel Lights: toggles the red and blue pressed panel lighting.',
  },
] as const;

const botParityToggleOptions = [
  {
    key: 'crossovers',
    label: 'Crossover',
  },
  {
    key: 'brackets',
    label: 'Bracket',
  },
  {
    key: 'footswitches',
    label: 'Footswitch',
  },
] as const;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const lerp = (start: number, end: number, amount: number): number => start + (end - start) * amount;
const getOtherFoot = (foot: FootName): FootName => (foot === 'left' ? 'right' : 'left');
const botFootMinSeparation = 18;
const getBotPadArrowColor = (panel: Panel, padStyle: BotPadStyleId): string =>
  botPadArrowColorsByStyle[padStyle][panel];
const getBotFootTargets = (formStyle: BotFormStyleId): BotFootTargetMap =>
  botFootTargetsByForm[formStyle] ?? botFootTargetsByForm['straight-wide'];
const getBotFootAngles = (formStyle: BotFormStyleId): BotFootAngleMap =>
  botFootAnglesByForm[formStyle] ?? botFootAnglesByForm['straight-wide'];
const getBotPanelEffectStyle = (panel: Panel, padStyle: BotPadStyleId): CSSProperties => ({
  ['--bot-panel-accent' as string]: getBotPadArrowColor(panel, padStyle),
});

const getUniquePanels = (...panels: Array<Panel | null>): Panel[] => {
  const values = panels.filter((panel): panel is Panel => panel !== null);
  return [...new Set(values)];
};

const isBracketStep = (step: Pick<BotStep, 'heelPanel' | 'toePanel'>): boolean =>
  step.heelPanel !== null && step.toePanel !== null && step.heelPanel !== step.toePanel;

const getHomePanel = (foot: FootName): Panel => (foot === 'left' ? 'left' : 'right');

const buildBotPanelTimeline = (stepsByFoot: Record<FootName, BotStep[]>): BotPanelTimeline => {
  const stepsByPanel: Record<Panel, BotStep[]> = {
    left: [],
    down: [],
    up: [],
    right: [],
  };

  for (const footName of footNames) {
    for (const step of stepsByFoot[footName]) {
      const activePanels = step.activePanels.length > 0 ? step.activePanels : [];

      for (const panel of activePanels) {
        stepsByPanel[panel].push(step);
      }
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

const getAnchorPanel = (foot: FootName, heelPanel: Panel | null, toePanel: Panel | null): Panel => {
  if (foot === 'left') {
    return heelPanel ?? toePanel ?? 'left';
  }

  return toePanel ?? heelPanel ?? 'right';
};

const getBracketAngle = (foot: FootName, heelTarget: BotPanelTarget, toeTarget: BotPanelTarget): number => {
  const deltaX = toeTarget.x - heelTarget.x;
  const deltaY = toeTarget.y - heelTarget.y;
  const baseAngle = (Math.atan2(deltaY, deltaX) * 180) / Math.PI + 90;

  if (foot === 'left') {
    return Math.min(152, Math.max(-72, baseAngle));
  }

  return Math.min(72, Math.max(-152, baseAngle));
};


const getCrossoverTarget = (
  step: Pick<BotStep, 'foot' | 'fromPanel' | 'toPanel'>,
  footTargets: BotFootTargetMap,
  footAngles: BotFootAngleMap,
): { x: number; y: number; angle: number; panel: Panel } | null => {
  if (step.foot === 'right' && step.toPanel === 'left') {
    const baseTarget = footTargets.right.left;

    return {
      x: baseTarget.x + 10,
      y: baseTarget.y - 10,
      angle: footAngles.right.left,
      panel: 'left',
    };
  }

  if (step.foot === 'left' && step.toPanel === 'right') {
    const baseTarget = footTargets.left.right;

    return {
      x: baseTarget.x - 10,
      y: baseTarget.y - 10,
      angle: footAngles.left.right,
      panel: 'right',
    };
  }

  return null;
};

const getBracketCenter = (heelTarget: BotPanelTarget, toeTarget: BotPanelTarget): BotPanelTarget => ({
  // The rendered foot's heel sits below its center, so a simple midpoint leaves
  // down-facing brackets too far off the side panel.
  x: heelTarget.x + (toeTarget.x - heelTarget.x) * 0.36,
  y: heelTarget.y + (toeTarget.y - heelTarget.y) * 0.36,
});

const getStepPoseTarget = (
  step: Pick<BotStep, 'foot' | 'fromPanel' | 'toPanel' | 'heelPanel' | 'toePanel'>,
  footTargets: BotFootTargetMap,
  footAngles: BotFootAngleMap,
): { x: number; y: number; angle: number; panel: Panel } => {
  const heelTarget = step.heelPanel ? footTargets[step.foot][step.heelPanel] : null;
  const toeTarget = step.toePanel ? footTargets[step.foot][step.toePanel] : null;
  const heelAngle = step.heelPanel ? footAngles[step.foot][step.heelPanel] : null;
  const toeAngle = step.toePanel ? footAngles[step.foot][step.toePanel] : null;

  if (heelTarget && toeTarget) {
    const bracketCenter = getBracketCenter(heelTarget, toeTarget);

    return {
      x: bracketCenter.x,
      y: bracketCenter.y,
      angle: getBracketAngle(step.foot, heelTarget, toeTarget),
      panel: step.toPanel,
    };
  }

  const crossoverTarget = getCrossoverTarget(step, footTargets, footAngles);

  if (crossoverTarget) {
    return crossoverTarget;
  }

  const fallbackPanel = step.heelPanel ?? step.toePanel ?? step.toPanel;
  return {
    x: footTargets[step.foot][fallbackPanel].x,
    y: footTargets[step.foot][fallbackPanel].y,
    angle: footAngles[step.foot][fallbackPanel],
    panel: fallbackPanel,
  };
};

const applyCrossoverTurn = (
  feet: Record<FootName, BotFootPose>,
  footTargets: BotFootTargetMap,
  footMotion: Record<FootName, BotFootMotionSample>,
): Record<FootName, BotFootPose> => {
  const crossoverDistance = feet.left.x - feet.right.x;
  const isRightFootCrossingLeft =
    feet.right.panel === 'left' ||
    footMotion.right.completedStep?.toPanel === 'left' ||
    footMotion.right.upcomingStep?.toPanel === 'left';
  const isLeftFootCrossingRight =
    feet.left.panel === 'right' ||
    footMotion.left.completedStep?.toPanel === 'right' ||
    footMotion.left.upcomingStep?.toPanel === 'right';

  if (crossoverDistance <= 0 && !isRightFootCrossingLeft && !isLeftFootCrossingRight) {
    return feet;
  }

  const crossingFoot: FootName | null = isRightFootCrossingLeft ? 'right' : isLeftFootCrossingRight ? 'left' : null;

  if (!crossingFoot) {
    return feet;
  }

  const supportFoot = getOtherFoot(crossingFoot);
  const isCrossingLeft = crossingFoot === 'right';
  const targetSidePanel: Panel = isCrossingLeft ? 'left' : 'right';
  const crossingUpcomingStep = footMotion[crossingFoot].upcomingStep;
  const crossingCompletedStep = footMotion[crossingFoot].completedStep;
  const crossingHasReachedSide = crossingCompletedStep?.toPanel === targetSidePanel;
  const supportReferencePanel = crossingHasReachedSide
    ? footMotion[supportFoot].completedStep?.toPanel ?? feet[supportFoot].panel
    : footMotion[supportFoot].upcomingStep?.toPanel ??
      footMotion[supportFoot].completedStep?.toPanel ??
      feet[supportFoot].panel;
  const alignedBodyFacingAngle = isCrossingLeft ? -92 : 92;
  const bodyFacingAngle = supportReferencePanel === 'up' ? -alignedBodyFacingAngle : alignedBodyFacingAngle;
  const leadFootOffset = bodyFacingAngle > 0 ? 8 : -8;
  const trailingFootOffset = bodyFacingAngle > 0 ? -4 : 4;
  const crossingIsMovingToSide = crossingUpcomingStep?.toPanel === targetSidePanel;
  const crossingIsExitingSide =
    crossingCompletedStep?.toPanel === targetSidePanel &&
    crossingUpcomingStep !== null &&
    crossingUpcomingStep.toPanel !== targetSidePanel;
  const referenceStartX = isRightFootCrossingLeft
    ? Math.max(footTargets.right.up.x, footTargets.right.down.x, footTargets.right.right.x)
    : Math.min(footTargets.left.up.x, footTargets.left.down.x, footTargets.left.left.x);
  const referenceEndX = isRightFootCrossingLeft
    ? footTargets.right.left.x + 10
    : footTargets.left.right.x - 10;
  const travelRangeX = Math.max(Math.abs(referenceStartX - referenceEndX), 0.001);
  const crossedTravelProgress = isRightFootCrossingLeft
    ? clamp((referenceStartX - feet.right.x) / travelRangeX, 0, 1)
    : isLeftFootCrossingRight
      ? clamp((feet.left.x - referenceStartX) / travelRangeX, 0, 1)
      : 0;
  const geometricBlend = crossingIsMovingToSide
    ? footMotion[crossingFoot].moveProgress
    : crossingIsExitingSide
      ? 1 - footMotion[crossingFoot].moveProgress
    : crossingHasReachedSide
      ? 1
      : crossoverDistance > 0
        ? clamp(crossedTravelProgress, 0.18, 1)
        : 0;
  const supportUpcomingStep = footMotion[supportFoot].upcomingStep;
  const supportCompletedStep = footMotion[supportFoot].completedStep;
  const supportSetupSteps = [supportCompletedStep, supportUpcomingStep].filter(
    (step): step is BotStep => step !== null,
  );
  const supportIsSteppingIntoBrace = supportUpcomingStep?.toPanel === 'down';
  const supportJustBraced = supportCompletedStep?.toPanel === 'down';
  const anticipatesUpcomingCrossover =
    crossingUpcomingStep?.toPanel === targetSidePanel &&
    !crossingHasReachedSide &&
    supportSetupSteps.some(
      (step) =>
        crossingUpcomingStep.hitTimeSeconds >= step.hitTimeSeconds &&
        crossingUpcomingStep.hitTimeSeconds - step.hitTimeSeconds <= botMoveLeadSeconds * 2.6,
    );
  const anticipatoryBlend = supportIsSteppingIntoBrace
    ? footMotion[supportFoot].moveProgress
    : supportJustBraced
      ? 1
      : 0;
  const supportBlend = Math.max(geometricBlend, anticipatoryBlend);
  const supportAngleBlend = Math.max(
    supportBlend,
    anticipatesUpcomingCrossover ? 0.68 : 0,
  );
  const crossingStartedBlend =
    crossingUpcomingStep && crossingUpcomingStep.toPanel === targetSidePanel
      ? footMotion[crossingFoot].moveProgress
      : footMotion[crossingFoot].completedStep?.toPanel === targetSidePanel
        ? 1
        : geometricBlend;
  const crossingBlend = Math.max(geometricBlend, crossingStartedBlend);
  const supportFootSpanX = isCrossingLeft
    ? Math.abs(footTargets.left.down.x - (footTargets.right.left.x + 10))
    : Math.abs((footTargets.left.right.x - 10) - footTargets.right.down.x);
  const supportFootSpanY = isCrossingLeft
    ? Math.abs(footTargets.left.down.y - (footTargets.right.left.y - 10))
    : Math.abs((footTargets.left.right.y - 10) - footTargets.right.down.y);
  const supportFootShiftX = (isCrossingLeft ? 1 : -1) * clamp(supportFootSpanX * 0.38, 3, 8);
  const supportFootShiftY = clamp(supportFootSpanY * 0.22, 3, 7);

  const nextFeet = {
    left: { ...feet.left },
    right: { ...feet.right },
  };

  nextFeet[supportFoot] = {
    ...nextFeet[supportFoot],
    x: nextFeet[supportFoot].x + supportFootShiftX * supportBlend,
    y: nextFeet[supportFoot].y + supportFootShiftY * supportBlend,
    angle: lerp(nextFeet[supportFoot].angle, bodyFacingAngle + trailingFootOffset, 0.88 * supportAngleBlend),
  };

  nextFeet[crossingFoot] = {
    ...nextFeet[crossingFoot],
    angle: lerp(nextFeet[crossingFoot].angle, bodyFacingAngle + leadFootOffset, 0.88 * crossingBlend),
  };

  return nextFeet;
};

const separateFeet = (feet: Record<FootName, BotFootPose>): Record<FootName, BotFootPose> => {
  const deltaX = feet.right.x - feet.left.x;
  const deltaY = feet.right.y - feet.left.y;
  const distance = Math.hypot(deltaX, deltaY);

  if (distance >= botFootMinSeparation) {
    return feet;
  }

  const overlap = (botFootMinSeparation - distance) / 2;
  const safeDistance = distance > 0.001 ? distance : 1;
  const axisX = distance > 0.001 ? deltaX / safeDistance : 1;
  const axisY = distance > 0.001 ? deltaY / safeDistance : 0;

  return {
    left: {
      ...feet.left,
      x: feet.left.x - axisX * overlap,
      y: feet.left.y - axisY * overlap,
    },
    right: {
      ...feet.right,
      x: feet.right.x + axisX * overlap,
      y: feet.right.y + axisY * overlap,
    },
  };
};

const addFootswitchReleaseSteps = (stepsByFoot: Record<FootName, BotStep[]>): Record<FootName, BotStep[]> => {
  const allSteps = footNames
    .flatMap((footName) => stepsByFoot[footName].map((step) => ({ footName, step })))
    .sort((left, right) => left.step.hitTimeSeconds - right.step.hitTimeSeconds);
  const lastPanelPress = new Map<Panel, BotStep>();
  const currentPanelByFoot: Record<FootName, Panel> = {
    left: getHomePanel('left'),
    right: getHomePanel('right'),
  };

  for (const { footName, step } of allSteps) {
    if (step.activePanels.length !== 1) {
      currentPanelByFoot[footName] = step.toPanel;

      for (const panel of step.activePanels) {
        lastPanelPress.set(panel, step);
      }
      continue;
    }

    const panel = step.activePanels[0];
    const previousStep = lastPanelPress.get(panel) ?? null;
    const previousFoot = previousStep?.foot ?? null;
    const previousFootStillOccupiesPanel =
      previousFoot !== null && currentPanelByFoot[previousFoot] === panel;

    if (
      previousStep &&
      previousStep.foot !== footName &&
      previousStep.activePanels.length === 1 &&
      previousFootStillOccupiesPanel
    ) {
      stepsByFoot[previousStep.foot].push({
        foot: previousStep.foot,
        footPart: null,
        fromPanel: panel,
        toPanel: panel,
        isLifted: true,
        heelPanel: null,
        toePanel: null,
        activePanels: [],
        hitBeat: step.hitBeat,
        hitTimeSeconds: step.hitTimeSeconds,
        moveStartTimeSeconds: step.moveStartTimeSeconds,
        moveEndTimeSeconds: step.moveEndTimeSeconds,
        holdUntilTimeSeconds: null,
      });
    }

    currentPanelByFoot[footName] = step.toPanel;
    lastPanelPress.set(panel, step);
  }

  for (const footName of footNames) {
    stepsByFoot[footName].sort((left, right) => left.hitTimeSeconds - right.hitTimeSeconds);
  }

  return stepsByFoot;
};

const sampleBotState = (
  stepsByFoot: Record<FootName, BotStep[]>,
  panelTimeline: BotPanelTimeline,
  footTargets: BotFootTargetMap,
  footAngles: BotFootAngleMap,
  currentTimeSeconds: number,
): BotViewState => {
  const sampleFootPose = (footName: FootName): BotFootMotionSample => {
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
    const restingTarget = completedStep
      ? getStepPoseTarget(completedStep, footTargets, footAngles)
      : {
          x: footTargets[footName][restingPanel].x,
          y: footTargets[footName][restingPanel].y,
          angle: footAngles[footName][restingPanel],
          panel: restingPanel,
        };
    let x = restingTarget.x;
    let y = restingTarget.y;
    let angle = restingTarget.angle;
    let panel = restingTarget.panel;
    let scale = 1;
    let isLifted = completedStep?.isLifted ?? false;
    let moveProgress = 0;
    const isHolding =
      completedStep !== null &&
      completedStep.holdUntilTimeSeconds !== null &&
      completedStep.holdUntilTimeSeconds > currentTimeSeconds;
    const pressEndTimeSeconds = completedStep
      ? Math.min(completedStep.hitTimeSeconds + botPressWindowSeconds, upcomingStep?.moveStartTimeSeconds ?? Number.POSITIVE_INFINITY)
      : Number.NEGATIVE_INFINITY;
    const isPressing =
      completedStep !== null &&
      completedStep.activePanels.length > 0 &&
      currentTimeSeconds >= completedStep.hitTimeSeconds &&
      currentTimeSeconds <= pressEndTimeSeconds;

    if (upcomingStep && currentTimeSeconds >= upcomingStep.moveStartTimeSeconds) {
      const fromTarget = completedStep
        ? getStepPoseTarget(completedStep, footTargets, footAngles)
        : {
            x: footTargets[footName][upcomingStep.fromPanel].x,
            y: footTargets[footName][upcomingStep.fromPanel].y,
            angle: footAngles[footName][upcomingStep.fromPanel],
            panel: upcomingStep.fromPanel,
          };
      const toTarget = getStepPoseTarget(upcomingStep, footTargets, footAngles);
      const moveDurationSeconds = Math.max(upcomingStep.moveEndTimeSeconds - upcomingStep.moveStartTimeSeconds, 0.001);
      const nextMoveProgress = clamp(
        (currentTimeSeconds - upcomingStep.moveStartTimeSeconds) / moveDurationSeconds,
        0,
        1,
      );
      const liftStrength = clamp(moveDurationSeconds / botMoveLeadSeconds, 0.45, 1);

      x = lerp(fromTarget.x, toTarget.x, nextMoveProgress);
      y = lerp(fromTarget.y, toTarget.y, nextMoveProgress);
      angle = lerp(fromTarget.angle, toTarget.angle, nextMoveProgress);
      panel = toTarget.panel;
      isLifted = upcomingStep.isLifted;
      moveProgress = nextMoveProgress;
      scale = Math.max(scale, 1 + Math.sin(nextMoveProgress * Math.PI) * botTravelLiftScale * liftStrength);

      if (upcomingStep.isLifted) {
        y -= Math.sin(nextMoveProgress * Math.PI * 0.5) * botFootswitchLiftHeight;
      }
    }

    if (isHolding) {
      scale = Math.max(scale, botHoldScale);
    } else if (isPressing) {
      scale = Math.max(scale, botPressScale);
    }

    if (isLifted) {
      y -= botFootswitchLiftHeight;
      scale = Math.max(scale, 1.02);
    }

    if ((completedStep && isBracketStep(completedStep)) || (upcomingStep && isBracketStep(upcomingStep) && currentTimeSeconds >= upcomingStep.moveStartTimeSeconds)) {
      scale = Math.max(scale, botPressScale + 0.06);
    }

    return {
      pose: {
        foot: footName,
        panel,
        x,
        y,
        angle,
        scale,
        isHolding,
        isPressing,
        isLifted,
        lastStepBeat: completedStep?.hitBeat ?? Number.NEGATIVE_INFINITY,
      },
      completedStep,
      upcomingStep,
      moveProgress,
    };
  };

  const footMotion: Record<FootName, BotFootMotionSample> = {
    left: sampleFootPose('left'),
    right: sampleFootPose('right'),
  };
  const feet: Record<FootName, BotFootPose> = {
    left: footMotion.left.pose,
    right: footMotion.right.pose,
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

  return { feet: separateFeet(applyCrossoverTurn(feet, footTargets, footMotion)), activePanels };
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

const buildGreedyBotTimeline = (
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
          footPart: null,
          fromPanel: foot.panel,
          toPanel: event.panel,
          isLifted: false,
          heelPanel: null,
          toePanel: null,
          activePanels: [event.panel],
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

interface PlannedBotHit {
  foot: FootName;
  footPart: BotFootPart | null;
  heelPanel: Panel | null;
  toePanel: Panel | null;
  toPanel: Panel;
  hitBeat: number;
  hitTimeSeconds: number;
  holdUntilBeat: number | null;
  holdUntilTimeSeconds: number | null;
}

const buildParityBotTimeline = (
  events: TimedNoteEvent[],
  holdEndBeatMap: Map<string, number>,
  simfile: SimfileDocument,
  parityConfig: Partial<StepParityConfig> = {},
): Record<FootName, BotStep[]> | null => {
  const parityResult = buildParityAssignmentMap(events, holdEndBeatMap, simfile, parityConfig);
  const playableEvents = events.filter((event) => event.kind !== 'hold-tail' && event.kind !== 'mine');

  if (playableEvents.length === 0 || parityResult.assignments.size < playableEvents.length) {
    return null;
  }

  const plannedHitsByFoot: Record<FootName, PlannedBotHit[]> = {
    left: [],
    right: [],
  };

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

    const perBeatHits = new Map<string, PlannedBotHit>();

    for (const event of stepEvents) {
      const footPart = parityResult.assignments.get(getTimedEventKey(event)) ?? null;
      if (!footPart) {
        return null;
      }

      const foot = getFootSideFromFootPart(footPart);
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
        const key = `${foot}:${stepBeat.toFixed(6)}`;
        const existingHit = perBeatHits.get(key) ?? {
          foot,
          footPart,
          heelPanel: null,
          toePanel: null,
          toPanel: event.panel,
          hitBeat: stepBeat,
          hitTimeSeconds,
          holdUntilBeat: sustainUntilBeat,
          holdUntilTimeSeconds,
        };

        if (footPart.endsWith('heel')) {
          existingHit.heelPanel = event.panel;
        } else {
          existingHit.toePanel = event.panel;
        }

        existingHit.toPanel = getAnchorPanel(foot, existingHit.heelPanel, existingHit.toePanel);
        existingHit.holdUntilBeat = Math.max(existingHit.holdUntilBeat ?? Number.NEGATIVE_INFINITY, sustainUntilBeat ?? Number.NEGATIVE_INFINITY);
        if (!Number.isFinite(existingHit.holdUntilBeat)) {
          existingHit.holdUntilBeat = null;
        }

        if ((existingHit.holdUntilTimeSeconds ?? Number.NEGATIVE_INFINITY) < (holdUntilTimeSeconds ?? Number.NEGATIVE_INFINITY)) {
          existingHit.holdUntilTimeSeconds = holdUntilTimeSeconds;
        }

        perBeatHits.set(key, existingHit);
      }
    }

    for (const hit of perBeatHits.values()) {
      plannedHitsByFoot[hit.foot].push(hit);
    }
  }

  const stepsByFoot: Record<FootName, BotStep[]> = {
    left: [],
    right: [],
  };
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

  for (const footName of footNames) {
    plannedHitsByFoot[footName].sort((left, right) => left.hitTimeSeconds - right.hitTimeSeconds);

    for (const hit of plannedHitsByFoot[footName]) {
      const foot = feet[footName];
      const preferredLeadSeconds = foot.panel === hit.toPanel ? botSamePanelLeadSeconds : botMoveLeadSeconds;
      const secondsSinceLastStep = Number.isFinite(foot.availableTimeSeconds)
        ? Math.max(hit.hitTimeSeconds - foot.availableTimeSeconds, 0)
        : Number.POSITIVE_INFINITY;
      const adaptiveLeadSeconds = Number.isFinite(secondsSinceLastStep)
        ? clamp(secondsSinceLastStep * botAdaptiveLeadRatio, botMinMoveLeadSeconds, preferredLeadSeconds)
        : preferredLeadSeconds;
      const moveStartTimeSeconds = Math.max(hit.hitTimeSeconds - adaptiveLeadSeconds, foot.availableTimeSeconds);
      const availableMoveWindowSeconds = Math.max(hit.hitTimeSeconds - moveStartTimeSeconds, 0.001);
      const compressedMoveRatio =
        foot.panel === hit.toPanel || preferredLeadSeconds <= 0
          ? 0
          : clamp(1 - adaptiveLeadSeconds / preferredLeadSeconds, 0, 1);
      const moveDurationScale = lerp(1, botFastMoveDurationScale, compressedMoveRatio);
      const moveEndTimeSeconds = Math.min(
        hit.hitTimeSeconds,
        moveStartTimeSeconds + availableMoveWindowSeconds * moveDurationScale,
      );

      stepsByFoot[footName].push({
        foot: footName,
        footPart: hit.footPart,
        fromPanel: foot.panel,
        toPanel: hit.toPanel,
        isLifted: false,
        heelPanel: hit.heelPanel,
        toePanel: hit.toePanel,
        activePanels: getUniquePanels(hit.heelPanel, hit.toePanel, hit.toPanel),
        hitBeat: hit.hitBeat,
        hitTimeSeconds: hit.hitTimeSeconds,
        moveStartTimeSeconds,
        moveEndTimeSeconds,
        holdUntilTimeSeconds: hit.holdUntilTimeSeconds,
      });

      feet[footName] = {
        ...foot,
        panel: hit.toPanel,
        lastStepBeat: hit.hitBeat,
        holdUntilBeat: hit.holdUntilBeat ?? null,
        lastEventKind: hit.holdUntilBeat !== null ? 'hold-head' : 'tap',
        availableTimeSeconds: hit.hitTimeSeconds,
      };
    }
  }

  return addFootswitchReleaseSteps(stepsByFoot);
};

export const buildBotTimeline = (
  events: TimedNoteEvent[],
  holdEndBeatMap: Map<string, number>,
  simfile: SimfileDocument,
  parityConfig: Partial<StepParityConfig> = {},
): Record<FootName, BotStep[]> => {
  return buildParityBotTimeline(events, holdEndBeatMap, simfile, parityConfig) ?? buildGreedyBotTimeline(events, holdEndBeatMap, simfile);
};

export const sampleBotStateAtBeat = (
  botTimeline: Record<'left' | 'right', BotStep[]>,
  simfile: SimfileDocument,
  beat: number,
  formStyle: BotFormStyleId = defaultBotFormStyle,
): BotViewState => {
  const botPanelTimeline = buildBotPanelTimeline(botTimeline);
  const botFootTargets = getBotFootTargets(formStyle);
  const botFootAngles = getBotFootAngles(formStyle);
  const timeSeconds = beatToSeconds(beat, simfile.bpms, simfile.stops, simfile.metadata.offset);

  return sampleBotState(botTimeline, botPanelTimeline, botFootTargets, botFootAngles, timeSeconds);
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
  selectedFootStyle: BotFootStyleId;
  selectedPadStyle: BotPadStyleId;
  isPanelGlowEnabled: boolean;
  isPanelLightsEnabled: boolean;
  isCrossoverEnabled: boolean;
  isBracketEnabled: boolean;
  isFootswitchEnabled: boolean;
  isAppearanceSectionOpen: boolean;
  isBehaviorSectionOpen: boolean;
  onFormStyleChange: (nextStyle: BotFormStyleId) => void;
  onFootStyleCycle: () => void;
  onPadStyleToggle: () => void;
  onPanelGlowToggle: () => void;
  onPanelLightsToggle: () => void;
  onCrossoverToggle: () => void;
  onBracketToggle: () => void;
  onFootswitchToggle: () => void;
  onAppearanceSectionOpenChange: (isOpen: boolean) => void;
  onBehaviorSectionOpenChange: (isOpen: boolean) => void;
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
  selectedFootStyle,
  selectedPadStyle,
  isPanelGlowEnabled,
  isPanelLightsEnabled,
  isCrossoverEnabled,
  isBracketEnabled,
  isFootswitchEnabled,
  isAppearanceSectionOpen,
  isBehaviorSectionOpen,
  onFormStyleChange,
  onFootStyleCycle,
  onPadStyleToggle,
  onPanelGlowToggle,
  onPanelLightsToggle,
  onCrossoverToggle,
  onBracketToggle,
  onFootswitchToggle,
  onAppearanceSectionOpenChange,
  onBehaviorSectionOpenChange,
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
      const timeSeconds = clock
        ? clock.audioTime + ((timestamp - clock.perfTime) / 1000) * clock.playbackRate
        : 0;
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

  useEffect(() => {
    const preloadTargets = botFootStyleOptions
      .map((option) => option.image)
      .filter((image): image is string => image !== null);

    if (preloadTargets.length === 0) {
      return undefined;
    }

    const preloadedImages = preloadTargets.map((imageUrl) => {
      const image = new Image();
      image.decoding = 'async';
      image.src = imageUrl;
      void image.decode().catch(() => undefined);
      return image;
    });

    return () => {
      for (const image of preloadedImages) {
        image.src = '';
      }
    };
  }, []);

  const botFootTargets = useMemo(() => getBotFootTargets(selectedFormStyle), [selectedFormStyle]);
  const botFootAngles = useMemo(() => getBotFootAngles(selectedFormStyle), [selectedFormStyle]);
  const botPanelTimeline = useMemo(() => buildBotPanelTimeline(botTimeline), [botTimeline]);
  const selectedFootStyleOption = useMemo(
    () => botFootStyleOptions.find((option) => option.id === selectedFootStyle) ?? botFootStyleOptions[0],
    [selectedFootStyle],
  );
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
          <details
            className="bot-settings-section"
            open={isAppearanceSectionOpen}
            onToggle={(event) => onAppearanceSectionOpenChange(event.currentTarget.open)}
          >
            <summary className="bot-settings-section-summary">
              <span className="bot-settings-section-heading">Appearance</span>
            </summary>

            <div className="bot-settings-group">
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
              </div>

              <div className="bot-future-control-grid bot-future-control-grid-appearance" aria-label="Appearance controls">
                <button
                  type="button"
                  className={`bot-future-control-slot bot-future-control-toggle${selectedPadStyle === 'ddr' ? ' is-enabled' : ''}`}
                  onClick={onPadStyleToggle}
                >
                  <span className="bot-future-control-label">{botPanelToggleOptions[0].label}</span>
                  <span className="bot-future-control-value">{selectedPadStyle === 'ddr' ? 'DDR' : 'ITG'}</span>
                </button>

                <button
                  type="button"
                  className={`bot-future-control-slot bot-future-control-toggle${isPanelGlowEnabled ? ' is-enabled' : ''}`}
                  aria-pressed={isPanelGlowEnabled}
                  onClick={onPanelGlowToggle}
                >
                  <span className="bot-future-control-label">{botPanelToggleOptions[1].label}</span>
                  <span className="bot-future-control-value">{isPanelGlowEnabled ? 'On' : 'Off'}</span>
                </button>

                <button
                  type="button"
                  className={`bot-future-control-slot bot-future-control-toggle${isPanelLightsEnabled ? ' is-enabled' : ''}`}
                  aria-pressed={isPanelLightsEnabled}
                  onClick={onPanelLightsToggle}
                >
                  <span className="bot-future-control-label">{botPanelToggleOptions[2].label}</span>
                  <span className="bot-future-control-value">{isPanelLightsEnabled ? 'On' : 'Off'}</span>
                </button>

                <button
                  type="button"
                  className={`bot-future-control-slot bot-future-control-toggle${selectedFootStyle !== 'default' ? ' is-enabled' : ''}`}
                  onClick={onFootStyleCycle}
                >
                  <span className="bot-future-control-label">Feet</span>
                  <span className="bot-future-control-value">{selectedFootStyleOption.label}</span>
                </button>
              </div>
            </div>
          </details>

          <details
            className="bot-settings-section"
            open={isBehaviorSectionOpen}
            onToggle={(event) => onBehaviorSectionOpenChange(event.currentTarget.open)}
          >
            <summary className="bot-settings-section-summary">
              <span className="bot-settings-section-heading">Behavior</span>
            </summary>

            <div className="bot-settings-group">
              <div className="bot-future-control-grid bot-future-control-grid-behavior" aria-label="Behavior controls">
                <button
                  type="button"
                  className={`bot-future-control-slot bot-future-control-toggle${isCrossoverEnabled ? ' is-enabled' : ''}`}
                  aria-pressed={isCrossoverEnabled}
                  onClick={onCrossoverToggle}
                >
                  <span className="bot-future-control-label">{botParityToggleOptions[0].label}</span>
                  <span className="bot-future-control-value">{isCrossoverEnabled ? 'On' : 'Off'}</span>
                </button>

                <button
                  type="button"
                  className={`bot-future-control-slot bot-future-control-toggle${isBracketEnabled ? ' is-enabled' : ''}`}
                  aria-pressed={isBracketEnabled}
                  onClick={onBracketToggle}
                >
                  <span className="bot-future-control-label">{botParityToggleOptions[1].label}</span>
                  <span className="bot-future-control-value">{isBracketEnabled ? 'On' : 'Off'}</span>
                </button>

                <button
                  type="button"
                  className={`bot-future-control-slot bot-future-control-toggle${isFootswitchEnabled ? ' is-enabled' : ''}`}
                  aria-pressed={isFootswitchEnabled}
                  onClick={onFootswitchToggle}
                >
                  <span className="bot-future-control-label">{botParityToggleOptions[2].label}</span>
                  <span className="bot-future-control-value">{isFootswitchEnabled ? 'On' : 'Off'}</span>
                </button>
              </div>
            </div>
          </details>
        </section>

        <div className="bot-pad-stage">
          <div className="bot-pad-surface">
            {botStaticPadTiles.map((tile) => (
              <div key={tile} className={`bot-pad-static-tile bot-pad-static-tile-${tile}`} aria-hidden="true" />
            ))}

            {panelOrder.map((panel) => (
              <div
                key={panel}
                className={`bot-pad-panel bot-pad-panel-${panel}${botState.activePanels[panel] ? ' is-active' : ''}${isPanelGlowEnabled ? ' is-glow-enabled' : ''}${isPanelLightsEnabled ? ' is-lights-enabled' : ''}`}
                style={getBotPanelEffectStyle(panel, selectedPadStyle)}
              >
                {resolvedNoteskin?.panelAssets[panel].receptor ? (
                  <div className="bot-pad-panel-icon" aria-hidden="true">
                    <div
                      className="bot-pad-panel-icon-layer bot-pad-panel-icon-tint"
                      style={getTintedSpriteMaskStyle(
                        resolvedNoteskin.panelAssets[panel].receptor,
                        getBotPadArrowColor(panel, selectedPadStyle),
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
              const isImageFoot = selectedFootStyleOption.image !== null;

              return (
                <div
                  key={footName}
                  className={`bot-foot bot-foot-${footName}${foot.isHolding ? ' is-holding' : ''}${foot.isPressing ? ' is-pressing' : ''}${foot.isLifted ? ' is-lifted' : ''}${isImageFoot ? ' is-image-foot' : ''}`}
                  style={{
                    left: `${foot.x}%`,
                    top: `${foot.y}%`,
                    transform: getBotFootTransform(foot),
                  }}
                  title={`${footName} foot on ${foot.panel}`}
                >
                  {selectedFootStyleOption.image ? (
                    <img
                      src={selectedFootStyleOption.image}
                      alt=""
                      className={`bot-foot-image${footName === 'right' ? ' is-mirrored' : ''}`}
                    />
                  ) : (
                    <span>{footName === 'left' ? 'L' : 'R'}</span>
                  )}
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