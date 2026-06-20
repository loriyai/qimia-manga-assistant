import express from "express";
import multer from "multer";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { readConfig, writeConfig } from "./configStore.js";
import {
  buildStoredFilename,
  EMPTY_AI_SITES,
  EMPTY_LIBRARY,
  EMPTY_PROMPTS,
  getMediaPath,
  initWorkspace,
  listWorkspaceFiles,
  migrateWorkspace,
  readJsonFile,
  removeWorkspaceFile,
  writeJsonFile
} from "./workspace.js";

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv"]);

export function createRouter(options = {}) {
  const router = express.Router();
  const configPath = options.configPath;
  const upload = multer({ storage: multer.memoryStorage() });

  router.get("/health", (req, res) => {
    res.json({ ok: true, appName: "七秒漫剧助手" });
  });

  router.get("/config", asyncHandler(async (req, res) => {
    res.json(await readConfig(configPath));
  }));

  router.post("/config", asyncHandler(async (req, res) => {
    const current = await readConfig(configPath);
    res.json(await writeConfig(mergeConfig(current, req.body || {}), configPath));
  }));

  router.post("/workspace/init", asyncHandler(async (req, res) => {
    const config = await readConfig(configPath);
    res.json(await initWorkspace(config.workspaceDir));
  }));

  router.post("/workspace/migrate", asyncHandler(async (req, res) => {
    const config = await readConfig(configPath);
    const nextWorkspaceDir = String(req.body?.workspaceDir || "").trim();
    if (!nextWorkspaceDir) {
      res.status(400).json({ error: "请输入新的工作目录" });
      return;
    }
    let migrated;
    try {
      migrated = await migrateWorkspace(config.workspaceDir, nextWorkspaceDir);
    } catch (error) {
      if (error.code === "SAME_WORKSPACE_DIR") {
        res.status(400).json({ error: "新工作目录和当前工作目录相同" });
        return;
      }
      if (error.code === "ERR_FS_CP_EEXIST") {
        res.status(409).json({ error: "目标目录已有同名文件，请选择空目录或新的目录" });
        return;
      }
      throw error;
    }
    res.json(await writeConfig(mergeConfig(config, migrated), configPath));
  }));

  router.get("/syncthing/status", asyncHandler(async (req, res) => {
    const config = await readConfig(configPath);
    const system = await syncthingRequest(config.syncthing, "/rest/system/status");
    let folder = null;
    if (config.syncthing.folderId) {
      folder = await syncthingRequest(config.syncthing, `/rest/db/status?folder=${encodeURIComponent(config.syncthing.folderId)}`);
    }
    res.json({ ok: true, system, folder });
  }));

  router.post("/syncthing/scan", asyncHandler(async (req, res) => {
    const config = await readConfig(configPath);
    const folderId = config.syncthing.folderId;
    if (!folderId) {
      res.status(400).json({ error: "请先填写 Syncthing 文件夹 ID" });
      return;
    }
    await syncthingRequest(config.syncthing, `/rest/db/scan?folder=${encodeURIComponent(folderId)}`, { method: "POST" });
    res.json({ ok: true });
  }));

  router.post("/syncthing/open", asyncHandler(async (req, res) => {
    await startSyncthing();
    res.json({ ok: true });
  }));

  router.post("/syncthing/pause", asyncHandler(async (req, res) => {
    const config = await readConfig(configPath);
    const folderId = config.syncthing.folderId;
    if (!folderId) {
      res.status(400).json({ error: "请先填写 Syncthing 文件夹 ID" });
      return;
    }
    await syncthingRequest(config.syncthing, `/rest/config/folders/${encodeURIComponent(folderId)}/pause`, { method: "POST" });
    res.json({ ok: true });
  }));

  router.post("/syncthing/resume", asyncHandler(async (req, res) => {
    const config = await readConfig(configPath);
    const folderId = config.syncthing.folderId;
    if (!folderId) {
      res.status(400).json({ error: "请先填写 Syncthing 文件夹 ID" });
      return;
    }
    await syncthingRequest(config.syncthing, `/rest/config/folders/${encodeURIComponent(folderId)}/resume`, { method: "POST" });
    res.json({ ok: true });
  }));

  router.get("/prompts", asyncHandler(async (req, res) => {
    const rootDir = await requireWorkspace(configPath);
    res.json(await readJsonFile(rootDir, "prompts.json", EMPTY_PROMPTS));
  }));

  router.put("/prompts", asyncHandler(async (req, res) => {
    const rootDir = await requireWorkspace(configPath);
    res.json(await writeJsonFile(rootDir, "prompts.json", normalizePrompts(req.body.data), req.body.knownMtimeMs));
  }));

  router.get("/ai-sites", asyncHandler(async (req, res) => {
    const rootDir = await requireWorkspace(configPath);
    res.json(await readJsonFile(rootDir, "ai-sites.json", EMPTY_AI_SITES));
  }));

  router.put("/ai-sites", asyncHandler(async (req, res) => {
    const rootDir = await requireWorkspace(configPath);
    res.json(await writeJsonFile(rootDir, "ai-sites.json", normalizeAiSites(req.body.data), req.body.knownMtimeMs));
  }));

  router.post("/prompts/:id/thumbnail", upload.single("thumbnail"), asyncHandler(async (req, res) => {
    const rootDir = await requireWorkspace(configPath);
    if (!req.file) {
      res.status(400).json({ error: "请选择图片文件" });
      return;
    }
    const filename = buildStoredFilename(req.file.originalname);
    await mkdir(path.join(rootDir, "thumbs"), { recursive: true });
    await import("node:fs/promises").then((fs) => fs.writeFile(getMediaPath(rootDir, "thumbs", filename), req.file.buffer));
    const current = await readJsonFile(rootDir, "prompts.json", EMPTY_PROMPTS);
    const data = normalizePrompts(current.data);
    data.prompts = data.prompts.map((promptItem) =>
      promptItem.id === req.params.id ? { ...promptItem, thumbnailFilename: filename, updatedAt: new Date().toISOString() } : promptItem
    );
    const saved = await writeJsonFile(rootDir, "prompts.json", data, current.mtimeMs);
    res.json({ filename, prompts: saved });
  }));

  router.delete("/prompts/:id/thumbnail", asyncHandler(async (req, res) => {
    const rootDir = await requireWorkspace(configPath);
    const current = await readJsonFile(rootDir, "prompts.json", EMPTY_PROMPTS);
    const data = normalizePrompts(current.data);
    const promptItem = data.prompts.find((item) => item.id === req.params.id);
    const thumbnailFilename = promptItem?.thumbnailFilename || "";
    data.prompts = data.prompts.map((item) =>
      item.id === req.params.id ? { ...item, thumbnailFilename: "", updatedAt: new Date().toISOString() } : item
    );
    if (req.body?.deleteThumbnailFile && thumbnailFilename) {
      await removeWorkspaceFile(rootDir, "thumbs", thumbnailFilename);
    }
    res.json(await writeJsonFile(rootDir, "prompts.json", data, current.mtimeMs));
  }));

  router.get("/library", asyncHandler(async (req, res) => {
    const rootDir = await requireWorkspace(configPath);
    res.json(await readJsonFile(rootDir, "library.json", EMPTY_LIBRARY));
  }));

  router.post("/library/refresh", asyncHandler(async (req, res) => {
    const rootDir = await requireWorkspace(configPath);
    const current = await readJsonFile(rootDir, "library.json", EMPTY_LIBRARY);
    const data = normalizeLibrary(current.data);
    const knownVideoFilenames = new Set(data.resources.map((item) => item.videoFilename).filter(Boolean));
    const videoFilenames = (await listWorkspaceFiles(rootDir, "videos"))
      .filter((filename) => VIDEO_EXTENSIONS.has(path.extname(filename).toLowerCase()));
    const now = new Date().toISOString();
    let addedCount = 0;
    const addedResources = videoFilenames
      .filter((filename) => !knownVideoFilenames.has(filename))
      .map((filename) => {
        addedCount += 1;
        return {
          id: createId("res"),
          title: `请检查是否多余${addedCount}`,
          videoFilename: filename,
          thumbnailFilename: "",
          prompt: "",
          description: "",
          tags: [],
          createdAt: now,
          updatedAt: now
        };
      });
    if (!addedResources.length) {
      res.json(current);
      return;
    }
    data.resources = [...addedResources, ...data.resources];
    res.json(await writeJsonFile(rootDir, "library.json", data, current.mtimeMs));
  }));

  router.put("/library", asyncHandler(async (req, res) => {
    const rootDir = await requireWorkspace(configPath);
    res.json(await writeJsonFile(rootDir, "library.json", normalizeLibrary(req.body.data), req.body.knownMtimeMs));
  }));

  router.post("/resources/upload-video", upload.single("video"), asyncHandler(async (req, res) => {
    const rootDir = await requireWorkspace(configPath);
    if (!req.file) {
      res.status(400).json({ error: "请选择视频文件" });
      return;
    }
    const filename = buildStoredFilename(req.file.originalname);
    await mkdir(path.join(rootDir, "videos"), { recursive: true });
    await import("node:fs/promises").then((fs) => fs.writeFile(getMediaPath(rootDir, "videos", filename), req.file.buffer));
    res.json({ filename });
  }));

  router.delete("/resources/uploaded-video", asyncHandler(async (req, res) => {
    const rootDir = await requireWorkspace(configPath);
    const filename = String(req.body?.filename || "").trim();
    if (!filename) {
      res.status(400).json({ error: "请选择要删除的视频文件" });
      return;
    }
    await removeWorkspaceFile(rootDir, "videos", filename);
    res.json({ ok: true });
  }));

  router.post("/resources/:id/thumbnail", upload.single("thumbnail"), asyncHandler(async (req, res) => {
    const rootDir = await requireWorkspace(configPath);
    if (!req.file) {
      res.status(400).json({ error: "请选择缩略图文件" });
      return;
    }
    const filename = buildStoredFilename(req.file.originalname);
    await mkdir(path.join(rootDir, "thumbs"), { recursive: true });
    await import("node:fs/promises").then((fs) => fs.writeFile(getMediaPath(rootDir, "thumbs", filename), req.file.buffer));
    const current = await readJsonFile(rootDir, "library.json", EMPTY_LIBRARY);
    const data = normalizeLibrary(current.data);
    data.resources = data.resources.map((resource) =>
      resource.id === req.params.id ? { ...resource, thumbnailFilename: filename, updatedAt: new Date().toISOString() } : resource
    );
    const saved = await writeJsonFile(rootDir, "library.json", data, current.mtimeMs);
    res.json({ filename, library: saved });
  }));

  router.delete("/resources/:id/thumbnail", asyncHandler(async (req, res) => {
    const rootDir = await requireWorkspace(configPath);
    const current = await readJsonFile(rootDir, "library.json", EMPTY_LIBRARY);
    const data = normalizeLibrary(current.data);
    const resource = data.resources.find((item) => item.id === req.params.id);
    const thumbnailFilename = resource?.thumbnailFilename || "";
    data.resources = data.resources.map((item) =>
      item.id === req.params.id ? { ...item, thumbnailFilename: "", updatedAt: new Date().toISOString() } : item
    );
    if (req.body?.deleteThumbnailFile && thumbnailFilename) {
      await removeWorkspaceFile(rootDir, "thumbs", thumbnailFilename);
    }
    res.json(await writeJsonFile(rootDir, "library.json", data, current.mtimeMs));
  }));

  router.delete("/resources/:id/video", asyncHandler(async (req, res) => {
    const rootDir = await requireWorkspace(configPath);
    const current = await readJsonFile(rootDir, "library.json", EMPTY_LIBRARY);
    const data = normalizeLibrary(current.data);
    const resource = data.resources.find((item) => item.id === req.params.id);
    const videoFilename = resource?.videoFilename || "";
    data.resources = data.resources.map((item) =>
      item.id === req.params.id ? { ...item, videoFilename: "", updatedAt: new Date().toISOString() } : item
    );
    if (req.body?.deleteVideoFile && videoFilename) {
      await removeWorkspaceFile(rootDir, "videos", videoFilename);
    }
    res.json(await writeJsonFile(rootDir, "library.json", data, current.mtimeMs));
  }));

  router.delete("/resources/:id", asyncHandler(async (req, res) => {
    const rootDir = await requireWorkspace(configPath);
    const current = await readJsonFile(rootDir, "library.json", EMPTY_LIBRARY);
    const data = normalizeLibrary(current.data);
    const resource = data.resources.find((item) => item.id === req.params.id);
    data.resources = data.resources.filter((item) => item.id !== req.params.id);
    if (resource && req.body?.deleteVideoFile && resource.videoFilename) {
      await removeWorkspaceFile(rootDir, "videos", resource.videoFilename);
    }
    if (resource && req.body?.deleteThumbnailFile && resource.thumbnailFilename) {
      await removeWorkspaceFile(rootDir, "thumbs", resource.thumbnailFilename);
    }
    res.json(await writeJsonFile(rootDir, "library.json", data, current.mtimeMs));
  }));

  return router;
}

export async function requireWorkspace(configPath) {
  const config = await readConfig(configPath);
  if (!config.workspaceDir) {
    const error = new Error("Workspace directory is not configured");
    error.status = 400;
    throw error;
  }
  return path.resolve(config.workspaceDir);
}

export function normalizePrompts(data = {}) {
  return {
    categories: Array.isArray(data.categories) ? data.categories : [],
    prompts: Array.isArray(data.prompts) ? data.prompts : []
  };
}

export function normalizeAiSites(data = {}) {
  return {
    sites: Array.isArray(data.sites) ? data.sites : []
  };
}

export function normalizeLibrary(data = {}) {
  return {
    resources: Array.isArray(data.resources) ? data.resources : []
  };
}

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function mergeConfig(current, patch) {
  return {
    ...current,
    ...patch,
    syncthing: {
      ...(current.syncthing || {}),
      ...(patch.syncthing || {})
    }
  };
}

async function syncthingRequest(syncthingConfig, endpoint, options = {}) {
  const apiUrl = String(syncthingConfig?.apiUrl || "").replace(/\/+$/, "");
  const apiKey = String(syncthingConfig?.apiKey || "").trim();
  if (!apiUrl || !apiKey) {
    const error = new Error("请先填写 Syncthing 地址和 API Key");
    error.status = 400;
    throw error;
  }
  let response;
  try {
    response = await fetch(`${apiUrl}${endpoint}`, {
      method: options.method || "GET",
      headers: { "X-API-Key": apiKey }
    });
  } catch (error) {
    const wrapped = new Error("无法连接 Syncthing，请确认 Syncthing 正在运行");
    wrapped.status = 502;
    throw wrapped;
  }
  if (!response.ok) {
    const text = await response.text();
    const error = new Error(text || `Syncthing 请求失败：${response.status}`);
    error.status = response.status;
    throw error;
  }
  const text = await response.text();
  if (!text) return { ok: true };
  try {
    return JSON.parse(text);
  } catch {
    return { ok: true, text };
  }
}

export async function startSyncthing() {
  const command = await findSyncthingCommand();
  await new Promise((resolve, reject) => {
    const child = spawn(command, [], {
      detached: true,
      stdio: "ignore"
    });
    child.once("error", reject);
    child.once("spawn", resolve);
    child.unref();
  });
}

async function findSyncthingCommand() {
  const candidates = [
    "/opt/homebrew/bin/syncthing",
    "/usr/local/bin/syncthing",
    "/opt/local/bin/syncthing",
    "syncthing"
  ];
  for (const candidate of candidates) {
    if (!candidate.includes("/")) return candidate;
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next common install location.
    }
  }
  const error = new Error("未找到 Syncthing 命令，请确认已安装并可在终端运行 syncthing");
  error.status = 404;
  throw error;
}
