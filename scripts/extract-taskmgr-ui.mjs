import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const outDir = path.join(repoRoot, 'src/shells/win11/apps/task-manager/win32-extracted');

const MUN_PATH = 'C:\\Windows\\SystemResources\\Taskmgr.exe.mun';
const MUI_PATH = 'C:\\Windows\\System32\\zh-CN\\Taskmgr.exe.mui';

const STD_TYPES = {
  1: 'CURSOR',
  2: 'BITMAP',
  3: 'ICON',
  4: 'MENU',
  5: 'DIALOG',
  6: 'STRING',
  9: 'ACCEL',
  10: 'RCDATA',
  11: 'MESSAGETABLE',
  14: 'GROUP_ICON',
  16: 'VERSION',
  23: 'HTML',
  24: 'MANIFEST',
};

const BUILTIN_DUI_ATOMS = [
  'element', 'duixml', 'resid', 'true', 'false', 'stylesheets', 'if', 'unless',
  'style', 'base', 'sheet', 'accessible', 'font', 'accrole', 'background',
  'foreground', 'id', 'content', 'contentalign', 'class', 'bordercolor',
  'borderthickness', 'borderstyle', 'edgehighlightcolor', 'edgehighlightthickness',
  'layout', 'layoutpos', 'enabled', 'pressed', 'mousewithin', 'captured',
  'active', 'inactive', 'padding', 'accname', 'margin', 'width', 'height',
  'top', 'bottom', 'left', 'right', 'client', 'none', 'TopLeft', 'TopCenter',
  'TopRight', 'MiddleLeft', 'MiddleCenter', 'MiddleRight', 'BottomLeft',
  'BottomCenter', 'BottomRight', 'WrapLeft', 'WrapCenter', 'WrapRight',
  'EndEllipsis', 'FocusRect', 'PathEllipsis', 'NoPrefix', 'WordEllipsis',
  'EditControl', 'StartEllipsis', 'borderlayout()',
];

function openPeRsrc(filePath) {
  const buf = fs.readFileSync(filePath);
  const pe = buf.readUInt32LE(0x3c);
  const nsec = buf.readUInt16LE(pe + 6);
  const opt = buf.readUInt16LE(pe + 20);
  const sec = pe + 24 + opt;
  let rva = 0, rraw = 0, rsz = 0;
  for (let i = 0; i < nsec; i++) {
    const o = sec + i * 40;
    const nm = buf.subarray(o, o + 8).toString('ascii').replace(/\0.*$/, '');
    if (nm === '.rsrc') {
      rva = buf.readUInt32LE(o + 12);
      rsz = buf.readUInt32LE(o + 16);
      rraw = buf.readUInt32LE(o + 20);
      break;
    }
  }
  const r = buf.subarray(rraw, rraw + rsz);
  const rdName = (off) => {
    if (off & 0x80000000) {
      const q = off & 0x7fffffff;
      const len = r.readUInt16LE(q);
      return r.subarray(q + 2, q + 2 + len * 2).toString('utf16le');
    }
    return STD_TYPES[off] || String(off);
  };
  const entries = (off) => {
    const nn = r.readUInt16LE(off + 12);
    const ni = r.readUInt16LE(off + 14);
    const arr = [];
    for (let i = 0; i < nn + ni; i++) {
      arr.push([rdName(r.readUInt32LE(off + 16 + i * 8)), r.readUInt32LE(off + 20 + i * 8)]);
    }
    return arr;
  };
  const blob = (off) => {
    const va = r.readUInt32LE(off);
    const sz = r.readUInt32LE(off + 4);
    const raw = rraw + (va - rva);
    return buf.subarray(raw, raw + sz);
  };
  return { entries, blob };
}

function decodeDuib(u) {
  const magic = u.subarray(0, 4).toString('ascii');
  if (magic !== 'duib') throw new Error(`Expected duib magic, got ${magic}`);
  const version = u.readUInt32LE(0x04);
  const hdrEnd = u.readUInt32LE(0x08);
  const strBase = u.readUInt32LE(0x0c);
  const numS = u.readUInt32LE(strBase + 4);
  const strings = [];
  for (let i = 0; i < numS; i++) {
    const o = u.readUInt32LE(strBase + 8 + i * 4);
    let e = strBase + o;
    while (e + 1 < u.length && u.readUInt16LE(e) !== 0) e += 2;
    strings.push(u.subarray(strBase + o, e).toString('utf16le'));
  }
  const sym = (w) =>
    w & 0x8000
      ? BUILTIN_DUI_ATOMS[w & 0x7fff] ?? `BUILTIN_${(w & 0x7fff).toString(16)}`
      : strings[w] ?? `STR_${w}`;

  let p = hdrEnd + 8;
  const root = { tag: '__root__', attrs: {}, children: [] };
  const stack = [root];
  let unknowns = 0;
  while (p + 2 <= strBase) {
    const hdr = u.readUInt16LE(p);
    p += 2;
    if (hdr === 0x0002) {
      p += 2; // closing tag atom
      if (stack.length > 1) stack.pop();
      continue;
    }
    const kind = hdr & 0x0f;
    const nAttrs = hdr >> 4;
    if (kind !== 0 && kind !== 1) {
      unknowns++;
      break;
    }
    const tag = sym(u.readUInt16LE(p));
    p += 2;
    const attrs = {};
    for (let i = 0; i < nAttrs; i++) {
      const k = sym(u.readUInt16LE(p));
      p += 2;
      const v = sym(u.readUInt16LE(p));
      p += 2;
      attrs[k] = v;
    }
    const node = { tag, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (kind === 0) stack.push(node);
  }
  if (p !== strBase || unknowns > 0 || stack.length !== 1) {
    throw new Error(`DUIB parse incomplete: pos=${p}/${strBase} unknowns=${unknowns} depth=${stack.length}`);
  }
  const duixml = root.children[0];
  const stylesheets = [];
  const resources = [];
  for (const ch of duixml.children) {
    if (ch.tag === 'stylesheets') {
      for (const s of ch.children) stylesheets.push(s);
    } else {
      resources.push(ch);
    }
  }
  return { version, stylesheets, resources };
}

function rdSzOrOrd(buf, p) {
  const first = buf.readUInt16LE(p);
  if (first === 0xffff) return ['#' + buf.readUInt16LE(p + 2), p + 4];
  if (first === 0x0000) return ['', p + 2];
  let end = p;
  while (end + 1 < buf.length && buf.readUInt16LE(end) !== 0) end += 2;
  return [buf.subarray(p, end).toString('utf16le'), end + 2];
}

function parseDialog(id, buf) {
  const sig = buf.readUInt16LE(2);
  if (sig !== 0xffff) return { id, kind: 'DIALOG_STD', bytes: buf.length };
  const exStyle = buf.readUInt32LE(8);
  const style = buf.readUInt32LE(12);
  const cdit = buf.readUInt16LE(16);
  const x = buf.readInt16LE(18);
  const y = buf.readInt16LE(20);
  const cx = buf.readInt16LE(22);
  const cy = buf.readInt16LE(24);
  let p = 26;
  const [, p1] = rdSzOrOrd(buf, p);
  const [, p2] = rdSzOrOrd(buf, p1);
  const [title, p3] = rdSzOrOrd(buf, p2);
  p = p3;
  let font = '';
  if (style & 0x40) {
    const pt = buf.readUInt16LE(p);
    const [fn, p4] = rdSzOrOrd(buf, p + 6);
    font = `${pt}pt ${fn}`;
    p = p4;
  }
  const controls = [];
  for (let i = 0; i < cdit; i++) {
    p = (p + 3) & ~3;
    if (p + 24 > buf.length) break;
    const isx = buf.readInt16LE(p + 12);
    const isy = buf.readInt16LE(p + 14);
    const icx = buf.readInt16LE(p + 16);
    const icy = buf.readInt16LE(p + 18);
    const cid = buf.readUInt32LE(p + 20);
    const ist = buf.readUInt32LE(p + 8);
    p += 24;
    const [icls, pA] = rdSzOrOrd(buf, p);
    const [itxt, pB] = rdSzOrOrd(buf, pA);
    const extra = buf.readUInt16LE(pB);
    p = pB + 2 + extra;
    controls.push({ id: cid, x: isx, y: isy, cx: icx, cy: icy, class: icls, text: itxt, style: ist });
  }
  return { id, kind: 'DIALOGEX', x, y, cx, cy, title, font, exStyle, style, controls };
}

function parseMenu(id, buf) {
  const ver = buf.readUInt16LE(0);
  const off = buf.readUInt16LE(2);
  let p = 4 + off;
  function readItems() {
    const items = [];
    while (p < buf.length) {
      if (ver === 1) {
        if (p + 14 > buf.length) break;
        const type = buf.readUInt32LE(p);
        const state = buf.readUInt32LE(p + 4);
        const itemId = buf.readUInt32LE(p + 8);
        const flags = buf.readUInt16LE(p + 12);
        p += 14;
        let e = p;
        while (e + 1 < buf.length && buf.readUInt16LE(e) !== 0) e += 2;
        const text = buf.subarray(p, e).toString('utf16le');
        p = (e + 2 + 3) & ~3;
        const isPop = (flags & 0x01) !== 0;
        const isEnd = (flags & 0x80) !== 0;
        if (isPop) {
          p += 4; // dwHelpId
          items.push({ id: itemId, type, state, flags, text, submenu: readItems() });
        } else {
          items.push({ id: itemId, type, state, flags, text });
        }
        if (isEnd) break;
      } else {
        if (p + 4 > buf.length) break;
        const flags = buf.readUInt16LE(p);
        p += 2;
        const isPop = (flags & 0x10) !== 0;
        const isEnd = (flags & 0x80) !== 0;
        const itemId = isPop ? 0 : buf.readUInt16LE(p);
        if (!isPop) p += 2;
        let e = p;
        while (e + 1 < buf.length && buf.readUInt16LE(e) !== 0) e += 2;
        const text = buf.subarray(p, e).toString('utf16le');
        p = e + 2;
        if (isPop) items.push({ id: 0, flags, text, submenu: readItems() });
        else items.push({ id: itemId, flags, text });
        if (isEnd) break;
      }
    }
    return items;
  }
  return { id, version: ver, items: readItems() };
}

function queryThemeTokens() {
  const psScript = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class TmThemeProbe {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct LOGFONTW {
        public int lfHeight, lfWidth, lfEscapement, lfOrientation, lfWeight;
        public byte lfItalic, lfUnderline, lfStrikeOut, lfCharSet, lfOutPrecision, lfClipPrecision, lfQuality, lfPitchAndFamily;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string lfFaceName;
    }
    [DllImport("uxtheme.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr OpenThemeData(IntPtr hwnd, string pszClassList);
    [DllImport("uxtheme.dll")]
    public static extern int CloseThemeData(IntPtr hTheme);
    [DllImport("uxtheme.dll")]
    public static extern int GetThemeFont(IntPtr hTheme, IntPtr hdc, int iPartId, int iStateId, int iPropId, out LOGFONTW pFont);
    [DllImport("uxtheme.dll")]
    public static extern int GetThemeColor(IntPtr hTheme, int iPartId, int iStateId, int iPropId, out uint pColor);
    [DllImport("uxtheme.dll")]
    public static extern int GetThemeInt(IntPtr hTheme, int iPartId, int iStateId, int iPropId, out int pVal);
    [DllImport("user32.dll")]
    public static extern IntPtr GetDesktopWindow();
}
"@
$out = @{}
foreach ($cls in @("TASKMANAGER", "DarkMode::TASKMANAGER", "CHARTVIEW", "DARKMODE::CHARTVIEW", "TEXTSTYLE", "CONTROLPANELSTYLE")) {
    $h = [TmThemeProbe]::OpenThemeData([TmThemeProbe]::GetDesktopWindow(), $cls)
    $parts = @{}
    if ($h -ne [IntPtr]::Zero) {
        for ($part = 1; $part -le 60; $part++) {
            $lf = New-Object TmThemeProbe+LOGFONTW
            $rcF = [TmThemeProbe]::GetThemeFont($h, [IntPtr]::Zero, $part, 0, 210, [ref]$lf)
            $col = 0
            $rcC = [TmThemeProbe]::GetThemeColor($h, $part, 0, 3803, [ref]$col)
            $bcol = 0
            $rcB = [TmThemeProbe]::GetThemeColor($h, $part, 0, 3802, [ref]$bcol)
            $fcol = 0
            $rcFill = [TmThemeProbe]::GetThemeColor($h, $part, 0, 3801, [ref]$fcol)
            $alpha = 0
            $rcA = [TmThemeProbe]::GetThemeInt($h, $part, 0, 2402, [ref]$alpha)
            if ($rcF -eq 0 -or $rcC -eq 0 -or $rcB -eq 0 -or $rcFill -eq 0 -or $rcA -eq 0) {
                $entry = @{}
                if ($rcF -eq 0) {
                    $entry.fontFamily = $lf.lfFaceName
                    $entry.pxHeight = [Math]::Abs($lf.lfHeight)
                    $entry.weight = $lf.lfWeight
                }
                if ($rcC -eq 0) {
                    $r = $col -band 0xFF; $g = ($col -shr 8) -band 0xFF; $b = ($col -shr 16) -band 0xFF
                    $entry.color = ("#{0:X2}{1:X2}{2:X2}" -f $r,$g,$b).ToLowerInvariant()
                }
                if ($rcB -eq 0) {
                    $r = $bcol -band 0xFF; $g = ($bcol -shr 8) -band 0xFF; $b = ($bcol -shr 16) -band 0xFF
                    $entry.borderColor = ("#{0:X2}{1:X2}{2:X2}" -f $r,$g,$b).ToLowerInvariant()
                }
                if ($rcFill -eq 0) {
                    $r = $fcol -band 0xFF; $g = ($fcol -shr 8) -band 0xFF; $b = ($fcol -shr 16) -band 0xFF
                    $entry.fillColor = ("#{0:X2}{1:X2}{2:X2}" -f $r,$g,$b).ToLowerInvariant()
                }
                if ($rcA -eq 0) {
                    $entry.alpha = $alpha
                }
                $parts[[string]$part] = $entry
            }
        }
        [TmThemeProbe]::CloseThemeData($h) | Out-Null
    }
    $out[$cls] = $parts
}
$out | ConvertTo-Json -Depth 5
`;
  const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command', psScript], { encoding: 'utf8' });
  return JSON.parse(raw);
}

function colorrefToHex(dw) {
  const r = dw & 0xff;
  const g = (dw >>> 8) & 0xff;
  const b = (dw >>> 16) & 0xff;
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function hexToRgba(hex, alphaByte) {
  const clean = hex.replace('#', '');
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  const a = Math.round(((alphaByte ?? 255) / 255) * 100) / 100;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function extractTaskmgrBinaryPalettes(tokens) {
  const exePath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'Taskmgr.exe');
  const buf = fs.readFileSync(exePath);
  const peOff = buf.readUInt32LE(0x3c);
  const numSec = buf.readUInt16LE(peOff + 6);
  const optSize = buf.readUInt16LE(peOff + 20);
  const secOff = peOff + 24 + optSize;
  const secs = [];
  for (let i = 0; i < numSec; i++) {
    const o = secOff + i * 40;
    secs.push({
      name: buf.subarray(o, o + 8).toString('ascii').replace(/\0+$/, ''),
      va: buf.readUInt32LE(o + 12),
      rsize: buf.readUInt32LE(o + 16),
      ra: buf.readUInt32LE(o + 20),
    });
  }
  const rvaToOff = (rva) => {
    const s = secs.find((x) => rva >= x.va && rva < x.va + x.rsize);
    return s ? s.ra + (rva - s.va) : -1;
  };
  const text = secs.find((s) => s.name === '.text');

  // 1) Extract TmLegendElement Dark Mode 5-COLORREF table (`lea rcx,[rip+disp]; mov eax,dword ptr [rcx+rbp*4]`)
  let darkLegends = null;
  for (let i = 0; i < text.rsize - 12; i++) {
    if (
      buf[text.ra + i] === 0x48 &&
      buf[text.ra + i + 1] === 0x8d &&
      buf[text.ra + i + 2] === 0x0d &&
      buf[text.ra + i + 7] === 0x8b &&
      buf[text.ra + i + 8] === 0x04 &&
      buf[text.ra + i + 9] === 0xa9
    ) {
      const rva = text.va + i + 7 + buf.readInt32LE(text.ra + i + 3);
      const off = rvaToOff(rva);
      if (off >= 0 && off + 24 <= buf.length && buf.readUInt32LE(off + 20) === 0) {
        const vals = Array.from({ length: 5 }, (_, k) => buf.readUInt32LE(off + k * 4));
        if (vals.every((v) => v > 0 && v <= 0x00ffffff)) {
          darkLegends = {
            cpu: colorrefToHex(vals[0]),
            mem: colorrefToHex(vals[1]),
            disk: colorrefToHex(vals[2]),
            net: colorrefToHex(vals[3]),
            gpu: colorrefToHex(vals[4]),
          };
          break;
        }
      }
    }
  }
  if (!darkLegends) throw new Error('Failed to locate TmLegendElement dark COLORREF table in Taskmgr.exe');

  // 2) Extract CWdcChart 5x9 CHARTVIEW part table (`lea r12, [rip+disp]` with part rows starting [1..7,35,36])
  let chartPartRows = null;
  for (let i = 0; i < text.rsize - 16; i++) {
    if (buf[text.ra + i] === 0x4c && buf[text.ra + i + 1] === 0x8d && buf[text.ra + i + 2] === 0x25) {
      const rva = text.va + i + 7 + buf.readInt32LE(text.ra + i + 3);
      const off = rvaToOff(rva);
      if (off >= 0 && off + 180 <= buf.length) {
        const firstRow = Array.from({ length: 9 }, (_, c) => buf.readUInt32LE(off + c * 4));
        if (firstRow[0] === 1 && firstRow[1] === 2 && firstRow[7] === 35 && firstRow[8] === 36) {
          chartPartRows = Array.from({ length: 5 }, (__, r) =>
            Array.from({ length: 9 }, (___, c) => buf.readUInt32LE(off + (r * 9 + c) * 4)),
          );
          break;
        }
      }
    }
  }
  if (!chartPartRows) throw new Error('Failed to locate CWdcChart part table in Taskmgr.exe');

  const keys = ['cpu', 'mem', 'disk', 'net', 'gpu'];
  const buildModePalette = (clsName, legendsByKey) => {
    const clsTokens = tokens[clsName] || {};
    const out = {};
    keys.forEach((k, idx) => {
      const parts = chartPartRows[idx];
      const bgTok = clsTokens[String(parts[0])] || {};
      const brdTok = clsTokens[String(parts[1])] || {};
      const gridTok = clsTokens[String(parts[2])] || {};
      const pStrokeTok = clsTokens[String(parts[3])] || {};
      const pFillTok = clsTokens[String(parts[4])] || {};
      const sStrokeTok = clsTokens[String(parts[5])] || pStrokeTok;
      const sFillTok = clsTokens[String(parts[6])] || pFillTok;
      const peakTextTok = clsTokens[String(parts[8])] || {};

      const stroke = pStrokeTok.borderColor;
      const fill = hexToRgba(pFillTok.borderColor, pFillTok.alpha ?? 102);
      const kernelFill = hexToRgba(sFillTok.borderColor, sFillTok.alpha ?? pFillTok.alpha ?? 102);
      const secStroke = sStrokeTok.borderColor || stroke;

      out[k] = {
        bg: bgTok.alpha !== undefined && bgTok.alpha < 255 ? hexToRgba(bgTok.borderColor, bgTok.alpha) : bgTok.borderColor,
        border: hexToRgba(brdTok.borderColor || '#757575', brdTok.alpha ?? 102),
        grid: gridTok.alpha !== undefined && gridTok.alpha < 255 ? hexToRgba(gridTok.borderColor, gridTok.alpha) : gridTok.borderColor,
        axisText: peakTextTok.color || (clsName.startsWith('DARKMODE') ? '#cdcdcd' : '#707070'),
        stroke,
        fill,
        ...(k === 'cpu' ? { kernelFill } : {}),
        ...(k === 'disk' || k === 'net' ? { secondaryStroke: secStroke } : {}),
        dot: stroke,
        legend: legendsByKey ? legendsByKey[k] : stroke,
      };
    });
    return out;
  };

  return {
    darkLegend: darkLegends,
    chartPartRows,
    dark: buildModePalette('DARKMODE::CHARTVIEW', darkLegends),
    light: buildModePalette('CHARTVIEW', null),
  };
}

function compilePerfLayoutMetrics(uifile30001) {
  const findById = (nodes, idAtom) => {
    for (const n of nodes || []) {
      if (n.attrs?.id === idAtom) return n;
      const sub = findById(n.children, idAtom);
      if (sub) return sub;
    }
    return null;
  };
  const extractSheetRules = (sheet) => {
    const out = {};
    for (const ch of sheet?.children || []) {
      if (ch.tag === 'if') {
        const key = ch.attrs?.class ? `class:${ch.attrs.class}` : ch.attrs?.id ? `id:${ch.attrs.id}` : null;
        const inner = ch.children?.[0]?.attrs;
        if (key && inner) out[key] = inner;
      } else if (ch.attrs && Object.keys(ch.attrs).length > 0) {
        out[`tag:${ch.tag}`] = ch.attrs;
      }
    }
    return out;
  };
  const resMap = Object.fromEntries(uifile30001.resources.map((r) => [r.attrs.resid, r]));
  const sheetMap = Object.fromEntries(uifile30001.stylesheets.map((s) => [s.attrs.resid, s]));
  const tablesAst = resMap.performancetab_tables;
  const dash = extractSheetRules(sheetMap.DashboardStyle);
  const staticChart = extractSheetRules(sheetMap.staticResourceChart);
  const secChart = extractSheetRules(sheetMap.secondaryChart);
  const cpuChart = extractSheetRules(sheetMap.cpuchart);
  const gpuChart = extractSheetRules(sheetMap.gpuchart);

  return {
    detailInfo: findById([tablesAst], 'atom(detailInfo)')?.attrs || {},
    chartAndTitle: findById([tablesAst], 'atom(chartAndTitle)')?.attrs || {},
    chartInfo: findById([tablesAst], 'atom(chartInfo)')?.attrs || {},
    dataInfo: findById([tablesAst], 'atom(dataInfo)')?.attrs || {},
    staticInfo: findById([tablesAst], 'atom(staticInfo)')?.attrs || {},
    staticChart: staticChart['tag:chart'] || {},
    secondaryChart: secChart['tag:chart'] || {},
    cpuChart: cpuChart['tag:element'] || cpuChart['tag:chart'] || {},
    gpuChart: gpuChart['tag:element'] || gpuChart['tag:chart'] || {},
    barchartMemoryHolder: dash['id:atom(BarchartMemoryHolder)'] || {},
    dashboardLegend: dash['class:dashboardLegend'] || {},
    dashboardWriteLegend: dash['class:dashboardWriteLegend'] || {},
    staticLabel: dash['class:staticLabel'] || {},
    staticData: dash['class:staticData'] || {},
    dynamicLabel: dash['class:dynamicLabel'] || {},
    dynamicData: dash['class:dynamicData'] || {},
    theader: dash['id:atom(lheader)'] || dash['class:lheader'] || {},
    resourceTitle: dash['id:atom(resourceTitle)'] || {},
    resourceName: dash['id:atom(resourceName)'] || {},
    dashRules: dash,
  };
}

const mun = openPeRsrc(MUN_PATH);
const mui = openPeRsrc(MUI_PATH);

const uifiles = {};
const pngAssets = [];
for (const [tn, tv] of mun.entries(0)) {
  if (tn === 'UIFILE') {
    for (const [nm, nv] of mun.entries(tv & 0x7fffffff)) {
      const data = mun.blob(mun.entries(nv & 0x7fffffff)[0][1]);
      uifiles[nm] = decodeDuib(data);
    }
  } else if (tn === 'PNG') {
    for (const [nm, nv] of mun.entries(tv & 0x7fffffff)) {
      const data = mun.blob(mun.entries(nv & 0x7fffffff)[0][1]);
      pngAssets.push({ name: nm, bytes: data.length });
    }
  }
}

const strings = {};
const dialogs = {};
const menus = {};
for (const [tn, tv] of mui.entries(0)) {
  if (tn === 'STRING') {
    for (const [blk, bv] of mui.entries(tv & 0x7fffffff)) {
      const sb = mui.blob(mui.entries(bv & 0x7fffffff)[0][1]);
      let p = 0;
      for (let idx = 0; idx < 16 && p + 2 <= sb.length; idx++) {
        const len = sb.readUInt16LE(p);
        p += 2;
        if (len > 0) strings[String((Number(blk) - 1) * 16 + idx)] = sb.subarray(p, p + len * 2).toString('utf16le');
        p += len * 2;
      }
    }
  } else if (tn === 'DIALOG') {
    for (const [nm, nv] of mui.entries(tv & 0x7fffffff)) {
      const data = mui.blob(mui.entries(nv & 0x7fffffff)[0][1]);
      dialogs[nm] = parseDialog(nm, data);
    }
  } else if (tn === 'MENU') {
    for (const [nm, nv] of mui.entries(tv & 0x7fffffff)) {
      const data = mui.blob(mui.entries(nv & 0x7fffffff)[0][1]);
      menus[nm] = parseMenu(nm, data);
    }
  }
}

const themeTokens = queryThemeTokens();
const seriesPalettes = extractTaskmgrBinaryPalettes(themeTokens);
const compiledLayout = compilePerfLayoutMetrics(uifiles['30001']);

fs.mkdirSync(outDir, { recursive: true });

const fullDump = {
  source: {
    mun: MUN_PATH,
    mui: MUI_PATH,
    extractedAt: new Date().toISOString(),
  },
  themeTokens,
  seriesPalettes,
  compiledLayout,
  uifiles,
  strings,
  menus,
  dialogs,
  pngAssets,
};

fs.writeFileSync(path.join(outDir, 'full-taskmgr-ui.json'), JSON.stringify(fullDump, null, 2));

// Produce focused slim runtime spec for Performance tab + Core Dialogs/Menus
const PERF_STYLE_NAMES = new Set([
  'page', 'SmallViewPage', 'drop', 'chart', 'cpuchart', 'gpuchart',
  'staticResourceChart', 'secondaryChart', 'DotIconStyle', 'chartbox',
  'TaskManagerCommon', 'DashboardStyle', 'cpuBlockStyleB', 'cpuBlockStyleR',
  'cpuBlockStyleData', 'scrollviewer', 'gpuExpanderStyle',
]);
const PERF_RES_NAMES = new Set([
  'performancetab_graphs', 'performancetab_tables', 'dashSidebarEntryViewer', 'dashSidebarCpuButton',
  'dashSidebarMemoryButton', 'dashSidebarDiskButton', 'dashSidebarNetButton',
  'dashSidebarGpuButton', 'static_cpu', 'dynamic_cpu', 'cpu_chart', 'atmCpu',
  'cpuBlock', 'static_memory', 'dynamic_memory', 'memory_chart', 'static_disk',
  'dynamic_disk_server', 'dynamic_disk_client', 'disk_chart', 'disk_server_chart',
  'static_network', 'dynamic_network', 'net_chart', 'static_gpu', 'dynamic_gpu',
  'gpu_chart', 'singleEngineGpuView', 'multiEngineGpuView',
  'gpuEngineChartTemplate', 'gpuMemoryChart',
]);

// Collect all resstr(ID) referenced by perf resources & stylesheets
const perfStrIds = new Set();
function scanStrings(node) {
  for (const val of Object.values(node.attrs || {})) {
    const m = typeof val === 'string' && val.match(/^resstr\((\d+)\)$/);
    if (m) perfStrIds.add(m[1]);
  }
  for (const ch of node.children || []) scanStrings(ch);
}

const perfStylesheets = uifiles['30001'].stylesheets.filter((s) => PERF_STYLE_NAMES.has(s.attrs.resid));
const perfResources = uifiles['30001'].resources.filter((r) => PERF_RES_NAMES.has(r.attrs.resid));
perfStylesheets.forEach(scanStrings);
perfResources.forEach(scanStrings);

// Add well-known perf strings referenced from C++ resource IDs (headers, tooltips, chart labels, GPU strings)
for (const id of Object.keys(strings)) {
  const num = Number(id);
  if ((num >= 33800 && num <= 34700) || (num >= 41000 && num <= 41100) || (num >= 45000 && num <= 45050)) {
    perfStrIds.add(id);
  }
}

const perfStrings = {};
for (const id of [...perfStrIds].sort((a, b) => Number(a) - Number(b))) {
  if (strings[id] !== undefined) perfStrings[id] = strings[id];
}

const perfBundle = {
  themeTokens,
  seriesPalettes,
  compiledLayout,
  stylesheets: Object.fromEntries(perfStylesheets.map((s) => [s.attrs.resid, s])),
  resources: Object.fromEntries(perfResources.map((r) => [r.attrs.resid, r])),
  strings: perfStrings,
  menus: {
    30206: menus['30206'],
    30207: menus['30207'],
  },
  dialogs: {
    34665: dialogs['34665'],
    34700: dialogs['34700'],
    30120: dialogs['30120'],
    30130: dialogs['30130'],
  },
};

fs.writeFileSync(path.join(outDir, 'perf-dui-bundle.json'), JSON.stringify(perfBundle, null, 2));

console.log('Extracted full Taskmgr UI ->', path.join(outDir, 'full-taskmgr-ui.json'));
console.log('  UIFILE 30001 stylesheets:', uifiles['30001'].stylesheets.length, 'resources:', uifiles['30001'].resources.length);
console.log('  UIFILE 30024 stylesheets:', uifiles['30024'].stylesheets.length, 'resources:', uifiles['30024'].resources.length);
console.log('  Strings:', Object.keys(strings).length, 'Menus:', Object.keys(menus).length, 'Dialogs:', Object.keys(dialogs).length);
console.log('Extracted perf DUI bundle ->', path.join(outDir, 'perf-dui-bundle.json'), `(${perfResources.length} resids, ${perfStylesheets.length} sheets, ${Object.keys(perfStrings).length} strings)`);
