import { beatToSeconds } from './simfile';
import type { Panel, SimfileDocument, TimedNoteEvent } from './simfile';

export type ParityFootPart = 'left-heel' | 'left-toe' | 'right-heel' | 'right-toe';
export type ParityFootName = 'left' | 'right';

export interface StepParityConfig {
  allowBrackets: boolean;
  allowCrossovers: boolean;
  allowFootswitches: boolean;
  favorJumpsOverBrackets: boolean;
}

export const defaultStepParityConfig: StepParityConfig = {
  allowBrackets: true,
  allowCrossovers: true,
  allowFootswitches: true,
  favorJumpsOverBrackets: true,
};

export interface ParityAssignmentResult {
  assignments: Map<string, ParityFootPart>;
  diagnostics: ParityRowDiagnostic[];
  rowCount: number;
}

export type ParityDiagnosticKind = 'bracket' | 'crossover' | 'double-step' | 'footswitch' | 'spin';

export interface ParityRowDiagnostic {
  beat: number;
  rowIndex: number;
  kinds: ParityDiagnosticKind[];
}

type RowNoteType = 'empty' | 'tap' | 'hold-head' | 'roll-head';

interface StagePoint {
  x: number;
  y: number;
}

interface TimedHold {
  startBeat: number;
  endBeat: number;
  type: RowNoteType;
  second: number;
}

interface RowNote {
  type: RowNoteType;
  beat: number;
  second: number;
  holdLength: number;
  key: string | null;
  panel: Panel | null;
  parity: FootValue;
}

interface Row {
  notes: RowNote[];
  holds: RowNote[];
  mines: number[];
  columns: FootValue[];
  whereTheFeetAre: number[];
  noteMask: number;
  holdMask: number;
  mineMask: number;
  second: number;
  beat: number;
  rowIndex: number;
  columnCount: number;
  noteCount: number;
}

interface State {
  combinedColumns: FootValue[];
  movedMask: number;
  holdingMask: number;
  combinedMask: string;
  whereTheFeetAre: number[];
  whatNoteTheFootIsHitting: number[];
  didTheFootMove: boolean[];
  isTheFootHolding: boolean[];
}

interface StepParityNode {
  id: number;
  state: State;
  rowIndex: number;
  second: number;
  totalCost: number;
  previousNode: StepParityNode | null;
}

const panelOrder: readonly Panel[] = ['left', 'down', 'up', 'right'] as const;
const panelIndexByName: Record<Panel, number> = {
  left: 0,
  down: 1,
  up: 2,
  right: 3,
};

const INVALID_COLUMN = -1;
const COLUMN_COUNT = 4;

enum FootValue {
  None = 0,
  LeftHeel = 1,
  LeftToe = 2,
  RightHeel = 3,
  RightToe = 4,
}

const footValues = [
  FootValue.LeftHeel,
  FootValue.LeftToe,
  FootValue.RightHeel,
  FootValue.RightToe,
] as const;
const footMasks = [0, 1, 2, 4, 8] as const;
const otherPartOfFoot: FootValue[] = [
  FootValue.None,
  FootValue.LeftToe,
  FootValue.LeftHeel,
  FootValue.RightToe,
  FootValue.RightHeel,
];

const DOUBLESTEP = 850;
const BRACKETJACK = 20;
const JACK = 30;
const SLOW_BRACKET = 300;
const TWISTED_FOOT = 100000;
const BRACKETTAP = 400;
const PREFERRED_BRACKET_BONUS = 5000;
const HOLDSWITCH = 55;
const MINE = 10000;
const FOOTSWITCH = 325;
const MISSED_FOOTSWITCH = 500;
const FACING = 2;
const DISTANCE = 6;
const SPIN = 1000;
const SIDESWITCH = 130;
const JACK_THRESHOLD = 0.1;
const SLOW_BRACKET_THRESHOLD = 0.15;
const SLOW_FOOTSWITCH_THRESHOLD = 0.2;
const SLOW_FOOTSWITCH_IGNORE = 0.4;
const EPSILON = 0.000001;
const HARD_DISABLE_PENALTY = 1_000_000;

const createEmptyNote = (): RowNote => ({
  type: 'empty',
  beat: 0,
  second: 0,
  holdLength: -1,
  key: null,
  panel: null,
  parity: FootValue.None,
});

const createEmptyState = (): State => ({
  combinedColumns: new Array<FootValue>(COLUMN_COUNT).fill(FootValue.None),
  movedMask: 0,
  holdingMask: 0,
  combinedMask: '0,0,0,0',
  whereTheFeetAre: new Array<number>(5).fill(INVALID_COLUMN),
  whatNoteTheFootIsHitting: new Array<number>(5).fill(INVALID_COLUMN),
  didTheFootMove: new Array<boolean>(5).fill(false),
  isTheFootHolding: new Array<boolean>(5).fill(false),
});

const getTimedEventKey = (event: TimedNoteEvent): string =>
  `${event.panel}:${event.beat.toFixed(6)}:${event.kind}:${event.measureIndex}:${event.rowIndex}`;

export { getTimedEventKey };

export const getFootSideFromFootPart = (footPart: ParityFootPart): ParityFootName =>
  footPart.startsWith('left') ? 'left' : 'right';

const toFootPart = (value: FootValue): ParityFootPart | null => {
  switch (value) {
    case FootValue.LeftHeel:
      return 'left-heel';
    case FootValue.LeftToe:
      return 'left-toe';
    case FootValue.RightHeel:
      return 'right-heel';
    case FootValue.RightToe:
      return 'right-toe';
    default:
      return null;
  }
};

const countBits = (value: number): number => {
  let remaining = value;
  let count = 0;

  while (remaining > 0) {
    count += remaining & 1;
    remaining >>= 1;
  }

  return count;
};

class StageLayout {
  readonly columnCount = COLUMN_COUNT;
  readonly columns: StagePoint[] = [
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
    { x: 1, y: 0 },
  ];
  readonly upArrows = [2];
  readonly downArrows = [1];
  readonly sideArrows = [0, 3];
  readonly avgPoints: StagePoint[] = [];
  readonly distances: number[] = [];
  readonly facingXPenalties: number[] = [];
  readonly facingYPenalties: number[] = [];
  readonly permuteCache = new Map<number, FootValue[][]>();

  constructor() {
    this.preCalculateStuff();
    this.preGeneratePermutations();
  }

  bracketCheck(column1: number, column2: number): boolean {
    const distance = this.getDistance(column1, column2);
    return distance <= Math.SQRT2 + EPSILON;
  }

  getDistance(leftIndex: number, rightIndex: number): number {
    if (leftIndex === INVALID_COLUMN || rightIndex === INVALID_COLUMN) {
      return 0;
    }

    return this.distances[leftIndex * this.columnCount + rightIndex] ?? 0;
  }

  getXFacingPenalty(leftIndex: number, rightIndex: number): number {
    if (leftIndex === INVALID_COLUMN || rightIndex === INVALID_COLUMN) {
      return 0;
    }

    return this.facingXPenalties[leftIndex * this.columnCount + rightIndex] ?? 0;
  }

  getYFacingPenalty(leftIndex: number, rightIndex: number): number {
    if (leftIndex === INVALID_COLUMN || rightIndex === INVALID_COLUMN) {
      return 0;
    }

    return this.facingYPenalties[leftIndex * this.columnCount + rightIndex] ?? 0;
  }

  averagePoint(leftIndex: number, rightIndex: number): StagePoint {
    if (leftIndex === INVALID_COLUMN && rightIndex === INVALID_COLUMN) {
      return { x: 0, y: 0 };
    }

    if (leftIndex === INVALID_COLUMN) {
      return this.columns[rightIndex] ?? { x: 0, y: 0 };
    }

    if (rightIndex === INVALID_COLUMN) {
      return this.columns[leftIndex] ?? { x: 0, y: 0 };
    }

    return this.avgPoints[leftIndex * this.columnCount + rightIndex] ?? { x: 0, y: 0 };
  }

  private getDistanceSq(point1: StagePoint, point2: StagePoint): number {
    const deltaX = point1.x - point2.x;
    const deltaY = point1.y - point2.y;
    return deltaX * deltaX + deltaY * deltaY;
  }

  private getXDifference(leftIndex: number, rightIndex: number): number {
    if (leftIndex === rightIndex) {
      return 0;
    }

    const deltaX = this.columns[rightIndex].x - this.columns[leftIndex].x;
    const deltaY = this.columns[rightIndex].y - this.columns[leftIndex].y;
    const distance = Math.hypot(deltaX, deltaY);
    const normalizedX = deltaX / distance;
    const negative = normalizedX <= 0;
    const shaped = Math.pow(normalizedX, 4);
    return negative ? -shaped : shaped;
  }

  private getYDifference(leftIndex: number, rightIndex: number): number {
    if (leftIndex === rightIndex) {
      return 0;
    }

    const deltaX = this.columns[rightIndex].x - this.columns[leftIndex].x;
    const deltaY = this.columns[rightIndex].y - this.columns[leftIndex].y;
    const distance = Math.hypot(deltaX, deltaY);
    const normalizedY = deltaY / distance;
    const negative = normalizedY <= 0;
    const shaped = Math.pow(normalizedY, 4);
    return negative ? -shaped : shaped;
  }

  private preCalculateStuff(): void {
    for (let left = 0; left < this.columnCount; left += 1) {
      for (let right = 0; right < this.columnCount; right += 1) {
        const averagePoint = {
          x: (this.columns[left].x + this.columns[right].x) / 2,
          y: (this.columns[left].y + this.columns[right].y) / 2,
        };
        this.avgPoints[left * this.columnCount + right] = averagePoint;

        const distanceSquared = this.getDistanceSq(this.columns[left], this.columns[right]);
        const distance = Math.sqrt(distanceSquared);
        this.distances[left * this.columnCount + right] = distance;

        if (distance === 0) {
          this.facingXPenalties[left * this.columnCount + right] = 0;
          this.facingYPenalties[left * this.columnCount + right] = 0;
          continue;
        }

        const facingPenalty = (value: number): number => {
          const base = -1 * Math.min(value, 0);
          return Math.pow(base, 1.8) * 100;
        };

        this.facingXPenalties[left * this.columnCount + right] = Math.max(0, facingPenalty(this.getXDifference(left, right)));
        this.facingYPenalties[left * this.columnCount + right] = Math.max(0, facingPenalty(this.getYDifference(left, right)));
      }
    }
  }

  private preGeneratePermutations(): void {
    this.permuteCache.set(0, []);

    const maxMask = 1 << this.columnCount;
    for (let mask = 0; mask < maxMask; mask += 1) {
      if (countBits(mask) > 4) {
        continue;
      }

      const placements = this.permuteFootPlacements(mask, new Array<FootValue>(this.columnCount).fill(FootValue.None), 0);
      if (placements.length > 0) {
        this.permuteCache.set(mask, placements);
      }
    }
  }

  private permuteFootPlacements(mask: number, testColumns: FootValue[], column: number): FootValue[][] {
    if (column >= testColumns.length) {
      let leftHeelIndex = INVALID_COLUMN;
      let leftToeIndex = INVALID_COLUMN;
      let rightHeelIndex = INVALID_COLUMN;
      let rightToeIndex = INVALID_COLUMN;

      testColumns.forEach((foot, index) => {
        if (foot === FootValue.LeftHeel) {
          leftHeelIndex = index;
        }
        if (foot === FootValue.LeftToe) {
          leftToeIndex = index;
        }
        if (foot === FootValue.RightHeel) {
          rightHeelIndex = index;
        }
        if (foot === FootValue.RightToe) {
          rightToeIndex = index;
        }
      });

      if (
        (leftHeelIndex === INVALID_COLUMN && leftToeIndex !== INVALID_COLUMN) ||
        (rightHeelIndex === INVALID_COLUMN && rightToeIndex !== INVALID_COLUMN)
      ) {
        return [];
      }

      if (leftHeelIndex !== INVALID_COLUMN && leftToeIndex !== INVALID_COLUMN && !this.bracketCheck(leftHeelIndex, leftToeIndex)) {
        return [];
      }

      if (rightHeelIndex !== INVALID_COLUMN && rightToeIndex !== INVALID_COLUMN && !this.bracketCheck(rightHeelIndex, rightToeIndex)) {
        return [];
      }

      return [[...testColumns]];
    }

    const active = (mask & (1 << column)) !== 0;
    if (!active) {
      return this.permuteFootPlacements(mask, testColumns, column + 1);
    }

    const permutations: FootValue[][] = [];
    for (const foot of footValues) {
      if (testColumns.includes(foot)) {
        continue;
      }

      const nextColumns = [...testColumns];
      nextColumns[column] = foot;
      permutations.push(...this.permuteFootPlacements(mask, nextColumns, column + 1));
    }

    return permutations;
  }
}

const layout = new StageLayout();

const cloneRowNote = (note: RowNote): RowNote => ({ ...note });

const buildRows = (
  events: TimedNoteEvent[],
  holdEndBeatMap: Map<string, number>,
  simfile: SimfileDocument,
): Row[] => {
  const sortedEvents = [...events].sort((left, right) => {
    if (left.beat !== right.beat) {
      return left.beat - right.beat;
    }

    return panelIndexByName[left.panel] - panelIndexByName[right.panel];
  });
  const groups = new Map<number, TimedNoteEvent[]>();

  for (const event of sortedEvents) {
    const beatKey = Number(event.beat.toFixed(6));
    const group = groups.get(beatKey) ?? [];
    group.push(event);
    groups.set(beatKey, group);
  }

  const activeHolds = new Map<number, TimedHold>();
  const pendingMines = new Array<number>(COLUMN_COUNT).fill(0);
  const rows: Row[] = [];
  const beats = [...groups.keys()].sort((left, right) => left - right);

  for (const beatKey of beats) {
    const beatEvents = groups.get(beatKey) ?? [];
    const playableEvents = beatEvents.filter((event) => event.kind !== 'hold-tail' && event.kind !== 'mine');
    const mineEvents = beatEvents.filter((event) => event.kind === 'mine');
    const beat = playableEvents[0]?.beat ?? beatEvents[0]?.beat ?? beatKey;
    const second = beatToSeconds(beat, simfile.bpms, simfile.stops, simfile.metadata.offset);

    for (const [column, hold] of [...activeHolds.entries()]) {
      if (hold.endBeat + EPSILON < beat) {
        activeHolds.delete(column);
      }
    }

    if (playableEvents.length > 0) {
      const notes = Array.from({ length: COLUMN_COUNT }, () => createEmptyNote());
      const holds = Array.from({ length: COLUMN_COUNT }, () => createEmptyNote());
      const mines = [...pendingMines];
      let noteMask = 0;
      let holdMask = 0;
      let mineMask = 0;

      for (const [column, hold] of activeHolds.entries()) {
        if (hold.startBeat + EPSILON >= beat || hold.endBeat + EPSILON < beat) {
          continue;
        }

        holds[column] = {
          type: hold.type,
          beat: hold.startBeat,
          second: hold.second,
          holdLength: hold.endBeat - hold.startBeat,
          key: null,
          panel: panelOrder[column],
          parity: FootValue.None,
        };
        holdMask |= 1 << column;
      }

      for (const mineEvent of mineEvents) {
        const column = panelIndexByName[mineEvent.panel];
        mines[column] = mineEvent.timeSeconds;
      }

      for (const playableEvent of playableEvents) {
        const column = panelIndexByName[playableEvent.panel];
        const type: RowNoteType =
          playableEvent.kind === 'tap'
            ? 'tap'
            : playableEvent.kind === 'hold-head'
              ? 'hold-head'
              : 'roll-head';
        const holdEndBeat =
          playableEvent.kind === 'hold-head' || playableEvent.kind === 'roll-head'
            ? holdEndBeatMap.get(`${playableEvent.panel}:${playableEvent.beat.toFixed(6)}`) ?? playableEvent.beat
            : playableEvent.beat;

        notes[column] = {
          type,
          beat: playableEvent.beat,
          second: playableEvent.timeSeconds,
          holdLength: holdEndBeat - playableEvent.beat,
          key: getTimedEventKey(playableEvent),
          panel: playableEvent.panel,
          parity: FootValue.None,
        };
        noteMask |= 1 << column;
      }

      mines.forEach((value, index) => {
        if (value !== 0) {
          mineMask |= 1 << index;
        }
      });

      rows.push({
        notes,
        holds,
        mines,
        columns: new Array<FootValue>(COLUMN_COUNT).fill(FootValue.None),
        whereTheFeetAre: new Array<number>(5).fill(INVALID_COLUMN),
        noteMask,
        holdMask,
        mineMask,
        second,
        beat,
        rowIndex: rows.length,
        columnCount: COLUMN_COUNT,
        noteCount: playableEvents.length,
      });

      pendingMines.fill(0);
    } else {
      for (const mineEvent of mineEvents) {
        pendingMines[panelIndexByName[mineEvent.panel]] = mineEvent.timeSeconds;
      }
    }

    for (const [column, hold] of [...activeHolds.entries()]) {
      if (hold.endBeat <= beat + EPSILON) {
        activeHolds.delete(column);
      }
    }

    for (const playableEvent of playableEvents) {
      if (playableEvent.kind !== 'hold-head' && playableEvent.kind !== 'roll-head') {
        continue;
      }

      const column = panelIndexByName[playableEvent.panel];
      const holdEndBeat = holdEndBeatMap.get(`${playableEvent.panel}:${playableEvent.beat.toFixed(6)}`) ?? playableEvent.beat;
      activeHolds.set(column, {
        startBeat: playableEvent.beat,
        endBeat: holdEndBeat,
        type: playableEvent.kind,
        second: playableEvent.timeSeconds,
      });
    }
  }

  return rows;
};

const getStateKey = (state: State): string => `${state.combinedMask}|${state.movedMask}|${state.holdingMask}`;

const buildCombinedMask = (combinedColumns: FootValue[]): string => combinedColumns.join(',');

const initResultState = (initialState: State, row: Row, columns: FootValue[]): State => {
  const resultState = createEmptyState();

  for (let column = 0; column < columns.length; column += 1) {
    const foot = columns[column];
    if (foot === FootValue.None) {
      continue;
    }

    resultState.whatNoteTheFootIsHitting[foot] = column;

    if (row.holds[column].type === 'empty') {
      resultState.didTheFootMove[foot] = true;
      continue;
    }

    if (initialState.combinedColumns[column] !== foot) {
      resultState.didTheFootMove[foot] = true;
    }
  }

  for (let column = 0; column < columns.length; column += 1) {
    const foot = columns[column];
    if (foot === FootValue.None) {
      continue;
    }

    if (row.holds[column].type !== 'empty') {
      resultState.isTheFootHolding[foot] = true;
    }

    const bit = 1 << column;
    const footMask = footMasks[foot];
    if ((row.holdMask & bit) !== 0) {
      resultState.holdingMask |= footMask;
    }
    if ((row.holdMask & bit) === 0 || initialState.combinedColumns[column] !== foot) {
      resultState.movedMask |= footMask;
    }
  }

  for (let column = 0; column < columns.length; column += 1) {
    const nextFoot = columns[column];
    if (nextFoot !== FootValue.None) {
      resultState.combinedColumns[column] = nextFoot;
      continue;
    }

    const initialFoot = initialState.combinedColumns[column];
    if (initialFoot === FootValue.LeftHeel || initialFoot === FootValue.RightHeel) {
      if (!resultState.didTheFootMove[initialFoot]) {
        resultState.combinedColumns[column] = initialFoot;
      }
      continue;
    }

    if (initialFoot === FootValue.LeftToe) {
      if (!resultState.didTheFootMove[FootValue.LeftToe] && !resultState.didTheFootMove[FootValue.LeftHeel]) {
        resultState.combinedColumns[column] = initialFoot;
      }
      continue;
    }

    if (initialFoot === FootValue.RightToe) {
      if (!resultState.didTheFootMove[FootValue.RightToe] && !resultState.didTheFootMove[FootValue.RightHeel]) {
        resultState.combinedColumns[column] = initialFoot;
      }
    }
  }

  for (let column = 0; column < columns.length; column += 1) {
    const foot = resultState.combinedColumns[column];
    if (foot !== FootValue.None) {
      resultState.whereTheFeetAre[foot] = column;
    }
  }

  resultState.combinedMask = buildCombinedMask(resultState.combinedColumns);
  return resultState;
};

const setFootPlacement = (row: Row, state: State): void => {
  for (let column = 0; column < row.columnCount; column += 1) {
    if (row.notes[column].type === 'empty') {
      continue;
    }

    row.notes[column].parity = state.combinedColumns[column];
    row.columns[column] = state.combinedColumns[column];
    row.whereTheFeetAre[state.combinedColumns[column]] = column;
  }
};

const getFootPlacementPermutations = (row: Row): FootValue[][] => {
  const fullKey = row.noteMask | row.holdMask;
  const fullPlacements = layout.permuteCache.get(fullKey);
  if (fullPlacements) {
    return fullPlacements;
  }

  const notePlacements = layout.permuteCache.get(row.noteMask);
  if (notePlacements) {
    return notePlacements;
  }

  return layout.permuteCache.get(0) ?? [];
};

const didJackLeft = (
  initialState: State,
  resultState: State,
  leftHeel: number,
  leftToe: number,
  movedLeft: boolean,
  didJump: boolean,
): boolean => {
  let jackedLeft = false;

  if (!didJump && movedLeft) {
    if (
      leftHeel > INVALID_COLUMN &&
      initialState.combinedColumns[leftHeel] === FootValue.LeftHeel &&
      !resultState.isTheFootHolding[FootValue.LeftHeel] &&
      ((initialState.didTheFootMove[FootValue.LeftHeel] && !initialState.isTheFootHolding[FootValue.LeftHeel]) ||
        (initialState.didTheFootMove[FootValue.LeftToe] && !initialState.isTheFootHolding[FootValue.LeftToe]))
    ) {
      jackedLeft = true;
    }

    if (
      leftToe > INVALID_COLUMN &&
      initialState.combinedColumns[leftToe] === FootValue.LeftToe &&
      !resultState.isTheFootHolding[FootValue.LeftToe] &&
      ((initialState.didTheFootMove[FootValue.LeftHeel] && !initialState.isTheFootHolding[FootValue.LeftHeel]) ||
        (initialState.didTheFootMove[FootValue.LeftToe] && !initialState.isTheFootHolding[FootValue.LeftToe]))
    ) {
      jackedLeft = true;
    }
  }

  return jackedLeft;
};

const didJackRight = (
  initialState: State,
  resultState: State,
  rightHeel: number,
  rightToe: number,
  movedRight: boolean,
  didJump: boolean,
): boolean => {
  let jackedRight = false;

  if (!didJump && movedRight) {
    if (
      rightHeel > INVALID_COLUMN &&
      initialState.combinedColumns[rightHeel] === FootValue.RightHeel &&
      !resultState.isTheFootHolding[FootValue.RightHeel] &&
      ((initialState.didTheFootMove[FootValue.RightHeel] && !initialState.isTheFootHolding[FootValue.RightHeel]) ||
        (initialState.didTheFootMove[FootValue.RightToe] && !initialState.isTheFootHolding[FootValue.RightToe]))
    ) {
      jackedRight = true;
    }

    if (
      rightToe > INVALID_COLUMN &&
      initialState.combinedColumns[rightToe] === FootValue.RightToe &&
      !resultState.isTheFootHolding[FootValue.RightToe] &&
      ((initialState.didTheFootMove[FootValue.RightHeel] && !initialState.isTheFootHolding[FootValue.RightHeel]) ||
        (initialState.didTheFootMove[FootValue.RightToe] && !initialState.isTheFootHolding[FootValue.RightToe]))
    ) {
      jackedRight = true;
    }
  }

  return jackedRight;
};

const didDoubleStep = (
  initialState: State,
  resultState: State,
  rows: Row[],
  rowIndex: number,
  movedLeft: boolean,
  jackedLeft: boolean,
  movedRight: boolean,
  jackedRight: boolean,
): boolean => {
  const row = rows[rowIndex];
  let doubleStepped = false;

  if (
    movedLeft &&
    !jackedLeft &&
    ((initialState.didTheFootMove[FootValue.LeftHeel] && !initialState.isTheFootHolding[FootValue.LeftHeel]) ||
      (initialState.didTheFootMove[FootValue.LeftToe] && !initialState.isTheFootHolding[FootValue.LeftToe]))
  ) {
    doubleStepped = true;
  }

  if (
    movedRight &&
    !jackedRight &&
    ((initialState.didTheFootMove[FootValue.RightHeel] && !initialState.isTheFootHolding[FootValue.RightHeel]) ||
      (initialState.didTheFootMove[FootValue.RightToe] && !initialState.isTheFootHolding[FootValue.RightToe]))
  ) {
    doubleStepped = true;
  }

  if (rowIndex - 1 > -1) {
    const lastRow = rows[rowIndex - 1];
    for (const hold of lastRow.holds) {
      if (hold.type === 'empty') {
        continue;
      }

      const endBeat = row.beat;
      const startBeat = lastRow.beat;
      if (hold.beat + hold.holdLength > startBeat && hold.beat + hold.holdLength < endBeat) {
        doubleStepped = false;
      }
      if (hold.beat + hold.holdLength >= endBeat) {
        doubleStepped = false;
      }
    }
  }

  return doubleStepped;
};

const isBracketState = (resultState: State): boolean => {
  const leftHeel = resultState.whatNoteTheFootIsHitting[FootValue.LeftHeel];
  const leftToe = resultState.whatNoteTheFootIsHitting[FootValue.LeftToe];
  const rightHeel = resultState.whatNoteTheFootIsHitting[FootValue.RightHeel];
  const rightToe = resultState.whatNoteTheFootIsHitting[FootValue.RightToe];
  return (leftHeel !== INVALID_COLUMN && leftToe !== INVALID_COLUMN) || (rightHeel !== INVALID_COLUMN && rightToe !== INVALID_COLUMN);
};

const isCrossoverState = (resultState: State): boolean => {
  const leftPosition = layout.averagePoint(
    resultState.whereTheFeetAre[FootValue.LeftHeel],
    resultState.whereTheFeetAre[FootValue.LeftToe],
  );
  const rightPosition = layout.averagePoint(
    resultState.whereTheFeetAre[FootValue.RightHeel],
    resultState.whereTheFeetAre[FootValue.RightToe],
  );
  return rightPosition.x < leftPosition.x;
};

const didFootswitch = (initialState: State, resultState: State, row: Row): boolean => {
  for (let column = 0; column < row.columnCount; column += 1) {
    if (row.notes[column].type === 'empty') {
      continue;
    }

    const initialFoot = initialState.combinedColumns[column];
    const nextFoot = resultState.combinedColumns[column];
    if (initialFoot === FootValue.None || nextFoot === FootValue.None) {
      continue;
    }

    if (initialFoot !== nextFoot && initialFoot !== otherPartOfFoot[nextFoot]) {
      return true;
    }
  }

  return false;
};

const getRowDiagnosticKinds = (
  initialState: State,
  resultState: State,
  rows: Row[],
  rowIndex: number,
  elapsedTime: number,
): ParityDiagnosticKind[] => {
  const row = rows[rowIndex];
  const leftHeel = resultState.whatNoteTheFootIsHitting[FootValue.LeftHeel];
  const leftToe = resultState.whatNoteTheFootIsHitting[FootValue.LeftToe];
  const rightHeel = resultState.whatNoteTheFootIsHitting[FootValue.RightHeel];
  const rightToe = resultState.whatNoteTheFootIsHitting[FootValue.RightToe];
  const movedLeft = resultState.didTheFootMove[FootValue.LeftHeel] || resultState.didTheFootMove[FootValue.LeftToe];
  const movedRight = resultState.didTheFootMove[FootValue.RightHeel] || resultState.didTheFootMove[FootValue.RightToe];
  const didJump =
    ((initialState.didTheFootMove[FootValue.LeftHeel] && !initialState.isTheFootHolding[FootValue.LeftHeel]) ||
      (initialState.didTheFootMove[FootValue.LeftToe] && !initialState.isTheFootHolding[FootValue.LeftToe])) &&
    ((initialState.didTheFootMove[FootValue.RightHeel] && !initialState.isTheFootHolding[FootValue.RightHeel]) ||
      (initialState.didTheFootMove[FootValue.RightToe] && !initialState.isTheFootHolding[FootValue.RightToe]));
  const jackedLeft = didJackLeft(initialState, resultState, leftHeel, leftToe, movedLeft, didJump);
  const jackedRight = didJackRight(initialState, resultState, rightHeel, rightToe, movedRight, didJump);
  const kinds: ParityDiagnosticKind[] = [];

  if (isCrossoverState(resultState)) {
    kinds.push('crossover');
  }

  if (isBracketState(resultState)) {
    kinds.push('bracket');
  }

  if (didFootswitch(initialState, resultState, row)) {
    kinds.push('footswitch');
  }

  if (
    movedLeft !== movedRight &&
    resultState.holdingMask === 0 &&
    !didJump &&
    didDoubleStep(initialState, resultState, rows, rowIndex, movedLeft, jackedLeft, movedRight, jackedRight)
  ) {
    kinds.push('double-step');
  }

  const diagnosticCostCalculator = new StepParityCostCalculator(defaultStepParityConfig);
  if (diagnosticCostCalculator['calcSpinCosts'](initialState, resultState) > 0) {
    kinds.push('spin');
  }

  return kinds;
};

class StepParityCostCalculator {
  constructor(private readonly config: StepParityConfig) {}

  getActionCost(initialState: State, resultState: State, rows: Row[], columns: FootValue[], rowIndex: number, elapsedTime: number): number {
    const row = rows[rowIndex];
    const leftHeel = resultState.whatNoteTheFootIsHitting[FootValue.LeftHeel];
    const leftToe = resultState.whatNoteTheFootIsHitting[FootValue.LeftToe];
    const rightHeel = resultState.whatNoteTheFootIsHitting[FootValue.RightHeel];
    const rightToe = resultState.whatNoteTheFootIsHitting[FootValue.RightToe];
    const movedLeft = resultState.didTheFootMove[FootValue.LeftHeel] || resultState.didTheFootMove[FootValue.LeftToe];
    const movedRight = resultState.didTheFootMove[FootValue.RightHeel] || resultState.didTheFootMove[FootValue.RightToe];
    const didJump =
      ((initialState.didTheFootMove[FootValue.LeftHeel] && !initialState.isTheFootHolding[FootValue.LeftHeel]) ||
        (initialState.didTheFootMove[FootValue.LeftToe] && !initialState.isTheFootHolding[FootValue.LeftToe])) &&
      ((initialState.didTheFootMove[FootValue.RightHeel] && !initialState.isTheFootHolding[FootValue.RightHeel]) ||
        (initialState.didTheFootMove[FootValue.RightToe] && !initialState.isTheFootHolding[FootValue.RightToe]));
    const jackedLeft = didJackLeft(initialState, resultState, leftHeel, leftToe, movedLeft, didJump);
    const jackedRight = didJackRight(initialState, resultState, rightHeel, rightToe, movedRight, didJump);

    let cost = 0;
    cost += this.calcMineCost(resultState, row);
    cost += this.calcHoldSwitchCost(initialState, resultState, row);
    cost += this.calcBracketTapCost(initialState, resultState, row, leftHeel, leftToe, rightHeel, rightToe, elapsedTime);
    cost += this.calcBracketJackCost(resultState, movedLeft, movedRight, jackedLeft, jackedRight, didJump);
    cost += this.calcDoubleStepCost(initialState, resultState, rows, rowIndex, movedLeft, movedRight, jackedLeft, jackedRight, didJump);
    cost += this.calcPreferredBracketBonus(row, resultState);
    cost += this.calcSlowBracketCost(row, movedLeft, movedRight, elapsedTime);
    cost += this.calcTwistedFootCost(resultState);
    cost += this.calcFacingCosts(resultState);
    cost += this.calcSpinCosts(initialState, resultState);
    cost += this.calcFootswitchCost(initialState, columns, row, elapsedTime);
    cost += this.calcSideSwitchCost(initialState, resultState, columns);
    cost += this.calcMissedFootswitchCost(row, jackedLeft, jackedRight);
    cost += this.calcJackCost(movedLeft, movedRight, jackedLeft, jackedRight, elapsedTime);
    cost += this.calcBigMovementsQuicklyCost(initialState, resultState, elapsedTime);

    if (!this.config.allowBrackets && isBracketState(resultState)) {
      cost += HARD_DISABLE_PENALTY;
    }

    if (!this.config.allowCrossovers && isCrossoverState(resultState)) {
      cost += HARD_DISABLE_PENALTY;
    }

    return cost;
  }

  private calcMineCost(resultState: State, row: Row): number {
    if (row.mineMask === 0) {
      return 0;
    }

    for (let column = 0; column < row.columnCount; column += 1) {
      if (resultState.combinedColumns[column] !== FootValue.None && row.mines[column] !== 0) {
        return MINE;
      }
    }

    return 0;
  }

  private calcHoldSwitchCost(initialState: State, resultState: State, row: Row): number {
    if (row.holdMask === 0) {
      return 0;
    }

    let cost = 0;

    for (let column = 0; column < row.columnCount; column += 1) {
      if (row.holds[column].type === 'empty') {
        continue;
      }

      const currentFoot = resultState.combinedColumns[column];
      const switchedLeft =
        (currentFoot === FootValue.LeftHeel || currentFoot === FootValue.LeftToe) &&
        initialState.combinedColumns[column] !== FootValue.LeftHeel &&
        initialState.combinedColumns[column] !== FootValue.LeftToe;
      const switchedRight =
        (currentFoot === FootValue.RightHeel || currentFoot === FootValue.RightToe) &&
        initialState.combinedColumns[column] !== FootValue.RightHeel &&
        initialState.combinedColumns[column] !== FootValue.RightToe;

      if (!switchedLeft && !switchedRight) {
        continue;
      }

      const previousFoot = initialState.whereTheFeetAre[currentFoot];
      const distanceMultiplier = previousFoot === INVALID_COLUMN ? 1 : Math.sqrt(layout.getDistance(previousFoot, column));
      cost += HOLDSWITCH * distanceMultiplier;
    }

    return cost;
  }

  private calcBracketTapCost(
    initialState: State,
    _resultState: State,
    row: Row,
    leftHeel: number,
    leftToe: number,
    rightHeel: number,
    rightToe: number,
    elapsedTime: number,
  ): number {
    if (row.holdMask === 0) {
      return 0;
    }

    let cost = 0;

    if (leftHeel !== INVALID_COLUMN && leftToe !== INVALID_COLUMN) {
      let jackPenalty = 1;
      if (initialState.didTheFootMove[FootValue.LeftHeel] || initialState.didTheFootMove[FootValue.LeftToe]) {
        jackPenalty = 1 / Math.max(elapsedTime, EPSILON);
      }
      if (row.holds[leftHeel].type !== 'empty' && row.holds[leftToe].type === 'empty') {
        cost += BRACKETTAP * jackPenalty;
      }
      if (row.holds[leftToe].type !== 'empty' && row.holds[leftHeel].type === 'empty') {
        cost += BRACKETTAP * jackPenalty;
      }
    }

    if (rightHeel !== INVALID_COLUMN && rightToe !== INVALID_COLUMN) {
      let jackPenalty = 1;
      if (initialState.didTheFootMove[FootValue.RightHeel] || initialState.didTheFootMove[FootValue.RightToe]) {
        jackPenalty = 1 / Math.max(elapsedTime, EPSILON);
      }
      if (row.holds[rightHeel].type !== 'empty' && row.holds[rightToe].type === 'empty') {
        cost += BRACKETTAP * jackPenalty;
      }
      if (row.holds[rightToe].type !== 'empty' && row.holds[rightHeel].type === 'empty') {
        cost += BRACKETTAP * jackPenalty;
      }
    }

    return cost;
  }

  private calcBracketJackCost(resultState: State, movedLeft: boolean, movedRight: boolean, jackedLeft: boolean, jackedRight: boolean, didJump: boolean): number {
    if (movedLeft === movedRight || resultState.holdingMask !== 0 || didJump) {
      return 0;
    }

    let cost = 0;
    if (jackedLeft && resultState.didTheFootMove[FootValue.LeftHeel] && resultState.didTheFootMove[FootValue.LeftToe]) {
      cost += BRACKETJACK;
    }
    if (jackedRight && resultState.didTheFootMove[FootValue.RightHeel] && resultState.didTheFootMove[FootValue.RightToe]) {
      cost += BRACKETJACK;
    }
    return cost;
  }

  private calcDoubleStepCost(
    initialState: State,
    resultState: State,
    rows: Row[],
    rowIndex: number,
    movedLeft: boolean,
    movedRight: boolean,
    jackedLeft: boolean,
    jackedRight: boolean,
    didJump: boolean,
  ): number {
    if (movedLeft === movedRight || resultState.holdingMask !== 0 || didJump) {
      return 0;
    }

    return didDoubleStep(initialState, resultState, rows, rowIndex, movedLeft, jackedLeft, movedRight, jackedRight)
      ? DOUBLESTEP
      : 0;
  }

  private calcPreferredBracketBonus(row: Row, resultState: State): number {
    if (this.config.favorJumpsOverBrackets || row.holdMask !== 0 || row.noteCount !== 2 || !isBracketState(resultState)) {
      return 0;
    }

    const activeColumns = row.notes
      .map((note, index) => (note.type !== 'empty' ? index : INVALID_COLUMN))
      .filter((index) => index !== INVALID_COLUMN);

    if (activeColumns.length !== 2 || !layout.bracketCheck(activeColumns[0] ?? INVALID_COLUMN, activeColumns[1] ?? INVALID_COLUMN)) {
      return 0;
    }

    return -PREFERRED_BRACKET_BONUS;
  }

  private calcSlowBracketCost(row: Row, movedLeft: boolean, movedRight: boolean, elapsedTime: number): number {
    if (elapsedTime <= SLOW_BRACKET_THRESHOLD || movedLeft === movedRight || row.noteCount < 2) {
      return 0;
    }

    const scale = this.config.favorJumpsOverBrackets ? 1 : 0.35;
    return (elapsedTime - SLOW_BRACKET_THRESHOLD) * SLOW_BRACKET * scale;
  }

  private calcTwistedFootCost(resultState: State): number {
    const leftHeel = resultState.whatNoteTheFootIsHitting[FootValue.LeftHeel];
    const leftToe = resultState.whatNoteTheFootIsHitting[FootValue.LeftToe];
    const rightHeel = resultState.whatNoteTheFootIsHitting[FootValue.RightHeel];
    const rightToe = resultState.whatNoteTheFootIsHitting[FootValue.RightToe];
    const leftPosition = layout.averagePoint(leftHeel, leftToe);
    const rightPosition = layout.averagePoint(rightHeel, rightToe);
    const crossedOver = rightPosition.x < leftPosition.x;
    const rightBackwards = rightHeel !== INVALID_COLUMN && rightToe !== INVALID_COLUMN ? layout.columns[rightToe].y < layout.columns[rightHeel].y : false;
    const leftBackwards = leftHeel !== INVALID_COLUMN && leftToe !== INVALID_COLUMN ? layout.columns[leftToe].y < layout.columns[leftHeel].y : false;

    return !crossedOver && (rightBackwards || leftBackwards) ? TWISTED_FOOT : 0;
  }

  private calcMissedFootswitchCost(row: Row, jackedLeft: boolean, jackedRight: boolean): number {
    return (jackedLeft || jackedRight) && row.mineMask !== 0 ? MISSED_FOOTSWITCH : 0;
  }

  private calcFacingCosts(resultState: State): number {
    let endLeftHeel = resultState.whereTheFeetAre[FootValue.LeftHeel];
    let endLeftToe = resultState.whereTheFeetAre[FootValue.LeftToe];
    let endRightHeel = resultState.whereTheFeetAre[FootValue.RightHeel];
    let endRightToe = resultState.whereTheFeetAre[FootValue.RightToe];

    if (endLeftToe === INVALID_COLUMN) {
      endLeftToe = endLeftHeel;
    }
    if (endRightToe === INVALID_COLUMN) {
      endRightToe = endRightHeel;
    }

    return (
      layout.getXFacingPenalty(endLeftHeel, endRightHeel) * FACING +
      layout.getXFacingPenalty(endLeftToe, endRightToe) * FACING +
      layout.getYFacingPenalty(endLeftHeel, endLeftToe) * FACING +
      layout.getYFacingPenalty(endRightHeel, endRightToe) * FACING
    );
  }

  private calcSpinCosts(initialState: State, resultState: State): number {
    let endLeftHeel = resultState.whereTheFeetAre[FootValue.LeftHeel];
    let endLeftToe = resultState.whereTheFeetAre[FootValue.LeftToe];
    let endRightHeel = resultState.whereTheFeetAre[FootValue.RightHeel];
    let endRightToe = resultState.whereTheFeetAre[FootValue.RightToe];

    if (endLeftToe === INVALID_COLUMN) {
      endLeftToe = endLeftHeel;
    }
    if (endRightToe === INVALID_COLUMN) {
      endRightToe = endRightHeel;
    }

    const previousLeftPosition = layout.averagePoint(
      initialState.whereTheFeetAre[FootValue.LeftHeel],
      initialState.whereTheFeetAre[FootValue.LeftToe],
    );
    const previousRightPosition = layout.averagePoint(
      initialState.whereTheFeetAre[FootValue.RightHeel],
      initialState.whereTheFeetAre[FootValue.RightToe],
    );
    const leftPosition = layout.averagePoint(endLeftHeel, endLeftToe);
    const rightPosition = layout.averagePoint(endRightHeel, endRightToe);

    if (
      rightPosition.x < leftPosition.x &&
      previousRightPosition.x < previousLeftPosition.x &&
      rightPosition.y < leftPosition.y &&
      previousRightPosition.y > previousLeftPosition.y
    ) {
      return SPIN;
    }

    if (
      rightPosition.x < leftPosition.x &&
      previousRightPosition.x < previousLeftPosition.x &&
      rightPosition.y > leftPosition.y &&
      previousRightPosition.y < previousLeftPosition.y
    ) {
      return SPIN;
    }

    return 0;
  }

  private calcFootswitchCost(initialState: State, columns: FootValue[], row: Row, elapsedTime: number): number {
    if (!this.config.allowFootswitches) {
      for (let column = 0; column < row.columnCount; column += 1) {
        if (initialState.combinedColumns[column] === FootValue.None || columns[column] === FootValue.None) {
          continue;
        }

        if (
          initialState.combinedColumns[column] !== columns[column] &&
          initialState.combinedColumns[column] !== otherPartOfFoot[columns[column]]
        ) {
          return HARD_DISABLE_PENALTY;
        }
      }
    }

    if (elapsedTime < SLOW_FOOTSWITCH_THRESHOLD || elapsedTime >= SLOW_FOOTSWITCH_IGNORE || row.mineMask !== 0) {
      return 0;
    }

    const timeScaled = elapsedTime - SLOW_FOOTSWITCH_THRESHOLD;
    for (let column = 0; column < row.columnCount; column += 1) {
      if (initialState.combinedColumns[column] === FootValue.None || columns[column] === FootValue.None) {
        continue;
      }

      if (
        initialState.combinedColumns[column] !== columns[column] &&
        initialState.combinedColumns[column] !== otherPartOfFoot[columns[column]]
      ) {
        return (timeScaled / (SLOW_FOOTSWITCH_THRESHOLD + timeScaled)) * FOOTSWITCH;
      }
    }

    return 0;
  }

  private calcSideSwitchCost(initialState: State, resultState: State, columns: FootValue[]): number {
    let cost = 0;
    for (const column of layout.sideArrows) {
      if (
        initialState.combinedColumns[column] !== columns[column] &&
        columns[column] !== FootValue.None &&
        initialState.combinedColumns[column] !== FootValue.None &&
        !resultState.didTheFootMove[initialState.combinedColumns[column]]
      ) {
        cost += SIDESWITCH;
      }
    }
    return cost;
  }

  private calcJackCost(movedLeft: boolean, movedRight: boolean, jackedLeft: boolean, jackedRight: boolean, elapsedTime: number): number {
    if (elapsedTime >= JACK_THRESHOLD || movedLeft === movedRight || (!jackedLeft && !jackedRight)) {
      return 0;
    }

    const timeScaled = Math.max(JACK_THRESHOLD - elapsedTime, EPSILON);
    return (1 / timeScaled - 1 / JACK_THRESHOLD) * JACK;
  }

  private calcBigMovementsQuicklyCost(initialState: State, resultState: State, elapsedTime: number): number {
    let cost = 0;
    const timeScale = Math.max(elapsedTime, EPSILON);

    for (const foot of footValues) {
      if ((resultState.movedMask & footMasks[foot]) === 0) {
        continue;
      }

      const initialPosition = initialState.whereTheFeetAre[foot];
      if (initialPosition === INVALID_COLUMN) {
        continue;
      }

      const resultPosition = resultState.whatNoteTheFootIsHitting[foot];
      const otherPosition = resultState.whatNoteTheFootIsHitting[otherPartOfFoot[foot]];
      const isBracketing = otherPosition !== INVALID_COLUMN;
      if (isBracketing && otherPosition === initialPosition) {
        continue;
      }

      let distanceCost = (layout.getDistance(initialPosition, resultPosition) * DISTANCE) / timeScale;
      if (isBracketing) {
        distanceCost *= 0.2;
      }
      cost += distanceCost;
    }

    return cost;
  }
}

const computeCheapestPath = (endNode: StepParityNode, startNode: StepParityNode): number[] => {
  const bestFinalNode = endNode.previousNode;
  if (!bestFinalNode) {
    return [];
  }

  const path: number[] = [];
  let current: StepParityNode | null = bestFinalNode;

  while (current && current !== startNode) {
    path.push(current.id);
    current = current.previousNode;
  }

  if (!current) {
    return [];
  }

  return path.reverse();
};

const getActiveNoteColumns = (row: Row): number[] =>
  row.notes
    .map((note, index) => (note.type !== 'empty' ? index : INVALID_COLUMN))
    .filter((index) => index !== INVALID_COLUMN);

const getBracketPartsForSideRow = (
  sideColumn: number,
  otherColumn: number,
): { sidePart: FootValue; otherPart: FootValue } | null => {
  const isLeftSide = sideColumn === panelIndexByName.left;
  const isRightSide = sideColumn === panelIndexByName.right;

  if (!isLeftSide && !isRightSide) {
    return null;
  }

  const pairsDown = otherColumn === panelIndexByName.down;
  const pairsUp = otherColumn === panelIndexByName.up;

  if (!pairsDown && !pairsUp) {
    return null;
  }

  if (isLeftSide) {
    return pairsDown
      ? { sidePart: FootValue.LeftToe, otherPart: FootValue.LeftHeel }
      : { sidePart: FootValue.LeftHeel, otherPart: FootValue.LeftToe };
  }

  return pairsDown
    ? { sidePart: FootValue.RightToe, otherPart: FootValue.RightHeel }
    : { sidePart: FootValue.RightHeel, otherPart: FootValue.RightToe };
};

const applySimpleBracketOverrides = (
  rows: Row[],
  diagnostics: ParityRowDiagnostic[],
  config: StepParityConfig,
): ParityRowDiagnostic[] => {
  if (!config.allowBrackets) {
    return diagnostics;
  }

  const diagnosticsByRowIndex = new Map<number, ParityRowDiagnostic>(
    diagnostics.map((diagnostic) => [diagnostic.rowIndex, diagnostic]),
  );

  for (const row of rows) {
    if (row.noteCount !== 2 || row.holdMask !== 0 || row.mineMask !== 0) {
      continue;
    }

    const activeColumns = getActiveNoteColumns(row);
    if (activeColumns.length !== 2 || !layout.bracketCheck(activeColumns[0] ?? INVALID_COLUMN, activeColumns[1] ?? INVALID_COLUMN)) {
      continue;
    }

    const includesLeft = activeColumns.includes(panelIndexByName.left);
    const includesRight = activeColumns.includes(panelIndexByName.right);

    if (includesLeft === includesRight) {
      continue;
    }

    const sideColumn = includesLeft ? panelIndexByName.left : panelIndexByName.right;
    const otherColumn = activeColumns.find((column) => column !== sideColumn);
    if (otherColumn === undefined) {
      continue;
    }

    const sideNote = row.notes[sideColumn];
    const otherNote = row.notes[otherColumn];
    const bracketParts = getBracketPartsForSideRow(sideColumn, otherColumn);

    if (!sideNote || !otherNote || !bracketParts) {
      continue;
    }

    sideNote.parity = bracketParts.sidePart;
    otherNote.parity = bracketParts.otherPart;
    row.columns[sideColumn] = bracketParts.sidePart;
    row.columns[otherColumn] = bracketParts.otherPart;

    const existingDiagnostic = diagnosticsByRowIndex.get(row.rowIndex);
    if (existingDiagnostic) {
      existingDiagnostic.kinds = ['bracket'];
    } else {
      const nextDiagnostic: ParityRowDiagnostic = {
        beat: row.beat,
        rowIndex: row.rowIndex,
        kinds: ['bracket'],
      };
      diagnostics.push(nextDiagnostic);
      diagnosticsByRowIndex.set(row.rowIndex, nextDiagnostic);
    }
  }

  return diagnostics.sort((left, right) => left.rowIndex - right.rowIndex);
};

const analyzeRows = (rows: Row[], config: StepParityConfig): ParityRowDiagnostic[] | null => {
  if (rows.length === 0) {
    return null;
  }

  const costCalculator = new StepParityCostCalculator(config);
  const nodes: StepParityNode[] = [];
  const stateCache = new Map<string, State>();
  const addNode = (state: State, second: number, rowIndex: number): StepParityNode => {
    const node: StepParityNode = {
      id: nodes.length,
      state,
      rowIndex,
      second,
      totalCost: 0,
      previousNode: null,
    };
    nodes.push(node);
    return node;
  };

  const beginningState = createEmptyState();
  const startNode = addNode(beginningState, rows[0].second - 1, -1);
  let previousNodes: StepParityNode[] = [startNode];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const stateMap = new Map<string, StepParityNode>();
    const resultNodes: StepParityNode[] = [];
    const permutations = getFootPlacementPermutations(row);

    for (const initialNode of previousNodes) {
      const elapsedTime = Math.max(row.second - initialNode.second, EPSILON);

      for (const placement of permutations) {
        const resultState = initResultState(initialNode.state, row, placement);
        const cachedState = stateCache.get(getStateKey(resultState)) ?? resultState;
        stateCache.set(getStateKey(cachedState), cachedState);
        const cost = costCalculator.getActionCost(initialNode.state, cachedState, rows, placement, index, elapsedTime);
        const stateKey = getStateKey(cachedState);
        const totalCost = initialNode.totalCost + cost;
        const existingNode = stateMap.get(stateKey);

        if (existingNode) {
          if (totalCost < existingNode.totalCost) {
            existingNode.totalCost = totalCost;
            existingNode.previousNode = initialNode;
          }
          continue;
        }

        const newNode = addNode(cachedState, row.second, index);
        newNode.totalCost = totalCost;
        newNode.previousNode = initialNode;
        stateMap.set(stateKey, newNode);
        resultNodes.push(newNode);
      }
    }

    previousNodes = resultNodes;
    if (previousNodes.length === 0) {
      return null;
    }
  }

  const endingState = createEmptyState();
  const endNode = addNode(endingState, rows.at(-1)?.second ?? 0 + 1, rows.length);
  endNode.totalCost = Number.POSITIVE_INFINITY;

  for (const node of previousNodes) {
    if (node.totalCost < endNode.totalCost) {
      endNode.totalCost = node.totalCost;
      endNode.previousNode = node;
    }
  }

  const path = computeCheapestPath(endNode, startNode);
  if (path.length !== rows.length) {
    return null;
  }

  const diagnostics: ParityRowDiagnostic[] = [];

  path.forEach((nodeId, rowIndex) => {
    const node = nodes[nodeId];
    if (node) {
      setFootPlacement(rows[rowIndex], node.state);
      const previousState = node.previousNode?.state ?? beginningState;
      const elapsedTime = Math.max(rows[rowIndex].second - (node.previousNode?.second ?? startNode.second), EPSILON);
      const kinds = getRowDiagnosticKinds(previousState, node.state, rows, rowIndex, elapsedTime);
      if (kinds.length > 0) {
        diagnostics.push({
          beat: rows[rowIndex].beat,
          rowIndex,
          kinds,
        });
      }
    }
  });

  return applySimpleBracketOverrides(rows, diagnostics, config);
};

export const buildParityAssignmentMap = (
  events: TimedNoteEvent[],
  holdEndBeatMap: Map<string, number>,
  simfile: SimfileDocument,
  config: Partial<StepParityConfig> = {},
): ParityAssignmentResult => {
  const mergedConfig: StepParityConfig = {
    ...defaultStepParityConfig,
    ...config,
  };
  const rows = buildRows(events, holdEndBeatMap, simfile);
  const assignments = new Map<string, ParityFootPart>();
  const diagnostics = analyzeRows(rows, mergedConfig);

  if (!diagnostics) {
    return { assignments, diagnostics: [], rowCount: rows.length };
  }

  for (const row of rows) {
    for (const note of row.notes) {
      if (!note.key) {
        continue;
      }

      const footPart = toFootPart(note.parity);
      if (footPart) {
        assignments.set(note.key, footPart);
      }
    }
  }

  return { assignments, diagnostics, rowCount: rows.length };
};
