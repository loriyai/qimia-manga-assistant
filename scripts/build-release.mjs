import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const outputDir = path.resolve(process.argv[2] || path.join(rootDir, "release"));
const releaseEntries = [
  "README.md",
  "package.json",
  "package-lock.json",
  "src",
  "scripts",
  "start-windows.bat",
  "start-mac.command",
  "install-dependencies-windows.bat",
  "install-dependencies-mac.command"
];

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
for (const entry of releaseEntries) {
  await cp(path.join(rootDir, entry), path.join(outputDir, entry), { recursive: true, preserveTimestamps: true });
}

const files = await listFiles(outputDir);
files.push(".update-files.json");
files.sort();
await writeFile(path.join(outputDir, ".update-files.json"), JSON.stringify({ files }, null, 2));
console.log(`已生成发布目录：${outputDir}（${files.length} 个文件）`);

async function listFiles(directory, prefix = "") {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(path.join(directory, entry.name), relativePath));
    else if (entry.isFile()) result.push(relativePath);
  }
  return result;
}
