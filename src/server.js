import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRouter, requireWorkspace, startSyncthing } from "./routes.js";
import { getMediaPath } from "./workspace.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp(options = {}) {
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use(express.static(path.join(__dirname, "public")));
  app.use("/api", createRouter(options));

  app.get("/media/video/:filename", mediaHandler(options.configPath, "videos"));
  app.get("/media/thumb/:filename", mediaHandler(options.configPath, "thumbs"));

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    res.status(error.status || (error.code === "ENOENT" ? 404 : 500)).json({
      error: error.message || "服务器错误",
      code: error.code || "SERVER_ERROR"
    });
  });

  return app;
}

function mediaHandler(configPath, mediaDir) {
  return async (req, res, next) => {
    try {
      const rootDir = await requireWorkspace(configPath);
      res.sendFile(getMediaPath(rootDir, mediaDir, req.params.filename));
    } catch (error) {
      next(error);
    }
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 5177);
  const server = createApp().listen(port, () => {
    console.log(`七秒漫剧助手已启动：http://localhost:${port}`);
    startSyncthing()
      .then(() => console.log("已尝试启动 Syncthing 后台进程。"))
      .catch((error) => console.warn(`Syncthing 未自动启动：${error.message || String(error)}`));
  });
  server.on("error", (error) => {
    console.error(getListenErrorMessage(error, port));
    process.exitCode = 1;
  });
}

export function getListenErrorMessage(error, port) {
  if (error?.code === "EADDRINUSE") {
    return [
      `端口 ${port} 已经被占用。`,
      `如果浏览器能打开 http://localhost:${port}，说明七秒漫剧助手已经在运行，不需要重复启动。`,
      `如果想临时换端口，可以运行：PORT=${port + 1} npm run dev`
    ].join("\n");
  }
  return `启动失败：${error?.message || String(error)}`;
}
