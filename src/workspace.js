import { copyFile, cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const JSON_FILES = new Set(["library.json", "prompts.json", "ai-sites.json"]);
const MEDIA_DIRS = new Set(["videos", "thumbs"]);

export const EMPTY_LIBRARY = { resources: [] };
export const EMPTY_PROMPTS = { categories: [], prompts: [] };
export const EMPTY_AI_SITES = { sites: [] };

export async function initWorkspace(rootDir) {
  const workspaceDir = assertWorkspaceDir(rootDir);
  await mkdir(path.join(workspaceDir, "videos"), { recursive: true });
  await mkdir(path.join(workspaceDir, "thumbs"), { recursive: true });
  await mkdir(path.join(workspaceDir, "backups"), { recursive: true });
  await ensureJsonFile(workspaceDir, "library.json", EMPTY_LIBRARY);
  await ensureJsonFile(workspaceDir, "prompts.json", EMPTY_PROMPTS);
  await ensureJsonFile(workspaceDir, "ai-sites.json", EMPTY_AI_SITES);
  return { workspaceDir };
}

export async function migrateWorkspace(fromDir, toDir) {
  const sourceDir = assertWorkspaceDir(fromDir);
  const targetDir = assertWorkspaceDir(toDir);
  if (sourceDir === targetDir) {
    const error = new Error("New workspace directory is the same as the current one");
    error.code = "SAME_WORKSPACE_DIR";
    throw error;
  }

  await initWorkspace(sourceDir);
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(sourceDir);
  await Promise.all(entries.map((entry) => cp(path.join(sourceDir, entry), path.join(targetDir, entry), {
    recursive: true,
    force: false,
    errorOnExist: true
  })));
  await initWorkspace(targetDir);
  return { workspaceDir: targetDir };
}

export async function readJsonFile(rootDir, filename, fallback) {
  const filePath = getJsonPath(rootDir, filename);
  try {
    const raw = await readFile(filePath, "utf8");
    const fileStat = await stat(filePath);
    return { data: raw.trim() ? JSON.parse(raw) : fallback, mtimeMs: fileStat.mtimeMs };
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    await ensureJsonFile(assertWorkspaceDir(rootDir), filename, fallback);
    return readJsonFile(rootDir, filename, fallback);
  }
}

export async function writeJsonFile(rootDir, filename, payload, knownMtimeMs) {
  const filePath = getJsonPath(rootDir, filename);
  await mkdir(path.join(assertWorkspaceDir(rootDir), "backups"), { recursive: true });
  let currentStat = null;
  try {
    currentStat = await stat(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  if (
    typeof knownMtimeMs === "number" &&
    currentStat &&
    Math.abs(currentStat.mtimeMs - knownMtimeMs) > 0.001
  ) {
    const stale = new Error("Synced file changed on disk");
    stale.code = "STALE_FILE";
    throw stale;
  }
  if (currentStat) {
    const backupName = `${path.basename(filename, ".json")}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    await copyFile(filePath, path.join(assertWorkspaceDir(rootDir), "backups", backupName));
  }
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  const nextStat = await stat(filePath);
  return { data: payload, mtimeMs: nextStat.mtimeMs };
}

export function assertSafeFilename(filename) {
  const value = String(filename || "").trim();
  if (!value || value !== path.basename(value) || value.includes("/") || value.includes("\\")) {
    throw new Error("Unsafe filename");
  }
  return value;
}

export function getMediaPath(rootDir, mediaDir, filename) {
  if (!MEDIA_DIRS.has(mediaDir)) {
    throw new Error("Unsafe media directory");
  }
  return path.join(assertWorkspaceDir(rootDir), mediaDir, assertSafeFilename(filename));
}

export async function listWorkspaceFiles(rootDir, mediaDir) {
  if (!MEDIA_DIRS.has(mediaDir)) {
    throw new Error("Unsafe media directory");
  }
  try {
    const entries = await readdir(path.join(assertWorkspaceDir(rootDir), mediaDir), { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    await mkdir(path.join(assertWorkspaceDir(rootDir), mediaDir), { recursive: true });
    return [];
  }
}

export async function removeWorkspaceFile(rootDir, mediaDir, filename) {
  await rm(getMediaPath(rootDir, mediaDir, filename), { force: true });
}

export function buildStoredFilename(originalName) {
  const safeOriginal = path.basename(String(originalName || "file")).replace(/[^a-zA-Z0-9._-]+/g, "-");
  return `${Date.now()}-${Math.random().toString(16).slice(2)}-${safeOriginal}`;
}

async function ensureJsonFile(rootDir, filename, fallback) {
  await mkdir(assertWorkspaceDir(rootDir), { recursive: true });
  const filePath = getJsonPath(rootDir, filename);
  try {
    await stat(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    await writeFile(filePath, `${JSON.stringify(fallback, null, 2)}\n`);
  }
}

function getJsonPath(rootDir, filename) {
  if (!JSON_FILES.has(filename)) {
    throw new Error("Unsupported JSON file");
  }
  return path.join(assertWorkspaceDir(rootDir), filename);
}

function assertWorkspaceDir(rootDir) {
  const value = String(rootDir || "").trim();
  if (!value) {
    throw new Error("Workspace directory is not configured");
  }
  return path.resolve(value);
}
