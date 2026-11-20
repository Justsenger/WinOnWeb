import fs from 'node:fs';
import zlib from 'node:zlib';

const endpoint = process.env.EXHYPERV_MCP ?? 'http://127.0.0.1:5188/mcp';
const connectionHandle = process.argv[2];
const outputBase = process.argv[3] ?? 'work/moban11-capture';
const requestedWidth = Number(process.argv[4] ?? 1024);
const requestedHeight = Number(process.argv[5] ?? 644);

if (!connectionHandle) throw new Error('Usage: node moban11-capture.mjs <connectionHandle> <outputBase> [width] [height]');

let requestId = 1;
async function rpc(method, params) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: requestId++, method, params }),
  });
  const raw = await response.text();
  const dataLine = raw.split(/\r?\n/).find((line) => line.startsWith('data: '));
  if (!dataLine) throw new Error(raw.slice(0, 500));
  return JSON.parse(dataLine.slice(6));
}

async function tool(name, args) {
  const result = await rpc('tools/call', { name, arguments: args });
  if (result.error) throw new Error(JSON.stringify(result.error));
  const structured = result.result?.structuredContent;
  if (structured !== undefined) return structured;
  const text = result.result?.content?.find((item) => item.type === 'text')?.text;
  return text ? JSON.parse(text) : result.result;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.alloc(4);
  typeBytes.writeUInt32BE(type, 0);
  const body = Buffer.concat([typeBytes, data]);
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(body), 8 + data.length);
  return chunk;
}

function encodePng(width, height, bgra) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 4;
      const target = 1 + x * 4;
      row[target] = bgra[source + 2];
      row[target + 1] = bgra[source + 1];
      row[target + 2] = bgra[source];
      row[target + 3] = bgra[source + 3];
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk(0x49484452, header),
    pngChunk(0x49444154, zlib.deflateSync(Buffer.concat(rows))),
    pngChunk(0x49454e44, Buffer.alloc(0)),
  ]);
}

const capture = await tool('core_api_call', {
  apiId: 'M:ExHyperV.Services.IConsoleVideoSource.CaptureFrame',
  target: connectionHandle,
  background: false,
  retainResult: true,
});
const frame = capture.data.response.result;
const width = frame.Width ?? requestedWidth;
const height = frame.Height ?? requestedHeight;
const pixels = await tool('core_api_get', {
  apiId: 'P:ExHyperV.Services.ConsoleFrame.Pixels',
  target: frame.$handle,
});
const binaryHandle = pixels.data.value.handle;
const chunks = [];
let offset = 0;
while (true) {
  const read = await tool('core_binary_read', { handle: binaryHandle, offset, count: 262144 });
  const bytes = Buffer.from(read.data.base64, 'base64');
  chunks.push(bytes);
  offset += bytes.length;
  if (read.data.end || bytes.length === 0) break;
}
const raw = Buffer.concat(chunks);
fs.writeFileSync(`${outputBase}.raw`, raw);
fs.writeFileSync(`${outputBase}.png`, encodePng(width, height, raw));
await tool('core_object_release', { handle: binaryHandle });
await tool('core_object_release', { handle: frame.$handle });
console.log(JSON.stringify({ outputBase, width, height, sequence: frame.Sequence, bytes: raw.length }));
