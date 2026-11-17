import './explorer.css';
import { getWinDesktopHostConfig } from './host-config';
import { UI_ICONS } from './icons';
import { createTmMenuController, showTmModal, type TmMenuItem } from './tm-overlays';
import type { WinAppHostContext, WinAppLifecycle, WinAppModule } from './types';
import {
  calcNtfsDiskBytes,
  createWin11FsNodes,
  EXP_ICONS,
  hydrateWin11FolderFiles,
  loadFullWin11FsSkeleton,
  scanWin11FolderStatsAsync,
  type ExpFsNode,
} from './win11-fs-skeleton';

export type ExpLocationId = string;
type ExpViewMode = 'large' | 'medium' | 'small' | 'list' | 'details' | 'tiles';
type ExpSortKey = 'name' | 'modified' | 'type' | 'size';
type ExpNode = ExpFsNode;

interface ExpTabState {
  id: number;
  locationId: ExpLocationId;
  history: ExpLocationId[];
  historyIndex: number;
  selectedItemId: string | null;
  selectedItemIds: Set<string>;
  searchQuery: string;
}

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatGiB(bytes: number): string {
  const gib = bytes / 1024 ** 3;
  return gib >= 100 ? `${Math.round(gib)} GB` : `${gib.toFixed(1)} GB`;
}

function formatSizeText(bytes?: number): string {
  if (typeof bytes !== 'number') return '';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${bytes} 字节`;
}

const SVG_GLYPHS = {
  back: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13 8H3.2M7.2 4L3.2 8L7.2 12" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  forward: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8H12.8M8.8 4L12.8 8L8.8 12" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  up: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 13V3.2M4 7.2L8 3.2L12 7.2" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  refresh: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13 8A5 5 0 1 1 11.5 4.4M13 2.8V5.2H10.6" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  monitorMono: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="2.5" width="12" height="8.5" rx="1.2" stroke="currentColor" stroke-width="1.15"/><path d="M5.5 13.5H10.5M8 11V13.5" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/></svg>`,
  chevronRight: `<svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  chevronDown: `<svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  search: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.3"/><path d="M10.4 10.4L13.5 13.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  tabClose: `<svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M3 3L9 9M9 3L3 9" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/></svg>`,
  tabPlus: `<svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M7 2.5V11.5M2.5 7H11.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`,
  more: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="3.5" cy="8" r="1.1" fill="currentColor"/><circle cx="8" cy="8" r="1.1" fill="currentColor"/><circle cx="12.5" cy="8" r="1.1" fill="currentColor"/></svg>`,
  statusList: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="2.5" width="12" height="11" rx="1" stroke="currentColor" stroke-width="1.1"/><path d="M4.5 5.5H11.5M4.5 8H11.5M4.5 10.5H11.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>`,
  statusGrid: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="2.5" width="5" height="4.5" rx="0.8" stroke="currentColor" stroke-width="1.1"/><rect x="9" y="2.5" width="5" height="4.5" rx="0.8" stroke="currentColor" stroke-width="1.1"/><rect x="2" y="9" width="5" height="4.5" rx="0.8" stroke="currentColor" stroke-width="1.1"/><rect x="9" y="9" width="5" height="4.5" rx="0.8" stroke="currentColor" stroke-width="1.1"/></svg>`,
} as const;

export function mountExplorer(ctx: WinAppHostContext): WinAppLifecycle {
  const { container, shell } = ctx;
  const hasRealDom = typeof document !== 'undefined' && typeof document.createElement === 'function';

  const nodes = createWin11FsNodes();
  let nextTabId = 1;
  let nextCustomId = 1;
  let tabs: ExpTabState[] = [
    {
      id: nextTabId++,
      locationId: 'this-pc',
      history: ['this-pc'],
      historyIndex: 0,
      selectedItemId: null,
      selectedItemIds: new Set<string>(),
      searchQuery: '',
    },
  ];
  let activeTabId = tabs[0].id;
  let navWidth = 137;
  let searchWidth = 240;
  const colWidths = { name: 280, modified: 150, type: 110, size: 90 };
  let thisPcExpanded = true;
  let drivesGroupExpanded = true;
  let showDetailsPane = false;
  let folderViewMode: ExpViewMode = 'details';
  let sortKey: ExpSortKey = 'name';
  let sortDir: 'asc' | 'desc' = 'asc';
  let clipboard: { mode: 'cut' | 'copy'; nodeId: string; fromParentId: string } | null = null;
  let suppressNextMainClick = false;
  let destroyed = false;
  const DETAIL_ROW_H = 26;
  let virtItems: ExpNode[] = [];
  let virtLastStart = -1;
  let virtLastEnd = -1;
  let virtLocationId = '';
  let virtScrollRaf = 0;
  let propWindowZ = 6000;
  const openPropCleanups = new Set<() => void>();

  const hostWindowEl = typeof container.closest === 'function' ? container.closest<HTMLElement>('.w11-window') : null;
  const hostTitlebarEl = hostWindowEl?.querySelector<HTMLElement>('.w11-win-titlebar') ?? null;
  const origTitleEl = hostTitlebarEl?.querySelector<HTMLElement>('.w11-win-title') ?? null;
  let tabbarEl: HTMLElement | null = null;
  let shellEl: HTMLElement | null = null;
  let menuCtrl: ReturnType<typeof createTmMenuController> | null = null;

  if (hasRealDom) {
    container.innerHTML = '';
    shellEl = document.createElement('div');
    shellEl.className = 'w11-exp-shell';
    container.appendChild(shellEl);
    menuCtrl = createTmMenuController(shellEl);
  }

  function getActiveTab(): ExpTabState {
    return tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  }

  function getNode(id: string): ExpNode {
    return nodes[id] ?? nodes['this-pc'];
  }

  function getBreadcrumbs(locId: string): ExpNode[] {
    const chain: ExpNode[] = [];
    let cur: ExpNode | undefined = nodes[locId];
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      chain.unshift(cur);
      cur = cur.parentId ? nodes[cur.parentId] : undefined;
    }
    return chain;
  }

  function getChildNodes(tab: ExpTabState): ExpNode[] {
    hydrateWin11FolderFiles(nodes, tab.locationId);
    const loc = getNode(tab.locationId);
    const q = tab.searchQuery.trim().toLowerCase();
    const list = (loc.children ?? [])
      .map((cid) => nodes[cid])
      .filter((n): n is ExpNode => Boolean(n))
      .filter((n) => !q || n.name.toLowerCase().includes(q));

    const dirMul = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      // Folders always appear before files in Explorer
      const aGroup = a.kind === 'drive' ? 0 : a.kind === 'folder' ? 1 : 2;
      const bGroup = b.kind === 'drive' ? 0 : b.kind === 'folder' ? 1 : 2;
      if (aGroup !== bGroup) return aGroup - bGroup;
      switch (sortKey) {
        case 'size':
          return ((a.sizeBytes ?? 0) - (b.sizeBytes ?? 0)) * dirMul;
        case 'type':
          return a.typeLabel.localeCompare(b.typeLabel, 'zh-CN') * dirMul;
        case 'modified':
          return a.modifiedText.localeCompare(b.modifiedText) * dirMul;
        default:
          return a.name.localeCompare(b.name, 'zh-CN') * dirMul;
      }
    });
  }

  function navigateTo(locId: string) {
    const targetNode = nodes[locId];
    if (!targetNode || targetNode.kind === 'file') return;
    const tab = getActiveTab();
    if (tab.locationId === locId) return;
    tab.history = tab.history.slice(0, tab.historyIndex + 1);
    tab.history.push(locId);
    tab.historyIndex = tab.history.length - 1;
    tab.locationId = locId;
    tab.selectedItemId = null;
    tab.selectedItemIds.clear();
    tab.searchQuery = '';
    shell.setWindowTitle(ctx.pid, targetNode.name);
    render();
  }

  function openNode(nodeId: string) {
    const node = nodes[nodeId];
    if (!node) return;
    if (node.kind === 'folder' || node.kind === 'drive' || node.kind === 'root') {
      navigateTo(node.id);
      return;
    }
    if (shellEl) {
      showTmModal(shellEl, {
        title: node.name,
        width: 380,
        bodyHtml: `
          <p class="w11-tm-modal-text">文件类型：${esc(node.typeLabel)}</p>
          <p class="w11-tm-modal-text">文件大小：${esc(formatSizeText(node.sizeBytes) || '0 字节')}</p>
          <p class="w11-tm-modal-text">修改日期：${esc(node.modifiedText)}</p>
        `,
        footerButtons: [{ label: '确定', primary: true, onClick: (_, close) => close() }],
      });
    }
  }

  function getDiskCStats() {
    const hw = typeof shell.getVirtualHardware === 'function' ? shell.getVirtualHardware() : null;
    const sp = hw?.storage?.probe;
    const totalBytes = hw?.storage?.fixedQuotaBytes ?? sp?.quotaBytes ?? 10 * 1024 ** 3;
    const usedBytes = Math.min(totalBytes, Math.max(0, sp?.usageBytes ?? 0));
    const freeBytes = Math.max(0, totalBytes - usedBytes);
    const usedPct = totalBytes > 0 ? Math.min(100, Math.max(0, (usedBytes / totalBytes) * 100)) : 0;
    return {
      totalText: formatGiB(totalBytes),
      freeText: formatGiB(freeBytes),
      usedText: formatGiB(usedBytes),
      usedPct,
      isWarn: usedPct >= 90,
    };
  }

  function formatPropBytes(bytes: number): string {
    const exact = `${bytes.toLocaleString('en-US')} 字节`;
    if (bytes < 1024) return exact;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let val = bytes / 1024;
    let idx = 0;
    while (val >= 1024 && idx < units.length - 1) {
      val /= 1024;
      idx++;
    }
    const short = val >= 100 ? val.toFixed(0) : val >= 10 ? val.toFixed(1) : val.toFixed(2);
    return `${short} ${units[idx]} (${exact})`;
  }

  function formatWinLocation(node: ExpNode): string {
    const chain = getBreadcrumbs(node.id).slice(0, -1);
    if (chain.length === 0) return '此电脑';
    if (chain[0]?.id === 'this-pc') chain.shift();
    if (chain.length === 0) return '此电脑';
    return chain
      .map((n) => (n.id === 'drive-c' ? 'C:' : n.name))
      .join('\\');
  }

  function formatWinDateFull(modText: string): string {
    const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/.exec(modText.trim());
    if (!m) return modText;
    return `${m[1]}年${Number(m[2])}月${Number(m[3])}日，${m[4].padStart(2, '0')}:${m[5]}:00`;
  }

  function showPropertiesModal(nodeId: string) {
    if (!hasRealDom) return;
    const node = getNode(nodeId);
    const locStr = formatWinLocation(node);
    const diskStats = node.kind === 'drive' ? getDiskCStats() : null;
    const isFolder = node.kind === 'folder' || node.kind === 'root';
    const fileBytes = node.sizeBytes ?? 0;
    const fileDiskBytes = calcNtfsDiskBytes(fileBytes);
    const fullTimeStr = formatWinDateFull(node.modifiedText);

    const hostLayer = hostWindowEl?.parentElement ?? document.body;
    const propWin = document.createElement('div');
    propWin.className = 'w11-prop-window';
    const offset = (openPropCleanups.size % 6) * 24;
    const baseLeft = hostWindowEl ? Math.max(24, hostWindowEl.offsetLeft + 140 + offset) : 240 + offset;
    const baseTop = hostWindowEl ? Math.max(24, hostWindowEl.offsetTop + 70 + offset) : 110 + offset;
    propWin.style.left = `${Math.min(window.innerWidth - 400, baseLeft)}px`;
    propWin.style.top = `${Math.min(window.innerHeight - 500, baseTop)}px`;
    propWin.style.zIndex = String(++propWindowZ);

    let readOnlyState: 'indeterminate' | 'checked' | 'unchecked' = isFolder ? 'indeterminate' : 'unchecked';
    let hiddenChecked = false;
    let dirty = false;
    let activePropTab: 'general' | 'sharing' | 'security' | 'previous' = 'general';
    let cancelScan: (() => void) | null = null;
    let latestStats = { files: 0, folders: 0, totalBytes: 0, diskBytes: 0, done: false };

    const cleanup = () => {
      cancelScan?.();
      cancelScan = null;
      propWin.remove();
      openPropCleanups.delete(cleanup);
    };
    openPropCleanups.add(cleanup);

    const renderPropContent = () => {
      const roClass =
        readOnlyState === 'indeterminate'
          ? ' is-indeterminate'
          : readOnlyState === 'checked'
            ? ' is-checked'
            : '';
      const roGlyph =
        readOnlyState === 'indeterminate'
          ? '<svg width="10" height="10" viewBox="0 0 10 10"><rect x="1.5" y="4.2" width="7" height="1.6" fill="currentColor"/></svg>'
          : readOnlyState === 'checked'
            ? '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5.2L4.2 7.4L8.2 2.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
            : '';
      const hidClass = hiddenChecked ? ' is-checked' : '';
      const hidGlyph = hiddenChecked
        ? '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5.2L4.2 7.4L8.2 2.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : '';

      const generalHtml = `
        <div class="w11-prop-head">
          <img src="${node.icon}" alt="" draggable="false" />
          <div class="w11-prop-namebox">${esc(node.name)}</div>
        </div>
        <div class="w11-prop-sep"></div>
        <div class="w11-prop-grid">
          <span class="w11-prop-lbl">类型：</span><span class="w11-prop-val">${esc(node.typeLabel)}</span>
          <span class="w11-prop-lbl">位置：</span><span class="w11-prop-val">${esc(locStr)}</span>
          ${
            diskStats
              ? `<span class="w11-prop-lbl">文件系统：</span><span class="w11-prop-val">NTFS</span>
                 <span class="w11-prop-lbl">已用空间：</span><span class="w11-prop-val">${esc(diskStats.usedText)}</span>
                 <span class="w11-prop-lbl">可用空间：</span><span class="w11-prop-val">${esc(diskStats.freeText)}</span>
                 <span class="w11-prop-lbl">容量：</span><span class="w11-prop-val">${esc(diskStats.totalText)}</span>`
              : isFolder
                ? `<span class="w11-prop-lbl">大小：</span><span class="w11-prop-val" data-prop-size>${esc(formatPropBytes(latestStats.totalBytes))}</span>
                   <span class="w11-prop-lbl">占用空间：</span><span class="w11-prop-val" data-prop-disk>${esc(formatPropBytes(latestStats.diskBytes))}</span>
                   <span class="w11-prop-lbl">包含：</span><span class="w11-prop-val" data-prop-contains>${latestStats.files.toLocaleString('en-US')} 个文件，${latestStats.folders.toLocaleString('en-US')} 个文件夹</span>`
                : `<span class="w11-prop-lbl">大小：</span><span class="w11-prop-val">${esc(formatPropBytes(fileBytes))}</span>
                   <span class="w11-prop-lbl">占用空间：</span><span class="w11-prop-val">${esc(formatPropBytes(fileDiskBytes))}</span>`
          }
        </div>
        <div class="w11-prop-sep"></div>
        <div class="w11-prop-grid">
          <span class="w11-prop-lbl">创建时间：</span><span class="w11-prop-val">${esc(fullTimeStr)}</span>
          ${
            !isFolder && !diskStats
              ? `<span class="w11-prop-lbl">修改时间：</span><span class="w11-prop-val">${esc(fullTimeStr)}</span>
                 <span class="w11-prop-lbl">访问时间：</span><span class="w11-prop-val">${esc(fullTimeStr)}</span>`
              : ''
          }
        </div>
        <div class="w11-prop-sep"></div>
        <div class="w11-prop-grid">
          <span class="w11-prop-lbl">属性：</span>
          <div class="w11-prop-attrs-wrap">
            <label class="w11-prop-check-row" data-prop-ro>
              <span class="w11-prop-tri${roClass}">${roGlyph}</span>
              <span>${isFolder ? '只读(仅应用于文件夹中的文件)(R)' : '只读(R)'}</span>
            </label>
            <label class="w11-prop-check-row" data-prop-hid>
              <span class="w11-prop-tri${hidClass}">${hidGlyph}</span>
              <span>隐藏(H)</span>
            </label>
            <div class="w11-prop-adv-row">
              <button type="button" class="w11-prop-btn" disabled>高级(D)...</button>
            </div>
          </div>
        </div>
      `;

      const otherHtml =
        activePropTab === 'sharing'
          ? `<div style="font-size:12px;line-height:1.6;">
               <div style="font-weight:600;margin-bottom:8px;">网络文件和文件夹共享</div>
               <div style="opacity:0.8;">${esc(node.name)} 未共享。</div>
               <div style="margin-top:12px;opacity:0.7;">网络路径：未共享</div>
             </div>`
          : activePropTab === 'security'
            ? `<div style="font-size:12px;line-height:1.6;">
                 <div style="margin-bottom:6px;">对象名称：${esc(locStr === '此电脑' ? node.name : `${locStr}\\${node.name}`)}</div>
                 <div style="margin-bottom:6px;">组或用户名(G)：</div>
                 <div style="border:1px solid rgba(128,128,128,0.28);padding:6px 8px;display:flex;flex-direction:column;gap:4px;">
                   <div>SYSTEM</div>
                   <div>Administrators (${esc(`${getWinDesktopHostConfig().machineName || 'WINONWEB-PC'}\\Administrators`)})</div>
                   <div>TrustedInstaller</div>
                   <div>Users (${esc(`${getWinDesktopHostConfig().machineName || 'WINONWEB-PC'}\\Users`)})</div>
                 </div>
               </div>`
            : `<div style="font-size:12px;line-height:1.6;opacity:0.8;">
                 <div>以前的版本来自文件历史记录或还原点。</div>
                 <div style="margin-top:14px;">没有可用的以前版本。</div>
               </div>`;

      propWin.innerHTML = `
        <div class="w11-prop-titlebar" data-prop-drag>
          <div class="w11-prop-title-left">
            <img src="${node.icon}" alt="" draggable="false" />
            <span class="w11-prop-title-text">${esc(node.name)} 属性</span>
          </div>
          <button type="button" class="w11-prop-close" data-prop-close aria-label="关闭">
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="w11-prop-body">
          <div class="w11-prop-tabs">
            <button type="button" class="w11-prop-tab${activePropTab === 'general' ? ' is-active' : ''}" data-prop-tab="general">常规</button>
            <button type="button" class="w11-prop-tab${activePropTab === 'sharing' ? ' is-active' : ''}" data-prop-tab="sharing">共享</button>
            <button type="button" class="w11-prop-tab${activePropTab === 'security' ? ' is-active' : ''}" data-prop-tab="security">安全</button>
            <button type="button" class="w11-prop-tab${activePropTab === 'previous' ? ' is-active' : ''}" data-prop-tab="previous">以前的版本</button>
          </div>
          <div class="w11-prop-panel">
            ${activePropTab === 'general' ? generalHtml : otherHtml}
          </div>
          <div class="w11-prop-footer">
            <button type="button" class="w11-prop-btn is-primary" data-prop-ok>确定</button>
            <button type="button" class="w11-prop-btn" data-prop-cancel>取消</button>
            <button type="button" class="w11-prop-btn" data-prop-apply${dirty ? '' : ' disabled'}>应用(A)</button>
          </div>
        </div>
      `;
    };

    const startFolderScan = () => {
      cancelScan?.();
      latestStats = { files: 0, folders: 0, totalBytes: 0, diskBytes: 0, done: false };
      cancelScan = scanWin11FolderStatsAsync(
        nodes,
        node.id,
        (stats) => {
          if (!propWin.isConnected) {
            cancelScan?.();
            return;
          }
          latestStats = stats;
          const sizeEl = propWin.querySelector<HTMLElement>('[data-prop-size]');
          const diskEl = propWin.querySelector<HTMLElement>('[data-prop-disk]');
          const containsEl = propWin.querySelector<HTMLElement>('[data-prop-contains]');
          if (sizeEl) sizeEl.textContent = formatPropBytes(stats.totalBytes);
          if (diskEl) diskEl.textContent = formatPropBytes(stats.diskBytes);
          if (containsEl) {
            containsEl.textContent = `${stats.files.toLocaleString('en-US')} 个文件，${stats.folders.toLocaleString('en-US')} 个文件夹`;
          }
        },
        () => 384,
      );
    };

    renderPropContent();
    hostLayer.appendChild(propWin);

    propWin.addEventListener('pointerdown', (ev) => {
      propWin.style.zIndex = String(++propWindowZ);
      const target = ev.target as HTMLElement | null;
      const dragBar = target?.closest<HTMLElement>('[data-prop-drag]');
      if (dragBar && !target?.closest('[data-prop-close]')) {
        ev.preventDefault();
        const startX = ev.clientX;
        const startY = ev.clientY;
        const origL = propWin.offsetLeft;
        const origT = propWin.offsetTop;
        const onMove = (m: PointerEvent) => {
          propWin.style.left = `${Math.max(0, Math.min(window.innerWidth - 120, origL + m.clientX - startX))}px`;
          propWin.style.top = `${Math.max(0, Math.min(window.innerHeight - 60, origT + m.clientY - startY))}px`;
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      }
    });

    propWin.addEventListener('click', (ev) => {
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-prop-close]') || target.closest('[data-prop-ok]') || target.closest('[data-prop-cancel]')) {
        cleanup();
        return;
      }
      if (target.closest('[data-prop-apply]')) {
        dirty = false;
        renderPropContent();
        return;
      }
      const tabBtn = target.closest<HTMLElement>('[data-prop-tab]');
      if (tabBtn?.dataset.propTab) {
        activePropTab = tabBtn.dataset.propTab as typeof activePropTab;
        renderPropContent();
        return;
      }
      if (target.closest('[data-prop-ro]')) {
        readOnlyState = readOnlyState === 'checked' ? 'unchecked' : 'checked';
        dirty = true;
        renderPropContent();
        return;
      }
      if (target.closest('[data-prop-hid]')) {
        hiddenChecked = !hiddenChecked;
        dirty = true;
        renderPropContent();
      }
    });

    if (isFolder) {
      startFolderScan();
    }
  }

  function createNewEntry(kind: 'folder' | 'file') {
    const tab = getActiveTab();
    const parent = getNode(tab.locationId);
    if (!parent.writable) return;
    const baseName = kind === 'folder' ? '新建文件夹' : '新建文本文档.txt';
    const existingNames = new Set((parent.children ?? []).map((cid) => nodes[cid]?.name));
    let finalName = baseName;
    let suffix = 2;
    while (existingNames.has(finalName)) {
      finalName = kind === 'folder' ? `新建文件夹 (${suffix})` : `新建文本文档 (${suffix}).txt`;
      suffix++;
    }
    const id = `custom-${nextCustomId++}`;
    nodes[id] = {
      id,
      name: finalName,
      kind,
      icon: kind === 'folder' ? EXP_ICONS.folder : EXP_ICONS.fileTxt,
      parentId: parent.id,
      typeLabel: kind === 'folder' ? '文件夹' : '文本文档',
      sizeBytes: kind === 'file' ? 0 : undefined,
      modifiedText: new Date().toLocaleString('zh-CN', { hour12: false }),
      writable: kind === 'folder',
      children: kind === 'folder' ? [] : undefined,
    };
    parent.children = [...(parent.children ?? []), id];
    tab.selectedItemId = id;
    render();
  }

  function promptRename(nodeId: string) {
    if (!shellEl) return;
    const node = nodes[nodeId];
    if (!node || node.kind === 'root') return;
    showTmModal(shellEl, {
      title: '重命名',
      width: 360,
      bodyHtml: `
        <label class="w11-tm-modal-text" for="w11ExpRenameInput">请输入新名称：</label>
        <input id="w11ExpRenameInput" type="text" class="w11-exp-input" value="${esc(node.name)}" />
      `,
      footerButtons: [
        { label: '取消', onClick: (_, close) => close() },
        {
          label: '确定',
          primary: true,
          onClick: (modalEl, close) => {
            const input = modalEl.querySelector<HTMLInputElement>('#w11ExpRenameInput');
            const nextName = input?.value.trim();
            if (nextName) {
              node.name = nextName;
            }
            close();
            render();
          },
        },
      ],
      onMount: (modalEl) => {
        const input = modalEl.querySelector<HTMLInputElement>('#w11ExpRenameInput');
        input?.focus();
        input?.select();
      },
    });
  }

  function deleteNode(nodeId: string) {
    const tab = getActiveTab();
    const node = nodes[nodeId];
    if (!node || node.kind === 'drive' || node.kind === 'root') return;
    const parent = getNode(tab.locationId);
    parent.children = (parent.children ?? []).filter((id) => id !== nodeId);
    if (tab.selectedItemId === nodeId) tab.selectedItemId = null;
    render();
  }

  function pasteToCurrent() {
    if (!clipboard) return;
    const tab = getActiveTab();
    const targetParent = getNode(tab.locationId);
    if (!targetParent.writable) return;
    const srcNode = nodes[clipboard.nodeId];
    if (!srcNode || srcNode.kind === 'drive' || srcNode.kind === 'root') return;

    if (clipboard.mode === 'cut') {
      const oldParent = nodes[clipboard.fromParentId];
      if (oldParent) {
        oldParent.children = (oldParent.children ?? []).filter((id) => id !== srcNode.id);
      }
      srcNode.parentId = targetParent.id;
      targetParent.children = [...(targetParent.children ?? []), srcNode.id];
      tab.selectedItemId = srcNode.id;
      clipboard = null;
    } else {
      const cloneId = `custom-${nextCustomId++}`;
      nodes[cloneId] = {
        ...srcNode,
        id: cloneId,
        name: `${srcNode.name} - 副本`,
        parentId: targetParent.id,
        children: srcNode.kind === 'folder' ? [] : undefined,
      };
      targetParent.children = [...(targetParent.children ?? []), cloneId];
      tab.selectedItemId = cloneId;
    }
    render();
  }

  function getEffectiveViewMode(tab: ExpTabState): ExpViewMode {
    return tab.locationId === 'this-pc' ? 'tiles' : folderViewMode;
  }

  function buildViewMenuItems(): TmMenuItem[] {
    const modes: Array<{ key: ExpViewMode; label: string }> = [
      { key: 'large', label: '大图标(R)' },
      { key: 'medium', label: '中等图标(M)' },
      { key: 'small', label: '小图标(N)' },
      { key: 'list', label: '列表(L)' },
      { key: 'details', label: '详细信息(D)' },
      { key: 'tiles', label: '平铺(S)' },
    ];
    return modes.map((m) => ({
      label: m.label,
      checked: folderViewMode === m.key,
      checkedType: 'radio',
      onSelect: () => {
        folderViewMode = m.key;
        render();
      },
    }));
  }

  function buildSortMenuItems(): TmMenuItem[] {
    const keys: Array<{ key: ExpSortKey; label: string }> = [
      { key: 'name', label: '名称' },
      { key: 'modified', label: '修改日期' },
      { key: 'type', label: '类型' },
      { key: 'size', label: '大小' },
    ];
    return [
      ...keys.map((k) => ({
        label: k.label,
        checked: sortKey === k.key,
        checkedType: 'radio' as const,
        onSelect: () => {
          sortKey = k.key;
          render();
        },
      })),
      { type: 'divider' as const },
      {
        label: '递增(A)',
        checked: sortDir === 'asc',
        checkedType: 'radio',
        onSelect: () => {
          sortDir = 'asc';
          render();
        },
      },
      {
        label: '递减(D)',
        checked: sortDir === 'desc',
        checkedType: 'radio',
        onSelect: () => {
          sortDir = 'desc';
          render();
        },
      },
    ];
  }

  function buildNewMenuItems(writable: boolean): TmMenuItem[] {
    return [
      {
        label: '文件夹(F)',
        disabled: !writable,
        onSelect: () => createNewEntry('folder'),
      },
      {
        label: '文本文档(T)',
        disabled: !writable,
        onSelect: () => createNewEntry('file'),
      },
    ];
  }

  function buildTabbarHtml(): string {
    const tabsHtml = tabs
      .map((t) => {
        const loc = getNode(t.locationId);
        const activeCls = t.id === activeTabId ? ' is-active' : '';
        return `
          <div class="w11-exp-tab${activeCls}" data-exp-tab="${t.id}" data-no-drag="true">
            <span class="w11-exp-tab-icon"><img src="${loc.icon}" alt="" draggable="false" /></span>
            <span class="w11-exp-tab-title">${esc(loc.name)}</span>
            <button type="button" class="w11-exp-tab-close" data-exp-tab-close="${t.id}" aria-label="关闭标签页">${SVG_GLYPHS.tabClose}</button>
          </div>
        `;
      })
      .join('');
    return `${tabsHtml}<button type="button" class="w11-exp-tab-new" data-exp-tab-new data-no-drag="true" aria-label="新建标签页">${SVG_GLYPHS.tabPlus}</button>`;
  }

  function buildLeftNavHtml(activeLoc: string): string {
    const navBtn = (
      id: string,
      label: string,
      icon: string,
      opts: { chev?: 'right' | 'down' | 'none'; isChild?: boolean; toggleThisPc?: boolean } = {},
    ) => {
      const active = activeLoc === id ? ' is-active' : '';
      const childCls = opts.isChild ? ' is-child' : '';
      const chevHtml =
        opts.chev === 'down'
          ? `<span class="w11-exp-nav-chev" ${opts.toggleThisPc ? 'data-exp-toggle-thispc' : ''}>${SVG_GLYPHS.chevronDown}</span>`
          : opts.chev === 'right'
            ? `<span class="w11-exp-nav-chev" ${opts.toggleThisPc ? 'data-exp-toggle-thispc' : ''}>${SVG_GLYPHS.chevronRight}</span>`
            : `<span class="w11-exp-nav-chev"></span>`;
      return `
        <button type="button" class="w11-exp-nav-item${active}${childCls}" data-exp-nav="${id}">
          ${chevHtml}
          <span class="w11-exp-nav-ico"><img src="${icon}" alt="" draggable="false" /></span>
          <span class="w11-exp-nav-label">${esc(label)}</span>
        </button>
      `;
    };

    return `
      ${navBtn('home', '主文件夹', EXP_ICONS.home)}
      ${navBtn('gallery', '图库', EXP_ICONS.gallery)}
      ${navBtn('onedrive', 'OneDrive - Personal', EXP_ICONS.onedrive, { chev: 'right' })}
      <div class="w11-exp-nav-sep"></div>
      ${navBtn('desktop', '桌面', EXP_ICONS.desktop)}
      ${navBtn('downloads', '下载', EXP_ICONS.downloads)}
      ${navBtn('documents', '文档', EXP_ICONS.documents)}
      ${navBtn('pictures', '图片', EXP_ICONS.pictures)}
      <div class="w11-exp-nav-sep"></div>
      ${navBtn('this-pc', '此电脑', EXP_ICONS.thisPc, {
        chev: thisPcExpanded ? 'down' : 'right',
        toggleThisPc: true,
      })}
      ${
        thisPcExpanded
          ? navBtn('drive-c', '本地磁盘 (C:)', EXP_ICONS.driveSystem, {
              chev: 'right',
              isChild: true,
            })
          : ''
      }
      ${navBtn('libraries', '库', EXP_ICONS.libraries, { chev: 'right' })}
      ${navBtn('network', '网络', EXP_ICONS.network, { chev: 'right' })}
    `;
  }

  function buildMainContentHtml(tab: ExpTabState): { html: string; itemCount: number } {
    const items = getChildNodes(tab);

    if (tab.locationId === 'this-pc') {
      const isSelected = tab.selectedItemId === 'drive-c' ? ' is-selected' : '';
      const diskStats = getDiskCStats();
      return {
        itemCount: items.length,
        html: `
          <div class="w11-exp-group-head" data-exp-toggle-drives>
            <span class="w11-exp-nav-chev">${drivesGroupExpanded ? SVG_GLYPHS.chevronDown : SVG_GLYPHS.chevronRight}</span>
            <span>设备和驱动器</span>
          </div>
          ${
            drivesGroupExpanded && items.length > 0
              ? `
                <div class="w11-exp-drives-grid">
                  <div class="w11-exp-drive-tile${isSelected}" data-exp-item="drive-c" data-exp-open="drive-c">
                    <div class="w11-exp-drive-ico">
                      <img src="${EXP_ICONS.driveSystem}" alt="" draggable="false" />
                    </div>
                    <div class="w11-exp-drive-meta">
                      <div class="w11-exp-drive-title">${esc(nodes['drive-c'].name)}</div>
                      <div class="w11-exp-drive-bar">
                        <div class="w11-exp-drive-bar-fill${diskStats.isWarn ? ' is-warn' : ''}" style="width:${diskStats.usedPct.toFixed(1)}%"></div>
                      </div>
                      <div class="w11-exp-drive-sub">${esc(diskStats.freeText)} 可用，共 ${esc(diskStats.totalText)}</div>
                    </div>
                  </div>
                </div>
              `
              : ''
          }
        `,
      };
    }

    if (items.length === 0) {
      return {
        itemCount: 0,
        html: `<div style="padding:28px 16px;color:#8e8e8e;text-align:center;">此文件夹为空。</div>`,
      };
    }

    const activeMode = getEffectiveViewMode(tab);
    if (activeMode === 'details') {
      virtItems = items;
      const hostEl = shellEl ?? container;
      const curMain = typeof hostEl.querySelector === 'function' ? hostEl.querySelector<HTMLElement>('[data-exp-main]') : null;
      const sameLoc = virtLocationId === tab.locationId;
      const st = sameLoc && curMain ? curMain.scrollTop : 0;
      const vh = curMain && curMain.clientHeight > 0 ? curMain.clientHeight : 600;
      virtLocationId = tab.locationId;
      const { html: rowsHtml, start, end } = buildDetailsRowsSlice(items, tab, st, vh);
      virtLastStart = start;
      virtLastEnd = end;
      return {
        itemCount: items.length,
        html: `
          <table class="w11-exp-details-table">
            <thead>
              <tr>
                <th style="width:${colWidths.name}px">名称<span class="w11-exp-col-resizer" data-exp-col-resize="name"></span></th>
                <th style="width:${colWidths.modified}px">修改日期<span class="w11-exp-col-resizer" data-exp-col-resize="modified"></span></th>
                <th style="width:${colWidths.type}px">类型<span class="w11-exp-col-resizer" data-exp-col-resize="type"></span></th>
                <th style="width:${colWidths.size}px;text-align:right">大小<span class="w11-exp-col-resizer" data-exp-col-resize="size"></span></th>
              </tr>
            </thead>
            <tbody data-exp-virt-tbody>
              ${rowsHtml}
            </tbody>
          </table>
        `,
      };
    }

    virtItems = [];
    const sizeCls =
      activeMode === 'large'
        ? ' is-large'
        : activeMode === 'small'
          ? ' is-small'
          : activeMode === 'list'
            ? ' is-list'
            : '';
    const gridItems = items.length > 2500 ? items.slice(0, 2500) : items;
    return {
      itemCount: items.length,
      html: `
        <div class="w11-exp-items-grid${sizeCls}">
          ${gridItems
            .map((item) => {
              const sel = tab.selectedItemIds.has(item.id) || tab.selectedItemId === item.id ? ' is-selected' : '';
              return `
                <div class="w11-exp-item-card${sel}" data-exp-item="${esc(item.id)}" data-exp-open="${esc(item.id)}">
                  <img src="${item.icon}" alt="" draggable="false" />
                  <span class="w11-exp-item-name">${esc(item.name)}</span>
                </div>
              `;
            })
            .join('')}
        </div>
      `,
    };
  }

  function buildDetailsRowsSlice(
    items: ExpNode[],
    tab: ExpTabState,
    scrollTop: number,
    viewportH: number,
  ): { html: string; start: number; end: number } {
    const start = Math.max(0, Math.floor(scrollTop / DETAIL_ROW_H) - 18);
    const end = Math.min(items.length, Math.ceil((scrollTop + viewportH) / DETAIL_ROW_H) + 18);
    const topPad = start * DETAIL_ROW_H;
    const bottomPad = Math.max(0, (items.length - end) * DETAIL_ROW_H);
    const parts: string[] = [];
    if (topPad > 0) {
      parts.push(`<tr class="w11-exp-spacer" style="height:${topPad}px"><td colspan="4"></td></tr>`);
    }
    for (let i = start; i < end; i++) {
      const item = items[i];
      const sel = tab.selectedItemIds.has(item.id) || tab.selectedItemId === item.id ? ' is-selected' : '';
      parts.push(`
        <tr class="w11-exp-details-row${sel}" data-exp-item="${esc(item.id)}" data-exp-open="${esc(item.id)}">
          <td><span class="w11-exp-details-name"><img src="${item.icon}" alt="" draggable="false" /><span>${esc(item.name)}</span></span></td>
          <td>${esc(item.modifiedText)}</td>
          <td>${esc(item.typeLabel)}</td>
          <td style="text-align:right">${esc(formatSizeText(item.sizeBytes))}</td>
        </tr>
      `);
    }
    if (bottomPad > 0) {
      parts.push(`<tr class="w11-exp-spacer" style="height:${bottomPad}px"><td colspan="4"></td></tr>`);
    }
    return { html: parts.join(''), start, end };
  }

  function updateVirtualDetailsWindow() {
    if (virtItems.length === 0) return;
    const hostEl = shellEl ?? container;
    const mainEl = hostEl.querySelector<HTMLElement>('[data-exp-main]');
    const tbody = hostEl.querySelector<HTMLElement>('[data-exp-virt-tbody]');
    if (!mainEl || !tbody) return;
    const st = mainEl.scrollTop;
    const vh = mainEl.clientHeight || 600;
    const start = Math.max(0, Math.floor(st / DETAIL_ROW_H) - 18);
    const end = Math.min(virtItems.length, Math.ceil((st + vh) / DETAIL_ROW_H) + 18);
    if (start === virtLastStart && end === virtLastEnd) return;
    const slice = buildDetailsRowsSlice(virtItems, getActiveTab(), st, vh);
    virtLastStart = slice.start;
    virtLastEnd = slice.end;
    tbody.innerHTML = slice.html;
  }

  function buildDetailPaneHtml(tab: ExpTabState, itemCount: number): string {
    const selected = tab.selectedItemId ? nodes[tab.selectedItemId] : null;
    if (selected) {
      return `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
          <img src="${selected.icon}" width="32" height="32" alt="" />
          <div style="font-size:14px;font-weight:600;color:#fff;word-break:break-all;">${esc(selected.name)}</div>
        </div>
        <div style="color:#a8a8a8;margin-bottom:4px;">类型：${esc(selected.typeLabel)}</div>
        ${
          selected.kind === 'file'
            ? `<div style="color:#a8a8a8;margin-bottom:4px;">大小：${esc(formatSizeText(selected.sizeBytes) || '0 字节')}</div>`
            : ''
        }
        <div style="color:#a8a8a8;">修改日期：${esc(selected.modifiedText)}</div>
      `;
    }
    const loc = getNode(tab.locationId);
    return `
      <div style="font-size:14px;font-weight:600;color:#fff;margin-bottom:6px;">${esc(loc.name)}</div>
      <div style="color:#9e9e9e;">${itemCount} 个项目</div>
    `;
  }

  function buildShellInnerHtml(): string {
    const tab = getActiveTab();
    const loc = getNode(tab.locationId);
    const canBack = tab.historyIndex > 0;
    const canForward = tab.historyIndex < tab.history.length - 1;
    const canUp = Boolean(loc.parentId);
    const selectedNode = tab.selectedItemId ? nodes[tab.selectedItemId] : null;
    const hasSelection = Boolean(selectedNode);
    const canMutateSelected = Boolean(selectedNode && selectedNode.kind !== 'drive' && selectedNode.kind !== 'root');
    const canWriteHere = Boolean(loc.writable);
    const canPaste = Boolean(clipboard && canWriteHere);
    const { html: mainHtml, itemCount } = buildMainContentHtml(tab);

    const crumbsHtml = getBreadcrumbs(loc.id)
      .map(
        (c) => `
          <span class="w11-exp-addr-sep">${SVG_GLYPHS.chevronRight}</span>
          <button type="button" class="w11-exp-addr-crumb" data-exp-nav="${esc(c.id)}">${esc(c.name)}</button>
        `,
      )
      .join('');

    return `
      <div class="w11-exp-navbar">
        <div class="w11-exp-nav-btns">
          <button type="button" class="w11-exp-icon-btn" data-exp-act="back" ${canBack ? '' : 'disabled'} aria-label="后退">${SVG_GLYPHS.back}</button>
          <button type="button" class="w11-exp-icon-btn" data-exp-act="forward" ${canForward ? '' : 'disabled'} aria-label="前进">${SVG_GLYPHS.forward}</button>
          <button type="button" class="w11-exp-icon-btn" data-exp-act="up" ${canUp ? '' : 'disabled'} aria-label="向上">${SVG_GLYPHS.up}</button>
          <button type="button" class="w11-exp-icon-btn" data-exp-act="refresh" aria-label="刷新">${SVG_GLYPHS.refresh}</button>
        </div>
        <div class="w11-exp-addr-box">
          <span class="w11-exp-addr-root-ico">${SVG_GLYPHS.monitorMono}</span>
          ${crumbsHtml}
          <span class="w11-exp-addr-sep">${SVG_GLYPHS.chevronRight}</span>
        </div>
        <div class="w11-exp-nav-splitter" data-exp-search-splitter></div>
        <div class="w11-exp-search-box" data-exp-searchbox style="width:${searchWidth}px">
          <span class="w11-exp-search-ico">${SVG_GLYPHS.search}</span>
          <input type="text" class="w11-exp-search-input" data-exp-search value="${esc(tab.searchQuery)}" placeholder="在 ${esc(loc.name)} 中搜索" aria-label="在 ${esc(loc.name)} 中搜索" autocomplete="off" />
        </div>
      </div>

      <div class="w11-exp-cmdbar">
        <button type="button" class="w11-exp-cmd-btn" data-exp-act="new" ${canWriteHere ? '' : 'disabled'}>
          <img src="${EXP_ICONS.cmdNew}" alt="" draggable="false" />
          <span>新建</span>
          <span class="w11-exp-cmd-caret">⌄</span>
        </button>
        <span class="w11-exp-cmd-sep"></span>
        <button type="button" class="w11-exp-cmd-btn is-icon-only" data-exp-act="cut" ${canMutateSelected ? '' : 'disabled'} aria-label="剪切">
          <img src="${EXP_ICONS.cmdCut}" alt="" draggable="false" />
        </button>
        <button type="button" class="w11-exp-cmd-btn is-icon-only" data-exp-act="copy" ${canMutateSelected ? '' : 'disabled'} aria-label="复制">
          <img src="${EXP_ICONS.cmdCopy}" alt="" draggable="false" />
        </button>
        <button type="button" class="w11-exp-cmd-btn is-icon-only" data-exp-act="paste" ${canPaste ? '' : 'disabled'} aria-label="粘贴">
          <img src="${EXP_ICONS.cmdPaste}" alt="" draggable="false" />
        </button>
        <button type="button" class="w11-exp-cmd-btn is-icon-only" data-exp-act="rename" ${hasSelection ? '' : 'disabled'} aria-label="重命名">
          <img src="${EXP_ICONS.cmdRename}" alt="" draggable="false" />
        </button>
        <button type="button" class="w11-exp-cmd-btn is-icon-only" data-exp-act="share" ${hasSelection ? '' : 'disabled'} aria-label="共享">
          <img src="${EXP_ICONS.cmdShare}" alt="" draggable="false" />
        </button>
        <button type="button" class="w11-exp-cmd-btn is-icon-only" data-exp-act="delete" ${canMutateSelected ? '' : 'disabled'} aria-label="删除">
          <img src="${EXP_ICONS.cmdDelete}" alt="" draggable="false" />
        </button>
        <span class="w11-exp-cmd-sep"></span>
        <button type="button" class="w11-exp-cmd-btn" data-exp-act="sort">
          <img src="${EXP_ICONS.cmdSort}" alt="" draggable="false" />
          <span>排序</span>
          <span class="w11-exp-cmd-caret">⌄</span>
        </button>
        <button type="button" class="w11-exp-cmd-btn" data-exp-act="view">
          <img src="${EXP_ICONS.cmdView}" alt="" draggable="false" />
          <span>查看</span>
          <span class="w11-exp-cmd-caret">⌄</span>
        </button>
        <span class="w11-exp-cmd-sep"></span>
        <button type="button" class="w11-exp-cmd-btn is-icon-only" data-exp-act="more" aria-label="查看更多">
          ${SVG_GLYPHS.more}
        </button>
        <span class="w11-exp-cmd-spacer"></span>
        <button type="button" class="w11-exp-cmd-btn" data-exp-act="details-pane">
          <img src="${EXP_ICONS.cmdDetails}" alt="" draggable="false" />
          <span>详细信息</span>
        </button>
      </div>

      <div class="w11-exp-workspace">
        <aside class="w11-exp-navpane" data-exp-navpane style="width:${navWidth}px">
          ${buildLeftNavHtml(tab.locationId)}
        </aside>
        <div class="w11-exp-splitter" data-exp-splitter></div>
        <main class="w11-exp-main" data-exp-main>
          ${mainHtml}
          <div class="w11-exp-marquee" data-exp-marquee></div>
        </main>
        ${
          showDetailsPane
            ? `<aside class="w11-exp-detail-pane" data-exp-detail-pane>${buildDetailPaneHtml(tab, itemCount)}</aside>`
            : ''
        }
      </div>

      <footer class="w11-exp-statusbar">
        <div class="w11-exp-status-left" data-exp-status-left>
          <span>${itemCount} 个项目</span>
          <span class="w11-exp-status-sep">|</span>
          ${hasSelection ? `<span>已选择 ${Math.max(1, tab.selectedItemIds.size)} 个项目</span><span class="w11-exp-status-sep">|</span>` : ''}
        </div>
        <div class="w11-exp-status-views">
          <button type="button" class="w11-exp-view-btn${getEffectiveViewMode(tab) === 'details' ? ' is-active' : ''}" data-exp-view="details" aria-label="详细信息视图">${SVG_GLYPHS.statusList}</button>
          <button type="button" class="w11-exp-view-btn${getEffectiveViewMode(tab) !== 'details' ? ' is-active' : ''}" data-exp-view="tiles" aria-label="平铺视图">${SVG_GLYPHS.statusGrid}</button>
        </div>
      </footer>
    `;
  }

  /**
   * Updates selection state in-place without rebuilding DOM nodes so dblclick
   * events between click 1 and click 2 are never interrupted.
   */
  function syncSelectionUi() {
    const host = shellEl ?? container;
    const tab = getActiveTab();
    const selCount = tab.selectedItemIds.size || (tab.selectedItemId ? 1 : 0);
    const primaryId = tab.selectedItemId ?? ([...tab.selectedItemIds][0] ?? null);
    const selectedNode = primaryId ? nodes[primaryId] : null;
    const hasSelection = selCount > 0;
    const canMutate = Boolean(selectedNode && selectedNode.kind !== 'drive' && selectedNode.kind !== 'root');

    host.querySelectorAll<HTMLElement>('[data-exp-item]').forEach((el) => {
      const id = el.dataset.expItem ?? '';
      el.classList.toggle('is-selected', tab.selectedItemIds.has(id) || id === tab.selectedItemId);
    });

    const setDisabled = (act: string, disabled: boolean) => {
      const btn = host.querySelector<HTMLButtonElement>(`[data-exp-act="${act}"]`);
      if (btn) btn.disabled = disabled;
    };
    setDisabled('cut', !canMutate);
    setDisabled('copy', !canMutate);
    setDisabled('rename', !hasSelection);
    setDisabled('share', !hasSelection);
    setDisabled('delete', !canMutate);

    const statusLeft = host.querySelector<HTMLElement>('[data-exp-status-left]');
    if (statusLeft) {
      const count = getChildNodes(tab).length;
      statusLeft.innerHTML = `
        <span>${count} 个项目</span>
        <span class="w11-exp-status-sep">|</span>
        ${hasSelection ? `<span>已选择 ${selCount} 个项目</span><span class="w11-exp-status-sep">|</span>` : ''}
      `;
    }

    const detailPane = host.querySelector<HTMLElement>('[data-exp-detail-pane]');
    if (detailPane) {
      detailPane.innerHTML = buildDetailPaneHtml(tab, getChildNodes(tab).length);
    }
  }

  function render() {
    menuCtrl?.close();
    const tab = getActiveTab();
    const prevHost = shellEl ?? container;
    const prevMain = typeof prevHost.querySelector === 'function' ? prevHost.querySelector<HTMLElement>('[data-exp-main]') : null;
    const keepScroll = virtLocationId === tab.locationId && prevMain ? prevMain.scrollTop : 0;

    if (tabbarEl) {
      tabbarEl.innerHTML = buildTabbarHtml();
    }
    const inner = buildShellInnerHtml();
    if (shellEl) {
      shellEl.innerHTML = inner;
    } else {
      container.innerHTML = `<div class="w11-exp-shell">${inner}</div>`;
    }

    if (hasRealDom) {
      const nextMain = (shellEl ?? container).querySelector<HTMLElement>('[data-exp-main]');
      if (nextMain) {
        if (keepScroll > 0) nextMain.scrollTop = keepScroll;
        if (virtItems.length > 0) {
          nextMain.addEventListener(
            'scroll',
            () => {
              if (virtScrollRaf) return;
              virtScrollRaf = requestAnimationFrame(() => {
                virtScrollRaf = 0;
                updateVirtualDetailsWindow();
              });
            },
            { passive: true },
          );
        }
      }
    }
  }

  if (hasRealDom && hostTitlebarEl) {
    if (origTitleEl) origTitleEl.style.display = 'none';
    tabbarEl = document.createElement('div');
    tabbarEl.className = 'w11-exp-tabbar';
    const controlsEl = hostTitlebarEl.querySelector('.w11-win-controls');
    hostTitlebarEl.insertBefore(tabbarEl, controlsEl);

    tabbarEl.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const closeBtn = target.closest<HTMLElement>('[data-exp-tab-close]');
      if (closeBtn) {
        e.stopPropagation();
        const closeId = Number(closeBtn.dataset.expTabClose);
        if (tabs.length <= 1) {
          shell.closeWindow(ctx.pid);
          return;
        }
        tabs = tabs.filter((t) => t.id !== closeId);
        if (activeTabId === closeId) {
          activeTabId = tabs[tabs.length - 1].id;
          shell.setWindowTitle(ctx.pid, getNode(getActiveTab().locationId).name);
        }
        render();
        return;
      }
      if (target.closest('[data-exp-tab-new]')) {
        const newTab: ExpTabState = {
          id: nextTabId++,
          locationId: 'this-pc',
          history: ['this-pc'],
          historyIndex: 0,
          selectedItemId: null,
          selectedItemIds: new Set<string>(),
          searchQuery: '',
        };
        tabs.push(newTab);
        activeTabId = newTab.id;
        shell.setWindowTitle(ctx.pid, '此电脑');
        render();
        return;
      }
      const tabEl = target.closest<HTMLElement>('[data-exp-tab]');
      if (tabEl) {
        const id = Number(tabEl.dataset.expTab);
        if (id && id !== activeTabId) {
          activeTabId = id;
          shell.setWindowTitle(ctx.pid, getNode(getActiveTab().locationId).name);
          render();
        }
      }
    });
  }

  function handleContainerClick(e: Event) {
    const target = e.target as HTMLElement | null;
    if (!target || typeof target.closest !== 'function') return;

    if (target.closest('[data-exp-toggle-thispc]')) {
      e.stopPropagation();
      thisPcExpanded = !thisPcExpanded;
      render();
      return;
    }

    if (target.closest('[data-exp-toggle-drives]')) {
      drivesGroupExpanded = !drivesGroupExpanded;
      render();
      return;
    }

    const navEl = target.closest<HTMLElement>('[data-exp-nav]');
    if (navEl?.dataset.expNav) {
      navigateTo(navEl.dataset.expNav);
      return;
    }

    const actBtn = target.closest<HTMLElement>('[data-exp-act]');
    if (actBtn?.dataset.expAct) {
      const act = actBtn.dataset.expAct;
      const tab = getActiveTab();
      const loc = getNode(tab.locationId);
      if (act === 'back' && tab.historyIndex > 0) {
        tab.historyIndex -= 1;
        tab.locationId = tab.history[tab.historyIndex];
        tab.selectedItemId = null;
        shell.setWindowTitle(ctx.pid, getNode(tab.locationId).name);
        render();
      } else if (act === 'forward' && tab.historyIndex < tab.history.length - 1) {
        tab.historyIndex += 1;
        tab.locationId = tab.history[tab.historyIndex];
        tab.selectedItemId = null;
        shell.setWindowTitle(ctx.pid, getNode(tab.locationId).name);
        render();
      } else if (act === 'up' && loc.parentId) {
        navigateTo(loc.parentId);
      } else if (act === 'refresh') {
        render();
      } else if (act === 'details-pane') {
        showDetailsPane = !showDetailsPane;
        render();
      } else if (act === 'new' && menuCtrl) {
        menuCtrl.openBelowElement(actBtn, buildNewMenuItems(Boolean(loc.writable)));
      } else if (act === 'sort' && menuCtrl) {
        menuCtrl.openBelowElement(actBtn, buildSortMenuItems());
      } else if (act === 'view' && menuCtrl) {
        menuCtrl.openBelowElement(actBtn, buildViewMenuItems());
      } else if (act === 'cut' && tab.selectedItemId) {
        clipboard = { mode: 'cut', nodeId: tab.selectedItemId, fromParentId: tab.locationId };
        render();
      } else if (act === 'copy' && tab.selectedItemId) {
        clipboard = { mode: 'copy', nodeId: tab.selectedItemId, fromParentId: tab.locationId };
        render();
      } else if (act === 'paste') {
        pasteToCurrent();
      } else if (act === 'rename' && tab.selectedItemId) {
        promptRename(tab.selectedItemId);
      } else if (act === 'delete' && tab.selectedItemId) {
        deleteNode(tab.selectedItemId);
      } else if (act === 'more' && menuCtrl) {
        menuCtrl.openBelowElement(actBtn, [
          { label: '属性(R)', onSelect: () => showPropertiesModal(tab.selectedItemId ?? tab.locationId) },
        ]);
      }
      return;
    }

    const viewBtn = target.closest<HTMLElement>('[data-exp-view]');
    if (viewBtn?.dataset.expView) {
      const tab = getActiveTab();
      if (tab.locationId !== 'this-pc') {
        folderViewMode = viewBtn.dataset.expView as ExpViewMode;
        render();
      }
      return;
    }

    const itemEl = target.closest<HTMLElement>('[data-exp-item]');
    if (itemEl) {
      const tab = getActiveTab();
      const id = itemEl.dataset.expItem ?? null;
      const me = e as MouseEvent;
      if (id) {
        if (me.ctrlKey || me.metaKey) {
          if (tab.selectedItemIds.has(id)) tab.selectedItemIds.delete(id);
          else tab.selectedItemIds.add(id);
          tab.selectedItemId = tab.selectedItemIds.has(id) ? id : ([...tab.selectedItemIds][0] ?? null);
        } else {
          tab.selectedItemIds.clear();
          tab.selectedItemIds.add(id);
          tab.selectedItemId = id;
        }
      }
      syncSelectionUi();
      return;
    }

    if (target.closest('[data-exp-main]')) {
      if (suppressNextMainClick) {
        suppressNextMainClick = false;
        return;
      }
      const tab = getActiveTab();
      if (tab.selectedItemId !== null || tab.selectedItemIds.size > 0) {
        tab.selectedItemId = null;
        tab.selectedItemIds.clear();
        syncSelectionUi();
      }
    }
  }

  function handleContainerDblClick(e: Event) {
    const target = e.target as HTMLElement | null;
    if (!target || typeof target.closest !== 'function') return;
    const openEl = target.closest<HTMLElement>('[data-exp-open]');
    if (openEl?.dataset.expOpen) {
      openNode(openEl.dataset.expOpen);
    }
  }

  function handleContextMenu(e: Event) {
    const me = e as MouseEvent;
    const target = me.target as HTMLElement | null;
    if (!target || typeof target.closest !== 'function' || !menuCtrl) return;
    const inMain = target.closest('[data-exp-main]');
    if (!inMain) return;
    me.preventDefault();

    const tab = getActiveTab();
    const loc = getNode(tab.locationId);
    const itemEl = target.closest<HTMLElement>('[data-exp-item]');

    if (itemEl?.dataset.expItem) {
      const itemId = itemEl.dataset.expItem;
      const itemNode = nodes[itemId];
      if (!itemNode) return;
      tab.selectedItemId = itemId;
      syncSelectionUi();
      const canMutate = itemNode.kind !== 'drive' && itemNode.kind !== 'root';
      menuCtrl.openAt(me.clientX, me.clientY, [
        { label: '打开(O)', onSelect: () => openNode(itemId) },
        { type: 'divider' },
        {
          label: '剪切(T)',
          shortcut: 'Ctrl+X',
          disabled: !canMutate,
          onSelect: () => {
            clipboard = { mode: 'cut', nodeId: itemId, fromParentId: tab.locationId };
            render();
          },
        },
        {
          label: '复制(C)',
          shortcut: 'Ctrl+C',
          disabled: !canMutate,
          onSelect: () => {
            clipboard = { mode: 'copy', nodeId: itemId, fromParentId: tab.locationId };
            render();
          },
        },
        {
          label: '删除(D)',
          shortcut: 'Del',
          disabled: !canMutate,
          onSelect: () => deleteNode(itemId),
        },
        {
          label: '重命名(M)',
          shortcut: 'F2',
          onSelect: () => promptRename(itemId),
        },
        { type: 'divider' },
        { label: '属性(R)', onSelect: () => showPropertiesModal(itemId) },
      ]);
      return;
    }

    if (tab.selectedItemId !== null || tab.selectedItemIds.size > 0) {
      tab.selectedItemId = null;
      tab.selectedItemIds.clear();
      syncSelectionUi();
    }

    menuCtrl.openAt(me.clientX, me.clientY, [
      { label: '查看(V)', iconHtml: UI_ICONS.view, submenu: buildViewMenuItems() },
      { label: '排序方式(O)', iconHtml: UI_ICONS.sort, submenu: buildSortMenuItems() },
      { label: '刷新(E)', iconHtml: UI_ICONS.refresh, onSelect: () => render() },
      { type: 'divider' },
      { label: '新建(W)', iconHtml: UI_ICONS.folder, disabled: !loc.writable, submenu: buildNewMenuItems(Boolean(loc.writable)) },
      {
        label: '粘贴(P)',
        shortcut: 'Ctrl+V',
        disabled: !(clipboard && loc.writable),
        onSelect: () => pasteToCurrent(),
      },
      { type: 'divider' },
      { label: '属性(R)', iconHtml: UI_ICONS.displaySettings, onSelect: () => showPropertiesModal(tab.locationId) },
    ]);
  }

  function handleContainerInput(e: Event) {
    const input = e.target as HTMLInputElement | null;
    if (!input || typeof input.matches !== 'function' || !input.matches('[data-exp-search]')) return;
    const tab = getActiveTab();
    tab.searchQuery = input.value ?? '';
    const mainEl = (shellEl ?? container).querySelector<HTMLElement>('[data-exp-main]');
    if (mainEl) {
      mainEl.innerHTML = `${buildMainContentHtml(tab).html}<div class="w11-exp-marquee" data-exp-marquee></div>`;
    }
  }

  function handlePointerDown(e: Event) {
    const pe = e as PointerEvent;
    const target = pe.target as HTMLElement | null;
    if (!target || typeof target.closest !== 'function' || pe.button !== 0) return;

    // 1. Left navigation pane splitter
    const splitter = target.closest<HTMLElement>('[data-exp-splitter]');
    if (splitter) {
      const navPane = (shellEl ?? container).querySelector<HTMLElement>('[data-exp-navpane]');
      if (!navPane) return;
      pe.preventDefault();
      const startX = pe.clientX;
      const startW = navPane.offsetWidth || navWidth;
      const onMove = (me: PointerEvent) => {
        navWidth = Math.max(120, Math.min(300, Math.round(startW + me.clientX - startX)));
        navPane.style.width = `${navWidth}px`;
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      return;
    }

    // 2. Top Address <-> Search box width splitter
    const searchSplitter = target.closest<HTMLElement>('[data-exp-search-splitter]');
    if (searchSplitter) {
      const searchBox = (shellEl ?? container).querySelector<HTMLElement>('[data-exp-searchbox]');
      if (!searchBox) return;
      pe.preventDefault();
      const startX = pe.clientX;
      const startW = searchBox.offsetWidth || searchWidth;
      const onMove = (me: PointerEvent) => {
        searchWidth = Math.max(140, Math.min(480, Math.round(startW - (me.clientX - startX))));
        searchBox.style.width = `${searchWidth}px`;
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      return;
    }

    // 3. Details view table column width resizers
    const colResizer = target.closest<HTMLElement>('[data-exp-col-resize]');
    if (colResizer?.dataset.expColResize) {
      const colKey = colResizer.dataset.expColResize as keyof typeof colWidths;
      const thEl = colResizer.closest<HTMLElement>('th');
      if (!thEl) return;
      pe.preventDefault();
      const startX = pe.clientX;
      const startW = thEl.offsetWidth || colWidths[colKey];
      const onMove = (me: PointerEvent) => {
        const nextW = Math.max(64, Math.min(520, Math.round(startW + me.clientX - startX)));
        colWidths[colKey] = nextW;
        thEl.style.width = `${nextW}px`;
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      return;
    }

    // 4. Blue rubber-band marquee selection inside [data-exp-main]
    const mainEl = target.closest<HTMLElement>('[data-exp-main]');
    if (mainEl && !target.closest('[data-exp-item], [data-exp-toggle-drives], th')) {
      const marqueeEl = mainEl.querySelector<HTMLElement>('[data-exp-marquee]');
      if (!marqueeEl) return;
      const rect = mainEl.getBoundingClientRect();
      const scaleX = rect.width > 0 ? rect.width / (mainEl.clientWidth || rect.width) : 1;
      const scaleY = rect.height > 0 ? rect.height / (mainEl.clientHeight || rect.height) : 1;
      const startLocalX = (pe.clientX - rect.left) / scaleX + mainEl.scrollLeft;
      const startLocalY = (pe.clientY - rect.top) / scaleY + mainEl.scrollTop;
      const startClientX = pe.clientX;
      const startClientY = pe.clientY;
      let dragging = false;

      const onMove = (me: PointerEvent) => {
        if (!dragging && Math.hypot(me.clientX - startClientX, me.clientY - startClientY) < 4) return;
        dragging = true;
        const curLocalX = (me.clientX - rect.left) / scaleX + mainEl.scrollLeft;
        const curLocalY = (me.clientY - rect.top) / scaleY + mainEl.scrollTop;
        const left = Math.max(0, Math.min(startLocalX, curLocalX));
        const top = Math.max(0, Math.min(startLocalY, curLocalY));
        const right = Math.max(startLocalX, curLocalX);
        const bottom = Math.max(startLocalY, curLocalY);

        marqueeEl.style.display = 'block';
        marqueeEl.style.left = `${left}px`;
        marqueeEl.style.top = `${top}px`;
        marqueeEl.style.width = `${Math.max(1, right - left)}px`;
        marqueeEl.style.height = `${Math.max(1, bottom - top)}px`;

        const selRect = {
          left: Math.min(startClientX, me.clientX),
          top: Math.min(startClientY, me.clientY),
          right: Math.max(startClientX, me.clientX),
          bottom: Math.max(startClientY, me.clientY),
        };
        const tab = getActiveTab();
        tab.selectedItemIds.clear();
        mainEl.querySelectorAll<HTMLElement>('[data-exp-item]').forEach((itemEl) => {
          const r = itemEl.getBoundingClientRect();
          const hit = !(r.right < selRect.left || r.left > selRect.right || r.bottom < selRect.top || r.top > selRect.bottom);
          const id = itemEl.dataset.expItem;
          if (hit && id) tab.selectedItemIds.add(id);
        });
        tab.selectedItemId = [...tab.selectedItemIds][0] ?? null;
        syncSelectionUi();
      };

      const onUp = () => {
        marqueeEl.style.display = 'none';
        if (dragging) {
          suppressNextMainClick = true;
        }
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    }
  }

  const eventTarget = shellEl ?? container;
  eventTarget.addEventListener('click', handleContainerClick);
  if (hasRealDom) {
    eventTarget.addEventListener('dblclick', handleContainerDblClick);
    eventTarget.addEventListener('contextmenu', handleContextMenu);
    eventTarget.addEventListener('input', handleContainerInput);
    eventTarget.addEventListener('pointerdown', handlePointerDown);
  }

  render();

  if (hasRealDom) {
    void loadFullWin11FsSkeleton(nodes).then((updated) => {
      if (updated && !destroyed && getActiveTab().locationId !== 'this-pc') {
        render();
      }
    });
  }

  return {
    onThemeChange: () => render(),
    onHardwareUpdate: () => {
      if (getActiveTab().locationId === 'this-pc') {
        const subEl = (shellEl ?? container).querySelector<HTMLElement>('.w11-exp-drive-sub');
        const fillEl = (shellEl ?? container).querySelector<HTMLElement>('.w11-exp-drive-bar-fill');
        if (subEl && fillEl) {
          const stats = getDiskCStats();
          subEl.textContent = `${stats.freeText} 可用，共 ${stats.totalText}`;
          fillEl.style.width = `${stats.usedPct.toFixed(1)}%`;
          fillEl.classList.toggle('is-warn', stats.isWarn);
        }
      }
    },
    destroy: () => {
      destroyed = true;
      for (const cleanup of [...openPropCleanups]) cleanup();
      menuCtrl?.destroy();
      eventTarget.removeEventListener('click', handleContainerClick);
      if (hasRealDom) {
        eventTarget.removeEventListener('dblclick', handleContainerDblClick);
        eventTarget.removeEventListener('contextmenu', handleContextMenu);
        eventTarget.removeEventListener('input', handleContainerInput);
        eventTarget.removeEventListener('pointerdown', handlePointerDown);
      }
      if (tabbarEl) tabbarEl.remove();
      if (origTitleEl) origTitleEl.style.display = '';
    },
  };
}

export const explorerApp: WinAppModule = {
  mount: mountExplorer,
};
