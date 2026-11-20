// Run on a disposable localhost origin using Vite. Exercises the actual Worker, stores and SW.
import { zipSync, strToU8 } from 'fflate';
import {
  acquireVersion,
  decideGrant,
  installPackage,
  recoverPackages,
  removePackage,
} from '../src/wow/kernel/package-security';
import { createProcessManager } from '../src/wow/kernel/process';
import { getRecord, putRecord, records, readContent } from '../src/wow/hal/storage';
import { sha256 } from '../src/wow/hal/platform';
import { versionUrl } from '../src/wow/hal/vhost';
import type { InstalledPackage, VersionRecord } from '../src/wow/contracts';

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw Error(message);
}
export async function verifyPackageLifecycle() {
  const declared = 'qa-' + crypto.randomUUID();
  const installed = new Set<string>();
  const id = 'official-' + declared;
  installed.add(id);
  function fixture(label: string, permissions: string[] = [], entry = 'index.html') {
    return zipSync({
      'manifest.json': strToU8(
        JSON.stringify({ id: declared, name: 'WOW QA', format: 1, entry, permissions }),
      ),
      'index.html': strToU8('<!doctype html><title>' + label + '</title><body>' + label + '</body>'),
      'bytes.bin': Uint8Array.of(0, 1, 2, 3, 255),
    }).slice().buffer;
  }
  async function official(bytes: ArrayBuffer) {
    return installPackage(bytes, { kind: 'catalog', id: declared, sha256: await sha256(bytes) });
  }
  const log: string[] = [];
  let release: (() => void) | undefined;
  try {
    const initial = await official(fixture('one'));
    const invalid = fixture('corrupt');
    new DataView(invalid).setUint16(invalid.byteLength - 12, 20000, true);
    let refused = false;
    try {
      await official(invalid);
    } catch {
      refused = true;
    }
    assert(refused, 'entry limit was ignored');
    const sameName = await Promise.all(
      [1, 2].map(async () => {
        const item = await installPackage(fixture('one'), { kind: 'sideload', trusted: true });
        installed.add(item.id);
        return item;
      }),
    );
    assert(new Set([id, ...sameName.map((p) => p.id)]).size === 3, 'installation identity collision');
    await decideGrant(sameName[0].id, 'notifications', 'granted');
    assert(!(await getRecord('grants', sameName[1].id)), 'sideload inherited grants');
    log.push('independent installation identities and grants');
    await decideGrant(id, 'virtual-fs', 'granted');
    release = await acquireVersion(id, initial.versionHash);
    const next = await official(fixture('two', ['notifications']));
    assert(
      next.versionHash !== initial.versionHash && !(await getRecord('grants', id)),
      'upgrade must renew grants',
    );
    const version = await getRecord<VersionRecord>('versions', [id, initial.versionHash]);
    assert(
      version && (await (await readContent(version, 'index.html')).text()).includes('one'),
      'old pinned version changed',
    );
    const oldUrl = versionUrl(id, initial.versionHash, 'index.html');
    const frame = document.createElement('iframe');
    try {
      await new Promise<void>((resolve, reject) => {
        frame.onload = () => resolve();
        frame.onerror = () => reject(Error('iframe failed'));
        frame.src = oldUrl;
        document.body.append(frame);
      });
      assert(frame.contentDocument?.title === 'one', 'old document navigated to new version');
      const guest = frame.contentWindow as Window & typeof globalThis;
      const response = await guest.fetch(new URL('bytes.bin', oldUrl), { headers: { Range: 'bytes=-2' } });
      assert(
        response.status === 206 && String(new Uint8Array(await response.arrayBuffer())) === '3,255',
        'incorrect byte range',
      );
    } finally {
      frame.remove();
    }
    release();
    release = undefined;
    await recoverPackages();
    assert(!(await getRecord('versions', [id, initial.versionHash])), 'unreferenced version leaked');
    log.push('atomic upgrade, old view pin, byte range, grant reset and GC');
    let rejected = false;
    try {
      await official(fixture('broken', [], 'missing.html'));
    } catch {
      rejected = true;
    }
    assert(
      rejected && (await getRecord<InstalledPackage>('apps', id))?.versionHash === next.versionHash,
      'failed install changed active version',
    );
    const interrupted: VersionRecord = { id, versionHash: '0'.repeat(64), backend: 'idb', state: 'staging' };
    await putRecord('versions', [id, interrupted.versionHash], interrupted);
    await recoverPackages();
    assert(
      !(await records<VersionRecord>('versions')).some((v) => v.id === id && v.state === 'staging'),
      'staging leak',
    );
    log.push('validation rollback and recovery of interrupted staging');
    const input: number[] = [];
    const pm = createProcessManager((wid) => input.push(wid));
    const pid = pm.spawn('qa', ['virtual-fs'], true);
    const a = pm.openView(pid),
      b = pm.openView(pid);
    pm.focus.focus(a.wid);
    pm.focus.focus(b.wid);
    pm.closeView(a.wid);
    pm.closeView(b.wid);
    assert(
      input.join() === a.wid + ',' + b.wid && pm.list()[0].views.length === 0,
      'focus / background ownership',
    );
    const scope = pm.scope(pid);
    let ports = 0,
      writers = 0,
      handles = 0;
    pm.ownPort(pid, () => ports++);
    scope.manage('writers', () => {
      writers++;
    });
    scope.manage('handles', () => {
      handles++;
    });
    const report = await pm.terminate(pid);
    assert(
      !pm.allows(pid, 'virtual-fs') &&
        ports === 1 &&
        writers === 1 &&
        handles === 1 &&
        report.ports === 1 &&
        !report.failures.length,
      'termination leak',
    );
    log.push('two views sharing a PID, input release, background survival and termination report');
    return { backend: version.backend, log };
  } finally {
    release?.();
    for (const appId of installed) await removePackage(appId);
  }
}
