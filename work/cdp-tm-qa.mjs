import { mkdir, writeFile } from 'node:fs/promises';

const endpoint = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';
const root = 'work/task-manager-qa';
const tabs = ['processes', 'performance', 'history', 'startup', 'users', 'details', 'services', 'settings'];

async function createTab() {
  const response = await fetch(`${endpoint}/json/new?${encodeURIComponent('https://localhost:5190/?desktop=1')}`, { method: 'PUT' });
  if (!response.ok) throw new Error(`tab creation failed: ${response.status}`);
  return response.json();
}

function connect(url) {
  const ws = new WebSocket(url);
  let nextId = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    if (message.error) item.reject(new Error(JSON.stringify(message.error)));
    else item.resolve(message.result);
  });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  return {
    async send(method, params = {}) {
      await ready;
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { ws.close(); },
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return result?.result?.value;
}

const tab = await createTab();
const cdp = connect(tab.webSocketDebuggerUrl);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Security.enable');
await cdp.send('Security.setIgnoreCertificateErrors', { ignore: true });
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: 1024,
  height: 644,
  deviceScaleFactor: 2,
  mobile: false,
});
await mkdir(root, { recursive: true });
await new Promise((resolve) => setTimeout(resolve, 1200));
await evaluate(cdp, "document.querySelector('[data-win11-root]')?.__winOnWebApi?.launchApp('task-manager')");
await new Promise((resolve) => setTimeout(resolve, 500));

const result = { viewport: await evaluate(cdp, '({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio })'), pages: {}, interactions: {} };
for (const tabName of tabs) {
  await evaluate(cdp, `document.querySelector('[data-tm-tab=${tabName}]')?.click()`);
  await new Promise((resolve) => setTimeout(resolve, 180));
  const pageState = await evaluate(cdp, `(() => {
    const root = document.querySelector('[data-win11-root]');
    const app = document.querySelector('[data-app="task-manager"]');
    const tm = document.querySelector('.w11-tm-shell');
    const rect = app?.getBoundingClientRect();
    return {
      active: document.querySelector('[data-tm-tab].is-active')?.dataset.tmTab ?? null,
      taskManagerMaximized: app?.classList.contains('is-maximized') ?? false,
      taskbarVisible: getComputedStyle(document.querySelector('[data-taskbar]')).display !== 'none',
      bounds: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      content: tm?.getBoundingClientRect().toJSON() ?? null,
      consoleErrors: window.__tmQaErrors ?? 0,
    };
  })()`);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  await writeFile(`${root}/${tabName}.png`, Buffer.from(shot.data, 'base64'));
  result.pages[tabName] = pageState;
}

result.interactions.processSelection = await evaluate(cdp, `(() => {
  document.querySelector('[data-tm-tab=processes]')?.click();
  const row = document.querySelector('[data-proc-id]');
  row?.click();
  return Boolean(row);
})()`);
await new Promise((resolve) => setTimeout(resolve, 80));
result.interactions.processSelection = await evaluate(cdp, `document.querySelector('[data-proc-id][aria-selected="true"]') !== null`);
result.interactions.processSort = await evaluate(cdp, `(() => {
  const header = document.querySelector('[data-proc-sort=cpu]');
  header?.click();
  return header?.getAttribute('aria-sort');
})()`);
result.interactions.search = await evaluate(cdp, `(() => {
  const input = document.querySelector('[data-tm-search]');
  if (!input) return false;
  input.value = '任务管理器';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return input.value === '任务管理器';
})()`);
result.interactions.newTaskDialog = await evaluate(cdp, `(() => {
  document.querySelector('[data-tm-cmd=new-task]')?.click();
  return Boolean(document.querySelector('.w11-tm-modal'));
})()`);
await evaluate(cdp, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
result.interactions.searchClear = await evaluate(cdp, `(() => {
  const input = document.querySelector('[data-tm-search]');
  if (!input) return false;
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return input.value === '';
})()`);
await new Promise((resolve) => setTimeout(resolve, 100));
result.interactions.navToggle = await evaluate(cdp, `(() => {
  const btn = document.querySelector('[data-tm-nav-toggle]');
  if (!btn) return false;
  btn.click();
  const expanded = document.querySelector('.w11-tm-shell')?.classList.contains('is-nav-expanded') === true;
  btn.click();
  return expanded;
})()`);
result.interactions.maximizeRestore = await evaluate(cdp, `(() => {
  const btn = document.querySelector('[data-win-max]');
  const app = document.querySelector('[data-app="task-manager"]');
  if (!btn || !app) return false;
  btn.click();
  const restored = !app.classList.contains('is-maximized');
  document.querySelector('[data-win-max]')?.click();
  return restored;
})()`);
await new Promise((resolve) => setTimeout(resolve, 120));

async function clickAndCheck(tabName, selector, checkExpression) {
  await evaluate(cdp, `document.querySelector('[data-tm-tab=${tabName}]')?.click()`);
  await new Promise((resolve) => setTimeout(resolve, 80));
  const clicked = await evaluate(cdp, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); el?.click(); return Boolean(el); })()`);
  await new Promise((resolve) => setTimeout(resolve, 80));
  const checked = await evaluate(cdp, checkExpression);
  return {
    clicked: Boolean(clicked),
    checked: Boolean(checked),
    active: await evaluate(cdp, "document.querySelector('[data-tm-tab].is-active')?.dataset.tmTab ?? null"),
    selectorCount: await evaluate(cdp, `document.querySelectorAll(${JSON.stringify(selector)}).length`),
  };
}

result.interactions.performanceCard = await clickAndCheck(
  'performance',
  '[data-perf-key="memory"]',
  `document.querySelector('[data-perf-key="memory"].is-active, [data-perf-key="memory"].is-selected') !== null || document.querySelector('.w11-tm-perf-detail')?.textContent?.includes('内存') === true`,
);
result.interactions.performanceGraphSummary = await evaluate(cdp, `(() => {
  document.querySelector('[data-tm-tab=performance]')?.click();
  const chart = document.querySelector('[data-perf-chart-area]');
  chart?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  return Boolean(chart);
})()`);
await new Promise((resolve) => setTimeout(resolve, 80));
result.interactions.performanceGraphSummary = Boolean(result.interactions.performanceGraphSummary && await evaluate(cdp, `document.querySelector('.w11-tm-shell.is-summary-graph') !== null`));

result.interactions.historyClear = await clickAndCheck(
  'history',
  '[data-hist-clear]',
  `document.querySelector('[data-hist-clear]')?.textContent?.includes('删除') === true`,
);
result.interactions.startupExpand = await clickAndCheck(
  'startup',
  '[data-startup-toggle]',
  `document.querySelector('[data-startup-toggle]') !== null`,
);
result.interactions.usersExpand = await clickAndCheck(
  'users',
  '[data-user-toggle]',
  `document.querySelector('[data-user-toggle]') !== null`,
);
result.interactions.detailsSort = await clickAndCheck(
  'details',
  '[data-det-sort="pid"]',
  `document.querySelector('[data-det-sort="pid"]') !== null`,
);
result.interactions.servicesSelection = await clickAndCheck(
  'services',
  '[data-svc-name]',
  `document.querySelector('[data-svc-name][aria-selected="true"]') !== null || document.querySelector('.w11-tm-proc-row.is-selected') !== null`,
);
result.interactions.settingsToggle = await clickAndCheck(
  'settings',
  '[data-set-exp="winMgmtExpanded"]',
  `document.querySelector('[data-set-exp="winMgmtExpanded"]') !== null`,
);
await writeFile(`${root}/result.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await cdp.send('Browser.close');
cdp.close();
