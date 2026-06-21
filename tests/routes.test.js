import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp, getListenErrorMessage } from "../src/server.js";
import { getRevealCommand } from "../src/routes.js";
import { initWorkspace } from "../src/workspace.js";

async function makeAppWithWorkspace(options = {}) {
  const rootDir = await mkdtemp(path.join(tmpdir(), "qimia-routes-"));
  const app = createApp({ ...options, configPath: path.join(rootDir, "config.json") });
  await request(app).post("/api/config").send({ workspaceDir: rootDir }).expect(200);
  await request(app).post("/api/workspace/init").expect(200);
  await request(app).post("/api/access/identity").send({ userId: "test-user" }).expect(200);
  return { app, rootDir };
}

describe("routes", () => {
  it("returns app health metadata", async () => {
    const app = createApp();

    const response = await request(app).get("/api/health").expect(200);

    expect(response.body).toEqual({ ok: true, appName: "七秒漫剧助手", version: "0.5.1" });
  });

  it("builds platform-specific commands for revealing an image file", () => {
    expect(getRevealCommand("/tmp/characters/hero.png", "darwin"))
      .toEqual({ command: "open", args: ["-R", "/tmp/characters/hero.png"] });
    expect(getRevealCommand("C:\\assets\\hero.png", "win32"))
      .toEqual({ command: "explorer.exe", args: ["/select,", "C:\\assets\\hero.png"] });
    expect(getRevealCommand("/tmp/characters/hero.png", "linux"))
      .toEqual({ command: "xdg-open", args: ["/tmp/characters"] });
  });

  it("merges workspace and Syncthing config updates", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "qimia-config-"));
    const configPath = path.join(rootDir, "config.json");
    const app = createApp({ configPath });

    await request(app)
      .post("/api/config")
      .send({
        workspaceDir: rootDir,
        syncthing: {
          apiUrl: "http://127.0.0.1:8384",
          apiKey: "secret",
          folderId: "TeamMangaResources"
        }
      })
      .expect(200);
    await request(app).post("/api/config").send({ workspaceDir: path.join(rootDir, "next") }).expect(200);

    const config = await request(app).get("/api/config").expect(200);
    expect(config.body.workspaceDir).toBe(path.join(rootDir, "next"));
    expect(config.body.syncthing).toEqual({
      apiUrl: "http://127.0.0.1:8384",
      apiKey: "secret",
      folderId: "TeamMangaResources"
    });
  });

  it("saves and reads prompt library JSON", async () => {
    const { app } = await makeAppWithWorkspace();
    const initial = await request(app).get("/api/prompts").expect(200);

    await request(app)
      .put("/api/prompts")
      .send({
        knownMtimeMs: initial.body.mtimeMs,
        data: {
          categories: [{ id: "cat-1", name: "镜头" }],
          prompts: [{ id: "prompt-1", categoryId: "cat-1", title: "开场", text: "黄昏街道", description: "" }]
        }
      })
      .expect(200);

    const saved = await request(app).get("/api/prompts").expect(200);
    expect(saved.body.data.prompts[0].text).toBe("黄昏街道");
  });

  it("uploads and deletes prompt thumbnails in the workspace thumbs directory", async () => {
    const { app, rootDir } = await makeAppWithWorkspace();
    const initial = await request(app).get("/api/prompts").expect(200);
    await request(app)
      .put("/api/prompts")
      .send({
        knownMtimeMs: initial.body.mtimeMs,
        data: {
          categories: [],
          prompts: [{ id: "prompt-1", title: "角色", text: "红发少女", description: "" }]
        }
      })
      .expect(200);

    const uploaded = await request(app)
      .post("/api/prompts/prompt-1/thumbnail")
      .attach("thumbnail", Buffer.from("fake-image"), "shot.png")
      .expect(200);

    expect(uploaded.body.filename).toMatch(/shot\.png$/);
    await expect(readFile(path.join(rootDir, "thumbs", uploaded.body.filename), "utf8")).resolves.toBe("fake-image");
    expect(uploaded.body.prompts.data.prompts[0].thumbnailFilename).toBe(uploaded.body.filename);

    await request(app)
      .delete("/api/prompts/prompt-1/thumbnail")
      .send({ deleteThumbnailFile: true })
      .expect(200);

    const saved = await request(app).get("/api/prompts").expect(200);
    expect(saved.body.data.prompts[0].thumbnailFilename).toBe("");
    await request(app).get(`/media/thumb/${uploaded.body.filename}`).expect(404);
  });

  it("saves and reads synced AI website entries", async () => {
    const { app } = await makeAppWithWorkspace();
    const initial = await request(app).get("/api/ai-sites").expect(200);

    await request(app)
      .put("/api/ai-sites")
      .send({
        knownMtimeMs: initial.body.mtimeMs,
        data: { sites: [{ id: "site-1", title: "模型站", url: "https://example.com" }] }
      })
      .expect(200);

    const saved = await request(app).get("/api/ai-sites").expect(200);
    expect(saved.body.data.sites[0]).toMatchObject({ title: "模型站", url: "https://example.com" });
  });

  it("saves library resources and serves safe media files", async () => {
    const { app, rootDir } = await makeAppWithWorkspace();
    await initWorkspace(rootDir);
    await writeFile(path.join(rootDir, "videos", "clip.mp4"), "fake-video");
    const initial = await request(app).get("/api/library").expect(200);

    await request(app)
      .put("/api/library")
      .send({
        knownMtimeMs: initial.body.mtimeMs,
        data: {
          resources: [
            {
              id: "res-1",
              title: "雨夜",
              videoFilename: "clip.mp4",
              thumbnailFilename: "",
              prompt: "雨夜霓虹街道",
              description: "",
              tags: []
            }
          ]
        }
      })
      .expect(200);

    const media = await request(app).get("/media/video/clip.mp4").expect(200);
    expect(media.body.toString()).toBe("fake-video");
  });

  it("refreshes the library by importing untracked workspace video files", async () => {
    const { app, rootDir } = await makeAppWithWorkspace();
    await writeFile(path.join(rootDir, "videos", "existing.mp4"), "existing-video");
    await writeFile(path.join(rootDir, "videos", "loose-a.mp4"), "loose-a");
    await writeFile(path.join(rootDir, "videos", "loose-b.webm"), "loose-b");
    await writeFile(path.join(rootDir, "videos", "notes.txt"), "not-video");
    const initial = await request(app).get("/api/library").expect(200);
    await request(app)
      .put("/api/library")
      .send({
        knownMtimeMs: initial.body.mtimeMs,
        data: {
          resources: [{ id: "res-existing", title: "已有", videoFilename: "existing.mp4", tags: [] }]
        }
      })
      .expect(200);

    const refreshed = await request(app).post("/api/library/refresh").expect(200);

    expect(refreshed.body.data.resources).toHaveLength(3);
    expect(refreshed.body.data.resources.slice(0, 2).map((item) => item.title)).toEqual([
      "请检查是否多余1",
      "请检查是否多余2"
    ]);
    expect(refreshed.body.data.resources.map((item) => item.videoFilename)).toEqual([
      "loose-a.mp4",
      "loose-b.webm",
      "existing.mp4"
    ]);
  });

  it("uploads selected videos into the workspace videos directory", async () => {
    const { app, rootDir } = await makeAppWithWorkspace();

    const response = await request(app)
      .post("/api/resources/upload-video")
      .attach("video", Buffer.from("uploaded-video"), "picked.mp4")
      .expect(200);

    expect(response.body.filename).toMatch(/picked\.mp4$/);
    await expect(readFile(path.join(rootDir, "videos", response.body.filename), "utf8")).resolves.toBe("uploaded-video");
  });

  it("deletes video references and optionally deletes the workspace video file", async () => {
    const { app, rootDir } = await makeAppWithWorkspace();
    await writeFile(path.join(rootDir, "videos", "clip.mp4"), "fake-video");
    const initial = await request(app).get("/api/library").expect(200);
    await request(app)
      .put("/api/library")
      .send({
        knownMtimeMs: initial.body.mtimeMs,
        data: {
          resources: [
            {
              id: "res-1",
              title: "镜头",
              videoFilename: "clip.mp4",
              thumbnailFilename: "",
              prompt: "提示词",
              description: "",
              tags: []
            }
          ]
        }
      })
      .expect(200);

    await request(app).delete("/api/resources/res-1/video").send({ deleteVideoFile: true }).expect(200);

    const library = await request(app).get("/api/library").expect(200);
    expect(library.body.data.resources[0].videoFilename).toBe("");
    await request(app).get("/media/video/clip.mp4").expect(404);
  });

  it("deletes thumbnail references and optionally deletes the local file", async () => {
    const { app, rootDir } = await makeAppWithWorkspace();
    await writeFile(path.join(rootDir, "thumbs", "shot.png"), "fake-thumb");
    const initial = await request(app).get("/api/library").expect(200);
    await request(app)
      .put("/api/library")
      .send({
        knownMtimeMs: initial.body.mtimeMs,
        data: {
          resources: [
            {
              id: "res-1",
              title: "镜头",
              videoFilename: "",
              thumbnailFilename: "shot.png",
              prompt: "提示词",
              description: "",
              tags: []
            }
          ]
        }
      })
      .expect(200);

    await request(app).delete("/api/resources/res-1/thumbnail").send({ deleteThumbnailFile: true }).expect(200);

    const library = await request(app).get("/api/library").expect(200);
    expect(library.body.data.resources[0].thumbnailFilename).toBe("");
    await request(app).get("/media/thumb/shot.png").expect(404);
  });

  it("migrates the configured workspace and serves files from the new location", async () => {
    const { app, rootDir } = await makeAppWithWorkspace();
    const targetDir = await mkdtemp(path.join(tmpdir(), "qimia-routes-target-"));
    await writeFile(path.join(rootDir, "videos", "clip.mp4"), "fake-video");
    const initial = await request(app).get("/api/library").expect(200);
    await request(app)
      .put("/api/library")
      .send({
        knownMtimeMs: initial.body.mtimeMs,
        data: { resources: [{ id: "res-1", title: "迁移", videoFilename: "clip.mp4" }] }
      })
      .expect(200);

    const migrated = await request(app)
      .post("/api/workspace/migrate")
      .send({ workspaceDir: targetDir })
      .expect(200);

    expect(migrated.body.workspaceDir).toBe(path.resolve(targetDir));
    await expect(readFile(path.join(targetDir, "videos", "clip.mp4"), "utf8")).resolves.toBe("fake-video");
    const media = await request(app).get("/media/video/clip.mp4").expect(200);
    expect(media.body.toString()).toBe("fake-video");
  });

  it("returns a friendly message when the default port is already in use", () => {
    const message = getListenErrorMessage({ code: "EADDRINUSE" }, 5177);

    expect(message).toContain("5177");
    expect(message).toContain("已经被占用");
    expect(message).toContain("PORT=5178");
  });

  it("enforces ownership, the 12-hour limit, and administrator override", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "qimia-access-routes-"));
    const configPath = path.join(rootDir, "config.json");
    let currentTime = Date.parse("2026-06-20T00:00:00.000Z");
    const app = createApp({ configPath, now: () => currentTime });
    const agent = request.agent(app);
    await agent.post("/api/config").send({ workspaceDir: rootDir }).expect(200);
    await agent.post("/api/workspace/init").expect(200);
    await agent.post("/api/access/identity").send({ userId: "alice" }).expect(200);

    const initial = await agent.get("/api/prompts").expect(200);
    const created = await agent.put("/api/prompts").send({
      knownMtimeMs: initial.body.mtimeMs,
      data: {
        categories: [],
        prompts: [{ id: "protected-prompt", title: "保护内容", text: "text", createdBy: "mallory", createdAt: "2000-01-01T00:00:00.000Z" }]
      }
    }).expect(200);
    expect(created.body.data.prompts[0]).toMatchObject({
      createdBy: "alice",
      createdAt: "2026-06-20T00:00:00.000Z"
    });

    currentTime += 12 * 60 * 60 * 1000;
    const denied = await agent.put("/api/prompts").send({
      knownMtimeMs: created.body.mtimeMs,
      data: { categories: [], prompts: [] }
    }).expect(403);
    expect(denied.body.code).toBe("DELETE_FORBIDDEN");

    await agent.post("/api/admin/setup").send({ username: "admin", password: "password-123" }).expect(200);
    const publicStatus = await agent.get("/api/access/status").expect(200);
    expect(JSON.stringify(publicStatus.body)).not.toContain("passwordHash");
    const storedAccess = JSON.parse(await readFile(path.join(rootDir, "access.json"), "utf8"));
    expect(storedAccess.admin.passwordHash).toEqual(expect.any(String));
    expect(JSON.stringify(storedAccess)).not.toContain("password-123");
    await agent.post("/api/access/identity").send({ userId: "bob" }).expect(401);
    await agent.post("/api/admin/login").send({ username: "admin", password: "password-123" }).expect(200);
    await agent.post("/api/access/identity").send({ userId: "bob" }).expect(200);
    await agent.post("/api/admin/delete-override").send({ enabled: true }).expect(200);
    await agent.put("/api/prompts").send({
      knownMtimeMs: created.body.mtimeMs,
      data: { categories: [], prompts: [] }
    }).expect(200);

    currentTime += 30 * 60 * 1000;
    const status = await agent.get("/api/access/status").expect(200);
    expect(status.body).toMatchObject({ adminAuthenticated: false, deleteOverrideEnabled: false });
  });

  it("requires an upload token and protects referenced videos from temporary cleanup", async () => {
    const { app, rootDir } = await makeAppWithWorkspace();
    const uploaded = await request(app)
      .post("/api/resources/upload-video")
      .attach("video", Buffer.from("temporary-video"), "temporary.mp4")
      .expect(200);
    expect(uploaded.body.uploadToken).toEqual(expect.any(String));

    await request(app).delete("/api/resources/uploaded-video")
      .send({ filename: uploaded.body.filename, uploadToken: "wrong" })
      .expect(400);

    const initial = await request(app).get("/api/library").expect(200);
    await request(app).put("/api/library").send({
      knownMtimeMs: initial.body.mtimeMs,
      data: { resources: [{ id: "res-upload", title: "已保存", videoFilename: uploaded.body.filename }] }
    }).expect(200);
    const denied = await request(app).delete("/api/resources/uploaded-video")
      .send({ filename: uploaded.body.filename, uploadToken: uploaded.body.uploadToken })
      .expect(403);
    expect(denied.body.code).toBe("DELETE_FORBIDDEN");
    await expect(readFile(path.join(rootDir, "videos", uploaded.body.filename), "utf8")).resolves.toBe("temporary-video");
  });

  it("creates, replaces, serves, and deletes character image assets", async () => {
    const { app, rootDir } = await makeAppWithWorkspace();
    const created = await request(app)
      .post("/api/assets/characters")
      .field("title", "剑客")
      .field("tags", "黑衣, 长剑")
      .field("style", "anime")
      .field("era", "ancient")
      .field("gender", "male")
      .field("createdBy", "spoofed")
      .attach("image", Buffer.from("old-image"), { filename: "剑客 立绘.png", contentType: "image/png" })
      .expect(201);
    expect(created.body.asset).toMatchObject({
      title: "剑客",
      tags: ["黑衣", "长剑"],
      style: "anime",
      era: "ancient",
      gender: "male",
      createdBy: "test-user"
    });
    const oldFilename = created.body.asset.imageFilename;
    expect(oldFilename).toMatch(/^剑客 立绘-[0-9a-f]{8}\.png$/);
    await expect(readFile(path.join(rootDir, "characters", oldFilename), "utf8")).resolves.toBe("old-image");
    await request(app).get(`/media/characters/${oldFilename}`).expect(200);

    const updated = await request(app)
      .put(`/api/assets/characters/${created.body.asset.id}`)
      .field("title", "女剑客")
      .field("tags", "红衣")
      .field("style", "live")
      .field("era", "modern")
      .field("gender", "female")
      .attach("image", Buffer.from("new-image"), { filename: "replacement.webp", contentType: "image/webp" })
      .expect(200);
    expect(updated.body.asset).toMatchObject({ title: "女剑客", style: "live", era: "modern", gender: "female" });
    expect(updated.body.asset.imageFilename).toMatch(/^replacement-[0-9a-f]{8}\.webp$/);
    await expect(readFile(path.join(rootDir, "characters", oldFilename))).rejects.toMatchObject({ code: "ENOENT" });

    await request(app).delete(`/api/assets/characters/${created.body.asset.id}`).expect(200);
    await expect(readFile(path.join(rootDir, "characters", updated.body.asset.imageFilename))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reveals character and scene image files by asset id without accepting a client path", async () => {
    const revealed = [];
    let revealShouldFail = false;
    const { app, rootDir } = await makeAppWithWorkspace({
      revealFile: async (filePath) => {
        if (revealShouldFail) throw new Error("failed");
        revealed.push(filePath);
      }
    });
    const character = await request(app).post("/api/assets/characters")
      .field("title", "人物")
      .field("style", "anime")
      .field("era", "ancient")
      .field("gender", "female")
      .attach("image", Buffer.from("character"), { filename: "hero.png", contentType: "image/png" })
      .expect(201);
    const scene = await request(app).post("/api/assets/scenes")
      .field("title", "场景")
      .field("style", "live")
      .field("era", "modern")
      .attach("image", Buffer.from("scene"), { filename: "street.jpg", contentType: "image/jpeg" })
      .expect(201);
    const duplicateName = await request(app).post("/api/assets/characters")
      .field("title", "另一个人物")
      .field("style", "anime")
      .field("era", "ancient")
      .field("gender", "male")
      .attach("image", Buffer.from("second-character"), { filename: "hero.png", contentType: "image/png" })
      .expect(201);
    expect(character.body.asset.imageFilename).toMatch(/^hero-[0-9a-f]{8}\.png$/);
    expect(duplicateName.body.asset.imageFilename).toMatch(/^hero-[0-9a-f]{8}\.png$/);
    expect(duplicateName.body.asset.imageFilename).not.toBe(character.body.asset.imageFilename);
    await expect(readFile(path.join(rootDir, "characters", character.body.asset.imageFilename), "utf8")).resolves.toBe("character");
    await expect(readFile(path.join(rootDir, "characters", duplicateName.body.asset.imageFilename), "utf8")).resolves.toBe("second-character");

    await request(app).post(`/api/assets/characters/${character.body.asset.id}/reveal`)
      .send({ filePath: "/tmp/not-allowed" })
      .expect(200);
    await request(app).post(`/api/assets/scenes/${scene.body.asset.id}/reveal`).expect(200);
    expect(revealed).toEqual([
      path.join(rootDir, "characters", character.body.asset.imageFilename),
      path.join(rootDir, "scenes", scene.body.asset.imageFilename)
    ]);
    const legacyFilename = "1700000000000-abcd1234-character.png";
    await writeFile(path.join(rootDir, "characters", legacyFilename), "legacy-character");
    const charactersPath = path.join(rootDir, "characters.json");
    const charactersData = JSON.parse(await readFile(charactersPath, "utf8"));
    charactersData.assets.push({
      id: "legacy-character",
      title: "旧人物",
      tags: [],
      style: "anime",
      era: "ancient",
      gender: "female",
      imageFilename: legacyFilename,
      createdBy: "test-user",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    await writeFile(charactersPath, JSON.stringify(charactersData));
    await request(app).post("/api/assets/characters/legacy-character/reveal").expect(200);
    expect(revealed.at(-1)).toBe(path.join(rootDir, "characters", legacyFilename));
    await request(app).delete("/api/assets/characters/legacy-character").expect(200);
    await request(app).post("/api/assets/characters/missing/reveal").expect(404);
    revealShouldFail = true;
    const failed = await request(app).post(`/api/assets/characters/${character.body.asset.id}/reveal`).expect(500);
    expect(failed.body.code).toBe("REVEAL_FAILED");
  });

  it("stores scenes without gender and enforces the 12-hour edit/delete boundary", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "qimia-scene-routes-"));
    const configPath = path.join(rootDir, "config.json");
    let currentTime = Date.parse("2026-06-21T00:00:00.000Z");
    const app = createApp({ configPath, now: () => currentTime });
    const agent = request.agent(app);
    await agent.post("/api/config").send({ workspaceDir: rootDir }).expect(200);
    await agent.post("/api/workspace/init").expect(200);
    await agent.post("/api/access/identity").send({ userId: "scene-owner" }).expect(200);
    const created = await agent.post("/api/assets/scenes")
      .field("title", "古城")
      .field("tags", "城门")
      .field("style", "anime")
      .field("era", "ancient")
      .field("gender", "male")
      .attach("image", Buffer.from("scene-image"), { filename: "scene.jpg", contentType: "image/jpeg" })
      .expect(201);
    expect(created.body.asset.gender).toBeUndefined();

    currentTime += 12 * 60 * 60 * 1000;
    const editDenied = await agent.put(`/api/assets/scenes/${created.body.asset.id}`)
      .field("title", "新古城")
      .field("tags", "城门")
      .field("style", "anime")
      .field("era", "ancient")
      .expect(403);
    expect(editDenied.body.code).toBe("EDIT_FORBIDDEN");
    const deleteDenied = await agent.delete(`/api/assets/scenes/${created.body.asset.id}`).expect(403);
    expect(deleteDenied.body.code).toBe("DELETE_FORBIDDEN");

    await agent.post("/api/admin/setup").send({ username: "admin", password: "password-123" }).expect(200);
    await agent.post("/api/admin/login").send({ username: "admin", password: "password-123" }).expect(200);
    await agent.post("/api/admin/delete-override").send({ enabled: true }).expect(200);
    await agent.delete(`/api/assets/scenes/${created.body.asset.id}`).expect(200);
  });
});
