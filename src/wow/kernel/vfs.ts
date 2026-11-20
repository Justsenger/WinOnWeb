import type { WriteState, ResourceOwner } from '../contracts';
export interface MountDriver {
  read(parts: string[]): AsyncIterable<Uint8Array>;
  replace(parts: string[], chunks: readonly Uint8Array<ArrayBuffer>[], owner: ResourceOwner): Promise<void>;
}
export function parsePath(path: string) {
  const match = /^([a-z0-9_-]+):(?:[\\/](.*))?$/i.exec(path);
  if (!match) throw Error('需要绝对挂载路径: ' + path);
  const parts = (match[2] ?? '').split(/[\\/]/).filter(Boolean);
  if (parts.some((p) => p === '.' || p === '..' || /[:\x00]/.test(p))) throw Error('无效路径');
  return { mountId: match[1].toUpperCase(), parts };
}
export class Vfs {
  private mounts = new Map<string, MountDriver>();
  mount(id: string, driver: MountDriver) {
    this.mounts.set(id, driver);
  }
  resolve(path: string) {
    const { mountId, parts } = parsePath(path);
    const driver = this.mounts.get(mountId);
    if (!driver) throw Error('未知挂载点: ' + mountId);
    return { mountId, driver, parts };
  }
  open(path: string, owner: ResourceOwner) {
    const { driver, parts } = this.resolve(path);
    let closed = false;
    function close() {
      closed = true;
      release();
    }
    const release = owner.manage('handles', close);
    return {
      close,
      async *read() {
        if (closed) throw Error('句柄已释放');
        for await (const chunk of driver.read(parts)) {
          owner.assertLive();
          if (closed) throw Error('句柄已释放');
          yield chunk;
        }
      },
    };
  }
  writer(path: string, owner: ResourceOwner) {
    const { driver, parts } = this.resolve(path);
    if (!parts.length) throw Error('不能覆盖挂载点');
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let state: WriteState = 'open';
    const operations = new Set<() => void | Promise<void>>();
    async function abort() {
      if (state !== 'open' && state !== 'committing') return;
      state = 'aborted';
      chunks.length = 0;
      release();
      const results = await Promise.allSettled([...operations].map(async (cancel) => cancel()));
      for (const result of results) if (result.status === 'rejected') throw result.reason;
    }
    const release = owner.manage('writers', abort);
    const scope = {
      ...owner,
      assertLive() {
        owner.assertLive();
        if (state === 'aborted') throw Error('写入已中止');
      },
      manage(kind: 'writers' | 'handles', cancel: () => void | Promise<void>) {
        operations.add(cancel);
        return () => operations.delete(cancel);
      },
    };
    return {
      get state() {
        return state;
      },
      abort,
      write(bytes: Uint8Array) {
        if (state !== 'open') throw Error('写入流已关闭');
        chunks.push(bytes.slice());
      },
      async commit() {
        if (state !== 'open') throw Error('写入流已关闭');
        state = 'committing';
        try {
          await driver.replace(parts, chunks, scope);
          state = 'committed';
        } catch (e) {
          if ((state as WriteState) !== 'aborted') state = 'failed';
          throw e;
        } finally {
          chunks.length = 0;
          release();
        }
      },
    };
  }
}
