import type { AppOriginBridge, VersionRecord } from '../contracts';
import { activateVhost } from './vhost';
import { contentBackend, discardVersion, getRecord, putRecord, writeContent } from './storage';

type Command =
  | { op: 'begin' | 'commit' | 'remove'; hash: string }
  | { op: 'file'; hash: string; path: string; bytes: ArrayBuffer }
  | { op: 'activate' };
const tag = 'wow/origin-v1';
function deadline<T>(work: Promise<T>, ms: number) {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error('应用源引导超时')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
export function subdomainBridge(domain: string): AppOriginBridge {
  if (!/^(?:[a-z0-9-]+\.)+[a-z0-9-]+(?::[0-9]{1,5})?$/i.test(domain)) throw Error('无效应用域');
  const originFor = (id: string) => 'https://' + id + '.' + domain;
  async function session(id: string, work: (command: (op: Command) => Promise<void>) => Promise<void>) {
    const origin = originFor(id),
      frame = document.createElement('iframe'),
      channel = new MessageChannel();
    frame.hidden = true;
    frame.allow = 'cross-origin-isolated';
    let seq = 0;
    async function command(payload: Command) {
      const request = ++seq;
      const response = new Promise<void>((resolve, reject) => {
        channel.port1.onmessage = (e) => {
          if (e.data?.request !== request) return;
          if (e.data.ok) resolve();
          else reject(Error(String(e.data.error)));
        };
        channel.port1.postMessage({ request, payload }, payload.op === 'file' ? [payload.bytes] : []);
      });
      await deadline(response, 60000);
    }
    try {
      await deadline(
        new Promise<void>((resolve, reject) => {
          frame.onload = () => {
            channel.port1.onmessage = (e) => (e.data?.ready ? resolve() : reject(Error('应用源拒绝连接')));
            frame.contentWindow?.postMessage({ tag, id }, origin, [channel.port2]);
          };
          frame.onerror = () => reject(Error('无法加载应用源引导页'));
          frame.src = origin + '/wow/bootstrap/';
          document.body.append(frame);
        }),
        15000,
      );
      await work(command);
    } finally {
      channel.port1.close();
      frame.remove();
    }
  }
  async function alreadyActive(id: string) {
    const origin = originFor(id),
      frame = document.createElement('iframe'),
      nonce = crypto.randomUUID();
    frame.hidden = true;
    let listener: (e: MessageEvent) => void = () => {};
    try {
      return await deadline(
        new Promise<boolean>((resolve) => {
          listener = (e) => {
            if (
              e.origin === origin &&
              e.source === frame.contentWindow &&
              e.data?.tag === 'wow:vhost-ready' &&
              e.data.nonce === nonce
            )
              resolve(true);
          };
          window.addEventListener('message', listener);
          frame.src = origin + '/wow/apps/.ready/#' + nonce;
          document.body.append(frame);
        }),
        1500,
      );
    } catch {
      return false;
    } finally {
      window.removeEventListener('message', listener);
      frame.remove();
    }
  }
  return {
    originFor,
    activate: async (id) => {
      if (!(await alreadyActive(id))) await session(id, (send) => send({ op: 'activate' }));
    },
    removeVersion: (id, hash) => session(id, (send) => send({ op: 'remove', hash })),
    writeVersion: (id, hash, files) =>
      session(id, async (send) => {
        await send({ op: 'begin', hash });
        for await (const { path, bytes } of files) await send({ op: 'file', hash, path, bytes });
        await send({ op: 'commit', hash });
      }),
  };
}
// The trusted parent origin is supplied at deployment time, never by the embedding document.
export function listenForShell(trustedOrigin: string) {
  if (!trustedOrigin || trustedOrigin === location.origin || parent === window) return;
  window.addEventListener('message', (e) => {
    const id = e.data?.id,
      port = e.ports[0];
    if (
      e.source !== parent ||
      e.origin !== trustedOrigin ||
      !port ||
      e.data?.tag !== tag ||
      typeof id !== 'string' ||
      id !== location.hostname.split('.')[0]
    )
      return;
    let staging: VersionRecord | undefined;
    port.onmessage = async ({ data }) => {
      const op = data.payload as Command;
      try {
        if (op.op === 'activate') await activateVhost(id);
        else {
          if (!/^[a-f0-9]{64}$/.test(op.hash)) throw Error('无效版本');
          const key = [id, op.hash];
          if (op.op === 'begin') {
            if (await getRecord('versions', key)) throw Error('目标版本已存在');
            staging = { id, versionHash: op.hash, state: 'staging', backend: await contentBackend() };
            await putRecord('versions', key, staging);
          } else if (op.op === 'remove') {
            const v = await getRecord<VersionRecord>('versions', key);
            if (v) await discardVersion(v);
          } else {
            if (staging?.versionHash !== op.hash || !staging) throw Error('无暂存会话');
            if (op.op === 'file') {
              if (op.path.split('/').some((p) => !p || p === '.' || p === '..' || p.includes('\\')))
                throw Error('无效文件路径');
              await writeContent(staging, op.path, new Blob([op.bytes]));
            } else if (op.op === 'commit') {
              await putRecord('versions', key, { ...staging, state: 'verified' });
              staging = undefined;
            } else throw Error('未知引导操作');
          }
        }
        port.postMessage({ request: data.request, ok: true });
      } catch (error) {
        port.postMessage({ request: data.request, ok: false, error: String(error) });
      }
    };
    port.postMessage({ ready: true });
  });
}
