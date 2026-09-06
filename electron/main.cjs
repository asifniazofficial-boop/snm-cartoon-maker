const { app, BrowserWindow, shell, dialog } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let serverInfo = null;

// When packaged, bundled binaries live in <resources>/bin. Tell the engine
// where to find them via env before we import it.
if (app.isPackaged) {
  process.env.RESOURCES_BIN = path.join(process.resourcesPath, "bin");
}
process.env.PORT = "0"; // let the OS pick a free port

async function startServer() {
  // server.js is an ES module; load it dynamically from CommonJS.
  const serverPath = app.isPackaged
    ? path.join(process.resourcesPath, "app", "server.js")
    : path.join(__dirname, "..", "server.js");
  const mod = await import(pathToFileURL(serverPath).href);
  serverInfo = await mod.start(0);
  return serverInfo.port;
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 960,
    height: 820,
    minWidth: 520,
    minHeight: 600,
    backgroundColor: "#0f1115",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  try {
    const port = await startServer();
    await win.loadURL(`http://127.0.0.1:${port}/`);
  } catch (e) {
    dialog.showErrorBox("Startup error", String(e && e.stack ? e.stack : e));
    app.quit();
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (serverInfo?.server) serverInfo.server.close();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
