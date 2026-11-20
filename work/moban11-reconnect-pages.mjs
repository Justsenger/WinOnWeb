import fs from 'node:fs';
import zlib from 'node:zlib';

const endpoint = process.env.EXHYPERV_MCP ?? 'http://127.0.0.1:5188/mcp';
const vmId = '2d5c1136-14a0-40fe-81fb-cc2e6075aae9';
const outputDir = process.argv[2] ?? 'work/moban11-reference-fresh';
fs.mkdirSync(outputDir, { recursive: true });
let requestId = 1;
async function rpc(method, params) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: requestId++, method, params }),
  });
  const raw = await response.text();
  const line = raw.split(/\r?\n/).find((item) => item.startsWith('data: '));
  if (!line) throw new Error(raw.slice(0, 500));
  return JSON.parse(line.slice(6));
}
async function tool(name, args) {
  const result = await rpc('tools/call', { name, arguments: args });
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
async function sendKeys(handle) {
  const events = [];
  for (const scanCode of [0x10, 0x11, 0x12, 0x13, 0x02, 0x03, 0x04, 0x05, 0x1c]) {
    events.push(
      { $type: 'ExHyperV.Services.ConsoleKeyEvent', ScanCode: scanCode, Extended: false, Down: true },
      { $type: 'ExHyperV.Services.ConsoleKeyEvent', ScanCode: scanCode, Extended: false, Down: false },
    );
  }
  await tool('core_api_call', {
    apiId: 'M:ExHyperV.Services.IConsoleInput.SendKeys(System.Collections.Generic.IReadOnlyList{ExHyperV.Services.ConsoleKeyEvent})',
    target: handle,
    arguments: { events },
    background: false,
  });
}
async function capture(handle, name) {
  const result = await tool('core_api_call', {
    apiId: 'M:ExHyperV.Services.IConsoleVideoSource.CaptureFrame',
    target: handle,
    background: false,
    retainResult: true,
  });
  const frame = result.data.response.result;
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
  fs.writeFileSync(`${outputDir}/${name}.raw`, raw);
  fs.writeFileSync(`${outputDir}/${name}.png`, encodePng(frame.Width, frame.Height, raw));
  await tool('core_object_release', { handle: binaryHandle });
  await tool('core_object_release', { handle: frame.$handle });
  return { name, sequence: frame.Sequence, width: frame.Width, height: frame.Height };
}
const pages = [
  ['processes', 215],
  ['performance', 295],
  ['history', 376],
  ['startup', 456],
  ['users', 536],
  ['details', 616],
  ['services', 696],
];
const results = [];
for (const [name, y] of pages) {
  const options = {
    $type: 'ExHyperV.Services.ConsoleConnectionOptions',
    VmId: vmId,
    Width: 2048,
    Height: 1288,
    DesktopScale: 200,
    ConnectTimeout: '00:00:30',
  };
  const created = await tool('core_api_call', {
    apiId: 'M:ExHyperV.Services.ConsoleService.CreateConnection(ExHyperV.Services.ConsoleConnectionOptions,System.String)',
    arguments: { options, backendId: 'RdpEnhanced' },
    background: false,
    retainResult: true,
  });
  const handle = created.data.response.result.$handle;
  await tool('core_api_call', { apiId: 'M:ExHyperV.Services.IConsoleConnection.Start', target: handle, background: false });
  await new Promise((resolve) => setTimeout(resolve, 5000));
  await sendKeys(handle);
  await new Promise((resolve) => setTimeout(resolve, 5000));
  await tool('core_api_call', {
    apiId: 'M:ExHyperV.Services.IConsoleInput.SendClick(System.UInt16,System.UInt16,ExHyperV.Services.ConsolePointerButton)',
    target: handle,
    arguments: { x: 48, y, button: 'Left' },
    background: false,
  });
  await new Promise((resolve) => setTimeout(resolve, 1800));
  results.push(await capture(handle, name));
  await tool('core_api_call', { apiId: 'M:ExHyperV.Services.IConsoleConnection.DisconnectAsync', target: handle, background: false });
  console.log(JSON.stringify(results.at(-1)));
}
console.log(JSON.stringify(results, null, 2));
