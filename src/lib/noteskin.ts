export type PanelName = "left" | "down" | "up" | "right";

export interface NoteskinOption {
  id: string;
  label: string;
  source: NoteskinSource;
}

export interface ResolvedSpriteAsset {
  url: string;
  columns: number;
  rows: number;
  frameX: number;
  frameY: number;
  renderMode: "image" | "mask";
  detailUrl?: string;
  detailColumns?: number;
  detailRows?: number;
  detailFrameX?: number;
  detailFrameY?: number;
}

export interface ResolvedPanelAssets {
  rotation: number;
  receptor: ResolvedSpriteAsset | null;
  tapNote: ResolvedSpriteAsset | null;
  tapLift: ResolvedSpriteAsset | null;
  tapMine: ResolvedSpriteAsset | null;
  holdBodyActive: ResolvedSpriteAsset | null;
  holdBodyInactive: ResolvedSpriteAsset | null;
}

export interface ResolvedDanceNoteskin {
  id: string;
  label: string;
  panelAssets: Record<PanelName, ResolvedPanelAssets>;
}

interface NoteskinSourceBase {
  kind: "bundled" | "local";
  id: string;
  label: string;
}

interface BundledNoteskinSource extends NoteskinSourceBase {
  kind: "bundled";
  rootUrl: string;
  files: string[];
}

interface LocalNoteskinSource extends NoteskinSourceBase {
  kind: "local";
  files: Map<string, File>;
  objectUrls: Map<string, string>;
}

type NoteskinSource = BundledNoteskinSource | LocalNoteskinSource;

interface LoadedNoteskinDefinition {
  id: string;
  label: string;
  fallbackId: string | null;
  redir: Record<string, string>;
  rotate: Record<string, number>;
  source: NoteskinSource;
}

const bundledNoteskinFiles: Record<string, string[]> = {
  metal: [
    "_Down Receptor Go 4x1 (doubleres).png",
    "_Down Roll Body active 4x1.png",
    "_Down Roll BottomCap active 4x1.png",
    "_down tap lift model.txt",
    "_down tap note model.txt",
    "_mine ani tex.ini",
    "_mine model.txt",
    "_mine tex.png",
    "beta2.txt",
    "Down Hold Body Active.png",
    "Down Hold Body Inactive.png",
    "Down Hold BottomCap active.png",
    "Down Hold BottomCap inactive.png",
    "down hold explosion.png",
    "Down Receptor.lua",
    "Down Roll Body active.lua",
    "Down Roll Body Inactive.png",
    "Down Roll BottomCap active.lua",
    "Down Roll BottomCap Inactive.png",
    "Down Tap Explosion Bright W1.png",
    "Down Tap Explosion Dim W1.png",
    "Down Tap Explosion Dim W2.png",
    "Down Tap Explosion Dim W3.png",
    "Down Tap Explosion Dim W4.png",
    "Down Tap Explosion Dim W5.png",
    "Down Tap Lift.lua",
    "Down Tap Mine.lua",
    "Down Tap Note.lua",
    "Fallback Explosion.lua",
    "metrics.ini",
    "NoteSkin.lua",
    "textures/Note.png",
    "textures/Tap Lift parts (mipmaps).png",
    "textures/Tap Note ani texture.ini",
    "textures/Tap Note parts (mipmaps).png",
  ],
  cel: [
    "_Down Receptor Go 4x1 (doubleres).png",
    "_Down Roll Body active 4x1.png",
    "_Down Roll BottomCap active 4x1.png",
    "_down tap lift model.txt",
    "_down tap note model.txt",
    "_mine ani tex.ini",
    "_mine model.txt",
    "_mine tex.png",
    "Down Hold Body Active.png",
    "Down Hold Body Inactive.png",
    "Down Hold BottomCap active.png",
    "Down Hold BottomCap inactive.png",
    "down hold explosion.png",
    "Down Receptor.lua",
    "Down Roll Body active.lua",
    "Down Roll Body Inactive.png",
    "Down Roll BottomCap active.lua",
    "Down Roll BottomCap Inactive.png",
    "Down Tap Explosion Bright W1.png",
    "Down Tap Explosion Dim W1.png",
    "Down Tap Explosion Dim W2.png",
    "Down Tap Explosion Dim W3.png",
    "Down Tap Explosion Dim W4.png",
    "Down Tap Explosion Dim W5.png",
    "Down Tap Lift.lua",
    "Down Tap Mine.lua",
    "Down Tap Note.lua",
    "Fallback Explosion.lua",
    "metrics.ini",
    "model.txt",
    "NoteSkin.lua",
    "textures/Tap Lift parts (mipmaps).png",
    "textures/Tap Note ani texture.ini",
    "textures/Tap Note parts (mipmaps).png",
  ],
};

const panelToButton: Record<PanelName, string> = {
  left: "Left",
  down: "Down",
  up: "Up",
  right: "Right",
};

const defaultRotations: Record<string, number> = {
  Down: 0,
  Left: 90,
  Up: 180,
  Right: -90,
};

const imageExtensions = [".png", ".jpg", ".jpeg", ".webp", ".gif"];

export const bundledNoteskinOptions: NoteskinOption[] = Object.entries(
  bundledNoteskinFiles,
).map(([id, files]) => ({
  id,
  label: id.charAt(0).toUpperCase() + id.slice(1),
  source: {
    kind: "bundled",
    id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
    rootUrl: `/noteskins/dance/${id}`,
    files,
  },
}));

const normalizePath = (value: string): string =>
  value.replace(/\\/g, "/").replace(/^\/+/, "").trim();

const encodePath = (value: string): string =>
  normalizePath(value).split("/").map(encodeURIComponent).join("/");

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parseLuaStringTable = (
  luaText: string,
  tableName: string,
): Record<string, string> => {
  const tableMatch = luaText.match(
    new RegExp(`${escapeRegExp(tableName)}\\s*=\\s*\\{([\\s\\S]*?)\\}`, "i"),
  );

  if (!tableMatch) {
    return {};
  }

  const result: Record<string, string> = {};

  for (const entry of tableMatch[1].matchAll(
    /[\[\s,]*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_]+))\s*=\s*(?:"([^"]+)"|'([^']+)')/g,
  )) {
    const key = entry[1] ?? entry[2] ?? entry[3];
    const value = entry[4] ?? entry[5];

    if (key && value) {
      result[key] = value;
    }
  }

  return result;
};

const parseLuaNumberTable = (
  luaText: string,
  tableName: string,
): Record<string, number> => {
  const tableMatch = luaText.match(
    new RegExp(`${escapeRegExp(tableName)}\\s*=\\s*\\{([\\s\\S]*?)\\}`, "i"),
  );

  if (!tableMatch) {
    return {};
  }

  const result: Record<string, number> = {};

  for (const entry of tableMatch[1].matchAll(
    /[\[\s,]*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_]+))\s*=\s*(-?\d+(?:\.\d+)?)/g,
  )) {
    const key = entry[1] ?? entry[2] ?? entry[3];
    const value = Number.parseFloat(entry[4]);

    if (key && Number.isFinite(value)) {
      result[key] = value;
    }
  }

  return result;
};

const parseFallbackName = (metricsText: string): string | null => {
  let inGlobalSection = false;

  for (const rawLine of metricsText.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#") || line.startsWith(";")) {
      continue;
    }

    if (line.startsWith("[") && line.endsWith("]")) {
      inGlobalSection = line.slice(1, -1).toLowerCase() === "global";
      continue;
    }

    if (!inGlobalSection) {
      continue;
    }

    const match = line.match(/^FallbackNoteSkin\s*=\s*(.+)$/i);

    if (match) {
      return match[1].trim() || null;
    }
  }

  return null;
};

const getSourceFiles = (source: NoteskinSource): string[] => {
  if (source.kind === "bundled") {
    return source.files.slice();
  }

  return Array.from(source.files.keys());
};

const findExactFile = (
  source: NoteskinSource,
  relativePath: string,
): string | null => {
  const normalized = normalizePath(relativePath).toLowerCase();

  for (const filePath of getSourceFiles(source)) {
    if (normalizePath(filePath).toLowerCase() === normalized) {
      return normalizePath(filePath);
    }
  }

  return null;
};

const findFile = (
  source: NoteskinSource,
  predicate: (normalizedLower: string) => boolean,
): string | null => {
  for (const filePath of getSourceFiles(source)) {
    const normalized = normalizePath(filePath);

    if (predicate(normalized.toLowerCase())) {
      return normalized;
    }
  }

  return null;
};

const getFileUrl = (
  source: NoteskinSource,
  relativePath: string,
): string | null => {
  const filePath = findExactFile(source, relativePath);

  if (!filePath) {
    return null;
  }

  if (source.kind === "bundled") {
    return `${source.rootUrl}/${encodePath(filePath)}`;
  }

  const existingUrl = source.objectUrls.get(filePath);

  if (existingUrl) {
    return existingUrl;
  }

  const file = source.files.get(filePath);

  if (!file) {
    return null;
  }

  const nextUrl = URL.createObjectURL(file);
  source.objectUrls.set(filePath, nextUrl);
  return nextUrl;
};

const readTextFile = async (
  source: NoteskinSource,
  relativePath: string,
): Promise<string | null> => {
  const filePath = findExactFile(source, relativePath);

  if (!filePath) {
    return null;
  }

  if (source.kind === "bundled") {
    const response = await fetch(`${source.rootUrl}/${encodePath(filePath)}`);

    if (!response.ok) {
      return null;
    }

    return response.text();
  }

  const file = source.files.get(filePath);
  return file ? file.text() : null;
};

const loadImageDimensions = async (
  url: string,
): Promise<{ width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    image.src = url;
  });

const inferGridFromDimensions = (
  width: number,
  height: number,
): { columns: number; rows: number } => {
  if (height > 0 && width % height === 0) {
    const columns = width / height;

    if (columns >= 2 && columns <= 8) {
      return { columns, rows: 1 };
    }
  }

  if (width > 0 && height % width === 0) {
    const rows = height / width;

    if (rows >= 2 && rows <= 8) {
      return { columns: 1, rows };
    }
  }

  return { columns: 1, rows: 1 };
};

const inferGridFromPath = (
  relativePath: string,
): { columns: number; rows: number } | null => {
  const fileName = normalizePath(relativePath).split("/").pop() ?? "";
  const match = fileName.match(/(\d+)x(\d+)/i);

  if (!match) {
    return null;
  }

  const columns = Number.parseInt(match[1], 10);
  const rows = Number.parseInt(match[2], 10);

  if (!Number.isFinite(columns) || !Number.isFinite(rows)) {
    return null;
  }

  return { columns, rows };
};

const buildSpriteAsset = async (
  source: NoteskinSource,
  relativePath: string,
  renderMode: "image" | "mask" = "image",
): Promise<ResolvedSpriteAsset | null> => {
  const url = getFileUrl(source, relativePath);

  if (!url) {
    return null;
  }

  const hintedGrid = inferGridFromPath(relativePath);
  let columns = hintedGrid?.columns ?? 1;
  let rows = hintedGrid?.rows ?? 1;

  if (!hintedGrid) {
    try {
      const dimensions = await loadImageDimensions(url);
      const inferredGrid = inferGridFromDimensions(
        dimensions.width,
        dimensions.height,
      );
      columns = inferredGrid.columns;
      rows = inferredGrid.rows;
    } catch {
      columns = 1;
      rows = 1;
    }
  }

  return {
    url,
    columns,
    rows,
    frameX: 0,
    frameY: 0,
    renderMode,
  };
};

const buildMaskedDetailSpriteAsset = async (
  source: NoteskinSource,
  maskPath: string,
  detailPath: string,
): Promise<ResolvedSpriteAsset | null> => {
  const maskAsset = await buildSpriteAsset(source, maskPath, "mask");
  const detailAsset = await buildSpriteAsset(source, detailPath, "image");

  if (!maskAsset || !detailAsset) {
    return maskAsset;
  }

  return {
    ...maskAsset,
    detailUrl: detailAsset.url,
    detailColumns: detailAsset.columns,
    detailRows: detailAsset.rows,
    detailFrameX: detailAsset.frameX,
    detailFrameY: detailAsset.frameY,
  };
};

const extractNoteskinGetPath = (
  actorText: string,
): { prefix: string; name: string } | null => {
  const match = actorText.match(
    /NOTESKIN:GetPath\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/i,
  );

  if (!match) {
    return null;
  }

  return {
    prefix: match[1],
    name: match[2],
  };
};

const findTextureByGetPath = (
  source: NoteskinSource,
  prefix: string,
  name: string,
): string | null => {
  const prefixLower = prefix.toLowerCase();
  const nameLower = name.toLowerCase();

  return findFile(source, (filePath) => {
    if (!imageExtensions.some((extension) => filePath.endsWith(extension))) {
      return false;
    }

    const fileName = filePath.split("/").pop() ?? "";
    return fileName.startsWith(`${prefixLower} ${nameLower}`);
  });
};

const findDirectImage = (
  source: NoteskinSource,
  candidates: string[],
): string | null => {
  for (const candidate of candidates) {
    const filePath = findFile(source, (normalized) =>
      normalized.endsWith(candidate.toLowerCase()),
    );

    if (filePath) {
      return filePath;
    }
  }

  return null;
};

const resolveModelTextureFallback = (
  source: NoteskinSource,
  elementName: string,
): string | null => {
  switch (elementName) {
    case "Tap Note":
      return findDirectImage(source, ["_down receptor go 4x1 (doubleres).png"]);
    case "Tap Lift":
      return findDirectImage(source, ["_down receptor go 4x1 (doubleres).png"]);
    case "Tap Mine":
      return findDirectImage(source, ["_mine tex.png"]);
    default:
      return null;
  }
};

const resolveModelTextureDetail = (
  source: NoteskinSource,
  elementName: string,
): string | null => {
  switch (elementName) {
    case "Tap Note":
      return findDirectImage(source, [
        "textures/note.png",
        "textures/tap note parts (mipmaps).png",
      ]);
    case "Tap Lift":
      return findDirectImage(source, ["textures/tap lift parts (mipmaps).png"]);
    default:
      return null;
  }
};

const resolveActorTexture = async (
  source: NoteskinSource,
  buttonName: string,
  elementName: string,
): Promise<ResolvedSpriteAsset | null> => {
  const actorPath = findExactFile(source, `${buttonName} ${elementName}.lua`);

  if (!actorPath) {
    return null;
  }

  const actorText = await readTextFile(source, actorPath);

  if (!actorText) {
    return null;
  }

  const getPathReference = extractNoteskinGetPath(actorText);

  if (getPathReference) {
    const texturePath = findTextureByGetPath(
      source,
      getPathReference.prefix,
      getPathReference.name,
    );

    if (texturePath) {
      return buildSpriteAsset(source, texturePath);
    }
  }

  if (actorText.includes("Def.Model")) {
    const fallbackTexture = resolveModelTextureFallback(source, elementName);

    if (!fallbackTexture) {
      return null;
    }

    if (elementName === "Tap Note" || elementName === "Tap Lift") {
      const detailTexture = resolveModelTextureDetail(source, elementName);

      if (detailTexture) {
        return buildMaskedDetailSpriteAsset(
          source,
          fallbackTexture,
          detailTexture,
        );
      }

      return buildSpriteAsset(source, fallbackTexture, "mask");
    }

    return buildSpriteAsset(source, fallbackTexture, "image");
  }

  return null;
};

const resolveDirectTexture = async (
  source: NoteskinSource,
  buttonName: string,
  elementName: string,
): Promise<ResolvedSpriteAsset | null> => {
  const preferredPath = findDirectImage(source, [
    `${buttonName.toLowerCase()} ${elementName.toLowerCase()}.png`,
    `_${buttonName.toLowerCase()} ${elementName.toLowerCase()}.png`,
  ]);

  return preferredPath ? buildSpriteAsset(source, preferredPath) : null;
};

const loadNoteskinDefinition = async (
  option: NoteskinOption,
): Promise<LoadedNoteskinDefinition> => {
  const noteskinLua = (await readTextFile(option.source, "NoteSkin.lua")) ?? "";
  const metricsIni = (await readTextFile(option.source, "metrics.ini")) ?? "";

  return {
    id: option.id,
    label: option.label,
    fallbackId: parseFallbackName(metricsIni),
    redir: parseLuaStringTable(noteskinLua, "ret.RedirTable"),
    rotate: parseLuaNumberTable(noteskinLua, "ret.Rotate"),
    source: option.source,
  };
};

const resolvePanelAsset = async (
  skinMap: Map<string, LoadedNoteskinDefinition>,
  skinId: string,
  originalButton: string,
  elementName: string,
  visited: Set<string>,
): Promise<ResolvedSpriteAsset | null> => {
  const skin = skinMap.get(skinId);

  if (!skin) {
    return null;
  }

  const visitKey = `${skinId}:${originalButton}:${elementName}`;

  if (visited.has(visitKey)) {
    return null;
  }

  visited.add(visitKey);

  const redirectedButton = skin.redir[originalButton] ?? originalButton;
  const actorAsset = await resolveActorTexture(
    skin.source,
    redirectedButton,
    elementName,
  );

  if (actorAsset) {
    return actorAsset;
  }

  const directAsset = await resolveDirectTexture(
    skin.source,
    redirectedButton,
    elementName,
  );

  if (directAsset) {
    return directAsset;
  }

  if (skin.fallbackId && skinMap.has(skin.fallbackId)) {
    return resolvePanelAsset(
      skinMap,
      skin.fallbackId,
      originalButton,
      elementName,
      visited,
    );
  }

  return null;
};

export const getPanelRotation = (
  resolvedNoteskin: ResolvedDanceNoteskin | null,
  panel: PanelName,
): number =>
  resolvedNoteskin?.panelAssets[panel].rotation ??
  defaultRotations[panelToButton[panel]];

export const getBundledNoteskinOptions = (): NoteskinOption[] =>
  bundledNoteskinOptions.slice();

export const buildImportedNoteskinOption = (
  files: FileList | File[],
): NoteskinOption | null => {
  const entries = Array.from(files);

  if (entries.length === 0) {
    return null;
  }

  const normalizedFiles = new Map<string, File>();
  let rootName = "";

  for (const file of entries) {
    const relativePath = normalizePath(
      (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
        file.name,
    );
    const parts = relativePath.split("/");

    if (!rootName) {
      rootName = parts[0] ?? "custom";
    }

    const trimmedPath = parts.slice(1).join("/");

    if (trimmedPath) {
      normalizedFiles.set(trimmedPath, file);
    }
  }

  if (!normalizedFiles.has("NoteSkin.lua")) {
    return null;
  }

  const id = `local-${rootName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return {
    id,
    label: `${rootName} (local)`,
    source: {
      kind: "local",
      id,
      label: `${rootName} (local)`,
      files: normalizedFiles,
      objectUrls: new Map<string, string>(),
    },
  };
};

export const releaseNoteskinOption = (option: NoteskinOption | null): void => {
  if (!option || option.source.kind !== "local") {
    return;
  }

  for (const url of option.source.objectUrls.values()) {
    URL.revokeObjectURL(url);
  }

  option.source.objectUrls.clear();
};

export const loadResolvedDanceNoteskin = async (
  selectedOption: NoteskinOption,
  availableOptions: NoteskinOption[],
): Promise<ResolvedDanceNoteskin> => {
  const allOptions = new Map<string, NoteskinOption>(
    availableOptions.map((option) => [option.id, option]),
  );
  const definitionCache = new Map<string, LoadedNoteskinDefinition>();

  const ensureDefinition = async (
    skinId: string,
  ): Promise<LoadedNoteskinDefinition | null> => {
    const cached = definitionCache.get(skinId);

    if (cached) {
      return cached;
    }

    const option = allOptions.get(skinId);

    if (!option) {
      return null;
    }

    const definition = await loadNoteskinDefinition(option);
    definitionCache.set(skinId, definition);
    return definition;
  };

  const rootDefinition = await ensureDefinition(selectedOption.id);

  if (!rootDefinition) {
    throw new Error(`Unable to load noteskin ${selectedOption.id}`);
  }

  if (rootDefinition.fallbackId) {
    await ensureDefinition(rootDefinition.fallbackId);
  }

  const panelAssets = {} as Record<PanelName, ResolvedPanelAssets>;

  for (const panel of Object.keys(panelToButton) as PanelName[]) {
    const buttonName = panelToButton[panel];
    const rotation =
      rootDefinition.rotate[buttonName] ?? defaultRotations[buttonName] ?? 0;

    panelAssets[panel] = {
      rotation,
      receptor: await resolvePanelAsset(
        definitionCache,
        rootDefinition.id,
        buttonName,
        "Receptor",
        new Set<string>(),
      ),
      tapNote: await resolvePanelAsset(
        definitionCache,
        rootDefinition.id,
        buttonName,
        "Tap Note",
        new Set<string>(),
      ),
      tapLift: await resolvePanelAsset(
        definitionCache,
        rootDefinition.id,
        buttonName,
        "Tap Lift",
        new Set<string>(),
      ),
      tapMine: await resolvePanelAsset(
        definitionCache,
        rootDefinition.id,
        buttonName,
        "Tap Mine",
        new Set<string>(),
      ),
      holdBodyActive: await resolvePanelAsset(
        definitionCache,
        rootDefinition.id,
        buttonName,
        "Hold Body Active",
        new Set<string>(),
      ),
      holdBodyInactive: await resolvePanelAsset(
        definitionCache,
        rootDefinition.id,
        buttonName,
        "Hold Body Inactive",
        new Set<string>(),
      ),
    };
  }

  return {
    id: rootDefinition.id,
    label: rootDefinition.label,
    panelAssets,
  };
};
