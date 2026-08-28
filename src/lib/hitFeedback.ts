import type { Panel, TimedNoteEvent } from "./simfile";

const hitWindowBeats = 0.18;
const rollRetriggerBeats = 0.5;

const getAssistTickKey = (event: TimedNoteEvent): string =>
  event.beat.toFixed(6);

export const buildAssistHitEvents = (
  events: TimedNoteEvent[],
): TimedNoteEvent[] => {
  const rollHeads = new Map<Panel, TimedNoteEvent>();
  const assistHits = events.filter(
    (event) => event.kind !== "hold-tail" && event.kind !== "mine",
  );

  for (const event of events) {
    if (event.kind === "roll-head") {
      rollHeads.set(event.panel, event);
      continue;
    }

    if (event.kind !== "hold-tail") {
      continue;
    }

    const rollHead = rollHeads.get(event.panel);

    if (!rollHead) {
      continue;
    }

    for (
      let beat = rollHead.beat + rollRetriggerBeats;
      beat < event.beat - 0.000001;
      beat += rollRetriggerBeats
    ) {
      assistHits.push({ ...rollHead, beat });
    }

    if (event.beat > rollHead.beat) {
      assistHits.push({ ...rollHead, beat: event.beat });
    }

    rollHeads.delete(event.panel);
  }

  return assistHits.sort((left, right) => left.beat - right.beat);
};

const findFirstEventAtOrAfter = (
  events: TimedNoteEvent[],
  beat: number,
): number => {
  let low = 0;
  let high = events.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);

    if (events[middle].beat < beat) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
};

export interface HitFeedbackTrigger {
  event: TimedNoteEvent;
  isJump: boolean;
}

export class HitFeedbackTracker {
  private readonly assistRowNoteCounts = new Map<string, number>();
  private readonly triggeredHitKeys = new Map<string, number>();

  constructor(private readonly events: TimedNoteEvent[]) {
    for (const event of events) {
      if (event.kind !== "mine") {
        const tickKey = getAssistTickKey(event);
        this.assistRowNoteCounts.set(
          tickKey,
          (this.assistRowNoteCounts.get(tickKey) ?? 0) + 1,
        );
      }
    }
  }

  reset(): void {
    this.triggeredHitKeys.clear();
  }

  advance(previousBeat: number, nextBeat: number): HitFeedbackTrigger[] {
    const minBeat = Math.min(previousBeat, nextBeat) - hitWindowBeats * 0.35;
    const maxBeat = Math.max(previousBeat, nextBeat) + hitWindowBeats * 0.35;
    const triggers: HitFeedbackTrigger[] = [];

    for (
      let eventIndex = findFirstEventAtOrAfter(this.events, minBeat);
      eventIndex < this.events.length && this.events[eventIndex].beat <= maxBeat;
      eventIndex += 1
    ) {
      const event = this.events[eventIndex];
      const hitKey = `${event.panel}-${event.beat.toFixed(6)}-${event.kind}`;

      if (this.triggeredHitKeys.has(hitKey)) {
        continue;
      }

      this.triggeredHitKeys.set(hitKey, event.beat);
      triggers.push({
        event,
        isJump: (this.assistRowNoteCounts.get(getAssistTickKey(event)) ?? 0) > 1,
      });
    }

    for (const [hitKey, beat] of this.triggeredHitKeys) {
      if (beat < nextBeat - hitWindowBeats * 2) {
        this.triggeredHitKeys.delete(hitKey);
      }
    }

    return triggers;
  }
}