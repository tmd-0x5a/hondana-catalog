import fs from "node:fs/promises";

const port = Number(process.env.CDP_PORT || 9223);
const output = process.env.CAPTURE_FILE || "C:/tmp/hondana-drawer.png";
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === "page");
if (!target) throw new Error("確認対象のページが見つかりません。");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  const handler = pending.get(message.id);
  if (!handler) return;
  pending.delete(message.id);
  if (message.error) handler.reject(new Error(message.error.message));
  else handler.resolve(message.result);
});

function command(method, params = {}) {
  const id = nextId;
  nextId += 1;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

await command("Runtime.evaluate", { expression: "document.querySelector('.book-cover')?.click()" });
await new Promise((resolve) => setTimeout(resolve, 350));
const metrics = await command("Runtime.evaluate", {
  expression: `JSON.stringify((() => {
    const pane = document.querySelector('.detail-pane');
    const rect = pane?.getBoundingClientRect();
    return { bodyWidth: document.body.scrollWidth, viewportWidth: innerWidth, drawerClass: pane?.className, drawerRect: rect && { x: rect.x, width: rect.width }, scrimVisible: Boolean(document.querySelector('.detail-scrim')) };
  })())`,
  returnByValue: true,
});
const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await fs.writeFile(output, Buffer.from(screenshot.data, "base64"));
console.log(metrics.result.value);
await command("Browser.close");
socket.close();
