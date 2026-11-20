import type { Capability, CleanupReport, ViewIdentity } from '../contracts';
import { createRuntimeResources } from '../hal/runtime-primitives';
import { uniqueId } from '../hal/platform';
import { ViewFocus } from './view-focus';

export function createProcessManager(releaseInput: (wid: number, reason: string) => void) {
  const resources = createRuntimeResources();
  const focus = new ViewFocus(releaseInput);
  const processes = new Map<
    number,
    {
      appId: string;
      version?: string;
      keepAlive: boolean;
      views: Set<number>;
      grants: Set<Capability>;
      cleanup: Set<() => void>;
      scope: ReturnType<typeof resources.attach>;
    }
  >();
  let nextPid = 1000;
  function requireProcess(pid: number) {
    const process = processes.get(pid);
    if (!process) throw Object.assign(Error('进程已退出'), { code: 'REVOKED' });
    return process;
  }
  function spawn(appId: string, grants: readonly Capability[] = [], keepAlive = false, version?: string) {
    const pid = ++nextPid;
    processes.set(pid, {
      appId,
      version,
      grants: new Set(grants),
      keepAlive,
      views: new Set(),
      cleanup: new Set(),
      scope: resources.attach(pid),
    });
    return pid;
  }
  function openView(pid: number): ViewIdentity {
    const p = requireProcess(pid);
    const instanceId = uniqueId();
    const wid = focus.create(pid, instanceId);
    p.views.add(wid);
    return { pid, wid, instanceId };
  }
  function terminate(pid: number): Promise<CleanupReport> {
    const p = requireProcess(pid);
    processes.delete(pid);
    p.grants.clear();
    const ports = p.cleanup.size;
    const failures: string[] = [];
    for (const wid of p.views) {
      try {
        focus.disconnect(wid);
      } catch (e) {
        failures.push(String(e));
      }
    }
    for (const close of p.cleanup) {
      try {
        close();
      } catch (e) {
        failures.push(String(e));
      }
    }
    return resources
      .detach(pid)
      .then((report) => ({ ...report, pid, ports, failures: [...failures, ...report.failures] }));
  }
  function closeView(wid: number) {
    const owner = focus.get(wid);
    if (!owner) return;
    const p = requireProcess(owner.pid);
    focus.disconnect(wid);
    p.views.delete(wid);
    if (!p.keepAlive && p.views.size === 0) return terminate(owner.pid);
  }
  return {
    spawn,
    openView,
    closeView,
    terminate,
    focus,
    snapshot: resources.snapshot,
    list: () =>
      Array.from(processes, ([pid, p]) => ({ pid, appId: p.appId, version: p.version, views: [...p.views] })),
    scope: (pid: number) => requireProcess(pid).scope,
    allows: (pid: number, cap: Capability) => processes.get(pid)?.grants.has(cap) ?? false,
    ownPort(pid: number, close: () => void) {
      const p = requireProcess(pid);
      p.cleanup.add(close);
      return () => p.cleanup.delete(close);
    },
  };
}
