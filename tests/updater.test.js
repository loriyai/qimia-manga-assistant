import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyPreparedUpdate, compareVersions, isSafeManagedPath, runUpdater, sha256File, validateUpdateManifest } from "../src/updater.js";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("updater", () => {
  it("compares stable semantic versions", () => {
    expect(compareVersions("0.2.0", "0.1.9")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.2.3", "2.0.0")).toBe(-1);
    expect(() => compareVersions("1.0.0-beta", "1.0.0")).toThrow();
  });

  it("validates update manifests and checksums", async () => {
    const directory = await makeTempDir();
    const filename = path.join(directory, "package.zip");
    await writeFile(filename, "release");
    const sha256 = await sha256File(filename);
    expect(validateUpdateManifest({
      version: "0.2.0",
      packageUrl: "https://example.com/package.zip",
      sha256,
      minimumNodeVersion: "20"
    })).toMatchObject({ version: "0.2.0", sha256 });
    expect(() => validateUpdateManifest({ version: "beta" })).toThrow();
  });

  it("rejects protected and escaping managed paths", () => {
    expect(isSafeManagedPath("src/server.js")).toBe(true);
    expect(isSafeManagedPath("workspace/prompts.json")).toBe(false);
    expect(isSafeManagedPath("node_modules/pkg/index.js")).toBe(false);
    expect(isSafeManagedPath("../outside.txt")).toBe(false);
  });

  it("skips update checks until a repository is configured", async () => {
    const directory = await makeTempDir();
    await writeFile(path.join(directory, "package.json"), JSON.stringify({ version: "0.2.0", qimiaUpdater: { repository: "" } }));
    await expect(runUpdater({ rootDir: directory })).resolves.toEqual({ status: "not-configured" });
  });

  it("updates managed files while preserving workspace and keeping a backup", async () => {
    const directory = await makeTempDir();
    const rootDir = path.join(directory, "app");
    const releaseRoot = path.join(directory, "release");
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await mkdir(path.join(rootDir, "workspace"), { recursive: true });
    await mkdir(path.join(rootDir, "node_modules", "old"), { recursive: true });
    await mkdir(path.join(releaseRoot, "src"), { recursive: true });
    await mkdir(path.join(releaseRoot, "node_modules", "new"), { recursive: true });
    await writeFile(path.join(rootDir, "src", "server.js"), "old");
    await writeFile(path.join(rootDir, "workspace", "prompts.json"), "user-data");
    await writeFile(path.join(rootDir, "node_modules", "old", "index.js"), "old-module");
    await writeFile(path.join(rootDir, ".update-files.json"), JSON.stringify({ files: ["src/server.js", ".update-files.json"] }));
    await writeFile(path.join(releaseRoot, "src", "server.js"), "new");
    await writeFile(path.join(releaseRoot, "node_modules", "new", "index.js"), "new-module");
    await writeFile(path.join(releaseRoot, ".update-files.json"), JSON.stringify({ files: ["src/server.js", ".update-files.json"] }));

    await applyPreparedUpdate({
      rootDir,
      releaseRoot,
      updateFiles: ["src/server.js", ".update-files.json"],
      fromVersion: "0.1.0",
      toVersion: "0.2.0"
    });

    expect(await readFile(path.join(rootDir, "src", "server.js"), "utf8")).toBe("new");
    expect(await readFile(path.join(rootDir, "workspace", "prompts.json"), "utf8")).toBe("user-data");
    expect(await readFile(path.join(rootDir, "node_modules", "new", "index.js"), "utf8")).toBe("new-module");
    const backups = await import("node:fs/promises").then(({ readdir }) => readdir(path.join(rootDir, ".updates")));
    expect(backups).toHaveLength(1);
  });
});

async function makeTempDir() {
  const directory = await mkdtemp(path.join(tmpdir(), "qimia-updater-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
