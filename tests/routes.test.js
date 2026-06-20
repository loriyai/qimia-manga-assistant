import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp, getListenErrorMessage } from "../src/server.js";
import { initWorkspace } from "../src/workspace.js";

async function makeAppWithWorkspace() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "qimia-routes-"));
  const app = createApp({ configPath: path.join(rootDir, "config.json") });
  await request(app).post("/api/config").send({ workspaceDir: rootDir }).expect(200);
  await request(app).post("/api/workspace/init").expect(200);
  return { app, rootDir };
}

describe("routes", () => {
  it("returns app health metadata", async () => {
    const app = createApp();

    const response = await request(app).get("/api/health").expect(200);

    expect(response.body).toEqual({ ok: true, appName: "七秒漫剧助手" });
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
});
