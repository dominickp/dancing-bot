import sampleSimfileText from "../../example-simfiles/Diskasting - Dogtown Clash Remix - [Zaia]/Dogtown Clash Remix.sm?raw";
import sampleAudioUrl from "../../example-simfiles/Diskasting - Dogtown Clash Remix - [Zaia]/Dskasting Feat. Feral - Dogtown Clash Remix_gain-adjusted.ogg";
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
