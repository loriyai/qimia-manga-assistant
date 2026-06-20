import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_CONFIG_PATH = path.join(homedir(), ".qimia-manga-assistant", "config.json");
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const DEFAULT_WORKSPACE_DIR = path.resolve(__dirname, "..", "workspace");

export async function readConfig(configPath = DEFAULT_CONFIG_PATH) {
  try {
    const raw = await readFile(configPath, "utf8");
    return normalizeConfig(JSON.parse(raw));
  } catch (error) {
    if (error.code === "ENOENT") {
      return normalizeConfig({});
    }
    throw error;
  }
}

export async function writeConfig(config, configPath = DEFAULT_CONFIG_PATH) {
  await mkdir(path.dirname(configPath), { recursive: true });
  const payload = normalizeConfig(config);
  await writeFile(configPath, JSON.stringify(payload, null, 2));
  return payload;
}

function normalizeConfig(config = {}) {
  return {
    workspaceDir: String(config.workspaceDir || DEFAULT_WORKSPACE_DIR).trim(),
    currentUserId: String(config.currentUserId || "").normalize("NFC").trim(),
    syncthing: {
      apiUrl: String(config.syncthing?.apiUrl || "http://127.0.0.1:8384").trim(),
      apiKey: String(config.syncthing?.apiKey || "").trim(),
      folderId: String(config.syncthing?.folderId || "").trim()
    }
  };
}
