import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import { app, BrowserWindow, dialog, shell } from "electron";

app.setPath("userData", path.join(app.getPath("appData"), "HondanaCatalog"));

const hasSingleInstanceLock = app.requestSingleInstanceLock();
let mainWindow = null;
let server = null;
let appUrl = "";
let appPort = 8080;

if (!hasSingleInstanceLock) app.quit();

function portIsAvailable(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "0.0.0.0");
  });
}

async function findAvailablePort(start = 8080) {
  for (let port = start; port < start + 20; port += 1) {
    if (await portIsAvailable(port)) return port;
  }
  throw new Error("本棚カタログで使用できる通信ポートが見つかりませんでした。");
}

async function prepareUserData() {
  const dataDir = path.join(app.getPath("userData"), "data");
  const booksFile = path.join(dataDir, "books.json");
  if (fs.existsSync(booksFile)) return dataDir;

  await fsp.mkdir(dataDir, { recursive: true });
  const seedDir = app.isPackaged
    ? path.join(process.resourcesPath, "seed-data")
    : path.join(app.getAppPath(), "data");
  if (fs.existsSync(seedDir)) await fsp.cp(seedDir, dataDir, { recursive: true, force: false });
  return dataDir;
}

function isLocalCompanionPage(url) {
  try {
    const target = new URL(url);
    return target.protocol === "http:"
      && Number(target.port) === appPort
      && ["/upload", "/check"].includes(target.pathname);
  } catch {
    return false;
  }
}

function applyNavigationPolicy(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isLocalCompanionPage(url)) {
      createWindow(url, { width: 460, height: 820, minWidth: 390, minHeight: 680 });
    } else {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(appUrl)) return;
    event.preventDefault();
    void shell.openExternal(url);
  });
}

function createWindow(url = appUrl, dimensions = {}) {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 720,
    minHeight: 560,
    show: false,
    backgroundColor: "#111510",
    icon: path.join(app.getAppPath(), "build", "icon.png"),
    autoHideMenuBar: true,
    ...dimensions,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.setMenuBarVisibility(false);
  applyNavigationPolicy(window);
  window.once("ready-to-show", () => window.show());
  void window.loadURL(url);
  if (url === appUrl) mainWindow = window;
  return window;
}

async function startApplication() {
  const dataDir = await prepareUserData();
  appPort = await findAvailablePort();
  appUrl = `http://127.0.0.1:${appPort}`;
  process.env.PORT = String(appPort);
  process.env.HONDANA_DATA_DIR = dataDir;
  process.env.HONDANA_DIST_DIR = path.join(app.getAppPath(), "dist");

  const serverModule = await import("../server/index.mjs");
  server = serverModule.server;
  if (!server.listening) {
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
  }
  createWindow();
}

if (hasSingleInstanceLock) {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(startApplication).catch((error) => {
    dialog.showErrorBox("本棚カタログを起動できません", error.message);
    app.quit();
  });
}

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  if (server?.listening) server.close();
});
