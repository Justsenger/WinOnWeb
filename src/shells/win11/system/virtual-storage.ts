import { Vfs, parsePath } from '../../../wow/kernel/vfs';
import { replaceHostBytes } from '../../../wow/hal/host-fs';
import { hasDatabase } from '../../../wow/hal/storage';
import { directoryPicker, listOpfsEntries, clearOpfsTestBlocks, requestPersistence } from '../../../wow/hal/storage';
import type { RuntimeScope } from '../../../wow/hal/runtime-primitives';
import type { WinDesktopShortcutSpec } from '../host-config';
import { listUploads, relocateUploads, saveUpload, type ExplorerUpload } from '../../../wow/hal/uploads';
import {
  clearDriveDHandle,
  computeHostDirStats,
  deleteHostEntry,
  listHostDirectory,
  loadDriveDHandle,
  queryDirPermission,
  requestDirPermission,
  resolveHostSubdir,
  saveDriveDHandle,
  writeHostTextFile,
  type HostEntryItem,
} from '../../../wow/hal/host-fs';
import type { VirtualHardwareSnapshot } from '../../../wow/hal/hardware';
import {
  calcNtfsDiskBytes,
  createWin11FsNodes,
  EXP_ICONS,
  getFileMetaByName,
  hydrateWin11FolderFiles,
  loadFullWin11FsSkeleton,
  scanWin11FolderStatsAsync,
  type ExpFsNode,
  type FolderScanStats,
} from './win11-fs-skeleton';

export type { ExpFsNode, FolderScanStats, HostEntryItem };
export { EXP_ICONS, getFileMetaByName, listHostDirectory, computeHostDirStats };

export interface VirtualDiskStats {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  usedPct: number;
  isWarn: boolean;
  totalText: string;
  freeText: string;
  usedText: string;
}

export type {OpfsEntrySummary} from '../../../wow/hal/storage';

export type DriveDStatus = 'unmounted' | 'needs-auth' | 'ready';

export interface DriveDState {
  status: DriveDStatus;
  volumeName: string | null;
  displayName: string;
}

export interface VfsEntryInfo {
  nodeId: string;
  path: string;
  name: string;
  kind: ExpFsNode['kind'];
  icon: string;
  typeLabel: string;
  sizeBytes?: number;
  modifiedText: string;
  writable: boolean;
  needsAuth?: boolean;
}

function formatGiB(bytes: number): string {
  const gib = bytes / 1024 ** 3;
  return gib >= 100 ? `${Math.round(gib)} GB` : `${gib.toFixed(1)} GB`;
}

function formatNowText(ts = Date.now()): string {
  const d = new Date(ts);
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDNodeId(relSegments: readonly string[]): string {
  return relSegments.length === 0 ? 'drive-d' : `drive-d:${relSegments.join('/')}`;
}

function parseDNodeIdSegments(nodeId: string): string[] | null {
  if (nodeId === 'drive-d') return [];
  if (nodeId.startsWith('drive-d:')) {
    const rest = nodeId.slice('drive-d:'.length);
    return rest ? rest.split('/').filter(Boolean) : [];
  }
  return null;
}

export function normalizeWinPath(raw: string): { drive: 'C' | 'D' | null; segments: string[] } {
  const trimmed = raw.trim().replace(/\//g, '\\');
  if (!trimmed || trimmed === '此电脑') {
    return { drive: null, segments: [] };
  }
  const {mountId,parts}=parsePath(trimmed);
  if (mountId!=='C' && mountId!=='D') throw Error('未知挂载点: '+mountId);
  return {drive:mountId,segments:parts};
}

export function createVirtualStorageService(opts: {
  resources: RuntimeScope;
  getDesktopShortcuts?: () => readonly WinDesktopShortcutSpec[];
}) {
  let sharedNodes: Record<string, ExpFsNode> | null = null;
  let customSeq = 1;
  let skeletonLoadPromise: Promise<boolean> | null = null;
  let uploadLoadPromise: Promise<void> | undefined;
  let driveDHandle: FileSystemDirectoryHandle | null = null;
  let driveDStatus: DriveDStatus = 'unmounted';
  const listeners = new Set<() => void>();

  function emitFsChange() {
    listeners.forEach((fn) => fn());
  }

  function syncDriveDNodeInTree(nodes: Record<string, ExpFsNode>) {
    const thisPc = nodes['this-pc'];
    if (!thisPc) return;
    const baseKids = (thisPc.children ?? []).filter((id) => id !== 'drive-d');

    if (driveDStatus === 'unmounted' || !driveDHandle) {
      thisPc.children = baseKids;
      delete nodes['drive-d'];
      return;
    }

    const displayName = driveDStatus === 'needs-auth' ? '本地磁盘 (D:) - 需授权' : '本地磁盘 (D:)';
    const existing = nodes['drive-d'];
    nodes['drive-d'] = {
      id: 'drive-d',
      name: displayName,
      kind: 'drive',
      icon: EXP_ICONS.driveData,
      parentId: 'this-pc',
      typeLabel: driveDStatus === 'needs-auth' ? `数据盘（${driveDHandle.name}，待授权）` : `本地数据盘（${driveDHandle.name}）`,
      modifiedText: existing?.modifiedText ?? formatNowText(),
      writable: driveDStatus === 'ready',
      children: driveDStatus === 'ready' ? (existing?.children ?? []) : [],
    };
    thisPc.children = [...baseKids, 'drive-d'];
  }

  function getSharedTree(): Record<string, ExpFsNode> {
    if (!sharedNodes) {
      sharedNodes = createWin11FsNodes(opts?.getDesktopShortcuts?.() ?? []);
      syncDriveDNodeInTree(sharedNodes);
    }
    return sharedNodes;
  }

  function getDriveDState(): DriveDState {
    if (driveDStatus === 'unmounted' || !driveDHandle) {
      return { status: 'unmounted', volumeName: null, displayName: '本地磁盘 (D:)' };
    }
    return {
      status: driveDStatus,
      volumeName: driveDHandle.name,
      displayName: driveDStatus === 'needs-auth' ? '本地磁盘 (D:) - 需授权' : '本地磁盘 (D:)',
    };
  }

  async function restoreDriveDStatus(): Promise<DriveDState> {
    const saved = await loadDriveDHandle();
    if (!saved) {
      driveDHandle = null;
      driveDStatus = 'unmounted';
    } else {
      driveDHandle = saved;
      const perm = await queryDirPermission(saved, 'readwrite');
      if (perm === 'granted') {
        driveDStatus = 'ready';
      } else if (perm === 'prompt') {
        driveDStatus = 'needs-auth';
      } else {
        driveDHandle = null;
        driveDStatus = 'unmounted';
      }
    }
    syncDriveDNodeInTree(getSharedTree());
    emitFsChange();
    return getDriveDState();
  }

  async function syncDriveDFolder(folderNodeId = 'drive-d'): Promise<ExpFsNode[]> {
    const nodes = getSharedTree();
    if (driveDStatus !== 'ready' || !driveDHandle) return [];
    const rel = parseDNodeIdSegments(folderNodeId);
    if (rel === null) return [];

    const dirHandle = await resolveHostSubdir(driveDHandle, rel, false);
    const items = await listHostDirectory(dirHandle);
    const parentNode = nodes[folderNodeId];
    if (!parentNode) return [];

    const nextIds: string[] = [];
    const resultNodes: ExpFsNode[] = [];
    for (const item of items) {
      const childRel = [...rel, item.name];
      const cid = formatDNodeId(childRel);
      const isDir = item.kind === 'directory';
      const meta = getFileMetaByName(item.name);
      const prev = nodes[cid];
      nodes[cid] = {
        id: cid,
        name: item.name,
        kind: isDir ? 'folder' : 'file',
        icon: isDir ? EXP_ICONS.folder : meta.icon,
        parentId: folderNodeId,
        typeLabel: isDir ? '文件夹' : meta.typeLabel,
        sizeBytes: isDir ? undefined : item.sizeBytes,
        modifiedText: item.lastModified ? formatNowText(item.lastModified) : formatNowText(),
        writable: true,
        children: isDir ? (prev?.children ?? []) : undefined,
      };
      nextIds.push(cid);
      resultNodes.push(nodes[cid]);
    }
    parentNode.children = nextIds;
    return resultNodes;
  }

  async function mountDriveD(providedHandle?: FileSystemDirectoryHandle): Promise<DriveDState> {
    let handle = providedHandle;
    if (!handle) {
      const picker = directoryPicker();
      if (typeof picker !== 'function') {
        throw new Error('当前浏览器不支持挂载本地目录 (本地目录选择器)。');
      }
      handle = await picker({ mode: 'readwrite' });
    }
    driveDHandle = handle;
    driveDStatus = 'ready';
    await saveDriveDHandle(handle);
    syncDriveDNodeInTree(getSharedTree());
    await syncDriveDFolder('drive-d');
    emitFsChange();
    return getDriveDState();
  }

  async function authorizeDriveD(): Promise<DriveDState> {
    if (!driveDHandle) return getDriveDState();
    const ok = await requestDirPermission(driveDHandle, 'readwrite');
    if (ok) {
      driveDStatus = 'ready';
      syncDriveDNodeInTree(getSharedTree());
      await syncDriveDFolder('drive-d');
      emitFsChange();
    }
    return getDriveDState();
  }

  async function unmountDriveD(): Promise<DriveDState> {
    driveDHandle = null;
    driveDStatus = 'unmounted';
    await clearDriveDHandle();
    syncDriveDNodeInTree(getSharedTree());
    emitFsChange();
    return getDriveDState();
  }

  function getNodePath(nodeId: string): string {
    const nodes = getSharedTree();
    const dSegs = parseDNodeIdSegments(nodeId);
    if (dSegs !== null) {
      return dSegs.length === 0 ? 'D:\\' : `D:\\${dSegs.join('\\')}`;
    }
    if (nodeId === 'this-pc') return '此电脑';
    if (nodeId === 'drive-c') return 'C:\\';

    const chain: string[] = [];
    let cur: ExpFsNode | undefined = nodes[nodeId];
    const seen = new Set<string>();
    while (cur && cur.id !== 'drive-c' && cur.id !== 'this-pc' && !seen.has(cur.id)) {
      seen.add(cur.id);
      chain.unshift(cur.name);
      cur = cur.parentId ? nodes[cur.parentId] : undefined;
    }
    if (!cur || cur.id!=='drive-c') throw Error('未知文件系统节点: '+nodeId);
    return `C:\\${chain.join('\\')}`;
  }

  function resolveCNodeBySegments(segments: readonly string[], createDirs = false): ExpFsNode | null {
    const nodes = getSharedTree();
    let cur = nodes['drive-c'];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      hydrateWin11FolderFiles(nodes, cur.id);
      const childIds = cur.children ?? [];
      let match = childIds.map((id) => nodes[id]).find((n) => n && n.name.toLowerCase() === seg.toLowerCase());
      if (!match) {
        if (!createDirs) return null;
        const id = `vfs-d-${customSeq++}`;
        match = {
          id,
          name: seg,
          kind: 'folder',
          icon: EXP_ICONS.folder,
          parentId: cur.id,
          typeLabel: '文件夹',
          modifiedText: formatNowText(),
          writable: true,
          children: [],
        };
        nodes[id] = match;
        cur.children = [...childIds, id];
      }
      cur = match;
    }
    return cur;
  }

  function toVfsEntry(node: ExpFsNode): VfsEntryInfo {
    return {
      nodeId: node.id,
      path: getNodePath(node.id),
      name: node.name,
      kind: node.kind,
      icon: node.icon,
      typeLabel: node.typeLabel,
      sizeBytes: node.sizeBytes,
      modifiedText: node.modifiedText,
      writable: Boolean(node.writable),
      needsAuth: node.id === 'drive-d' && driveDStatus === 'needs-auth',
    };
  }

  function addUploadNode(parent: ExpFsNode, name: string, record: ExplorerUpload): ExpFsNode {
    const nodes = getSharedTree();
    const node: ExpFsNode = {
      id: `upload-${customSeq++}`, name, parentId: parent.id, kind: 'file',
      ...getFileMetaByName(name), modifiedText: record.modifiedText,
      sizeBytes: record.blob.size, uploadedFile: record.blob,
    };
    nodes[node.id] = node;
    parent.children = [...(parent.children ?? []), node.id];
    return node;
  }

  function restoreUploads(): Promise<void> {
    if (!hasDatabase()) return Promise.resolve();
    uploadLoadPromise ??= listUploads().then((records) => {
      for (const record of records) {
        const { segments } = normalizeWinPath(record.path);
        const name = segments.pop();
        const parent = resolveCNodeBySegments(segments, true);
        if (name && parent) {
          const existing=resolveCNodeBySegments([...segments,name]);
          if(existing?.kind==='file') Object.assign(existing,{uploadedFile:record.blob,sizeBytes:record.blob.size,modifiedText:record.modifiedText});
          else addUploadNode(parent,name,record);
        }
      }
      if (records.length) emitFsChange();
    }).catch((error) => {
      uploadLoadPromise = undefined;
      throw error;
    });
    return uploadLoadPromise;
  }

  async function importFile(parentId: string, file: File, owner = opts.resources): Promise<ExpFsNode> {
    if (!file.name || /[\\/:*?"<>|]/.test(file.name) || /^\.{1,2}$/.test(file.name)) {
      throw new Error('文件名包含无效字符');
    }
    const nodes = getSharedTree();
    const parent = nodes[parentId];
    if (!parent?.writable || parent.kind === 'file') throw new Error('此文件夹不可写');
    const dSegments = parseDNodeIdSegments(parentId);
    if (dSegments) await syncDriveDFolder(parentId);
    else {
      await restoreUploads();
      hydrateWin11FolderFiles(nodes, parentId);
    }
    if (parent.children?.some((id) => nodes[id]?.name.toLowerCase() === file.name.toLowerCase())) {
      throw new Error(`已有同名文件或文件夹：${file.name}`);
    }
    if (dSegments) {
      if (driveDStatus !== 'ready' || !driveDHandle) throw new Error('请先授权访问 D 盘');
      const directory = await resolveHostSubdir(driveDHandle, dSegments);
      const handle = await directory.getFileHandle(file.name, { create: true });
      await owner.writeFile(handle, file);
      await syncDriveDFolder(parentId);
      emitFsChange();
      return nodes[formatDNodeId([...dSegments, file.name])];
    }
    const path = getNodePath(parentId).replace(/\\$/, '') + '\\' + file.name;
    const record = { path, blob: file, modifiedText: formatNowText(file.lastModified) };
    await saveUpload(record);
    const node = addUploadNode(parent, file.name, record);
    emitFsChange();
    return node;
  }

  async function readFileBlob(nodeId: string): Promise<Blob> {
    const node = getSharedTree()[nodeId];
    if (node?.kind !== 'file') throw new Error('找不到文件');
    const segments = parseDNodeIdSegments(nodeId);
    if (segments) {
      if (driveDStatus !== 'ready' || !driveDHandle) throw new Error('请先授权访问 D 盘');
      const dir = await resolveHostSubdir(driveDHandle, segments.slice(0, -1));
      return (await dir.getFileHandle(segments[segments.length - 1])).getFile();
    }
    if (node.uploadedFile) return node.uploadedFile;
    if (typeof node.textContent === 'string') return new Blob([node.textContent]);
    throw new Error('此文件没有可读取的内容');
  }

  async function listDirectory(path: string): Promise<VfsEntryInfo[]> {
    const nodes = getSharedTree();
    const { drive, segments } = normalizeWinPath(path);
    if (!drive) {
      const rootKids = (nodes['this-pc']?.children ?? [])
        .map((id) => nodes[id])
        .filter((n): n is ExpFsNode => Boolean(n));
      return rootKids.map(toVfsEntry);
    }

    if (drive === 'D') {
      if (driveDStatus === 'unmounted' || !driveDHandle) {
        throw new Error('本地磁盘 (D:) 尚未挂载，请先选择宿主机目录挂载为 D 盘。');
      }
      if (driveDStatus === 'needs-auth') {
        throw new Error('DRIVE_D_NEEDS_AUTH');
      }
      const dId = formatDNodeId(segments);
      if (!nodes[dId]) {
        // Ensure parent chain exists up to target D: directory
        for (let i = 1; i <= segments.length; i++) {
          await syncDriveDFolder(formatDNodeId(segments.slice(0, i - 1)));
        }
      }
      const list = await syncDriveDFolder(dId);
      return list.map(toVfsEntry);
    }

    await restoreUploads();
    const dir = resolveCNodeBySegments(segments, false);
    if (!dir || dir.kind === 'file') {
      throw new Error(`找不到目录：${path}`);
    }
    hydrateWin11FolderFiles(nodes, dir.id);
    const list = (dir.children ?? [])
      .map((id) => nodes[id])
      .filter((n): n is ExpFsNode => Boolean(n))
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
        return a.name.localeCompare(b.name, 'zh-CN');
      });
    return list.map(toVfsEntry);
  }

  async function openTextFile(path:string,owner=opts.resources) {
    const {parts}=files.resolve(path);
    if (!parts.length) throw Error('请提供完整的文件路径。');
    const handle=openBinaryFile(path,owner);
    return {close:handle.close,async read() {
      const decoder=new TextDecoder();
      let content='',sizeBytes=0;
      for await(const chunk of handle.read()) {content+=decoder.decode(chunk,{stream:true});sizeBytes+=chunk.byteLength;}
      return {path,name:parts.at(-1)!,content:content+decoder.decode(),sizeBytes};
    }};
  }
  async function readTextFile(path: string, owner = opts.resources) {
    const handle = await openTextFile(path, owner);
    try {
      return await handle.read();
    } finally {
      handle.close();
    }
  }

  const files = new Vfs();
  files.mount('C',{
    async *read(parts) {
      await restoreUploads();
      const node=resolveCNodeBySegments(parts);
      if (!node || node.kind!=='file') throw Error('找不到文件');
      const blob=node.uploadedFile ?? new Blob([node.textContent ?? '[系统骨架文件: '+node.name+']\r\n类型: '+node.typeLabel+'\r\n逻辑大小: '+(node.sizeBytes ?? 0)+' 字节\r\n']);
      yield* blob.stream();
    },
    async replace(parts,chunks,owner) {
      await restoreUploads();
      const parent=resolveCNodeBySegments(parts.slice(0,-1),true);
      if (!parent || parent.kind==='file') throw Error('无效目标目录');
      hydrateWin11FolderFiles(getSharedTree(),parent.id);
      const name=parts.at(-1)!;
      const path='C:\\'+parts.join('\\');
      const existing=resolveCNodeBySegments(parts);
      if (existing && existing.kind!=='file') throw Error('目录不能被覆盖');
      const record={path,blob:new Blob([...chunks]),modifiedText:formatNowText()};
      owner.assertLive();
      await saveUpload(record,true,owner);
      if (existing) {
        existing.uploadedFile=record.blob;existing.sizeBytes=record.blob.size;
        existing.modifiedText=record.modifiedText;delete existing.textContent;
      } else addUploadNode(parent,name,record);
      emitFsChange();
    },
  });
  files.mount('D',{
    async *read(parts) {
      if (!driveDHandle || driveDStatus!=='ready') throw Error('D: 盘未挂载或需要授权');
      const dir=await resolveHostSubdir(driveDHandle,parts.slice(0,-1));
      const file=await (await dir.getFileHandle(parts.at(-1)!)).getFile();
      yield* file.stream();
    },
    async replace(parts,chunks,owner) {
      if (!driveDHandle || driveDStatus!=='ready') throw Error('D: 盘未挂载或需要授权');
      const dir=await resolveHostSubdir(driveDHandle,parts.slice(0,-1),true);
      owner.assertLive();
      const file=await dir.getFileHandle(parts.at(-1)!,{create:true});
      await replaceHostBytes(file,chunks,owner);
      await syncDriveDFolder(formatDNodeId(parts.slice(0,-1)));
      emitFsChange();
    },
  });
  function openBinaryFile(path:string,owner=opts.resources) {return files.open(path,owner);}
  function createWriter(path:string,owner=opts.resources) {return files.writer(path,owner);}
  async function writeTextFile(path:string,content:string,owner=opts.resources,signal?:AbortSignal) {
    const {parts}=files.resolve(path);
    const bytes=new TextEncoder().encode(content);
    const stream=createWriter(path,owner);
    signal?.addEventListener('abort',stream.abort,{once:true});
    try { signal?.throwIfAborted();stream.write(bytes);await stream.commit(); }
    catch(error){await stream.abort();throw error;}
    finally {signal?.removeEventListener('abort',stream.abort);}
    return {path,name:parts.at(-1)!,sizeBytes:bytes.length};
  }

  async function createEntryInNode(
    parentNodeId: string,
    kind: 'folder' | 'file',
    desiredName?: string,
    owner = opts.resources,
  ): Promise<ExpFsNode | null> {
    const nodes = getSharedTree();
    const parent = nodes[parentNodeId];
    if (!parent || !parent.writable) return null;

    const existingNames = new Set((parent.children ?? []).map((cid) => nodes[cid]?.name.toLowerCase()));
    const baseName = desiredName || (kind === 'folder' ? '新建文件夹' : '新建文本文档.txt');
    let finalName = baseName;
    let suffix = 2;
    while (existingNames.has(finalName.toLowerCase())) {
      finalName = kind === 'folder' ? `新建文件夹 (${suffix})` : `新建文本文档 (${suffix}).txt`;
      suffix++;
    }

    const dSegs = parseDNodeIdSegments(parentNodeId);
    if (dSegs !== null) {
      if (driveDStatus !== 'ready' || !driveDHandle) return null;
      const targetSegs = [...dSegs, finalName];
      if (kind === 'folder') {
        await resolveHostSubdir(driveDHandle, targetSegs, true);
      } else {
        await writeHostTextFile(driveDHandle, targetSegs, '', owner);
      }
      await syncDriveDFolder(parentNodeId);
      emitFsChange();
      return nodes[formatDNodeId(targetSegs)] ?? null;
    }

    const id = `custom-${customSeq++}`;
    const meta = getFileMetaByName(finalName);
    nodes[id] = {
      id,
      name: finalName,
      kind,
      icon: kind === 'folder' ? EXP_ICONS.folder : meta.icon,
      parentId: parent.id,
      typeLabel: kind === 'folder' ? '文件夹' : meta.typeLabel,
      sizeBytes: kind === 'file' ? 0 : undefined,
      modifiedText: formatNowText(),
      writable: kind === 'folder',
      children: kind === 'folder' ? [] : undefined,
      ...(kind === 'file' ? { textContent: '' } : {}),
    };
    parent.children = [...(parent.children ?? []), id];
    emitFsChange();
    return nodes[id];
  }

  async function deleteEntryByNodeId(nodeId: string): Promise<boolean> {
    const nodes = getSharedTree();
    const node = nodes[nodeId];
    if (!node || node.kind === 'drive' || node.kind === 'root') return false;

    const dSegs = parseDNodeIdSegments(nodeId);
    if (dSegs !== null) {
      if (driveDStatus !== 'ready' || !driveDHandle || dSegs.length === 0) return false;
      await deleteHostEntry(driveDHandle, dSegs);
      await syncDriveDFolder(node.parentId ?? 'drive-d');
      emitFsChange();
      return true;
    }

    const parent = node.parentId ? nodes[node.parentId] : undefined;
    if (node.uploadedFile || node.kind === 'folder') {
      await relocateUploads(getNodePath(nodeId));
    }
    if (parent?.children) {
      parent.children = parent.children.filter((id) => id !== nodeId);
    }
    delete nodes[nodeId];
    emitFsChange();
    return true;
  }

  function computeDiskCStats(hw: VirtualHardwareSnapshot | null): VirtualDiskStats {
    const sp = hw?.storage?.probe;
    const totalBytes = hw?.storage?.fixedQuotaBytes ?? sp?.quotaBytes ?? 10 * 1024 ** 3;
    const usedBytes = Math.min(totalBytes, Math.max(0, sp?.usageBytes ?? 0));
    const freeBytes = Math.max(0, totalBytes - usedBytes);
    const usedPct = totalBytes > 0 ? Math.min(100, Math.max(0, (usedBytes / totalBytes) * 100)) : 0;
    return {
      totalBytes,
      usedBytes,
      freeBytes,
      usedPct,
      isWarn: usedPct >= 90,
      totalText: formatGiB(totalBytes),
      freeText: formatGiB(freeBytes),
      usedText: formatGiB(usedBytes),
    };
  }


  return {
    getSharedTree,openBinaryFile,createWriter,
    createExplorerTree: getSharedTree,
    hydrateFolder: hydrateWin11FolderFiles,
    loadFullSkeleton: (nodes: Record<string, ExpFsNode>) => {
      if (!skeletonLoadPromise) {
        skeletonLoadPromise = loadFullWin11FsSkeleton(nodes);
      }
      return skeletonLoadPromise;
    },
    scanFolderStatsAsync: scanWin11FolderStatsAsync,
    calcNtfsDiskBytes,
    computeDiskCStats,
    getUiIcons: () => EXP_ICONS,
    getDriveDState,
    restoreDriveDStatus,
    mountDriveD,
    authorizeDriveD,
    unmountDriveD,
    syncDriveDFolder,
    getNodePath,
    listDirectory,
    openTextFile,
    readTextFile,
    readFileBlob,
    importFile,
    restoreUploads,
    relocateUploads,
    writeTextFile,
    createEntryInNode,
    deleteEntryByNodeId,
    emitFsChange,
    subscribeFs: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    listOpfsEntries,
    clearOpfsTestBlocks,
    requestPersistence,
  };
}

export type VirtualStorageService = ReturnType<typeof createVirtualStorageService>;
