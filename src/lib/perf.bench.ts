import { bench, describe } from "vitest";
import { buildBotTimeline, sampleBotStateAtBeat } from "../components/DancingBotWindow";
import { buildAssistHitEvents, HitFeedbackTracker } from "./hitFeedback";
import { buildTimedChart, parseSimfile, beatToSeconds } from "./simfile";
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
 *    samples its pose (sampleBotStateAtBeat) and the production hit-feedback
 *    tracker scans events. On a complex
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

const buildHoldEndBeatMap = (
  events: ReturnType<typeof buildTimedChart>["events"],
): Map<string, number> => {
  const activeHeads = new Map<string, number>();
  const holdEndBeats = new Map<string, number>();

  for (const event of events) {
    const key = `${event.panel}:${event.beat.toFixed(6)}`;

    if (event.kind === "hold-head" || event.kind === "roll-head") {
      activeHeads.set(event.panel, event.beat);
    } else if (event.kind === "hold-tail") {
      const startBeat = activeHeads.get(event.panel);

      if (startBeat !== undefined) {
        holdEndBeats.set(`${event.panel}:${startBeat.toFixed(6)}`, event.beat);
        activeHeads.delete(event.panel);
      }
    }
  }

  return holdEndBeats;
};

// Pre-build timelines for the per-frame benchmarks.
const bossyHoldEndBeatMap = buildHoldEndBeatMap(bossy.timedChart.events);
const groovyHoldEndBeatMap = buildHoldEndBeatMap(groovy.timedChart.events);
const bossyTimeline = buildBotTimeline(bossy.timedChart.events, bossyHoldEndBeatMap, bossy.simfile, parityConfig);
const groovyTimeline = buildBotTimeline(groovy.timedChart.events, groovyHoldEndBeatMap, groovy.simfile, parityConfig);
const bossyHitEvents = buildAssistHitEvents(bossy.timedChart.events);
const groovyHitEvents = buildAssistHitEvents(groovy.timedChart.events);

describe("startup (chart build)", () => {
  bench(`buildBotTimeline — BOSSY (${bossy.timedChart.events.length} events)`, () => {
    buildBotTimeline(bossy.timedChart.events, bossyHoldEndBeatMap, bossy.simfile, parityConfig);
  });

  bench(`buildParityAssignmentMap — BOSSY (${bossy.timedChart.events.length} events)`, () => {
    buildParityAssignmentMap(bossy.timedChart.events, bossyHoldEndBeatMap, bossy.simfile, parityConfig);
  });

  bench(`buildBotTimeline — Groovy (${groovy.timedChart.events.length} events)`, () => {
    buildBotTimeline(groovy.timedChart.events, groovyHoldEndBeatMap, groovy.simfile, parityConfig);
  });
});

describe("per-frame sampling (single frame)", () => {
  bench("sampleBotStateAtBeat — BOSSY", () => {
    sampleBotStateAtBeat(bossyTimeline, bossy.simfile, 120);
  });

  bench("sampleBotStateAtBeat — Groovy", () => {
    sampleBotStateAtBeat(groovyTimeline, groovy.simfile, 120);
  });

  bench("HitFeedbackTracker.advance — BOSSY", () => {
    const tracker = new HitFeedbackTracker(bossyHitEvents);
    tracker.advance(119.9, 120);
  });

  bench("HitFeedbackTracker.advance — Groovy", () => {
    const tracker = new HitFeedbackTracker(groovyHitEvents);
    tracker.advance(119.9, 120);
  });
});

describe("play burst (sustained frames after pressing play)", () => {
  // Simulate 5 seconds of 60fps playback (300 frames) on the complex chart,
  // combining bot sampling + hit-feedback scan like the real render loop does.
  bench("300-frame play burst — BOSSY", () => {
    const tracker = new HitFeedbackTracker(bossyHitEvents);
    const secondsPerBeat = 60 / 170; // approximate; only used to advance the clock
    let acc = 0;
    for (let frame = 0; frame < 300; frame++) {
      const beat = 100 + frame * (1 / 60) / secondsPerBeat;
      const state = sampleBotStateAtBeat(bossyTimeline, bossy.simfile, beat);
      tracker.advance(beat - 0.05, beat);
      acc += state.feet.left.x;
    }
    if (Number.isNaN(acc)) throw new Error("unreachable");
  });

  bench("300-frame play burst — Groovy", () => {
    const tracker = new HitFeedbackTracker(groovyHitEvents);
    const secondsPerBeat = 60 / 170;
    let acc = 0;
    for (let frame = 0; frame < 300; frame++) {
      const beat = 100 + frame * (1 / 60) / secondsPerBeat;
      const state = sampleBotStateAtBeat(groovyTimeline, groovy.simfile, beat);
      tracker.advance(beat - 0.05, beat);
      acc += state.feet.left.x;
    }
    if (Number.isNaN(acc)) throw new Error("unreachable");
  });
});

// Reference the converter so tree-shaken builds keep parity with runtime.
void beatToSeconds;
