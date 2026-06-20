import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [archivePath, packageUrl, outputPath = "update.json"] = process.argv.slice(2);
if (!archivePath || !packageUrl) throw new Error("用法：node scripts/create-update-manifest.mjs <zip> <packageUrl> [output]");
const packageJson = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));
const hash = createHash("sha256");
for await (const chunk of createReadStream(path.resolve(archivePath))) hash.update(chunk);

const manifest = {
  version: packageJson.version,
  publishedAt: new Date().toISOString(),
  packageUrl,
  sha256: hash.digest("hex"),
  minimumNodeVersion: "20",
  releaseNotes: `七秒漫剧助手 ${packageJson.version} 稳定版`
};
await writeFile(path.resolve(outputPath), JSON.stringify(manifest, null, 2));
console.log(`已生成更新清单：${outputPath}`);
