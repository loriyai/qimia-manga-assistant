import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("image asset UI structure", () => {
  it("places character and scene navigation before bottom reload, settings, and version", async () => {
    const html = await readFile(new URL("../src/public/index.html", import.meta.url), "utf8");
    const characters = html.indexOf('data-page="characters"');
    const scenes = html.indexOf('data-page="scenes"');
    const reload = html.indexOf('id="globalReloadBtn"');
    const settings = html.indexOf('class="nav-btn settings-nav"');
    const version = html.indexOf('id="appVersion"');
    expect(characters).toBeGreaterThan(0);
    expect(characters).toBeLessThan(scenes);
    expect(scenes).toBeLessThan(reload);
    expect(reload).toBeLessThan(settings);
    expect(settings).toBeLessThan(version);
  });

  it("keeps image asset cancellation separate from form submission", async () => {
    const html = await readFile(new URL("../src/public/index.html", import.meta.url), "utf8");
    expect(html).toContain('<button id="cancelImageAssetBtn" type="button">取消</button>');
    expect(html).toContain('<button id="saveImageAssetBtn" type="submit">保存</button>');
  });

  it("defines all four tabs and a two-row portrait mosaic without cropping", async () => {
    const app = await readFile(new URL("../src/public/app.js", import.meta.url), "utf8");
    const styles = await readFile(new URL("../src/public/styles.css", import.meta.url), "utf8");
    expect(app).toContain('{ style: "anime", era: "ancient"');
    expect(app).toContain('{ style: "anime", era: "modern"');
    expect(app).toContain('{ style: "live", era: "ancient"');
    expect(app).toContain('{ style: "live", era: "modern"');
    expect(styles).toMatch(/\.asset-grid\s*\{[^}]*grid-auto-rows:[^;}]+;[^}]*gap:\s*14px;/s);
    expect(styles).toMatch(/\.asset-card\.portrait\s*\{[^}]*grid-row:\s*span 2;/s);
    expect(styles).toMatch(/\.asset-card img\s*\{[^}]*object-fit:\s*contain;/s);
  });

  it("adds linked style filters, filename titles, preview title, and global reload", async () => {
    const html = await readFile(new URL("../src/public/index.html", import.meta.url), "utf8");
    const app = await readFile(new URL("../src/public/app.js", import.meta.url), "utf8");
    const styles = await readFile(new URL("../src/public/styles.css", import.meta.url), "utf8");
    expect(html).toContain('id="characterStyleFilter"');
    expect(html).toContain('id="sceneStyleFilter"');
    expect(html).toContain('id="imageAssetPreviewTitle" type="text" readonly');
    const edit = html.indexOf('id="editImageAssetBtn"');
    const remove = html.indexOf('id="deleteImageAssetBtn"');
    const title = html.indexOf('id="imageAssetPreviewTitle"');
    const reveal = html.indexOf('id="revealImageAssetBtn"');
    const copy = html.indexOf('id="copyImageAssetBtn"');
    const close = html.indexOf('id="closeImageAssetPreviewBtn"');
    expect(edit).toBeLessThan(remove);
    expect(remove).toBeLessThan(title);
    expect(title).toBeLessThan(reveal);
    expect(reveal).toBeLessThan(copy);
    expect(copy).toBeLessThan(close);
    expect(html).toContain('<button id="refreshLibraryBtn">扫描视频目录</button>');
    expect(html).toContain('<button id="globalReloadBtn" class="sidebar-action">刷新</button>');
    expect(html).toContain('data-page="videos"><span>视频</span><span>资源</span>');
    expect(app).toContain('getImageAssetTitleFromFile(file)');
    expect(app).toContain('reloadAllData($("#globalReloadBtn"))');
    expect(app).toContain('writeImageBlobToClipboard(await response.blob())');
    expect(app).toContain('convertImageBlobToPng(blob)');
    expect(app).toContain('/reveal`, { method: "POST" }');
    expect(styles).toMatch(/\.dialog\.image-asset-preview-dialog\s*\{[^}]*width:\s*75vw;[^}]*height:\s*97\.5vh;/s);
    expect(styles).toMatch(/\.image-viewport\s*\{[^}]*place-items:\s*center;/s);
    expect(styles).toMatch(/#imageAssetPreviewImg\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*object-fit:\s*contain;/s);
  });
});
