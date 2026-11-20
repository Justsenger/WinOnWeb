import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';
const appId = process.argv[2] ?? 'explorer';
const outputPath = process.argv[3] ?? `work/${appId}-shot.png`;
const targetUrl = 'https://localhost:5190/?desktop=1';
async function openTab() {
  const response = await fetch(`${base}/json/new?${encodeURIComponent(targetUrl)}`, { method: 'PUT' });
  if (!response.ok) throw new Error(`Unable to create browser tab: ${response.status}`);
  return response.json();
}
function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const callback = pending.get(message.id);
    if (!callback) return;
    pending.delete(message.id);
    if (message.error) callback.reject(new Error(JSON.stringify(message.error)));
    else callback.resolve(message.result);
  });
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  return { async send(method, params = {}) { await ready; const id = ++sequence; return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); }); }, close() { socket.close(); } };
}
const tab = await openTab();
const cdp = connect(tab.webSocketDebuggerUrl);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Security.enable');
await cdp.send('Security.setIgnoreCertificateErrors', { ignore: true });
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 644, deviceScaleFactor: 2, mobile: false });
await new Promise((resolve) => setTimeout(resolve, 1200));
await cdp.send('Runtime.evaluate', { expression: `document.querySelector('[data-win11-root]')?.__winOnWebApi?.launchApp(${JSON.stringify(appId)})`, awaitPromise: true });
await new Promise((resolve) => setTimeout(resolve, 1000));
const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
await mkdir(outputPath.replace(/[\\/][^\\/]+$/, ''), { recursive: true });
await writeFile(outputPath, Buffer.from(screenshot.data, 'base64'));
await cdp.send('Browser.close');
cdp.close();
console.log(outputPath);
