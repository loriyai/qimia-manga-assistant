import express from "express";
import multer from "multer";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readConfig, writeConfig } from "./configStore.js";
import { APP_VERSION } from "./version.js";
import {
  ADMIN_SESSION_MS,
  createPasswordRecord,
  deletionDecision,
  normalizeUserId,
  verifyPassword
} from "./accessControl.js";
import {
  EMPTY_ACCESS,
  buildAssetStoredFilename,
  buildStoredFilename,
  EMPTY_AI_SITES,
  EMPTY_LIBRARY,
  EMPTY_IMAGE_ASSETS,
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
  const imageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter: (req, file, callback) => {
      const allowed = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
      if (!allowed.has(file.mimetype)) return callback(httpError("仅支持 JPEG、PNG、WebP、GIF 或 AVIF 图片", 400, "INVALID_IMAGE_TYPE"));
      callback(null, true);
    }
  });
  const sessions = new Map();
  const pendingUploads = new Map();
  const now = options.now || (() => Date.now());

  const getSession = (req, touch = false) => {
    const token = parseCookies(req.headers.cookie || "").qimia_admin_session;
    const session = token ? sessions.get(token) : null;
    if (!session || session.expiresAt <= now()) {
      if (token) sessions.delete(token);
      return null;
    }
    if (touch) session.expiresAt = now() + ADMIN_SESSION_MS;
    return session;
  };

  const requireAdmin = (req) => {
    const session = getSession(req, true);
    if (!session) throw httpError("管理员登录已失效，请重新登录", 401, "ADMIN_AUTH_REQUIRED");
    return session;
  };

  const requireIdentity = async () => {
    const config = await readConfig(configPath);
    if (!config.currentUserId) throw httpError("请先在设置中填写本机用户 ID", 403, "IDENTITY_REQUIRED");
    return config;
  };

  const assertDeleteAllowed = async (req, item) => {
    const config = await readConfig(configPath);
    const session = getSession(req, true);
    const decision = deletionDecision(item, config.currentUserId, Boolean(session?.deleteOverrideEnabled), now());
    if (!decision.allowed) throw httpError(decision.reason, 403, "DELETE_FORBIDDEN");
  };

  const assertEditAllowed = async (req, item) => {
    const config = await readConfig(configPath);
    const session = getSession(req, true);
    const decision = deletionDecision(item, config.currentUserId, Boolean(session?.deleteOverrideEnabled), now());
    if (!decision.allowed) throw httpError(decision.reason.replace("删除", "编辑"), 403, "EDIT_FORBIDDEN");
  };

  router.get("/health", (req, res) => {
    res.json({ ok: true, appName: "七秒漫剧助手", version: APP_VERSION });
  });

  router.get("/config", asyncHandler(async (req, res) => {
    res.json(await readConfig(configPath));
  }));

  router.post("/config", asyncHandler(async (req, res) => {
    const current = await readConfig(configPath);
    const next = mergeConfig(current, req.body || {});
    next.currentUserId = current.currentUserId;
    res.json(await writeConfig(next, configPath));
  }));

  router.get("/access/status", asyncHandler(async (req, res) => {
    const config = await readConfig(configPath);
    const rootDir = await requireWorkspace(configPath);
    const access = await readJsonFile(rootDir, "access.json", EMPTY_ACCESS);
    const session = getSession(req);
    res.json({
      currentUserId: config.currentUserId,
      adminConfigured: Boolean(access.data.admin),
      adminAuthenticated: Boolean(session),
      deleteOverrideEnabled: Boolean(session?.deleteOverrideEnabled),
      sessionExpiresAt: session ? new Date(session.expiresAt).toISOString() : "",
      serverTime: new Date(now()).toISOString(),
      deleteWindowHours: 12
    });
  }));

  router.post("/access/identity", asyncHandler(async (req, res) => {
    const config = await readConfig(configPath);
    const currentUserId = normalizeUserId(req.body?.userId);
    if (config.currentUserId && config.currentUserId !== currentUserId) requireAdmin(req);
    res.json(await writeConfig({ ...config, currentUserId }, configPath));
  }));

  router.post("/admin/setup", asyncHandler(async (req, res) => {
    const rootDir = await requireWorkspace(configPath);
    const access = await readJsonFile(rootDir, "access.json", EMPTY_ACCESS);
    if (access.data.admin) throw httpError("管理员账号已经创建", 409, "ADMIN_ALREADY_CONFIGURED");
    const admin = await createPasswordRecord(req.body?.username, req.body?.password);
    const saved = await writeJsonFile(rootDir, "access.json", { admin: { ...admin, createdAt: new Date(now()).toISOString() } }, access.mtimeMs);
    res.json({ ok: true, adminConfigured: Boolean(saved.data.admin) });
  }));

  router.post("/admin/login", asyncHandler(async (req, res) => {
    const rootDir = await requireWorkspace(configPath);
    const access = await readJsonFile(rootDir, "access.json", EMPTY_ACCESS);
    if (!await verifyPassword(access.data.admin, req.body?.username, req.body?.password)) {
      throw httpError("管理员账号或密码错误", 401, "ADMIN_LOGIN_FAILED");
    }
    const token = randomBytes(32).toString("hex");
    const session = { expiresAt: now() + ADMIN_SESSION_MS, deleteOverrideEnabled: false };
    sessions.set(token, session);
    setSessionCookie(res, token, ADMIN_SESSION_MS);
    res.json({ ok: true, sessionExpiresAt: new Date(session.expiresAt).toISOString() });
  }));

  router.post("/admin/logout", (req, res) => {
    const token = parseCookies(req.headers.cookie || "").qimia_admin_session;
    if (token) sessions.delete(token);
    setSessionCookie(res, "", 0);
    res.json({ ok: true });
  });

  router.post("/admin/delete-override", asyncHandler(async (req, res) => {
    const session = requireAdmin(req);
    session.deleteOverrideEnabled = Boolean(req.body?.enabled);
    res.json({ ok: true, deleteOverrideEnabled: session.deleteOverrideEnabled, sessionExpiresAt: new Date(session.expiresAt).toISOString() });
  }));

  router.post("/admin/password", asyncHandler(async (req, res) => {
    requireAdmin(req);
    const rootDir = await requireWorkspace(configPath);
    const access = await readJsonFile(rootDir, "access.json", EMPTY_ACCESS);
    const admin = await createPasswordRecord(access.data.admin?.username, req.body?.password);
    await writeJsonFile(rootDir, "access.json", { admin: { ...admin, createdAt: access.data.admin?.createdAt, updatedAt: new Date(now()).toISOString() } }, access.mtimeMs);
    res.json({ ok: true });
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
    const config = await requireIdentity();
    const current = await readJsonFile(rootDir, "prompts.json", EMPTY_PROMPTS);
    const incoming = normalizePrompts(req.body.data);
    const data = {
      categories: await reconcileItems(req, current.data.categories || [], incoming.categories, config.currentUserId, assertDeleteAllowed, [], now),
      prompts: await reconcileItems(req, current.data.prompts || [], incoming.prompts, config.currentUserId, assertDeleteAllowed, ["thumbnailFilename"], now)
    };
    res.json(await writeJsonFile(rootDir, "prompts.json", data, req.body.knownMtimeMs));
  }));

  router.get("/ai-sites", asyncHandler(async (req, res) => {
    const rootDir = await requireWorkspace(configPath);
    res.json(await readJsonFile(rootDir, "ai-sites.json", EMPTY_AI_SITES));
  }));

  router.put("/ai-sites", asyncHandler(async (req, res) => {
    const rootDir = await requireWorkspace(configPath);
    const config = await requireIdentity();
    const current = await readJsonFile(rootDir, "ai-sites.json", EMPTY_AI_SITES);
    const incoming = normalizeAiSites(req.body.data);
    const sites = await reconcileItems(req, current.data.sites || [], incoming.sites, config.currentUserId, assertDeleteAllowed, [], now);
    res.json(await writeJsonFile(rootDir, "ai-sites.json", { sites }, req.body.knownMtimeMs));
  }));

  registerImageAssetRoutes({
    router,
    routeName: "characters",
    jsonFilename: "characters.json",
    mediaDir: "characters",
    requiresGender: true,
    imageUpload,
    configPath,
    requireIdentity,
    assertEditAllowed,
    assertDeleteAllowed,
    revealFile: options.revealFile || revealInFileManager,
    now
  });
  registerImageAssetRoutes({
    router,
    routeName: "scenes",
    jsonFilename: "scenes.json",
    mediaDir: "scenes",
    requiresGender: false,
    imageUpload,
    configPath,
    requireIdentity,
    assertEditAllowed,
    assertDeleteAllowed,
    revealFile: options.revealFile || revealInFileManager,
    now
  });

  router.post("/prompts/:id/thumbnail", upload.single("thumbnail"), asyncHandler(async (req, res) => {
    const rootDir = await requireWorkspace(configPath);
    if (!req.file) {
      res.status(400).json({ error: "请选择图片文件" });
      return;
    }
    const current = await readJsonFile(rootDir, "prompts.json", EMPTY_PROMPTS);
    const data = normalizePrompts(current.data);
    const promptItem = data.prompts.find((item) => item.id === req.params.id);
    if (!promptItem) throw httpError("提示词不存在", 404, "NOT_FOUND");
    if (promptItem.thumbnailFilename) await assertDeleteAllowed(req, promptItem);
    const filename = buildStoredFilename(req.file.originalname);
    await mkdir(path.join(rootDir, "thumbs"), { recursive: true });
    await import("node:fs/promises").then((fs) => fs.writeFile(getMediaPath(rootDir, "thumbs", filename), req.file.buffer));
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
    if (!promptItem) throw httpError("提示词不存在", 404, "NOT_FOUND");
    await assertDeleteAllowed(req, promptItem);
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
    const config = await requireIdentity();
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
          createdBy: config.currentUserId,
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
    const config = await requireIdentity();
    const current = await readJsonFile(rootDir, "library.json", EMPTY_LIBRARY);
    const incoming = normalizeLibrary(req.body.data);
    const resources = await reconcileItems(req, current.data.resources || [], incoming.resources, config.currentUserId, assertDeleteAllowed, ["videoFilename", "thumbnailFilename"], now);
    res.json(await writeJsonFile(rootDir, "library.json", { resources }, req.body.knownMtimeMs));
  }));

  router.post("/resources/upload-video", upload.single("video"), asyncHandler(async (req, res) => {
    const rootDir = await requireWorkspace(configPath);
    const config = await requireIdentity();
    for (const [token, pending] of pendingUploads) {
      if (pending.expiresAt <= now()) pendingUploads.delete(token);
    }
    if (!req.file) {
      res.status(400).json({ error: "请选择视频文件" });
      return;
    }
    const filename = buildStoredFilename(req.file.originalname);
    await mkdir(path.join(rootDir, "videos"), { recursive: true });
    await import("node:fs/promises").then((fs) => fs.writeFile(getMediaPath(rootDir, "videos", filename), req.file.buffer));
    const uploadToken = randomBytes(24).toString("hex");
    pendingUploads.set(uploadToken, { filename, rootDir, userId: config.currentUserId, expiresAt: now() + 60 * 60 * 1000 });
    res.json({ filename, uploadToken });
  }));

  router.delete("/resources/uploaded-video", asyncHandler(async (req, res) => {
    const rootDir = await requireWorkspace(configPath);
    const filename = String(req.body?.filename || "").trim();
    const uploadToken = String(req.body?.uploadToken || "").trim();
    const pending = pendingUploads.get(uploadToken);
    if (!filename || !pending || pending.filename !== filename || pending.rootDir !== rootDir || pending.expiresAt <= now()) {
      res.status(400).json({ error: "请选择要删除的视频文件" });
      return;
    }
    const library = await readJsonFile(rootDir, "library.json", EMPTY_LIBRARY);
    if (library.data.resources.some((item) => item.videoFilename === filename)) throw httpError("正式资源中的视频不能作为临时文件删除", 403, "DELETE_FORBIDDEN");
    await removeWorkspaceFile(rootDir, "videos", filename);
    pendingUploads.delete(uploadToken);
    res.json({ ok: true });
  }));

  router.post("/resources/:id/thumbnail", upload.single("thumbnail"), asyncHandler(async (req, res) => {
    const rootDir = await requireWorkspace(configPath);
    if (!req.file) {
      res.status(400).json({ error: "请选择缩略图文件" });
      return;
    }
    const current = await readJsonFile(rootDir, "library.json", EMPTY_LIBRARY);
    const data = normalizeLibrary(current.data);
    const resource = data.resources.find((item) => item.id === req.params.id);
    if (!resource) throw httpError("视频资源不存在", 404, "NOT_FOUND");
    if (resource.thumbnailFilename) await assertDeleteAllowed(req, resource);
    const filename = buildStoredFilename(req.file.originalname);
    await mkdir(path.join(rootDir, "thumbs"), { recursive: true });
    await import("node:fs/promises").then((fs) => fs.writeFile(getMediaPath(rootDir, "thumbs", filename), req.file.buffer));
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
    if (!resource) throw httpError("视频资源不存在", 404, "NOT_FOUND");
    await assertDeleteAllowed(req, resource);
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
    if (!resource) throw httpError("视频资源不存在", 404, "NOT_FOUND");
    await assertDeleteAllowed(req, resource);
    const videoFilename = resource?.videoFilename || "";
    data.resources = data.resources.map((item) =>
      item.id === req.params.id ? { ...item, videoFilename: "", updatedAt: new Date().toISOString() } : item
    );
    if (req.body?.deleteVideoFile && videoFilename) {
      await removeWorkspaceFile(rootDir, "videos", videoFilename);
    }
    res.json(await writeJsonFile(rootDir, "library.json", data, current.mtimeMs));
  }));

  router.delete("/resources/:id/unreferenced-video", asyncHandler(async (req, res) => {
    const rootDir = await requireWorkspace(configPath);
    const current = await readJsonFile(rootDir, "library.json", EMPTY_LIBRARY);
    const resource = current.data.resources.find((item) => item.id === req.params.id);
    if (!resource) throw httpError("视频资源不存在", 404, "NOT_FOUND");
    await assertDeleteAllowed(req, resource);
    const filename = String(req.body?.filename || "").trim();
    if (current.data.resources.some((item) => item.videoFilename === filename)) {
      throw httpError("视频仍被资源引用，不能删除", 409, "MEDIA_STILL_REFERENCED");
    }
    await removeWorkspaceFile(rootDir, "videos", filename);
    res.json({ ok: true });
  }));

  router.delete("/resources/:id", asyncHandler(async (req, res) => {
    const rootDir = await requireWorkspace(configPath);
    const current = await readJsonFile(rootDir, "library.json", EMPTY_LIBRARY);
    const data = normalizeLibrary(current.data);
    const resource = data.resources.find((item) => item.id === req.params.id);
    if (!resource) throw httpError("视频资源不存在", 404, "NOT_FOUND");
    await assertDeleteAllowed(req, resource);
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

function registerImageAssetRoutes(options) {
  const {
    router,
    routeName,
    jsonFilename,
    mediaDir,
    requiresGender,
    imageUpload,
    configPath,
    requireIdentity,
    assertEditAllowed,
    assertDeleteAllowed,
    revealFile,
    now
  } = options;
  const route = `/assets/${routeName}`;

  router.get(route, asyncHandler(async (req, res) => {
    const rootDir = await requireWorkspace(configPath);
    res.json(await readJsonFile(rootDir, jsonFilename, EMPTY_IMAGE_ASSETS));
  }));

  router.post(`${route}/:id/reveal`, asyncHandler(async (req, res) => {
    const rootDir = await requireWorkspace(configPath);
    const current = await readJsonFile(rootDir, jsonFilename, EMPTY_IMAGE_ASSETS);
    const asset = current.data.assets.find((item) => item.id === req.params.id);
    if (!asset) throw httpError("图片资产不存在", 404, "NOT_FOUND");
    let filePath;
    try {
      filePath = getMediaPath(rootDir, mediaDir, asset.imageFilename);
      await access(filePath);
    } catch {
      throw httpError("图片文件不存在", 404, "NOT_FOUND");
    }
    try {
      await revealFile(filePath);
    } catch {
      throw httpError("无法打开图片所在文件夹", 500, "REVEAL_FAILED");
    }
    res.json({ ok: true });
  }));

  router.post(route, imageUpload.single("image"), asyncHandler(async (req, res) => {
    const rootDir = await requireWorkspace(configPath);
    const config = await requireIdentity();
    if (!req.file) throw httpError("请选择图片", 400, "IMAGE_REQUIRED");
    const fields = normalizeImageAssetFields(req.body, requiresGender);
    const timestamp = new Date(now()).toISOString();
    const filename = await storeAssetImage(rootDir, mediaDir, req.file);
    const asset = {
      id: createId(routeName === "characters" ? "character" : "scene"),
      ...fields,
      imageFilename: filename,
      createdBy: config.currentUserId,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    try {
      const saved = await mutateAssetJson(rootDir, jsonFilename, async (data) => {
        data.assets.unshift(asset);
        return { data, asset };
      });
      res.status(201).json({ asset: saved.result.asset, collection: saved.saved });
    } catch (error) {
      await removeWorkspaceFile(rootDir, mediaDir, filename).catch(() => {});
      throw error;
    }
  }));

  router.put(`${route}/:id`, imageUpload.single("image"), asyncHandler(async (req, res) => {
    const rootDir = await requireWorkspace(configPath);
    await requireIdentity();
    const fields = normalizeImageAssetFields(req.body, requiresGender);
    const newFilename = req.file ? await storeAssetImage(rootDir, mediaDir, req.file) : "";
    let oldFilename = "";
    try {
      const saved = await mutateAssetJson(rootDir, jsonFilename, async (data) => {
        const index = data.assets.findIndex((item) => item.id === req.params.id);
        if (index < 0) throw httpError("图片资产不存在", 404, "NOT_FOUND");
        const current = data.assets[index];
        await assertEditAllowed(req, current);
        oldFilename = current.imageFilename;
        data.assets[index] = {
          ...current,
          ...fields,
          imageFilename: newFilename || current.imageFilename,
          createdBy: current.createdBy,
          createdAt: current.createdAt,
          updatedAt: new Date(now()).toISOString()
        };
        return { data, asset: data.assets[index] };
      });
      if (newFilename && oldFilename && oldFilename !== newFilename) await removeWorkspaceFile(rootDir, mediaDir, oldFilename);
      res.json({ asset: saved.result.asset, collection: saved.saved });
    } catch (error) {
      if (newFilename) await removeWorkspaceFile(rootDir, mediaDir, newFilename).catch(() => {});
      throw error;
    }
  }));

  router.delete(`${route}/:id`, asyncHandler(async (req, res) => {
    const rootDir = await requireWorkspace(configPath);
    let removed = null;
    const saved = await mutateAssetJson(rootDir, jsonFilename, async (data) => {
      const index = data.assets.findIndex((item) => item.id === req.params.id);
      if (index < 0) throw httpError("图片资产不存在", 404, "NOT_FOUND");
      removed = data.assets[index];
      await assertDeleteAllowed(req, removed);
      data.assets.splice(index, 1);
      return { data, asset: removed };
    });
    if (removed?.imageFilename) await removeWorkspaceFile(rootDir, mediaDir, removed.imageFilename);
    res.json({ deletedId: req.params.id, collection: saved.saved });
  }));
}

async function mutateAssetJson(rootDir, jsonFilename, mutator) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = await readJsonFile(rootDir, jsonFilename, EMPTY_IMAGE_ASSETS);
    const data = { assets: Array.isArray(current.data.assets) ? [...current.data.assets] : [] };
    const result = await mutator(data);
    try {
      const saved = await writeJsonFile(rootDir, jsonFilename, result.data, current.mtimeMs);
      return { saved, result };
    } catch (error) {
      lastError = error;
      if (error.code !== "STALE_FILE" || attempt === 1) throw error;
    }
  }
  throw lastError;
}

async function storeAssetImage(rootDir, mediaDir, file) {
  await mkdir(path.join(rootDir, mediaDir), { recursive: true });
  const originalName = decodeMultipartFilename(file.originalname);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const filename = buildAssetStoredFilename(originalName, file.mimetype);
    try {
      await writeFile(getMediaPath(rootDir, mediaDir, filename), file.buffer, { flag: "wx" });
      return filename;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  throw httpError("无法生成唯一的图片文件名，请重试", 500, "FILENAME_COLLISION");
}

function decodeMultipartFilename(filename) {
  const value = String(filename || "");
  const decoded = Buffer.from(value, "latin1").toString("utf8");
  return decoded.includes("\uFFFD") ? value : decoded;
}

function normalizeImageAssetFields(body, requiresGender) {
  const title = String(body?.title || "").trim();
  const style = String(body?.style || "");
  const era = String(body?.era || "");
  const gender = String(body?.gender || "");
  if (!title) throw httpError("请输入标题", 400, "TITLE_REQUIRED");
  if (!new Set(["anime", "live"]).has(style)) throw httpError("请选择动漫或真人", 400, "INVALID_STYLE");
  if (!new Set(["ancient", "modern"]).has(era)) throw httpError("请选择古代或现代", 400, "INVALID_ERA");
  if (requiresGender && !new Set(["male", "female"]).has(gender)) throw httpError("请选择男或女", 400, "INVALID_GENDER");
  const tags = String(body?.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean);
  return { title, tags, style, era, ...(requiresGender ? { gender } : {}) };
}

async function reconcileItems(req, currentItems, incomingItems, currentUserId, assertDeleteAllowed, destructiveFields = [], clock = Date.now) {
  const currentById = new Map(currentItems.map((item) => [item.id, item]));
  const incomingIds = new Set(incomingItems.map((item) => item.id));
  if (incomingIds.size !== incomingItems.length) throw httpError("内容 ID 不能重复", 400, "DUPLICATE_ITEM_ID");
  for (const item of currentItems) {
    if (!incomingIds.has(item.id)) await assertDeleteAllowed(req, item);
  }

  const timestamp = new Date(clock()).toISOString();
  const result = [];
  for (const incoming of incomingItems) {
    if (!incoming?.id) throw httpError("内容 ID 无效", 400, "INVALID_ITEM_ID");
    const current = currentById.get(incoming.id);
    if (!current) {
      result.push({ ...incoming, createdBy: currentUserId, createdAt: timestamp, updatedAt: incoming.updatedAt || timestamp });
      continue;
    }
    for (const field of destructiveFields) {
      if (current[field] && current[field] !== incoming[field]) await assertDeleteAllowed(req, current);
    }
    result.push({ ...incoming, createdBy: current.createdBy, createdAt: current.createdAt });
  }
  return result;
}

function parseCookies(cookieHeader) {
  return Object.fromEntries(String(cookieHeader || "").split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const separator = part.indexOf("=");
    if (separator < 0) return [part, ""];
    return [decodeURIComponent(part.slice(0, separator)), decodeURIComponent(part.slice(separator + 1))];
  }));
}

function setSessionCookie(res, token, maxAgeMs) {
  const parts = [
    `qimia_admin_session=${encodeURIComponent(token)}`,
    "Path=/api",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}`
  ];
  res.setHeader("Set-Cookie", parts.join("; "));
}

function httpError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
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

export function getRevealCommand(filePath, platform = process.platform) {
  if (platform === "darwin") return { command: "open", args: ["-R", filePath] };
  if (platform === "win32") return { command: "explorer.exe", args: ["/select,", filePath] };
  return { command: "xdg-open", args: [path.dirname(filePath)] };
}

export async function revealInFileManager(filePath, options = {}) {
  const { command, args } = getRevealCommand(filePath, options.platform);
  const spawnImpl = options.spawnImpl || spawn;
  await new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref?.();
      resolve();
    });
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
