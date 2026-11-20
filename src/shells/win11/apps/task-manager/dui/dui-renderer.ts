import perfBundleRaw from '../win32-extracted/perf-dui-bundle.json';

export interface DuiNode {
  tag: string;
  attrs: Record<string, string>;
  children: DuiNode[];
}

export interface MuiMenuItemNode {
  id: number;
  text: string;
  flags?: number;
  submenu?: MuiMenuItemNode[];
}

export interface MuiDialogControl {
  id: number;
  x: number;
  y: number;
  cx: number;
  cy: number;
  class: string;
  text: string;
  style: number;
}

export interface MuiDialogTemplate {
  id: string;
  kind: string;
  x: number;
  y: number;
  cx: number;
  cy: number;
  title: string;
  font?: string;
  controls: MuiDialogControl[];
}

export interface DuiSeriesPaletteEntry {
  bg: string;
  border: string;
  grid: string;
  axisText: string;
  stroke: string;
  fill: string;
  kernelFill?: string;
  secondaryStroke?: string;
  dot: string;
  legend: string;
}

export interface PerfDuiBundle {
  themeTokens: Record<string, Record<string, {
    color?: string;
    borderColor?: string;
    fillColor?: string;
    alpha?: number;
    fontFamily?: string;
    pxHeight?: number;
    weight?: number;
  }>>;
  seriesPalettes: {
    darkLegend: Record<'cpu' | 'mem' | 'disk' | 'net' | 'gpu', string>;
    chartPartRows: number[][];
    dark: Record<'cpu' | 'mem' | 'disk' | 'net' | 'gpu', DuiSeriesPaletteEntry>;
    light: Record<'cpu' | 'mem' | 'disk' | 'net' | 'gpu', DuiSeriesPaletteEntry>;
  };
  compiledLayout: {
    detailInfo: Record<string, string>;
    chartAndTitle: Record<string, string>;
    chartInfo: Record<string, string>;
    dataInfo: Record<string, string>;
    staticInfo: Record<string, string>;
    staticChart: Record<string, string>;
    secondaryChart: Record<string, string>;
    cpuChart: Record<string, string>;
    gpuChart: Record<string, string>;
    barchartMemoryHolder: Record<string, string>;
    dashboardLegend: Record<string, string>;
    dashboardWriteLegend: Record<string, string>;
    staticLabel: Record<string, string>;
    staticData: Record<string, string>;
    dynamicLabel: Record<string, string>;
    dynamicData: Record<string, string>;
    theader: Record<string, string>;
    resourceTitle: Record<string, string>;
    resourceName: Record<string, string>;
  };
  stylesheets: Record<string, DuiNode>;
  resources: Record<string, DuiNode>;
  strings: Record<string, string>;
  menus: Record<string, { id: string; items: MuiMenuItemNode[] }>;
  dialogs: Record<string, MuiDialogTemplate>;
}

export const perfBundle = perfBundleRaw as unknown as PerfDuiBundle;

function escHtml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function extractAtomId(raw?: string): string | undefined {
  if (!raw) return undefined;
  const m = raw.match(/^atom\(([^)]+)\)$/);
  return m ? m[1] : undefined;
}

export function resolveResStr(val?: string, stripMnemonic = true): string {
  if (!val) return '';
  const m = val.match(/^resstr\((\d+)\)$/);
  const resolved = m ? (perfBundle.strings[m[1]] ?? val) : val;
  if (!stripMnemonic) return resolved;
  return resolved.replace(/\(&[A-Za-z0-9]\)/g, '').replace(/&([A-Za-z0-9])/g, '$1').trim();
}

export function muiString(id: string | number, fallback = ''): string {
  return perfBundle.strings[String(id)] ?? fallback;
}

export function normalizeStaticLabel(raw: string): string {
  const s = resolveResStr(raw, true).replace(/：$/, ':');
  return s.endsWith(':') ? s : `${s}:`;
}

export function parseDuiRect(rectStr?: string): [number, number, number, number] | null {
  if (!rectStr) return null;
  const m = rectStr.match(/^rect\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\s*\)$/);
  if (!m) return null;
  const toPx = (tok: string) => Number.parseFloat(tok.replace(/rp$/i, '').trim()) || 0;
  // DirectUI rect ordering is (left, top, right, bottom) -> return [top, right, bottom, left] for CSS shorthand
  const left = toPx(m[1]);
  const top = toPx(m[2]);
  const right = toPx(m[3]);
  const bottom = toPx(m[4]);
  return [top, right, bottom, left];
}

/**
 * Windows 11 Logical CPU grid columns/rows matching Taskmgr TMGrid aspect rules.
 */
export function computeCpuCoreGridLayout(cores: number): { cols: number; rows: number } {
  const c = Math.max(1, cores);
  if (c === 1) return { cols: 1, rows: 1 };
  if (c === 2) return { cols: 2, rows: 1 };
  if (c <= 4) return { cols: 2, rows: 2 };
  if (c <= 6) return { cols: 3, rows: 2 };
  if (c <= 8) return { cols: 4, rows: 2 };
  if (c <= 12) return { cols: 4, rows: 3 };
  if (c <= 16) return { cols: 4, rows: 4 };
  if (c <= 20) return { cols: 5, rows: 4 };
  if (c <= 24) return { cols: 6, rows: 4 };
  if (c <= 32) return { cols: 8, rows: 4 };
  const cols = Math.ceil(Math.sqrt(c));
  return { cols, rows: Math.ceil(c / cols) };
}

/**
 * Converts Win32 DIALOGEX dialog units (Microsoft YaHei UI 9pt) to modal pixels.
 */
export function dluToPxDialogSpec(dialogId: string): {
  title: string;
  widthPx: number;
  heightPx: number;
  okLabel: string;
  cancelLabel: string;
} {
  const dlg = perfBundle.dialogs[dialogId];
  if (!dlg) {
    return { title: '', widthPx: 390, heightPx: 320, okLabel: '确定', cancelLabel: '取消' };
  }
  // 9pt Segoe/YaHei UI average char ~6x15px => x DLU * 1.24 fits crisp 1024px Web modals without horizontal overflow
  const widthPx = Math.round(dlg.cx * 1.24);
  const heightPx = Math.round(dlg.cy * 1.42);
  const okCtrl = dlg.controls.find((c) => c.id === 1);
  const cancelCtrl = dlg.controls.find((c) => c.id === 2);
  return {
    title: dlg.title,
    widthPx,
    heightPx,
    okLabel: resolveResStr(okCtrl?.text || '确定', true),
    cancelLabel: resolveResStr(cancelCtrl?.text || '取消', true),
  };
}

/**
 * Formats Win32 MENU label mnemonic like `查看网络详细信息(&D)` -> `查看网络详细信息(D)`
 * while splitting shortcut tabs cleanly if needed.
 */
export function formatMuiMenuText(raw: string): { label: string; shortcut?: string } {
  const [left, right] = raw.split('\t');
  const label = left.replace(/\(&([A-Za-z0-9])\)/g, '($1)').trim();
  const shortcut = right?.trim() || undefined;
  return { label, shortcut };
}

export interface MuiMenuCommandState {
  visible?: boolean;
  checked?: boolean;
  checkedType?: 'check' | 'radio';
  labelOverride?: string;
  submenuOverride?: Array<{
    label: string;
    checked?: boolean;
    checkedType?: 'check' | 'radio';
    onSelect: () => void;
  }>;
  onSelect?: () => void;
}

export interface RenderedMuiMenuItem {
  type?: 'divider';
  label?: string;
  shortcut?: string;
  checked?: boolean;
  checkedType?: 'check' | 'radio';
  submenu?: RenderedMuiMenuItem[];
  onSelect?: () => void;
}

/**
 * Materializes a Win32 MENU resource (`30206` Dashboard Context / `30207` Sidebar Context)
 * directly from `Taskmgr.exe.mui`, preserving Microsoft's exact ordering, separators & mnemonics.
 */
export function buildMuiMenuItems(
  menuId: '30206' | '30207',
  commands: Record<number, MuiMenuCommandState | undefined>,
): RenderedMuiMenuItem[] {
  const root = perfBundle.menus[menuId]?.items?.[0]?.submenu ?? [];
  const convert = (nodes: MuiMenuItemNode[]): RenderedMuiMenuItem[] => {
    const out: RenderedMuiMenuItem[] = [];
    for (const item of nodes) {
      if (item.text === '' || item.id === 2048 || item.id === 0) {
        if (out.length > 0 && out[out.length - 1].type !== 'divider') {
          out.push({ type: 'divider' });
        }
        continue;
      }
      const st = commands[item.id];
      if (st?.visible === false) continue;

      const parsed = formatMuiMenuText(item.text);
      const label = st?.labelOverride ?? parsed.label;
      if (st?.submenuOverride) {
        out.push({ label, submenu: st.submenuOverride });
        continue;
      }
      if (item.submenu && item.submenu.length > 0) {
        const sub = convert(item.submenu);
        if (sub.length > 0) out.push({ label, submenu: sub });
        continue;
      }
      if (!st) continue;
      out.push({
        label,
        ...(parsed.shortcut ? { shortcut: parsed.shortcut } : {}),
        ...(st.checked !== undefined ? { checked: st.checked } : {}),
        ...(st.checkedType ? { checkedType: st.checkedType } : {}),
        ...(st.onSelect ? { onSelect: st.onSelect } : {}),
      });
    }
    while (out.length > 0 && out[0].type === 'divider') out.shift();
    while (out.length > 0 && out[out.length - 1].type === 'divider') out.pop();
    return out;
  };
  return convert(root);
}

export interface DuiStaticSlotValue {
  text: string;
  labelOverride?: string;
  extraAttrs?: string;
}

/**
 * Renders `static_*` DirectUI `rowlayout(N)` panel directly from `UIFILE 30001` AST.
 */
export function renderDuiStaticPanel(
  resid: 'static_cpu' | 'static_memory' | 'static_disk' | 'static_network' | 'static_gpu',
  slots: Record<string, DuiStaticSlotValue | undefined>,
  fallbackExtraRows?: Array<{ id: string; label: string; value: DuiStaticSlotValue }>,
): string {
  const root = perfBundle.resources[resid];
  if (!root) return '';
  const rowsHtml: string[] = [];

  for (const rowNode of root.children) {
    if (!rowNode.attrs.layout?.startsWith('rowlayout(')) continue;
    const labelNode = rowNode.children.find((ch) => ch.attrs.class?.includes('staticLabel'));
    const dataNode = rowNode.children.find((ch) => ch.attrs.class?.includes('staticData'));
    const dataAtom = extractAtomId(dataNode?.attrs.id);
    if (!dataAtom) continue;

    const binding = slots[dataAtom];
    if (!binding) continue;

    const labelText = binding.labelOverride
      ? binding.labelOverride
      : normalizeStaticLabel(labelNode?.attrs.content ?? '');
    const extraAttrs = binding.extraAttrs ?? '';
    rowsHtml.push(
      `<div class="dui-static-row" data-dui-atom="${escHtml(extractAtomId(labelNode?.attrs.id) ?? dataAtom)}">` +
        `<span class="dui-static-label">${escHtml(labelText)}</span>` +
        `<span class="dui-static-data" data-dui-id="${escHtml(dataAtom)}"${extraAttrs}>${escHtml(binding.text)}</span>` +
      `</div>`,
    );
  }

  if (fallbackExtraRows) {
    for (const extra of fallbackExtraRows) {
      rowsHtml.push(
        `<div class="dui-static-row" data-dui-atom="${escHtml(extra.id)}">` +
          `<span class="dui-static-label">${escHtml(extra.label)}</span>` +
          `<span class="dui-static-data" data-dui-id="${escHtml(extra.id)}"${extra.value.extraAttrs ?? ''}>${escHtml(extra.value.text)}</span>` +
        `</div>`,
      );
    }
  }

  return `<div class="dui-static-grid" data-dui-resid="${escHtml(resid)}">${rowsHtml.join('')}</div>`;
}

export interface DuiDynamicSlotValue {
  text: string;
  labelOverride?: string;
  legendClass?: string;
  extraCellClass?: string;
  extraAttrs?: string;
}

/**
 * Renders `dynamic_*` DirectUI `borderlayout()` KPI panel directly from `UIFILE 30001` AST.
 */
export function renderDuiDynamicPanel(
  resid: 'dynamic_cpu' | 'dynamic_memory' | 'dynamic_disk_client' | 'dynamic_disk_server' | 'dynamic_network' | 'dynamic_gpu',
  slots: Record<string, DuiDynamicSlotValue | undefined>,
  options?: { rootClass?: string },
): string {
  const root = perfBundle.resources[resid];
  if (!root) return '';

  const renderKpiLeafContainer = (node: DuiNode): string => {
    const labelNode = node.children.find((ch) => ch.attrs.class?.includes('dynamicLabel'));
    const dataNode = node.children.find((ch) => ch.attrs.class?.includes('dynamicData'));
    const containerAtom = extractAtomId(node.attrs.id);
    const dataAtom = extractAtomId(dataNode?.attrs.id);
    const slotKey = containerAtom && slots[containerAtom] !== undefined ? containerAtom : dataAtom;
    if (!slotKey) return '';

    const binding = slots[slotKey];
    if (!binding) return '';

    const labelText = binding.labelOverride ?? resolveResStr(labelNode?.attrs.content ?? '', true);
    const cellCls = binding.extraCellClass ? ` ${binding.extraCellClass}` : '';
    const extraAttrs = binding.extraAttrs ?? '';
    return (
      `<div class="dui-kpi-cell${cellCls}" data-dui-id="${escHtml(slotKey)}"${extraAttrs}>` +
        `<span class="dui-dynamic-label">${escHtml(labelText)}</span>` +
        `<strong class="dui-dynamic-data">${escHtml(binding.text)}</strong>` +
      `</div>`
    );
  };

  // Column-based `dynamic_gpu` (`<element layoutpos="left">` columns at root)
  const hasRootLeftCols = root.children.every((ch) => ch.attrs.layoutpos === 'left');
  if (hasRootLeftCols) {
    const colsHtml: string[] = [];
    for (const colNode of root.children) {
      const itemsHtml: string[] = [];
      for (const itemNode of colNode.children) {
        const rendered = renderKpiLeafContainer(itemNode);
        if (rendered) {
          itemsHtml.push(`<div class="dui-dynamic-col-item">${rendered}</div>`);
        }
      }
      if (itemsHtml.length > 0) {
        colsHtml.push(`<div class="dui-dynamic-col">${itemsHtml.join('')}</div>`);
      }
    }
    const extraCls = options?.rootClass ? ` ${options.rootClass}` : '';
    return `<div class="dui-dynamic-panel dui-dynamic-cols${extraCls}" data-dui-resid="${escHtml(resid)}">${colsHtml.join('')}</div>`;
  }

  // Row-based `dynamic_cpu`, `dynamic_memory`, `dynamic_disk_client`, `dynamic_network`
  const rowsHtml: string[] = [];
  for (const rowNode of root.children) {
    const partsHtml: string[] = [];
    let pendingLegend: { atomId: string; defaultCls: string } | null = null;

    for (const child of rowNode.children) {
      if (child.tag === 'TmLegendElement') {
        const legendAtom = extractAtomId(child.attrs.id) ?? '';
        const isWrite = child.attrs.class?.includes('dashboardWriteLegend') ?? false;
        pendingLegend = {
          atomId: legendAtom,
          defaultCls: isWrite ? 'is-write' : '',
        };
        continue;
      }

      const labelNode = child.children.find((ch) => ch.attrs.class?.includes('dynamicLabel'));
      const dataNode = child.children.find((ch) => ch.attrs.class?.includes('dynamicData'));
      const dataAtom = extractAtomId(dataNode?.attrs.id);
      const containerAtom = extractAtomId(child.attrs.id);
      const slotKey = dataAtom && slots[dataAtom] !== undefined ? dataAtom : containerAtom;
      const binding = slotKey ? slots[slotKey] : undefined;
      if (!slotKey || !binding) {
        pendingLegend = null;
        continue;
      }

      if (pendingLegend) {
        const lCls = [
          'dui-dashboard-legend',
          pendingLegend.defaultCls,
          binding.legendClass ?? '',
        ]
          .filter(Boolean)
          .join(' ');
        partsHtml.push(`<span class="${lCls}" data-dui-id="${escHtml(pendingLegend.atomId)}" aria-hidden="true"></span>`);
        pendingLegend = null;
      }

      const cellHtml = renderKpiLeafContainer(child);
      if (cellHtml) partsHtml.push(cellHtml);
    }

    if (partsHtml.length > 0) {
      rowsHtml.push(`<div class="dui-dynamic-row">${partsHtml.join('')}</div>`);
    }
  }

  const extraCls = options?.rootClass ? ` ${options.rootClass}` : '';
  return `<div class="dui-dynamic-panel${extraCls}" data-dui-resid="${escHtml(resid)}">${rowsHtml.join('')}</div>`;
}

export interface DuiChartHeaderSpec {
  leftText: string;
  rightText?: string;
  variant?: 'standard' | 'cpu';
  rightIsHtml?: boolean;
  leftIsHtml?: boolean;
}

export function renderDuiHeaderBar(pos: 'top' | 'bottom', spec: DuiChartHeaderSpec): string {
  const isCpu = spec.variant === 'cpu';
  const cls = pos === 'top'
    ? (isCpu ? 'dui-cpu-theader' : 'dui-theader')
    : (isCpu ? 'dui-cpu-bheader' : 'dui-bheader');
  const left = spec.leftIsHtml ? spec.leftText : escHtml(spec.leftText);
  const right = spec.rightText === undefined
    ? ''
    : `<span class="dui-rheader">${spec.rightIsHtml ? spec.rightText : escHtml(spec.rightText)}</span>`;
  return `<div class="${cls}"><span class="dui-lheader">${left}</span>${right}</div>`;
}

function parseRpPx(val?: string, fallback = 0): number {
  if (!val) return fallback;
  const n = Number.parseFloat(val.replace(/rp$/i, '').trim());
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Compiles Win11 UIFILE 30001 stylesheets, `uxtheme.dll` (`TASKMANAGER` / `CHARTVIEW`),
 * and `Taskmgr.exe` binary palettes into live CSS variables for `.w11-tm-shell`.
 */
export function buildDuiThemeStyleTag(): string {
  const { seriesPalettes, themeTokens, compiledLayout } = perfBundle;
  const dk = seriesPalettes.dark;
  const lt = seriesPalettes.light;
  const tmLight = themeTokens['TASKMANAGER'] ?? {};
  const tmDark = themeTokens['DarkMode::TASKMANAGER'] ?? {};

  const detailPad = parseDuiRect(compiledLayout.detailInfo.padding) ?? [10, 24, 20, 0];
  const chartTitlePad = parseDuiRect(compiledLayout.chartAndTitle.padding) ?? [0, 0, 10, 0];
  const chartInfoPad = parseDuiRect(compiledLayout.chartInfo.padding) ?? [0, 0, 0, 2];
  const chartInfoMar = parseDuiRect(compiledLayout.chartInfo.margin) ?? [5, 0, 0, 0];
  const dataInfoPad = parseDuiRect(compiledLayout.dataInfo.padding) ?? [0, 0, 0, 2];
  const staticInfoPad = parseDuiRect(compiledLayout.staticInfo.padding) ?? [0, 0, 0, 10];
  const legendMar = parseDuiRect(compiledLayout.dashboardLegend.margin) ?? [0, 6, 0, 0];
  const writeLegendMar = parseDuiRect(compiledLayout.dashboardWriteLegend.margin) ?? [0, 6, 0, 20];
  const staticLabelPad = parseDuiRect(compiledLayout.staticLabel.padding) ?? [0, 0, 3, 0];

  const emitPaletteVars = (p: Record<'cpu' | 'mem' | 'disk' | 'net' | 'gpu', DuiSeriesPaletteEntry>) =>
    [
      `--dui-chart-bg: ${p.cpu.bg};`,
      `--dui-chart-border: ${p.cpu.border};`,
      `--dui-chart-grid: ${p.cpu.grid};`,
      `--dui-thumb-bg: ${p.cpu.bg};`,
      `--dui-thumb-mem-bg: ${p.mem.bg};`,
      `--dui-legend-cpu: ${p.cpu.legend};`,
      `--dui-legend-mem: ${p.mem.legend};`,
      `--dui-legend-disk: ${p.disk.legend};`,
      `--dui-legend-net: ${p.net.legend};`,
      `--dui-legend-gpu: ${p.gpu.legend};`,
      `--dui-series-cpu-stroke: ${p.cpu.stroke};`,
      `--dui-series-cpu-fill: ${p.cpu.fill};`,
      `--dui-series-mem-stroke: ${p.mem.stroke};`,
      `--dui-series-mem-fill: ${p.mem.fill};`,
      `--dui-series-disk-stroke: ${p.disk.stroke};`,
      `--dui-series-disk-fill: ${p.disk.fill};`,
      `--dui-series-disk-sec: ${p.disk.secondaryStroke ?? p.disk.stroke};`,
      `--dui-series-net-stroke: ${p.net.stroke};`,
      `--dui-series-net-fill: ${p.net.fill};`,
      `--dui-series-net-sec: ${p.net.secondaryStroke ?? p.net.stroke};`,
      `--dui-series-gpu-stroke: ${p.gpu.stroke};`,
      `--dui-series-gpu-fill: ${p.gpu.fill};`,
      `--dui-mem-border: ${p.mem.stroke};`,
      `--dui-mem-used-edge: ${p.mem.stroke};`,
    ].join(' ');

  const rules = `
.w11-tm-shell {
  ${emitPaletteVars(dk)}
  --dui-fg-scale: ${tmDark['44']?.color ?? dk.cpu.axisText ?? '#9e9e9e'};
  --dui-detail-padding: ${detailPad[0] + 4}px ${detailPad[1]}px ${Math.max(20, detailPad[2])}px ${detailPad[3]}px;
  --dui-chart-title-pb: ${chartTitlePad[2] + 4}px;
  --dui-chart-info-mt: ${chartInfoMar[0]}px;
  --dui-chart-info-pl: ${chartInfoPad[3]}px;
  --dui-data-info-pl: ${dataInfoPad[3]}px;
  --dui-static-pl: ${staticInfoPad[3]}px;
  --dui-static-chart-min-h: ${parseRpPx(compiledLayout.staticChart.height, 80)}px;
  --dui-secondary-chart-h: ${parseRpPx(compiledLayout.secondaryChart.height, 67)}px;
  --dui-mem-bar-h: ${parseRpPx(compiledLayout.barchartMemoryHolder.height, 52)}px;
  --dui-legend-w: ${parseRpPx(compiledLayout.dashboardLegend.width, 2)}px;
  --dui-legend-h: ${Math.min(31, parseRpPx(compiledLayout.dashboardLegend.height, 32))}px;
  --dui-legend-mr: ${legendMar[1]}px;
  --dui-legend-write-ml: ${writeLegendMar[3]}px;
  --dui-static-pb: ${staticLabelPad[2]}px;
  --dui-font-title-size: ${Math.max(24, Math.min(28, tmDark['14']?.pxHeight ?? 28))}px;
  --dui-font-sub-size: ${Math.max(15, Math.min(16, tmDark['15']?.pxHeight ?? 16))}px;
  --dui-font-label-size: ${Math.max(12, tmDark['17']?.pxHeight ?? 12)}px;
  --dui-font-value-size: ${Math.max(19, Math.min(20, (tmDark['19']?.pxHeight ?? 21) - 1))}px;
  --dui-font-axis-size: ${Math.max(11, tmDark['44']?.pxHeight ?? 11)}px;
}
.w11-tm-shell[data-tm-theme='light'] {
  ${emitPaletteVars(lt)}
  --dui-fg-scale: ${tmLight['44']?.color ?? lt.cpu.axisText ?? '#707070'};
}
  `.trim();

  return `<style data-dui-compiled="true">${rules}</style>`;
}

/**
 * Wraps any Performance detail page in Microsoft's exact `performancetab_tables` ->
 * `tablesViewer` -> `detailInfo` -> `chartAndTitle` + `dataInfo` DirectUI tree.
 */
export function renderDuiPerfDetailShell(opts: {
  title: string;
  subtitle: string;
  subtitleTip?: string;
  chartHtml: string;
  dynamicHtml?: string;
  staticHtml?: string;
  isGraphOnly?: boolean;
}): string {
  const graphOnlyCls = opts.isGraphOnly ? ' is-graph-only' : '';
  const dataInfoHtml = opts.isGraphOnly
    ? ''
    : `
      <div class="dui-data-info" data-dui-id="dataInfo">
        <div class="dui-dynamic-info" data-dui-id="dynamicInfo">${opts.dynamicHtml ?? ''}</div>
        <div class="dui-static-info" data-dui-id="staticInfo">${opts.staticHtml ?? ''}</div>
      </div>
    `;

  return `
    <div class="dui-perf-tab-tables w11-tm-perf-detail${graphOnlyCls}" data-dui-resid="performancetab_tables">
      <div class="dui-tables-viewer" data-dui-id="tablesViewer">
        <div class="dui-detail-info" data-dui-id="detailInfo">
          <div class="dui-chart-and-title" data-dui-id="chartAndTitle">
            <div class="dui-title-bar w11-tm-detail-head${opts.isGraphOnly ? ' is-compact' : ''}">
              <h2 class="dui-resource-title" data-dui-id="resourceTitle">${escHtml(opts.title)}</h2>
              <span class="dui-resource-name w11-tm-detail-hw" data-dui-id="resourceName"${opts.subtitleTip ? ` title="${escHtml(opts.subtitleTip).replace(/"/g, '&quot;')}"` : ''}>${escHtml(opts.subtitle)}</span>
            </div>
            <div class="dui-chart-info" data-dui-id="chartInfo">
              ${opts.chartHtml}
            </div>
          </div>
          ${dataInfoHtml}
        </div>
      </div>
    </div>
  `;
}
