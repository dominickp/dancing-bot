import { describe, expect, it } from "vitest";
import chiaroscuroSource from "../../example-simfiles/Chiaroscuro/Chiaroscuro.sm?raw";
import ferrariSource from "../../example-simfiles/Ferrari/Ferrari.sm?raw";
import {
  buildTimedChart,
  parseSimfile,
  secondsToBeat,
  type Panel,
  type TimedNoteEvent,
} from "../lib/simfile";
import { buildBotTimeline, sampleBotStateAtBeat } from "./DancingBotWindow";
import { buildSteppingScenario } from "../test/steppingScenario";

const panelSymbols = ["L", "D", "U", "R"];

const buildHoldEndBeatMap = (
  events: readonly TimedNoteEvent[],
): Map<string, number> => {
  const activeHeads = new Map<Panel, number>();
  const holdEndBeats = new Map<string, number>();

  for (const event of events) {
    if (event.kind === "hold-head" || event.kind === "roll-head") {
      activeHeads.set(event.panel, event.beat);
      continue;
    }

    if (event.kind !== "hold-tail") {
      continue;
    }

    const startBeat = activeHeads.get(event.panel);
    if (startBeat !== undefined) {
      holdEndBeats.set(`${event.panel}:${startBeat.toFixed(6)}`, event.beat);
      activeHeads.delete(event.panel);
    }
  }

  return holdEndBeats;
};

const buildAnimationSnapshot = (measureRows: string[]) => {
  const steps = measureRows.flatMap((row, rowIndex) => {
    const notes = row
      .split("")
      .flatMap((value, panelIndex) => value === "1" ? panelSymbols[panelIndex]! : [])
      .join("");

    return notes
      ? [{ beat: (rowIndex * 4) / measureRows.length, notes }]
      : [];
  });
  const { document: simfile, timedChart } = buildSteppingScenario({ steps });
  const botTimeline = buildBotTimeline(timedChart.events, new Map(), simfile, {
    allowBrackets: true,
    allowCrossovers: true,
    allowFootswitches: true,
    favorJumpsOverBrackets: false,
  });

  return { simfile, botTimeline };
};

const buildFerrariSnapshot = () => {
  const simfile = parseSimfile(ferrariSource);
  const chart = simfile.charts[0];

  expect(chart).toBeTruthy();

  const timedChart = buildTimedChart(simfile, chart!);
  const botTimeline = buildBotTimeline(timedChart.events, new Map(), simfile, {
    allowBrackets: true,
    allowCrossovers: true,
    allowFootswitches: true,
    favorJumpsOverBrackets: false,
  });

  return { simfile, botTimeline };
};

const getFeetDistance = (
  left: { x: number; y: number },
  right: { x: number; y: number },
): number => Math.hypot(right.x - left.x, right.y - left.y);

const getAngleDelta = (fromAngle: number, toAngle: number): number => {
  let delta = toAngle - fromAngle;

  while (delta > 180) {
    delta -= 360;
  }

  while (delta < -180) {
    delta += 360;
  }

  return delta;
};

describe("DancingBotWindow animation sampling", () => {
  it("briefly lifts a foot for an isolated mine before returning to its panel", () => {
    const { document: simfile, timedChart } = buildSteppingScenario({
      steps: [
        { beat: 0, taps: "L" },
        { beat: 1, mines: "L" },
      ],
    });
    const botTimeline = buildBotTimeline(timedChart.events, new Map(), simfile);

    expect(sampleBotStateAtBeat(botTimeline, simfile, 1).feet.left).toMatchObject({
      panel: "left",
      isLifted: true,
      isCentered: false,
    });
    expect(sampleBotStateAtBeat(botTimeline, simfile, 1.25).feet.left).toMatchObject({
      panel: "left",
      isLifted: false,
      isCentered: false,
    });
  });

  it("moves feet to center for Chiaroscuro's rapid all-panel mine run", () => {
    const simfile = parseSimfile(chiaroscuroSource);
    const chart = simfile.charts[0];

    expect(chart).toBeTruthy();

    const timedChart = buildTimedChart(simfile, chart!);
    const botTimeline = buildBotTimeline(timedChart.events, new Map(), simfile);
    const mineEvents = timedChart.events.filter(
      (event) => event.kind === "mine" && event.measureIndex === 28,
    );

    expect(mineEvents).toHaveLength(14);

    for (const mineEvent of mineEvents) {
      const snapshot = sampleBotStateAtBeat(botTimeline, simfile, mineEvent.beat);

      for (const foot of Object.values(snapshot.feet)) {
        if (foot.panel === mineEvent.panel) {
          expect(foot.isLifted || foot.isCentered).toBe(true);
          expect(foot.isPressing).toBe(false);
        }
      }
    }

    expect(sampleBotStateAtBeat(botTimeline, simfile, mineEvents[0]!.beat).feet.left.isCentered).toBe(true);
    expect(sampleBotStateAtBeat(botTimeline, simfile, mineEvents.at(-1)!.beat + 0.25).feet.left.isCentered).toBe(false);
  });

  it("holds the right foot still while the left foot centers through Hard 12's mine run", () => {
    const simfile = parseSimfile(chiaroscuroSource);
    const chart = simfile.charts.find(
      ({ difficulty, meter }) => difficulty === "Hard" && meter === 12,
    );

    expect(chart).toBeTruthy();

    const timedChart = buildTimedChart(simfile, chart!);
    const botTimeline = buildBotTimeline(
      timedChart.events,
      buildHoldEndBeatMap(timedChart.events),
      simfile,
    );
    const snapshots = [127.5, 128, 128.5, 129, 129.5, 130, 130.5, 131, 131.5]
      .map((beat) => sampleBotStateAtBeat(botTimeline, simfile, beat));
    const preMineSnapshot = sampleBotStateAtBeat(botTimeline, simfile, 127);
    const centerTransitionSnapshot = sampleBotStateAtBeat(botTimeline, simfile, 127.25);
    const initialSnapshot = snapshots[0]!;

    expect(centerTransitionSnapshot.feet.left).toMatchObject({ isCentered: true });
    expect(centerTransitionSnapshot.feet.left.y).toBeGreaterThan(preMineSnapshot.feet.left.y);
    expect(centerTransitionSnapshot.feet.left.y).toBeLessThan(initialSnapshot.feet.left.y);

    for (const snapshot of snapshots) {
      expect(snapshot.feet.left.isCentered).toBe(true);
      expect(snapshot.feet.right).toMatchObject({
        panel: "right",
        isHolding: true,
        x: initialSnapshot.feet.right.x,
        y: initialSnapshot.feet.right.y,
      });
      expect(snapshot.feet.left).toMatchObject({
        x: initialSnapshot.feet.left.x,
        y: initialSnapshot.feet.left.y,
      });
    }
  });

  it("keeps Ferrari's DR bracket sourced as heel-down toe-right", () => {
    const { simfile, botTimeline } = buildFerrariSnapshot();
    const ferrariDrBracketStep = botTimeline.right.find(
      (step) => step.heelPanel === "down" && step.toePanel === "right",
    );

    expect(ferrariDrBracketStep).toBeTruthy();
    expect(ferrariDrBracketStep).toMatchObject({
      heelPanel: "down",
      toePanel: "right",
      toPanel: "right",
    });

    const snapshot = sampleBotStateAtBeat(
      botTimeline,
      simfile,
      ferrariDrBracketStep!.hitBeat + 0.05,
    );

    expect(snapshot.feet.right.panel).toBe("right");
    expect(snapshot.feet.right.angle).toBeGreaterThan(0);
  });

  it("keeps the first crossover entry on left-up-right instead of spinning into right-left-right", () => {
    const { simfile, botTimeline } = buildAnimationSnapshot([
      "1000",
      "0010",
      "0001",
      "0000",
      "0000",
      "0000",
      "0000",
      "0000",
      "0000",
      "0000",
      "0000",
      "0000",
      "0000",
      "0000",
      "0000",
      "0000",
    ]);

    const sweepBeats = [0.84, 0.92, 1.0];
    const snapshots = sweepBeats.map((beat) =>
      sampleBotStateAtBeat(botTimeline, simfile, beat),
    );

    expect(botTimeline.left.map((step) => step.toPanel)).toEqual([
      "left",
      "right",
    ]);
    expect(botTimeline.right.map((step) => step.toPanel)).toEqual(["up"]);

    for (const snapshot of snapshots) {
      expect(snapshot.feet.left.panel).toBe("right");
      expect(snapshot.feet.right.panel).toBe("up");
      expect(snapshot.feet.left.x).toBeGreaterThanOrEqual(62);
      expect(snapshot.feet.right.y).toBeLessThanOrEqual(42);
      expect(
        getFeetDistance(snapshot.feet.left, snapshot.feet.right),
      ).toBeGreaterThanOrEqual(18);
    }
  });

  it("keeps the left-facing crossover posed left with separated feet", () => {
    const { simfile, botTimeline } = buildAnimationSnapshot([
      "1000",
      "0000",
      "0010",
      "0000",
      "0100",
      "0000",
      "1000",
      "0000",
      "0000",
      "0000",
      "0100",
      "0000",
      "0010",
      "0000",
      "1000",
      "0000",
    ]);

    const snapshot = sampleBotStateAtBeat(botTimeline, simfile, 2);

    expect(snapshot.feet.left.panel).toBe("down");
    expect(snapshot.feet.right.panel).toBe("left");
    expect(snapshot.feet.left.angle).toBeLessThan(-40);
    expect(snapshot.feet.right.angle).toBeLessThan(-40);
    expect(
      getFeetDistance(snapshot.feet.left, snapshot.feet.right),
    ).toBeGreaterThanOrEqual(18);
  });

  it("keeps the right-facing crossover posed right and blends the exit over the walk-out move", () => {
    const { simfile, botTimeline } = buildAnimationSnapshot([
      "1000",
      "0000",
      "0100",
      "0000",
      "0010",
      "0000",
      "1000",
      "0000",
      "0000",
      "0000",
      "0010",
      "0000",
      "0100",
      "0000",
      "1000",
      "0000",
    ]);

    const crossed = sampleBotStateAtBeat(botTimeline, simfile, 2);
    const exitStep = botTimeline.right.find(
      (step) => step.fromPanel === "left" && step.toPanel === "down",
    );

    expect(exitStep).toBeTruthy();

    const exitMoveStartBeat = secondsToBeat(
      exitStep!.moveStartTimeSeconds,
      simfile.bpms,
      simfile.stops,
      simfile.metadata.offset,
    );
    const exitMoveEndBeat = secondsToBeat(
      exitStep!.moveEndTimeSeconds,
      simfile.bpms,
      simfile.stops,
      simfile.metadata.offset,
    );
    const exitStartBeat =
      exitMoveStartBeat + (exitMoveEndBeat - exitMoveStartBeat) * 0.25;
    const exitMidBeat =
      exitMoveStartBeat + (exitMoveEndBeat - exitMoveStartBeat) * 0.7;
    const exitedBeat = exitMoveEndBeat + 0.05;

    expect(crossed.feet.left.panel).toBe("up");
    expect(crossed.feet.right.panel).toBe("left");
    expect(crossed.feet.left.angle).toBeGreaterThan(40);
    expect(crossed.feet.right.angle).toBeGreaterThan(40);
    expect(
      getFeetDistance(crossed.feet.left, crossed.feet.right),
    ).toBeGreaterThanOrEqual(18);

    const exitStart = sampleBotStateAtBeat(botTimeline, simfile, exitStartBeat);
    const exitMid = sampleBotStateAtBeat(botTimeline, simfile, exitMidBeat);
    const exited = sampleBotStateAtBeat(botTimeline, simfile, exitedBeat);

    expect(exitStart.feet.left.angle).toBeLessThan(crossed.feet.left.angle);
    expect(exitStart.feet.left.angle).toBeGreaterThan(20);
    expect(exitMid.feet.left.angle).toBeLessThan(exitStart.feet.left.angle);
    expect(exitMid.feet.left.angle).toBeGreaterThan(-20);
    expect(exited.feet.left.angle).toBeLessThan(0);
    expect(exited.feet.right.panel).toBe("down");
    expect(exited.feet.right.angle).toBeLessThan(30);
  });

  it("keeps alternating crossovers stable through the crossover entry and exit window", () => {
    const { simfile, botTimeline } = buildAnimationSnapshot([
      "1000",
      "0010",
      "0001",
      "0010",
      "1000",
      "0100",
      "0001",
      "0100",
      "1000",
      "0000",
      "0000",
      "0000",
      "0000",
      "0000",
      "0000",
      "0000",
    ]);

    const sampleBeats = [1.95, 2.02, 2.08, 2.16, 2.24];
    const snapshots = sampleBeats.map((beat) =>
      sampleBotStateAtBeat(botTimeline, simfile, beat),
    );

    for (const snapshot of snapshots) {
      expect(
        getFeetDistance(snapshot.feet.left, snapshot.feet.right),
      ).toBeGreaterThanOrEqual(14);
      expect(snapshot.feet.left.x).toBeLessThan(snapshot.feet.right.x);
    }

    const rightFootAngleDeltas = snapshots
      .slice(1)
      .map((snapshot, index) =>
        Math.abs(
          getAngleDelta(
            snapshots[index].feet.right.angle,
            snapshot.feet.right.angle,
          ),
        ),
      );
    const leftFootAngleDeltas = snapshots
      .slice(1)
      .map((snapshot, index) =>
        Math.abs(
          getAngleDelta(
            snapshots[index].feet.left.angle,
            snapshot.feet.left.angle,
          ),
        ),
      );

    expect(Math.max(...rightFootAngleDeltas)).toBeLessThan(65);
    expect(Math.max(...leftFootAngleDeltas)).toBeLessThan(65);
  });
});
