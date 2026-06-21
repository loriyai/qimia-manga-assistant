import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("image asset UI structure", () => {
  it("places character and scene navigation before bottom settings and version", async () => {
    const html = await readFile(new URL("../src/public/index.html", import.meta.url), "utf8");
    const characters = html.indexOf('data-page="characters"');
    const scenes = html.indexOf('data-page="scenes"');
    const settings = html.indexOf('class="nav-btn settings-nav"');
    const version = html.indexOf('id="appVersion"');
    expect(characters).toBeGreaterThan(0);
    expect(characters).toBeLessThan(scenes);
    expect(scenes).toBeLessThan(settings);
    expect(settings).toBeLessThan(version);
  });

  it("keeps image asset cancellation separate from form submission", async () => {
    const html = await readFile(new URL("../src/public/index.html", import.meta.url), "utf8");
    expect(html).toContain('<button id="cancelImageAssetBtn" type="button">取消</button>');
    expect(html).toContain('<button id="saveImageAssetBtn" type="submit">保存</button>');
  });

  it("defines all four tabs and original-ratio card images", async () => {
    const app = await readFile(new URL("../src/public/app.js", import.meta.url), "utf8");
    const styles = await readFile(new URL("../src/public/styles.css", import.meta.url), "utf8");
    expect(app).toContain('{ style: "anime", era: "ancient"');
    expect(app).toContain('{ style: "anime", era: "modern"');
    expect(app).toContain('{ style: "live", era: "ancient"');
    expect(app).toContain('{ style: "live", era: "modern"');
    expect(styles).toMatch(/\.asset-card img\s*\{[^}]*height:\s*auto;/s);
  });
});
