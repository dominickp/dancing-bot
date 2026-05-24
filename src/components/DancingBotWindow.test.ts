import { describe, expect, it } from "vitest";
import { buildTimedChart, parseSimfile, secondsToBeat } from "../lib/simfile";
import { buildBotTimeline, sampleBotStateAtBeat } from "./DancingBotWindow";

const createSimfile = (measureRows: string[]): string =>
  `#TITLE:Animation Test;\n#OFFSET:0;\n#BPMS:0.000=120.000;\n#STOPS:;\n#NOTES:\n     dance-single:\n     test:\n     Challenge:\n     9:\n     0,0,0,0,0:\n${measureRows.join("\n")}\n;`;

const buildAnimationSnapshot = (measureRows: string[]) => {
  const simfile = parseSimfile(createSimfile(measureRows));
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

describe("DancingBotWindow animation sampling", () => {
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
});
