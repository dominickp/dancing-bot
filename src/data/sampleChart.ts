import sampleSimfileText from "../../example-simfiles/Groovy Rollercoaster Acid Trip/Groovy Rollercoaster Acid Trip.sm?raw";
import sampleAudioUrl from "../../example-simfiles/Groovy Rollercoaster Acid Trip/Groovy Rollercoaster Acid Trip.ogg";
import { buildTimedChart, parseSmSimfile } from "../lib/simfile";

export const sampleChart = parseSmSimfile(sampleSimfileText);
export const getSampleTimedChart = (chartIndex: number) => {
  const chart = sampleChart.charts[chartIndex];

  return chart
    ? buildTimedChart(sampleChart, chart)
    : { events: [], lastBeat: 0, lastTimeSeconds: 0 };
};

export const samplePrimaryChart = sampleChart.charts[0];
export const sampleTimedChart = getSampleTimedChart(0);
export const sampleAudioSource = sampleAudioUrl;
