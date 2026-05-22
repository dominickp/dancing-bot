export type Panel = "left" | "down" | "up" | "right";

export interface SimfileMetadata {
  title: string;
  subtitle: string;
  artist: string;
  credit: string;
  music: string;
  offset: number;
}

export interface BpmSegment {
  beat: number;
  bpm: number;
}

export interface StopSegment {
  beat: number;
  durationSeconds: number;
}

export interface ParsedMeasure {
  index: number;
  rows: string[];
}

export interface ChartSummary {
  totalMeasures: number;
  totalRows: number;
  tapRows: number;
  holdRows: number;
  mineRows: number;
}

export interface SimfileChart {
  stepType: string;
  description: string;
  difficulty: string;
  meter: number;
  radarValues: number[];
  measures: ParsedMeasure[];
  summary: ChartSummary;
}

export interface SimfileDocument {
  metadata: SimfileMetadata;
  bpms: BpmSegment[];
  stops: StopSegment[];
  charts: SimfileChart[];
}

export type NoteKind = "tap" | "hold-head" | "hold-tail" | "roll-head" | "mine";

export interface TimedNoteEvent {
  beat: number;
  timeSeconds: number;
  panel: Panel;
  kind: NoteKind;
  measureIndex: number;
  rowIndex: number;
  rowCount: number;
}

export interface TimedChart {
  events: TimedNoteEvent[];
  lastBeat: number;
  lastTimeSeconds: number;
}

const PANELS: Panel[] = ["left", "down", "up", "right"];

const parseTagMap = (source: string): Map<string, string[]> => {
  const tags = new Map<string, string[]>();
  const tagPattern = /#([A-Z0-9]+):([\s\S]*?);/g;

  for (const match of source.matchAll(tagPattern)) {
    const [, key, value] = match;
    const normalizedKey = key.trim().toUpperCase();
    const currentValues = tags.get(normalizedKey) ?? [];
    currentValues.push(value);
    tags.set(normalizedKey, currentValues);
  }

  return tags;
};

const getFirstTagValue = (tags: Map<string, string[]>, key: string): string => {
  return tags.get(key)?.[0]?.trim() ?? "";
};

const parseBpms = (rawBpms: string): BpmSegment[] => {
  if (!rawBpms) {
    return [];
  }

  return rawBpms
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      const [beatText, bpmText] = segment.split("=");

      return {
        beat: Number.parseFloat(beatText),
        bpm: Number.parseFloat(bpmText),
      };
    })
    .filter(
      (segment) =>
        Number.isFinite(segment.beat) && Number.isFinite(segment.bpm),
    )
    .sort((left, right) => left.beat - right.beat);
};

const parseStops = (rawStops: string): StopSegment[] => {
  if (!rawStops) {
    return [];
  }

  return rawStops
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      const [beatText, durationText] = segment.split("=");

      return {
        beat: Number.parseFloat(beatText),
        durationSeconds: Number.parseFloat(durationText),
      };
    })
    .filter(
      (segment) =>
        Number.isFinite(segment.beat) &&
        Number.isFinite(segment.durationSeconds) &&
        segment.durationSeconds !== 0,
    )
    .sort((left, right) => left.beat - right.beat);
};

const summarizeMeasures = (measures: ParsedMeasure[]): ChartSummary => {
  let totalRows = 0;
  let tapRows = 0;
  let holdRows = 0;
  let mineRows = 0;

  for (const measure of measures) {
    totalRows += measure.rows.length;

    for (const row of measure.rows) {
      if (/[124]/.test(row)) {
        tapRows += 1;
      }

      if (/[23]/.test(row)) {
        holdRows += 1;
      }

      if (/M/i.test(row)) {
        mineRows += 1;
      }
    }
  }

  return {
    totalMeasures: measures.length,
    totalRows,
    tapRows,
    holdRows,
    mineRows,
  };
};

const parseMeasureBlock = (rawNotes: string): ParsedMeasure[] => {
  return rawNotes
    .split(",")
    .map((measure, index) => ({
      index,
      rows: measure
        .split(/\r?\n/)
        .map((row) => row.trim())
        .filter((row) => row.length > 0 && !row.startsWith("//")),
    }))
    .filter((measure) => measure.rows.length > 0);
};

const parseChart = (rawChart: string): SimfileChart => {
  const sections = rawChart
    .split(":")
    .map((section) => section.trim())
    .filter((section) => section.length > 0);

  const [
    stepType = "",
    description = "",
    difficulty = "",
    meterText = "0",
    radarText = "",
    ...noteParts
  ] = sections;
  const noteData = noteParts.join(":");
  const measures = parseMeasureBlock(noteData);

  return {
    stepType,
    description,
    difficulty,
    meter: Number.parseInt(meterText, 10) || 0,
    radarValues: radarText
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => Number.parseFloat(value))
      .filter((value) => Number.isFinite(value)),
    measures,
    summary: summarizeMeasures(measures),
  };
};

export const parseSmSimfile = (source: string): SimfileDocument => {
  const tags = parseTagMap(source);
  const charts = (tags.get("NOTES") ?? []).map(parseChart);

  return {
    metadata: {
      title: getFirstTagValue(tags, "TITLE"),
      subtitle: getFirstTagValue(tags, "SUBTITLE"),
      artist: getFirstTagValue(tags, "ARTIST"),
      credit: getFirstTagValue(tags, "CREDIT"),
      music: getFirstTagValue(tags, "MUSIC"),
      offset: Number.parseFloat(getFirstTagValue(tags, "OFFSET")) || 0,
    },
    bpms: parseBpms(getFirstTagValue(tags, "BPMS")),
    stops: parseStops(getFirstTagValue(tags, "STOPS")),
    charts,
  };
};

const getBpmAtBeat = (beat: number, bpms: BpmSegment[]): number => {
  if (bpms.length === 0) {
    return 60;
  }

  let currentBpm = bpms[0].bpm;

  for (const segment of bpms) {
    if (segment.beat > beat) {
      break;
    }

    currentBpm = segment.bpm;
  }

  return currentBpm;
};

export const beatToSeconds = (
  beat: number,
  bpms: BpmSegment[],
  stops: StopSegment[] = [],
  offset = 0,
): number => {
  if (beat <= 0) {
    return -offset;
  }

  const orderedBpms = bpms.length > 0 ? bpms : [{ beat: 0, bpm: 60 }];
  let totalSeconds = 0;
  let cursorBeat = 0;
  let bpmIndex = 0;

  while (
    bpmIndex + 1 < orderedBpms.length &&
    orderedBpms[bpmIndex + 1].beat <= 0
  ) {
    bpmIndex += 1;
  }

  while (bpmIndex < orderedBpms.length) {
    const currentBpm = orderedBpms[bpmIndex].bpm;
    const nextBeat =
      orderedBpms[bpmIndex + 1]?.beat ?? Number.POSITIVE_INFINITY;
    const segmentEndBeat = Math.min(beat, nextBeat);

    if (segmentEndBeat > cursorBeat) {
      totalSeconds += ((segmentEndBeat - cursorBeat) * 60) / currentBpm;

      for (const stop of stops) {
        if (stop.beat > cursorBeat && stop.beat < segmentEndBeat) {
          totalSeconds += stop.durationSeconds;
        }
      }
    }

    if (segmentEndBeat >= beat) {
      break;
    }

    cursorBeat = nextBeat;
    bpmIndex += 1;
  }

  return totalSeconds - offset;
};

export const secondsToBeat = (
  timeSeconds: number,
  bpms: BpmSegment[],
  stops: StopSegment[] = [],
  offset = 0,
): number => {
  const targetTime = Math.max(timeSeconds, -offset);

  if (targetTime <= -offset) {
    return 0;
  }

  let lowBeat = 0;
  let highBeat = Math.max(bpms.at(-1)?.beat ?? 4, 4);

  while (beatToSeconds(highBeat, bpms, stops, offset) < targetTime) {
    highBeat *= 2;

    if (highBeat > 100000) {
      break;
    }
  }

  for (let iteration = 0; iteration < 32; iteration += 1) {
    const midBeat = (lowBeat + highBeat) / 2;
    const midTime = beatToSeconds(midBeat, bpms, stops, offset);

    if (midTime < targetTime) {
      lowBeat = midBeat;
    } else {
      highBeat = midBeat;
    }
  }

  return (lowBeat + highBeat) / 2;
};

const getNoteKind = (value: string): NoteKind | null => {
  switch (value) {
    case "1":
      return "tap";
    case "2":
      return "hold-head";
    case "3":
      return "hold-tail";
    case "4":
      return "roll-head";
    case "M":
      return "mine";
    default:
      return null;
  }
};

export const buildTimedChart = (
  document: SimfileDocument,
  chart: SimfileChart,
): TimedChart => {
  const events: TimedNoteEvent[] = [];

  for (const measure of chart.measures) {
    const rowCount = measure.rows.length;

    measure.rows.forEach((row, rowIndex) => {
      const beat = measure.index * 4 + (rowIndex * 4) / rowCount;
      const timeSeconds = beatToSeconds(
        beat,
        document.bpms,
        document.stops,
        document.metadata.offset,
      );

      row
        .split("")
        .slice(0, PANELS.length)
        .forEach((value, panelIndex) => {
          const kind = getNoteKind(value.toUpperCase());

          if (!kind) {
            return;
          }

          events.push({
            beat,
            timeSeconds,
            panel: PANELS[panelIndex],
            kind,
            measureIndex: measure.index,
            rowIndex,
            rowCount,
          });
        });
    });
  }

  const lastEvent = events.at(-1);

  return {
    events,
    lastBeat: lastEvent?.beat ?? 0,
    lastTimeSeconds: lastEvent?.timeSeconds ?? 0,
  };
};

export const getSecondsPerBeat = (beat: number, bpms: BpmSegment[]): number => {
  const bpm = getBpmAtBeat(beat, bpms);
  return 60 / bpm;
};
