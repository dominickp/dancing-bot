import bossyAudioUrl from "../../example-simfiles/BOSSY (Jorts Speedy Mix)/bossyremix.ogg";
import bossyBackgroundUrl from "../../example-simfiles/BOSSY (Jorts Speedy Mix)/bg.png";
import bossyBannerUrl from "../../example-simfiles/BOSSY (Jorts Speedy Mix)/bn.png";
import bossySimfileText from "../../example-simfiles/BOSSY (Jorts Speedy Mix)/bossyremix.ssc?raw";
import groovyAudioUrl from "../../example-simfiles/Groovy Rollercoaster Acid Trip/Groovy Rollercoaster Acid Trip.ogg";
import groovySimfileText from "../../example-simfiles/Groovy Rollercoaster Acid Trip/Groovy Rollercoaster Acid Trip.sm?raw";
import { buildTimedChart, parseSimfile } from "./simfile";
import type { SimfileDocument, TimedChart } from "./simfile";

type SongSourceType = "bundled" | "local";

interface SongAssetResolver {
  resolveAssetUrl: (assetPath: string) => string | null;
  dispose?: () => void;
}

interface SongSourceDefinition {
  id: string;
  label?: string;
  sourceType: SongSourceType;
  simfileText: string;
  resolver: SongAssetResolver;
}

export interface LoadedSongSource {
  id: string;
  label: string;
  sourceType: SongSourceType;
  document: SimfileDocument;
  timedCharts: TimedChart[];
  audioUrl: string | null;
  bannerUrl: string | null;
  backgroundUrl: string | null;
  dispose?: () => void;
}

const normalizeAssetKey = (assetPath: string): string =>
  assetPath
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .join("/")
    .toLowerCase();

const getSongLabel = (document: SimfileDocument, fallback: string): string => {
  const title = [document.metadata.title, document.metadata.subtitle]
    .filter(Boolean)
    .join(" ")
    .trim();

  return title || fallback;
};

const createBundledResolver = (
  assets: Record<string, string>,
): SongAssetResolver => {
  const assetMap = new Map<string, string>();

  for (const [assetPath, assetUrl] of Object.entries(assets)) {
    assetMap.set(normalizeAssetKey(assetPath), assetUrl);
  }

  return {
    resolveAssetUrl: (assetPath: string) =>
      assetMap.get(normalizeAssetKey(assetPath)) ?? null,
  };
};

const createSongSource = ({
  id,
  label,
  sourceType,
  simfileText,
  resolver,
}: SongSourceDefinition): LoadedSongSource => {
  const document = parseSimfile(simfileText);

  return {
    id,
    label: label ?? getSongLabel(document, id),
    sourceType,
    document,
    timedCharts: document.charts.map((chart) =>
      buildTimedChart(document, chart),
    ),
    audioUrl: document.metadata.music
      ? resolver.resolveAssetUrl(document.metadata.music)
      : null,
    bannerUrl: document.metadata.banner
      ? resolver.resolveAssetUrl(document.metadata.banner)
      : null,
    backgroundUrl: document.metadata.background
      ? resolver.resolveAssetUrl(document.metadata.background)
      : null,
    dispose: resolver.dispose,
  };
};

const createLocalResolver = (files: File[]): SongAssetResolver => {
  const assetMap = new Map<string, File>();
  const objectUrlMap = new Map<File, string>();

  for (const file of files) {
    assetMap.set(normalizeAssetKey(file.name), file);

    if (file.webkitRelativePath) {
      assetMap.set(normalizeAssetKey(file.webkitRelativePath), file);
    }
  }

  return {
    resolveAssetUrl: (assetPath: string) => {
      const assetFile = assetMap.get(normalizeAssetKey(assetPath));

      if (!assetFile) {
        return null;
      }

      const cachedUrl = objectUrlMap.get(assetFile);

      if (cachedUrl) {
        return cachedUrl;
      }

      const objectUrl = URL.createObjectURL(assetFile);
      objectUrlMap.set(assetFile, objectUrl);
      return objectUrl;
    },
    dispose: () => {
      for (const objectUrl of objectUrlMap.values()) {
        URL.revokeObjectURL(objectUrl);
      }

      objectUrlMap.clear();
    },
  };
};

export const bundledSongSources: LoadedSongSource[] = [
  createSongSource({
    id: "bossy-jorts-speedy-mix",
    sourceType: "bundled",
    simfileText: bossySimfileText,
    resolver: createBundledResolver({
      "bossyremix.ogg": bossyAudioUrl,
      "bg.png": bossyBackgroundUrl,
      "bn.png": bossyBannerUrl,
    }),
  }),
  createSongSource({
    id: "groovy-rollercoaster-acid-trip",
    sourceType: "bundled",
    simfileText: groovySimfileText,
    resolver: createBundledResolver({
      "Groovy Rollercoaster Acid Trip.ogg": groovyAudioUrl,
    }),
  }),
];

export const loadLocalSongSource = async (
  files: File[],
): Promise<LoadedSongSource> => {
  const simfile = files.find((file) => /\.(?:sm|ssc)$/i.test(file.name));

  if (!simfile) {
    throw new Error(
      "Select a simfile folder that contains a .sm or .ssc file and its assets.",
    );
  }

  const resolver = createLocalResolver(files);
  const simfileText = await simfile.text();
  const loadedSong = createSongSource({
    id: `local-${Date.now()}`,
    label: `${simfile.name.replace(/\.(?:sm|ssc)$/i, "")} (Local)`,
    sourceType: "local",
    simfileText,
    resolver,
  });

  loadedSong.label = `${getSongLabel(loadedSong.document, simfile.name.replace(/\.(?:sm|ssc)$/i, ""))} (Local)`;
  return loadedSong;
};

export const releaseLoadedSongSource = (
  songSource: LoadedSongSource | null,
): void => {
  songSource?.dispose?.();
};
