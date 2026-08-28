import { bench, describe } from "vitest";
import { buildBotTimeline, sampleBotStateAtBeat } from "../components/DancingBotWindow";
import { buildTimedChart, parseSimfile, beatToSeconds } from "./simfile";
import type { TimedNoteEvent } from "./simfile";
import { buildParityAssignmentMap } from "./parity";
import bossySimfileText from "../../example-simfiles/BOSSY (Jorts Speedy Mix)/bossyremix.ssc?raw";
import groovySimfileText from "../../example-simfiles/Groovy Rollercoaster Acid Trip/Groovy Rollercoaster Acid Trip.sm?raw";

/**
 * Benchmarks for the hot paths that run during play / pause on a chart.
 *
 * Run with:  npx vitest bench
 *
 * What each group models:
 *  - "startup": the one-time work when a chart is (re)built — buildBotTimeline
 *    and buildParityAssignmentMap. This is the blocking cost a user feels when
 *    selecting a song or toggling behavior options.
 *  - "per-frame": the work done every animation frame while playing. The bot
 *    samples its pose (sampleBotStateAtBeat) and the notefield scans all events
 *    for hit feedback (updateHitFeedback in useChartPlayback). On a complex
 *    chart with thousands of notes this per-frame cost is what low-end systems
 *    feel as shudder during play.
 *  - "play burst": a realistic slice of consecutive frames right after pressing
 *    play, capturing the sustained per-frame cost rather than a single sample.
 */

const parityConfig = {
  allowCrossovers: true,
  allowBrackets: true,
  allowFootswitches: true,
  favorJumpsOverBrackets: false,
};

const loadChart = (source: string) => {
  const simfile = parseSimfile(source);
  // Use the hardest (last) chart, which is typically the most complex.
  const chart = simfile.charts[simfile.charts.length - 1];
  const timedChart = buildTimedChart(simfile, chart);
  return { simfile, timedChart };
};

const bossy = loadChart(bossySimfileText);
const groovy = loadChart(groovySimfileText);

const holdEndBeatMap = new Map<string, number>();

// Pre-build timelines for the per-frame benchmarks.
const bossyTimeline = buildBotTimeline(bossy.timedChart.events, holdEndBeatMap, bossy.simfile, parityConfig);
const groovyTimeline = buildBotTimeline(groovy.timedChart.events, holdEndBeatMap, groovy.simfile, parityConfig);

/**
 * Faithfully replicates the per-frame hit-feedback scan from useChartPlayback
 * (updateHitFeedback). It loops over every event twice per frame, so its cost
 * grows linearly with the number of notes in the chart.
 */
const makeHitFeedbackScanner = (events: TimedNoteEvent[]) => {
  const hitWindowBeats = 0.18;
  const triggered = new Set<string>();
  const onTrigger = (_event: TimedNoteEvent) => {};
  return (previousBeat: number, nextBeat: number) => {
    const minBeat = Math.min(previousBeat, nextBeat) - hitWindowBeats * 0.35;
    const maxBeat = Math.max(previousBeat, nextBeat) + hitWindowBeats * 0.35;

    for (const event of events) {
      if (event.kind === "hold-tail" || event.beat < minBeat || event.beat > maxBeat) {
        continue;
      }
      const hitKey = `${event.panel}-${event.measureIndex}-${event.rowIndex}-${event.kind}`;
      if (triggered.has(hitKey)) {
        continue;
      }
      triggered.add(hitKey);
      onTrigger(event);
    }

    for (const event of events) {
      if (event.beat < nextBeat - 2 || event.beat > nextBeat + 2) {
        continue;
      }
      const hitKey = `${event.panel}-${event.measureIndex}-${event.rowIndex}-${event.kind}`;
      if (event.beat < nextBeat - hitWindowBeats * 2) {
        triggered.delete(hitKey);
      }
    }
  };
};

describe("startup (chart build)", () => {
  bench("buildBotTimeline — complex (BOSSY)", () => {
    buildBotTimeline(bossy.timedChart.events, holdEndBeatMap, bossy.simfile, parityConfig);
  });

  bench("buildParityAssignmentMap — complex (BOSSY)", () => {
    buildParityAssignmentMap(bossy.timedChart.events, holdEndBeatMap, bossy.simfile, parityConfig);
  });

  bench("buildBotTimeline — simple (Groovy)", () => {
    buildBotTimeline(groovy.timedChart.events, holdEndBeatMap, groovy.simfile, parityConfig);
  });
});

describe("per-frame sampling (single frame)", () => {
  bench("sampleBotStateAtBeat — complex (BOSSY)", () => {
    sampleBotStateAtBeat(bossyTimeline, bossy.simfile, 120);
  });

  bench("sampleBotStateAtBeat — simple (Groovy)", () => {
    sampleBotStateAtBeat(groovyTimeline, groovy.simfile, 120);
  });

  bench("hit-feedback scan — complex (BOSSY)", () => {
    const scan = makeHitFeedbackScanner(bossy.timedChart.events);
    scan(119.9, 120);
  });

  bench("hit-feedback scan — simple (Groovy)", () => {
    const scan = makeHitFeedbackScanner(groovy.timedChart.events);
    scan(119.9, 120);
  });
});

describe("play burst (sustained frames after pressing play)", () => {
  // Simulate 5 seconds of 60fps playback (300 frames) on the complex chart,
  // combining bot sampling + hit-feedback scan like the real render loop does.
  bench("300-frame play burst — complex (BOSSY)", () => {
    const scan = makeHitFeedbackScanner(bossy.timedChart.events);
    const secondsPerBeat = 60 / 170; // approximate; only used to advance the clock
    let acc = 0;
    for (let frame = 0; frame < 300; frame++) {
      const beat = 100 + frame * (1 / 60) / secondsPerBeat;
      const state = sampleBotStateAtBeat(bossyTimeline, bossy.simfile, beat);
      scan(beat - 0.05, beat);
      acc += state.feet.left.x;
    }
    if (Number.isNaN(acc)) throw new Error("unreachable");
  });
});

// Reference the converter so tree-shaken builds keep parity with runtime.
void beatToSeconds;
