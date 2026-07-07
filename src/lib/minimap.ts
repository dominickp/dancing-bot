import type { TimedNoteEvent } from "./simfile";

export interface MinimapRow {
  beat: number;
  noteCount: number;
  density: number;
  quantizationKind: MinimapQuantizationKind;
  quantizationColor: string;
}

export interface MinimapHoldBand {
  startBeat: number;
  endBeat: number;
  intensity: number;
  kind: "hold" | "roll";
}

export interface MinimapHoldSource {
  startBeat: number;
  endBeat: number;
  kind: "hold" | "roll";
}

export type MinimapQuantizationKind =
  | "quarter"
  | "eighth"
  | "twelfth"
  | "sixteenth"
  | "twentyFourth"
  | "fortyEighth";

export interface MinimapQuantizationSlice {
  kind: MinimapQuantizationKind;
  count: number;
  ratio: number;
  color: string;
}

export interface MinimapQuantizationSegment {
  startBeat: number;
  endBeat: number;
  slices: MinimapQuantizationSlice[];
  dominantKind: MinimapQuantizationKind;
}

const ticksPerBeat = 192;
const quantizationColors: Record<MinimapQuantizationKind, string> = {
  quarter: "#ff5d73",
  eighth: "#51a8ff",
  twelfth: "#d08cff",
  sixteenth: "#63d17c",
  twentyFourth: "#efd166",
  fortyEighth: "#63e6d8",
};

const quantizationKindOrder: MinimapQuantizationKind[] = [
  "quarter",
  "eighth",
  "twelfth",
  "sixteenth",
  "twentyFourth",
  "fortyEighth",
];
const defaultMaxMinimapRows = 900;

const getBeatKey = (beat: number): string => beat.toFixed(6);

const getEventWeight = (event: TimedNoteEvent): number => {
  switch (event.kind) {
    case "hold-head":
      return 1.15;
    case "roll-head":
      return 1.25;
    case "mine":
      return 0.9;
    case "tap":
    default:
      return 1;
  }
};

export const getMinimapQuantizationKind = (
  beat: number,
): MinimapQuantizationKind => {
  const tick =
    ((Math.round(beat * ticksPerBeat) % ticksPerBeat) + ticksPerBeat) %
    ticksPerBeat;

  if (tick === 0) {
    return "quarter";
  }

  if (tick % 96 === 0) {
    return "eighth";
  }

  if (tick % 64 === 0) {
    return "twelfth";
  }

  if (tick % 48 === 0) {
    return "sixteenth";
  }

  if (tick % 32 === 0) {
    return "twentyFourth";
  }

  if (tick % 16 === 0) {
    return "fortyEighth";
  }

  return "twelfth";
};

export const buildMinimapRows = (events: TimedNoteEvent[]): MinimapRow[] => {
  const groupedRows = new Map<
    string,
    { beat: number; noteCount: number; weightedCount: number }
  >();
  const localWindowBeats = 1;

  for (const event of events) {
    if (event.kind === "hold-tail") {
      continue;
    }

    const key = getBeatKey(event.beat);
    const existing = groupedRows.get(key);

    if (existing) {
      existing.noteCount += 1;
      existing.weightedCount += getEventWeight(event);
      continue;
    }

    groupedRows.set(key, {
      beat: event.beat,
      noteCount: 1,
      weightedCount: getEventWeight(event),
    });
  }

  const sortedRows = Array.from(groupedRows.values()).sort(
    (left, right) => left.beat - right.beat,
  );
  const localWeightedCounts = new Array<number>(sortedRows.length).fill(0);
  let windowStartIndex = 0;
  let windowEndIndex = 0;
  let windowWeightedTotal = 0;

  for (let index = 0; index < sortedRows.length; index += 1) {
    const windowStartBeat = sortedRows[index]!.beat - localWindowBeats / 2;
    const windowEndBeat = sortedRows[index]!.beat + localWindowBeats / 2;

    while (
      windowStartIndex < sortedRows.length &&
      sortedRows[windowStartIndex]!.beat < windowStartBeat
    ) {
      windowWeightedTotal -= sortedRows[windowStartIndex]!.weightedCount;
      windowStartIndex += 1;
    }

    while (
      windowEndIndex < sortedRows.length &&
      sortedRows[windowEndIndex]!.beat <= windowEndBeat
    ) {
      windowWeightedTotal += sortedRows[windowEndIndex]!.weightedCount;
      windowEndIndex += 1;
    }

    localWeightedCounts[index] = windowWeightedTotal;
  }

  const maxLocalWeightedCount = Math.max(...localWeightedCounts, 1);

  const rows = sortedRows.map((row, index) => {
    const localDensity = localWeightedCounts[index]! / maxLocalWeightedCount;
    const quantizationKind = getMinimapQuantizationKind(row.beat);

    return {
      beat: row.beat,
      noteCount: row.noteCount,
      density: localDensity,
      quantizationKind,
      quantizationColor: quantizationColors[quantizationKind],
    };
  });

  if (rows.length <= defaultMaxMinimapRows) {
    return rows;
  }

  const lastBeat = rows[rows.length - 1]!.beat;
  const bucketBeatSpan = Math.max(
    lastBeat / Math.max(defaultMaxMinimapRows - 1, 1),
    0.25,
  );
  const compressedRows: MinimapRow[] = [];
  let bucketStartBeat = 0;
  let bucketRows: MinimapRow[] = [];

  const flushBucket = () => {
    if (bucketRows.length === 0) {
      return;
    }

    const representativeRow = bucketRows.reduce((best, row) => {
      if (row.density === best.density) {
        return row.noteCount > best.noteCount ? row : best;
      }

      return row.density > best.density ? row : best;
    }, bucketRows[0]!);

    const noteCount = bucketRows.reduce(
      (maxCount, row) => Math.max(maxCount, row.noteCount),
      representativeRow.noteCount,
    );
    const density = bucketRows.reduce(
      (maxDensity, row) => Math.max(maxDensity, row.density),
      representativeRow.density,
    );

    compressedRows.push({
      ...representativeRow,
      beat: bucketStartBeat,
      noteCount,
      density,
    });
  };

  for (const row of rows) {
    if (row.beat >= bucketStartBeat + bucketBeatSpan) {
      flushBucket();
      bucketRows = [];
      bucketStartBeat = Math.floor(row.beat / bucketBeatSpan) * bucketBeatSpan;
    }

    bucketRows.push(row);
  }

  flushBucket();

  return compressedRows;
};

export const buildMinimapHoldBands = (
  segments: MinimapHoldSource[],
): MinimapHoldBand[] =>
  segments
    .filter((segment) => segment.endBeat > segment.startBeat)
    .map((segment) => ({
      startBeat: segment.startBeat,
      endBeat: segment.endBeat,
      kind: segment.kind,
      intensity: segment.kind === "roll" ? 0.58 : 0.42,
    }));

export const buildMinimapQuantizationSegments = (
  events: TimedNoteEvent[],
  totalChartBeats: number,
  segmentBeatSize = 2,
): MinimapQuantizationSegment[] => {
  const sanitizedSegmentBeatSize = Math.max(segmentBeatSize, 0.25);
  const segmentCount = Math.max(
    Math.ceil(totalChartBeats / sanitizedSegmentBeatSize),
    1,
  );
  const segments = Array.from({ length: segmentCount }, (_, index) => ({
    startBeat: index * sanitizedSegmentBeatSize,
    endBeat: Math.min((index + 1) * sanitizedSegmentBeatSize, totalChartBeats),
    counts: new Map<MinimapQuantizationKind, number>(),
  }));

  for (const event of events) {
    if (event.kind === "hold-tail") {
      continue;
    }

    const segmentIndex = Math.min(
      Math.floor(event.beat / sanitizedSegmentBeatSize),
      segments.length - 1,
    );
    const segment = segments[segmentIndex];
    const kind = getMinimapQuantizationKind(event.beat);

    segment.counts.set(kind, (segment.counts.get(kind) ?? 0) + 1);
  }

  return segments.flatMap((segment) => {
    const totalCount = Array.from(segment.counts.values()).reduce(
      (sum, count) => sum + count,
      0,
    );

    if (totalCount === 0 || segment.endBeat <= segment.startBeat) {
      return [];
    }

    const slices = quantizationKindOrder
      .map((kind) => ({ kind, count: segment.counts.get(kind) ?? 0 }))
      .filter((slice) => slice.count > 0)
      .map((slice) => ({
        ...slice,
        ratio: slice.count / totalCount,
        color: quantizationColors[slice.kind],
      }));

    const dominantKind = slices.reduce(
      (best, slice) => (slice.count > best.count ? slice : best),
      slices[0]!,
    ).kind;

    return [
      {
        startBeat: segment.startBeat,
        endBeat: segment.endBeat,
        slices,
        dominantKind,
      },
    ];
  });
};
