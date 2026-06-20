import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { homedir, platform, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const __filename = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = path.resolve(path.dirname(__filename), "..");
const STABLE_VERSION = /^\d+\.\d+\.\d+$/;
const PROTECTED_ROOTS = new Set(["workspace", "node_modules", ".git", ".updates"]);
const UPDATE_FILES_NAME = ".update-files.json";

export async function runUpdater(options = {}) {
  const rootDir = path.resolve(options.rootDir || DEFAULT_ROOT);
  const logger = options.logger || console;
  let temporaryDir = "";

  try {
    const packageJson = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
    const repository = String(packageJson.qimiaUpdater?.repository || "").trim();
    if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) return { status: "not-configured" };

    const manifestUrl = `https://github.com/${repository}/releases/latest/download/update.json`;
    const manifest = validateUpdateManifest(await fetchJson(manifestUrl, options.fetchImpl));
    if (compareVersions(manifest.version, packageJson.version) <= 0) return { status: "current" };
    if (Number(process.versions.node.split(".")[0]) < Number(manifest.minimumNodeVersion)) {
      logger.warn(`发现新版本 ${manifest.version}，但需要 Node.js ${manifest.minimumNodeVersion} 或更高版本。`);
      return { status: "node-too-old" };
    }

    logger.log(`发现新版本：${packageJson.version} → ${manifest.version}`);
    if (manifest.releaseNotes) logger.log(`更新说明：${manifest.releaseNotes}`);
    const accepted = options.acceptUpdate ?? await confirmUpdate();
    if (!accepted) return { status: "skipped" };

    temporaryDir = await mkdtemp(path.join(tmpdir(), "qimia-update-"));
    const archivePath = path.join(temporaryDir, "update.zip");
    const extractDir = path.join(temporaryDir, "extracted");
    await mkdir(extractDir, { recursive: true });
    logger.log("正在下载更新包……");
    await downloadFile(manifest.packageUrl, archivePath, options.fetchImpl);
    const digest = await sha256File(archivePath);
    if (digest !== manifest.sha256.toLowerCase()) throw new Error("更新包校验失败，已取消安装");

    await extractZip(archivePath, extractDir, options.commandRunner);
    const releaseRoot = await findReleaseRoot(extractDir);
    const updateFiles = await readManagedFiles(path.join(releaseRoot, UPDATE_FILES_NAME));
    logger.log("正在准备新版依赖……");
    await (options.installDependencies || installDependencies)(releaseRoot);
    await applyPreparedUpdate({ rootDir, releaseRoot, updateFiles, fromVersion: packageJson.version, toVersion: manifest.version });
    logger.log(`更新完成：${manifest.version}`);
    return { status: "updated", version: manifest.version };
  } catch (error) {
    logger.warn(`更新未完成，将继续启动当前版本：${error.message || String(error)}`);
    return { status: "failed", error };
  } finally {
    if (temporaryDir) await rm(temporaryDir, { recursive: true, force: true }).catch(() => {});
  }
}

export function compareVersions(left, right) {
  if (!STABLE_VERSION.test(String(left)) || !STABLE_VERSION.test(String(right))) throw new Error("版本号必须使用 x.y.z 格式");
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function validateUpdateManifest(value) {
  if (!value || !STABLE_VERSION.test(String(value.version))) throw new Error("更新清单中的版本号无效");
  if (!/^https:\/\//.test(String(value.packageUrl || ""))) throw new Error("更新包地址无效");
  if (!/^[a-f\d]{64}$/i.test(String(value.sha256 || ""))) throw new Error("更新包校验值无效");
  const minimumNodeVersion = String(value.minimumNodeVersion || "20");
  if (!/^\d+$/.test(minimumNodeVersion)) throw new Error("Node.js 最低版本无效");
  return {
    version: String(value.version),
    publishedAt: String(value.publishedAt || ""),
    packageUrl: String(value.packageUrl),
    sha256: String(value.sha256).toLowerCase(),
    minimumNodeVersion,
    releaseNotes: String(value.releaseNotes || "").trim()
  };
}

export async function sha256File(filename) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

export async function applyPreparedUpdate({ rootDir, releaseRoot, updateFiles, fromVersion, toVersion }) {
  const updatesDir = path.join(rootDir, ".updates");
  const backupDir = path.join(updatesDir, `backup-${fromVersion}-${Date.now()}`);
  const oldFiles = await readManagedFiles(path.join(rootDir, UPDATE_FILES_NAME), true);
  const affectedFiles = [...new Set([...oldFiles, ...updateFiles])].filter(isSafeManagedPath);
  const existingFiles = [];
  let oldNodeModulesBackedUp = false;

  await mkdir(backupDir, { recursive: true });
  try {
    for (const relativePath of affectedFiles) {
      const currentPath = path.join(rootDir, relativePath);
      if (await pathExists(currentPath)) {
        existingFiles.push(relativePath);
        await copyPath(currentPath, path.join(backupDir, "files", relativePath));
      }
    }
    await writeFile(path.join(backupDir, "backup.json"), JSON.stringify({ fromVersion, toVersion, existingFiles }, null, 2));

    const currentModules = path.join(rootDir, "node_modules");
    if (await pathExists(currentModules)) {
      await rename(currentModules, path.join(backupDir, "node_modules"));
      oldNodeModulesBackedUp = true;
    }
    await copyPath(path.join(releaseRoot, "node_modules"), currentModules);

    for (const relativePath of oldFiles) {
      if (!updateFiles.includes(relativePath) && isSafeManagedPath(relativePath)) {
        await rm(path.join(rootDir, relativePath), { recursive: true, force: true });
      }
    }
    for (const relativePath of updateFiles) {
      if (!isSafeManagedPath(relativePath)) throw new Error(`更新包包含不安全路径：${relativePath}`);
      await copyPath(path.join(releaseRoot, relativePath), path.join(rootDir, relativePath));
    }
    if (platform() !== "win32") {
      await chmod(path.join(rootDir, "start-mac.command"), 0o755).catch(() => {});
      await chmod(path.join(rootDir, "install-dependencies-mac.command"), 0o755).catch(() => {});
    }
    await removeOtherBackups(updatesDir, backupDir);
  } catch (error) {
    await rm(path.join(rootDir, "node_modules"), { recursive: true, force: true });
    if (oldNodeModulesBackedUp) await rename(path.join(backupDir, "node_modules"), path.join(rootDir, "node_modules")).catch(() => {});
    for (const relativePath of affectedFiles) await rm(path.join(rootDir, relativePath), { recursive: true, force: true });
    for (const relativePath of existingFiles) {
      await copyPath(path.join(backupDir, "files", relativePath), path.join(rootDir, relativePath));
    }
    throw error;
  }
}

async function fetchJson(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`检查更新失败（HTTP ${response.status}）`);
  return response.json();
}

async function downloadFile(url, destination, fetchImpl = fetch) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(120000), redirect: "follow" });
  if (!response.ok) throw new Error(`下载更新失败（HTTP ${response.status}）`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(destination, bytes);
}

async function confirmUpdate() {
  if (!input.isTTY) return false;
  const prompt = createInterface({ input, output });
  try {
    const answer = await prompt.question("现在安装更新吗？[Y/n] ");
    return !answer.trim() || /^y(es)?$/i.test(answer.trim());
  } finally {
    prompt.close();
  }
}

async function extractZip(archivePath, destination, commandRunner = runCommand) {
  if (platform() === "win32") {
    const escapedArchive = archivePath.replaceAll("'", "''");
    const escapedDestination = destination.replaceAll("'", "''");
    await commandRunner("powershell.exe", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${escapedArchive}' -DestinationPath '${escapedDestination}' -Force`]);
  } else if (platform() === "darwin") {
    await commandRunner("/usr/bin/ditto", ["-x", "-k", archivePath, destination]);
  } else {
    await commandRunner("unzip", ["-q", archivePath, "-d", destination]);
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: options.stdio || "inherit", shell: false });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} 执行失败（退出码 ${code}）`)));
  });
}

async function installDependencies(releaseRoot) {
  const npmCommand = platform() === "win32" ? "npm.cmd" : "npm";
  await runCommand(npmCommand, ["ci", "--omit=dev", "--no-audit", "--no-fund"], { cwd: releaseRoot });
}

async function findReleaseRoot(extractDir) {
  if (await pathExists(path.join(extractDir, UPDATE_FILES_NAME))) return extractDir;
  const entries = await readdir(extractDir, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory());
  if (directories.length === 1 && await pathExists(path.join(extractDir, directories[0].name, UPDATE_FILES_NAME))) {
    return path.join(extractDir, directories[0].name);
  }
  throw new Error("更新包结构无效");
}

async function readManagedFiles(filename, allowMissing = false) {
  try {
    const value = JSON.parse(await readFile(filename, "utf8"));
    if (!Array.isArray(value.files) || !value.files.every((item) => typeof item === "string" && isSafeManagedPath(item))) {
      throw new Error("更新文件清单无效");
    }
    return value.files;
  } catch (error) {
    if (allowMissing && error.code === "ENOENT") return [];
    throw error;
  }
}

export function isSafeManagedPath(relativePath) {
  if (!relativePath || path.isAbsolute(relativePath)) return false;
  const normalized = path.normalize(relativePath).replaceAll("\\", "/");
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) return false;
  return !PROTECTED_ROOTS.has(normalized.split("/")[0]);
}

async function copyPath(source, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, force: true, preserveTimestamps: true });
}

async function pathExists(filename) {
  try {
    await access(filename);
    return true;
  } catch {
    return false;
  }
}

async function removeOtherBackups(updatesDir, retainedBackup) {
  const entries = await readdir(updatesDir, { withFileTypes: true });
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("backup-") && path.join(updatesDir, entry.name) !== retainedBackup)
    .map((entry) => rm(path.join(updatesDir, entry.name), { recursive: true, force: true })));
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  await runUpdater();
}
