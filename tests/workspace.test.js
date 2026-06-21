import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertSafeFilename,
  initWorkspace,
  migrateWorkspace,
  readJsonFile,
  removeWorkspaceFile,
  writeJsonFile
} from "../src/workspace.js";

async function makeWorkspace() {
  return mkdtemp(path.join(tmpdir(), "qimia-workspace-"));
}

describe("workspace storage", () => {
  it("creates the expected synced directory structure", async () => {
    const rootDir = await makeWorkspace();

    await initWorkspace(rootDir);

    await expect(stat(path.join(rootDir, "videos"))).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    await expect(stat(path.join(rootDir, "thumbs"))).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    await expect(stat(path.join(rootDir, "backups"))).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    await expect(stat(path.join(rootDir, "characters"))).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    await expect(stat(path.join(rootDir, "scenes"))).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    await expect(readJsonFile(rootDir, "library.json", { resources: [] })).resolves.toMatchObject({
      data: { resources: [] },
      mtimeMs: expect.any(Number)
    });
    await expect(readJsonFile(rootDir, "prompts.json", { categories: [], prompts: [] })).resolves.toMatchObject({
      data: { categories: [], prompts: [] },
      mtimeMs: expect.any(Number)
    });
    await expect(readJsonFile(rootDir, "access.json", { admin: null })).resolves.toMatchObject({
      data: { admin: null },
      mtimeMs: expect.any(Number)
    });
    await expect(readJsonFile(rootDir, "characters.json", { assets: [] })).resolves.toMatchObject({ data: { assets: [] } });
    await expect(readJsonFile(rootDir, "scenes.json", { assets: [] })).resolves.toMatchObject({ data: { assets: [] } });
  });

  it("backs up the old JSON before overwriting it", async () => {
    const rootDir = await makeWorkspace();
    await initWorkspace(rootDir);
    const first = await writeJsonFile(rootDir, "prompts.json", { categories: ["镜头"], prompts: [] });

    await writeJsonFile(rootDir, "prompts.json", { categories: ["镜头", "人物"], prompts: [] }, first.mtimeMs);

    const backupDir = path.join(rootDir, "backups");
    const backupFiles = await import("node:fs/promises").then((fs) => fs.readdir(backupDir));
    expect(backupFiles.some((file) => file.includes("prompts"))).toBe(true);
  });

  it("creates missing workspace directories when reading JSON", async () => {
    const parentDir = await makeWorkspace();
    const rootDir = path.join(parentDir, "nested-workspace");

    await expect(readJsonFile(rootDir, "prompts.json", { categories: [], prompts: [] })).resolves.toMatchObject({
      data: { categories: [], prompts: [] },
      mtimeMs: expect.any(Number)
    });
    await expect(stat(rootDir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
  });

  it("rejects stale writes when a synced file changed on disk", async () => {
    const rootDir = await makeWorkspace();
    await initWorkspace(rootDir);
    const first = await writeJsonFile(rootDir, "library.json", { resources: [] });

    await writeFile(path.join(rootDir, "library.json"), JSON.stringify({ resources: [{ id: "other" }] }));

    await expect(
      writeJsonFile(rootDir, "library.json", { resources: [{ id: "mine" }] }, first.mtimeMs)
    ).rejects.toMatchObject({ code: "STALE_FILE" });
  });

  it("prevents unsafe filenames from escaping media directories", () => {
    expect(assertSafeFilename("clip.mp4")).toBe("clip.mp4");
    expect(() => assertSafeFilename("../clip.mp4")).toThrow("Unsafe filename");
    expect(() => assertSafeFilename("nested/clip.mp4")).toThrow("Unsafe filename");
  });

  it("removes a workspace file only from the requested media folder", async () => {
    const rootDir = await makeWorkspace();
    await initWorkspace(rootDir);
    await writeFile(path.join(rootDir, "thumbs", "shot.png"), "fake");

    await removeWorkspaceFile(rootDir, "thumbs", "shot.png");

    await expect(readFile(path.join(rootDir, "thumbs", "shot.png"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("migrates workspace files to another directory", async () => {
    const sourceDir = await makeWorkspace();
    const targetDir = await makeWorkspace();
    await initWorkspace(sourceDir);
    await writeJsonFile(sourceDir, "library.json", { resources: [{ id: "res-1", videoFilename: "clip.mp4" }] });
    await writeFile(path.join(sourceDir, "videos", "clip.mp4"), "fake-video");

    await migrateWorkspace(sourceDir, targetDir);

    await expect(readJsonFile(targetDir, "library.json", { resources: [] })).resolves.toMatchObject({
      data: { resources: [{ id: "res-1", videoFilename: "clip.mp4" }] },
      mtimeMs: expect.any(Number)
    });
    await expect(readFile(path.join(targetDir, "videos", "clip.mp4"), "utf8")).resolves.toBe("fake-video");
  });
});
