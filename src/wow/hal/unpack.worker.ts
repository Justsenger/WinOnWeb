import type { PackageManifest, VersionRecord } from '../contracts';
import { writeContent } from './storage';

const LIMIT = 512 * 1024 * 1024;
const MAX_FILES = 16384;
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  for (let bit = 0; bit < 8; bit++) i = i & 1 ? (i >>> 1) ^ 0xedb88320 : i >>> 1;
  return i >>> 0;
});

async function unpack(bytes: ArrayBuffer, version: VersionRecord) {
  const data = new Uint8Array(bytes);
  const header = new DataView(bytes);
  const u16 = (p: number) => header.getUint16(p, true);
  const u32 = (p: number) => header.getUint32(p, true);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let end = data.length - 22;
  while (
    end >= Math.max(0, data.length - 65557) &&
    !(u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === data.length)
  )
    end--;
  if (end < Math.max(0, data.length - 65557) || u32(end + 4) !== 0) throw Error('无效或分卷 ZIP');
  const count = u16(end + 10);
  if (!count || count > MAX_FILES || count !== u16(end + 8)) throw Error('包条目数超限');
  let cursor = u32(end + 16);
  const directory = cursor;
  if (cursor + u32(end + 12) !== end) throw Error('无效包目录');
  const seen = new Set<string>();
  const paths: string[] = [];
  let expanded = 0;
  let manifest: PackageManifest | undefined;
  for (let i = 0; i < count; i++) {
    if (u32(cursor) !== 0x02014b50 || u16(cursor + 8) & 1) throw Error('无效或加密条目');
    const method = u16(cursor + 10),
      checksum = u32(cursor + 16),
      packed = u32(cursor + 20),
      size = u32(cursor + 24);
    const nameLen = u16(cursor + 28),
      local = u32(cursor + 42);
    const raw = decoder.decode(data.subarray(cursor + 46, cursor + 46 + nameLen));
    cursor += 46 + nameLen + u16(cursor + 30) + u16(cursor + 32);
    const path = raw.replace(/\/$/, '');
    if (
      !path ||
      path.length > 1024 ||
      /[\\:\x00-\x1f]/.test(path) ||
      path.split('/').some((part) => !part || part === '.' || part === '..') ||
      seen.has(path)
    )
      throw Error('无效或重复的包路径');
    seen.add(path);
    if (u32(local) !== 0x04034b50 || u16(local + 8) !== method) throw Error('无效本地文件头');
    const start = local + 30 + u16(local + 26) + u16(local + 28);
    if (start + packed > directory || cursor > end || ![0, 8].includes(method))
      throw Error('包条目范围或压缩方式无效');
    expanded += size;
    if (expanded > LIMIT || (path === 'manifest.json' && size > 65536)) throw Error('展开字节数超限');
    if (raw.endsWith('/')) {
      if (size) throw Error('无效目录条目');
      continue;
    }
    const chunks: ArrayBuffer[] = [];
    let length = 0,
      crc = 0xffffffff;
    function append(chunk: Uint8Array) {
      length += chunk.length;
      if (length > size) throw Error('包展开长度超出声明');
      for (const b of chunk) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
      chunks.push(chunk.slice().buffer);
    }
    const packedFile = new Blob([data.subarray(start, start + packed)]);
    const stream =
      method === 8
        ? packedFile.stream().pipeThrough(new DecompressionStream('deflate-raw'))
        : packedFile.stream();
    for await (const chunk of stream) append(chunk);
    if (length !== size || (crc ^ 0xffffffff) >>> 0 !== checksum) throw Error('包文件校验失败: ' + path);
    const blob = new Blob(chunks);
    await writeContent(version, path, blob);
    paths.push(path);
    if (path === 'manifest.json') manifest = JSON.parse(await blob.text());
  }
  if (
    cursor !== end ||
    !manifest ||
    manifest.format !== 1 ||
    typeof manifest.name !== 'string' ||
    !manifest.name.trim() ||
    typeof manifest.id !== 'string' ||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(manifest.id) ||
    !paths.includes(manifest.entry ?? 'index.html') ||
    (manifest.icon && !paths.includes(manifest.icon)) ||
    (manifest.singleThreadEntry && !paths.includes(manifest.singleThreadEntry)) ||
    (manifest.description !== undefined && typeof manifest.description !== 'string') ||
    (manifest.window &&
      (typeof manifest.window !== 'object' ||
        Object.values(manifest.window).some(
          (n) => typeof n !== 'number' || !Number.isFinite(n) || n <= 0,
        ))) ||
    (manifest.version !== undefined && typeof manifest.version !== 'string') ||
    (manifest.permissions &&
      !(Array.isArray(manifest.permissions) && manifest.permissions.every((p) => typeof p === 'string')))
  )
    throw Error('WOW 包清单或入口无效');
  return { manifest, paths };
}
self.onmessage = async ({ data }) => {
  try {
    self.postMessage({ result: await unpack(data.bytes, data.version) });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
