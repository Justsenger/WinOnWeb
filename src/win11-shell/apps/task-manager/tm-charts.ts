import type { VirtualHardwareSnapshot } from '../../system/virtual-hardware';
import { perfBundle } from './dui/dui-renderer';

export interface PerfSeriesColor {
  stroke: string;
  fill: string;
  kernelFill?: string;
  secondaryStroke?: string;
  dot: string;
}

const _dk = perfBundle.seriesPalettes.dark;
const _lt = perfBundle.seriesPalettes.light;

export const TM_SERIES_COLORS: Record<'cpu' | 'mem' | 'disk' | 'net' | 'gpu' | 'npu', PerfSeriesColor> = {
  cpu: {
    stroke: _dk.cpu.stroke,
    fill: _dk.cpu.fill,
    kernelFill: _dk.cpu.kernelFill,
    dot: _dk.cpu.dot,
  },
  mem: {
    stroke: _dk.mem.stroke,
    fill: _dk.mem.fill,
    dot: _dk.mem.dot,
  },
  disk: {
    stroke: _dk.disk.stroke,
    fill: _dk.disk.fill,
    secondaryStroke: _dk.disk.secondaryStroke ?? _dk.disk.stroke,
    dot: _dk.disk.dot,
  },
  net: {
    stroke: _dk.net.stroke,
    fill: _dk.net.fill,
    secondaryStroke: _dk.net.secondaryStroke ?? _dk.net.stroke,
    dot: _dk.net.dot,
  },
  gpu: {
    stroke: _dk.gpu.stroke,
    fill: _dk.gpu.fill,
    dot: _dk.gpu.dot,
  },
  npu: {
    stroke: '#757575',
    fill: 'rgba(117, 117, 117, 0.16)',
    dot: '#757575',
  },
};

export const TM_SERIES_COLORS_LIGHT: Record<'cpu' | 'mem' | 'disk' | 'net' | 'gpu' | 'npu', PerfSeriesColor> = {
  cpu: {
    stroke: _lt.cpu.stroke,
    fill: _lt.cpu.fill,
    kernelFill: _lt.cpu.kernelFill,
    dot: _lt.cpu.dot,
  },
  mem: {
    stroke: _lt.mem.stroke,
    fill: _lt.mem.fill,
    dot: _lt.mem.dot,
  },
  disk: {
    stroke: _lt.disk.stroke,
    fill: _lt.disk.fill,
    secondaryStroke: _lt.disk.secondaryStroke ?? _lt.disk.stroke,
    dot: _lt.disk.dot,
  },
  net: {
    stroke: _lt.net.stroke,
    fill: _lt.net.fill,
    secondaryStroke: _lt.net.secondaryStroke ?? _lt.net.stroke,
    dot: _lt.net.dot,
  },
  gpu: {
    stroke: _lt.gpu.stroke,
    fill: _lt.gpu.fill,
    dot: _lt.gpu.dot,
  },
  npu: {
    stroke: '#757575',
    fill: 'rgba(117, 117, 117, 0.16)',
    dot: '#757575',
  },
};

export function sampleToSvgPoints(pts: readonly number[], w: number, h: number, maxY = 100): string {
  const safeMax = Math.max(1e-6, maxY);
  const count = pts.length;
  const xMin = 0.5;
  const xMax = Math.max(1.5, w - 1.5);
  const yMin = 0.5;
  const yMax = Math.max(1.5, h - 0.5);
  if (count === 0) return `${xMin},${yMax} ${xMax},${yMax}`;
  if (count === 1) {
    const ratio = Math.max(0, Math.min(1, pts[0] / safeMax));
    const y = yMax - ratio * (yMax - yMin);
    return `${xMin},${y.toFixed(2)} ${xMax},${y.toFixed(2)}`;
  }
  return pts
    .map((val, i) => {
      const x = xMin + (i / (count - 1)) * (xMax - xMin);
      const ratio = Math.max(0, Math.min(1, val / safeMax));
      const y = yMax - ratio * (yMax - yMin);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

export function renderPerfChartSvg(opts: {
  primaryPts: readonly number[];
  secondaryPts?: readonly number[];
  secondaryMode?: 'dashed-series' | 'kernel-overlay';
  maxY?: number;
  width?: number;
  height?: number;
  cols?: number;
  rows?: number;
  color: PerfSeriesColor;
  peakValue?: number;
  peakColor?: string;
  thumb?: boolean;
}): string {
  const w = opts.width ?? (opts.thumb ? 61 : 174);
  const h = opts.height ?? (opts.thumb ? 42 : 124);
  const maxY = Math.max(1e-6, opts.maxY ?? 100);
  const cols = opts.cols ?? (opts.thumb ? 3 : 3);
  const rows = opts.rows ?? (opts.thumb ? 4 : 10);

  const gridLines: string[] = [];
  if (!opts.thumb) {
    for (let i = 1; i < cols; i++) {
      const x = (Math.round((i / cols) * (w - 1)) + 0.5).toFixed(1);
      gridLines.push(`<line x1="${x}" y1="1" x2="${x}" y2="${h - 1}" shape-rendering="crispEdges" />`);
    }
    for (let j = 1; j < rows; j++) {
      const y = (Math.round((j / rows) * (h - 1)) + 0.5).toFixed(1);
      gridLines.push(`<line x1="1" y1="${y}" x2="${w - 1}" y2="${y}" shape-rendering="crispEdges" />`);
    }
  }

  const hasNonZero = opts.primaryPts.some((v) => v > 0);
  const linePts = sampleToSvgPoints(opts.primaryPts, w, h, maxY);
  const strokePts = linePts;
  const areaPts = `0.5,${(h - 0.5).toFixed(1)} ${linePts} ${(w - 0.5).toFixed(1)},${(h - 0.5).toFixed(1)}`;
  const borderColor = 'var(--dui-chart-border, rgba(117, 117, 117, 0.4))';

  let extraSvg = '';
  if (opts.secondaryPts && opts.secondaryPts.length > 0 && opts.secondaryPts.some((v) => v > 0)) {
    const secLine = sampleToSvgPoints(opts.secondaryPts, w, h, maxY);
    if (opts.secondaryMode === 'kernel-overlay') {
      const secArea = `0,${h} ${secLine} ${w},${h}`;
      extraSvg = `
        <polygon points="${secArea}" fill="${opts.color.kernelFill ?? opts.color.fill}" />
        <polyline points="${secLine}" fill="none" stroke="${opts.color.stroke}" stroke-width="1.35" stroke-dasharray="3 2" vector-effect="non-scaling-stroke" />
      `;
    } else if (opts.thumb) {
      extraSvg = `
        <polyline points="${secLine}" fill="none" stroke="${opts.color.secondaryStroke ?? opts.color.stroke}" stroke-width="1" stroke-dasharray="2 2" vector-effect="non-scaling-stroke" />
      `;
    } else {
      extraSvg = `
        <polyline points="${secLine}" fill="none" stroke="${opts.color.secondaryStroke ?? opts.color.stroke}" stroke-width="1.25" stroke-dasharray="3 2" vector-effect="non-scaling-stroke" />
      `;
    }
  }

  let peakLineSvg = '';
  if (typeof opts.peakValue === 'number' && opts.peakValue > 0 && !opts.thumb) {
    const ratio = Math.max(0.03, Math.min(0.96, opts.peakValue / maxY));
    const py = (h - ratio * h).toFixed(1);
    peakLineSvg = `<line x1="0" y1="${py}" x2="${w}" y2="${py}" stroke="${opts.peakColor ?? opts.color.stroke}" stroke-width="1" vector-effect="non-scaling-stroke" />`;
  }

  return `
    <svg class="w11-tm-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <g class="w11-tm-grid-lines">${gridLines.join('')}</g>
      ${hasNonZero ? `<polygon points="${areaPts}" fill="${opts.color.fill}" />` : ''}
      <line x1="0" y1="0.5" x2="${w}" y2="0.5" stroke="${borderColor}" stroke-width="1" vector-effect="non-scaling-stroke" shape-rendering="crispEdges" />
      <line x1="0.5" y1="0" x2="0.5" y2="${h}" stroke="${borderColor}" stroke-width="1" vector-effect="non-scaling-stroke" shape-rendering="crispEdges" />
      ${hasNonZero ? `<polyline points="${strokePts}" fill="none" stroke="${opts.color.stroke}" stroke-width="1" vector-effect="non-scaling-stroke" />` : ''}
      ${extraSvg}
      ${peakLineSvg}
      <line x1="${w - 0.5}" y1="0" x2="${w - 0.5}" y2="${h}" stroke="${borderColor}" stroke-width="1" vector-effect="non-scaling-stroke" shape-rendering="crispEdges" />
      <line x1="0" y1="${h - 0.5}" x2="${w}" y2="${h - 0.5}" stroke="${borderColor}" stroke-width="1" vector-effect="non-scaling-stroke" shape-rendering="crispEdges" />
    </svg>
  `;
}

export function computeDynamicScaleMax(peakVal: number, steps: readonly number[]): number {
  for (const s of steps) {
    if (peakVal <= s * 0.88) return s;
  }
  return steps[steps.length - 1];
}

export function formatThroughputKb(kbPerSec: number, allowDecimal = false): string {
  if (kbPerSec <= 0) return '0 KB/秒';
  if (kbPerSec >= 1024) {
    const mb = kbPerSec / 1024;
    return `${allowDecimal || !Number.isInteger(mb) ? mb.toFixed(1) : mb} MB/秒`;
  }
  if (allowDecimal && kbPerSec < 100 && !Number.isInteger(kbPerSec)) {
    return `${kbPerSec.toFixed(1)} KB/秒`;
  }
  return `${Math.round(kbPerSec)} KB/秒`;
}

export function formatNetRateKbps(kbps: number, allowDecimal = false): string {
  if (kbps <= 0) return '0 Kbps';
  if (kbps >= 1000) {
    const mbps = kbps / 1000;
    return `${allowDecimal || !Number.isInteger(mbps) ? mbps.toFixed(1) : mbps} Mbps`;
  }
  if (allowDecimal && kbps < 100 && !Number.isInteger(kbps)) {
    return `${kbps.toFixed(1)} Kbps`;
  }
  return `${Math.round(kbps)} Kbps`;
}

export function renderMemoryCompositionBar(hw: VirtualHardwareSnapshot): string {
  const { modifiedMb: modMb, standbyMb, freeMb, compressedMb: compMb, compressionSavedMb: savedEst } = hw.memory;
  const usableMb = hw.memory.usableGb * 1024;
  const usedMb = Math.max(0, Math.round(hw.memory.usedGb * 1024) - modMb);
  const inUsePureMb = Math.max(0, usedMb - compMb);
  const usedPct = usedMb / usableMb * 100;
  const modPct = modMb / usableMb * 100;
  const standbyPct = standbyMb / usableMb * 100;
  const rawEst = compMb + savedEst;

  const usedTip = `使用中(${inUsePureMb} MB)`;
  const usedBody =
    `由进程、驱动程序或操作系统使用的内存\n\n` +
    `使用中，已压缩(${compMb} MB)\n压缩内存存储了估计 ${rawEst} MB 的数据，为系统节省了 ${savedEst} MB 的内存`;
  const modTip = `已修改(${modMb} MB)`;
  const modBody = '必须先将其内容写入磁盘，然后才可用于其他用途的内存';
  const standbyTip = `备用(${standbyMb} MB)`;
  const standbyBody = '包含未频繁使用的缓存数据和代码的内存';
  const freeTip = `可用(${freeMb} MB)`;
  const freeBody = '包含当前未由进程、驱动程序或操作系统使用的内存，或包含无需先写入磁盘即可利用的已归零内存';

  const attrEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

  return `
    <div class="w11-tm-mem-bar" role="img" aria-label="内存组合">
      <div class="w11-tm-mem-used" style="width:${usedPct.toFixed(1)}%" data-tm-tip="${attrEsc(usedTip)}" data-tm-tip-flat="true" data-tm-tip-key="mem-used" data-tm-tip-body="${attrEsc(usedBody)}"></div>
      <div class="w11-tm-mem-modified" style="width:${modPct.toFixed(1)}%" data-tm-tip="${attrEsc(modTip)}" data-tm-tip-flat="true" data-tm-tip-key="mem-modified" data-tm-tip-body="${attrEsc(modBody)}"></div>
      <div class="w11-tm-mem-standby" style="width:${standbyPct.toFixed(1)}%" data-tm-tip="${attrEsc(standbyTip)}" data-tm-tip-flat="true" data-tm-tip-key="mem-standby" data-tm-tip-body="${attrEsc(standbyBody)}"></div>
      <div class="w11-tm-mem-free" style="flex:1" data-tm-tip="${attrEsc(freeTip)}" data-tm-tip-flat="true" data-tm-tip-key="mem-free" data-tm-tip-body="${attrEsc(freeBody)}"></div>
    </div>
  `;
}
