import { bench, describe } from "vitest";
import { buildBotTimeline, sampleBotStateAtBeat } from "../components/DancingBotWindow";
import { buildTimedChart, parseSmSimfile, beatToSeconds } from "./simfile";
import { buildParityAssignmentMap } from "./parity";
import sampleSimfileText from "../../example-simfiles/Groovy Rollercoaster Acid Trip/Groovy Rollercoaster Acid Trip.sm?raw";

/**
 * Benchmarks for the two hot paths that run during playback:
 *  - buildBotTimeline: runs once per chart/config change (playback start).
 *  - sampleBotStateAtBeat: conceptually runs every animation frame while the
 *    song plays (the DancingBotWindow rAF loop). This is the per-frame cost
 *    that low-end systems feel as shudder/lag.
 *
 * Run with:  npx vitest bench
 */

const simfile = parseSmSimfile(sampleSimfileText);
const chart = simfile.charts[0];
const timedChart = buildTimedChart(simfile, chart);
const holdEndBeatMap = new Map<string, number>();
const parityConfig = {
  allowCrossovers: true,
  allowBrackets: true,
  allowFootswitches: true,
  favorJumpsOverBrackets: false,
};

// Pre-build once for the per-frame sampling benchmark.
const botTimeline = buildBotTimeline(timedChart.events, holdEndBeatMap, simfile, parityConfig);

describe("playback hot paths", () => {
  bench("buildBotTimeline (startup, once)", () => {
    buildBotTimeline(timedChart.events, holdEndBeatMap, simfile, parityConfig);
  });

  bench("buildParityAssignmentMap (startup, once)", () => {
    buildParityAssignmentMap(timedChart.events, holdEndBeatMap, simfile, parityConfig);
  });

  bench("sampleBotStateAtBeat (per-frame, ~60fps during play)", () => {
    // Simulate sampling across the whole chart at 60fps granularity.
    const seconds = timedChart.lastTimeSeconds;
    const step = 1 / 60;
    let acc = 0;
    for (let t = 0; t < Math.min(seconds, 30); t += step) {
      const beat = (t / seconds) * timedChart.lastBeat;
      const state = sampleBotStateAtBeat(botTimeline, simfile, beat);
      acc += state.feet.left.x + state.feet.right.x;
    }
    if (acc === Number.NaN) throw new Error("unreachable");
  });
});

// Reference the converter so tree-shaken builds keep parity with runtime.
void beatToSeconds;
