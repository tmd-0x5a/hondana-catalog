import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const targetUrl = process.env.CAPTURE_URL || "http://127.0.0.1:8080/";
const outputDir = process.env.CAPTURE_DIR || path.join(os.tmpdir(), "hondana-bulk-import");
const viewports = [
  { name: "desktop", width: 1180, height: 820 },
  { name: "narrow", width: 760, height: 700 },
];

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForJson(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // Edgeのデバッグポート待受が始まるまで短く再試行する。
    }
    await delay(100);
  }
  throw new Error(`DevTools endpoint did not start: ${url}`);
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    };
  }

  async connect() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.socket.onopen = resolve;
      this.socket.onerror = () => reject(new Error("DevTools WebSocket connection failed."));
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

await fs.mkdir(outputDir, { recursive: true });
const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "hondana-edge-"));
const debuggingPort = await availablePort();
const edge = spawn(EDGE_PATH, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  `--remote-debugging-port=${debuggingPort}`,
  `--user-data-dir=${userDataDir}`,
  "about:blank",
], { stdio: "ignore", windowsHide: true });

try {
  const browserInfo = await waitForJson(`http://127.0.0.1:${debuggingPort}/json/version`);
  const pageInfoResponse = await fetch(`http://127.0.0.1:${debuggingPort}/json/new?${encodeURIComponent(targetUrl)}`, { method: "PUT" });
  if (!pageInfoResponse.ok) throw new Error(`Could not create capture page: HTTP ${pageInfoResponse.status}`);
  const pageInfo = await pageInfoResponse.json();
  const page = new CdpClient(pageInfo.webSocketDebuggerUrl);
  await page.connect();
  await page.send("Page.enable");
  await page.send("Runtime.enable");

  for (const viewport of viewports) {
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await page.send("Page.navigate", { url: targetUrl });
    await delay(900);
    if (viewport.name === "desktop") {
      const shelfScreenshot = await page.send("Page.captureScreenshot", { format: "png", fromSurface: true });
      await fs.writeFile(path.join(outputDir, "bookshelf-desktop.png"), Buffer.from(shelfScreenshot.data, "base64"));
    }
    await page.send("Runtime.evaluate", {
      expression: `document.querySelector('[title="電子書籍のスクリーンショットを取り込む"]')?.click()`,
      awaitPromise: true,
    });
    await delay(350);
    const metricsResult = await page.send("Runtime.evaluate", {
      expression: `(() => {
        const modal = document.querySelector(".bulk-import-modal");
        const picker = document.querySelector(".screenshot-picker");
        const modalRect = modal?.getBoundingClientRect();
        const pickerRect = picker?.getBoundingClientRect();
        return {
          innerWidth,
          innerHeight,
          bodyScrollWidth: document.body.scrollWidth,
          modal: modalRect && { x: modalRect.x, y: modalRect.y, width: modalRect.width, height: modalRect.height, scrollHeight: modal.scrollHeight, clientHeight: modal.clientHeight },
          picker: pickerRect && { x: pickerRect.x, y: pickerRect.y, width: pickerRect.width, height: pickerRect.height },
        };
      })()`,
      returnByValue: true,
    });
    const screenshot = await page.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    await fs.writeFile(path.join(outputDir, `${viewport.name}.png`), Buffer.from(screenshot.data, "base64"));
    await fs.writeFile(path.join(outputDir, `${viewport.name}.json`), JSON.stringify(metricsResult.result.value, null, 2));
  }
  page.close();

  const browser = new CdpClient(browserInfo.webSocketDebuggerUrl);
  await browser.connect();
  await browser.send("Browser.close");
  browser.close();
  if (edge.exitCode === null) await Promise.race([once(edge, "exit"), delay(3_000)]);
} finally {
  if (edge.exitCode === null) edge.kill();
  await delay(300);
  await fs.rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

console.log(outputDir);
