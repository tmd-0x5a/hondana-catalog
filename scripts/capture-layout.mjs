import fs from "node:fs/promises";
import path from "node:path";

import { app, BrowserWindow } from "electron";

const targetUrl = process.env.CAPTURE_URL || "http://127.0.0.1:8080/";
const outputDir = process.env.CAPTURE_DIR || path.join(app.getPath("temp"), "hondana-layout");
const viewports = [
  { name: "compact", width: 900, height: 700 },
  { name: "narrow", width: 760, height: 700 },
  { name: "short", width: 1100, height: 620 },
];

await app.whenReady();
await fs.mkdir(outputDir, { recursive: true });

for (const viewport of viewports) {
  const window = new BrowserWindow({
    width: viewport.width,
    height: viewport.height,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await window.loadURL(targetUrl);
  await new Promise((resolve) => setTimeout(resolve, 800));
  const metrics = await window.webContents.executeJavaScript(`(() => {
    const selectors = [".app-shell", ".sidebar", ".library-panel", ".detail-pane", ".topbar", ".shelf-stage"];
    const elements = Object.fromEntries(selectors.map((selector) => {
      const element = document.querySelector(selector);
      if (!element) return [selector, null];
      const rect = element.getBoundingClientRect();
      return [selector, { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight }];
    }));
    return { innerWidth, innerHeight, bodyScrollWidth: document.body.scrollWidth, bodyScrollHeight: document.body.scrollHeight, elements };
  })()`);
  const image = await window.webContents.capturePage();
  await fs.writeFile(path.join(outputDir, `${viewport.name}.png`), image.toPNG());
  await fs.writeFile(path.join(outputDir, `${viewport.name}.json`), JSON.stringify(metrics, null, 2));
  window.destroy();
}

console.log(outputDir);
app.quit();
