import type { FileResult as PickedFileResult } from '../contracts';

export interface RuntimeFileHandle {
  read(): Promise<PickedFileResult>;
  close(): void;
}

// One instance per desktop. Built-in windows share the desktop's main JS thread.
export function createRuntimeResources() {
  const activeWriters = new Set<FileSystemWritableFileStream>();
  type GuestSnapshot = () => { workers: number; handles: number } | undefined;
  type Scope = {
    workers: Set<Worker>;
    files: Set<RuntimeFileHandle>;
    writers: Set<FileSystemWritableFileStream>;
    guests: Set<GuestSnapshot>;
    owned: { writers: Set<() => void | Promise<void>>; handles: Set<() => void | Promise<void>> };
  };
  const scopes = new Map<number, Scope>();

  function attach(pid: number) {
    const workers = new Set<Worker>();
    const files = new Set<RuntimeFileHandle>();
    if (scopes.has(pid)) throw new Error('PID already attached: ' + pid);
    const writers = new Set<FileSystemWritableFileStream>();
    const scope: Scope = {
      workers,
      files,
      writers,
      guests: new Set(),
      owned: { writers: new Set(), handles: new Set() },
    };
    scopes.set(pid, scope);
    function assertLive() {
      if (scopes.get(pid) !== scope) throw new DOMException('Application has exited', 'InvalidStateError');
    }
    return {
      pid,
      assertLive,
      manage(kind: 'writers' | 'handles', close: () => void | Promise<void>) {
        assertLive();
        scope.owned[kind].add(close);
        return () => scope.owned[kind].delete(close);
      },
      observeGuest(read: GuestSnapshot) {
        assertLive();
        scope.guests.add(read);
        return () => scope.guests.delete(read);
      },
      startWorker(entry: URL): Worker {
        assertLive();
        // Static module imports install the exit hook before any application code runs.
        const exitHook = new URL('/wow/worker-lifecycle.js', location.origin).href;
        const bootstrap =
          'import ' + JSON.stringify(exitHook) + ';\nimport ' + JSON.stringify(entry.href) + ';';
        const url = URL.createObjectURL(new Blob([bootstrap], { type: 'text/javascript' }));
        let worker: Worker;
        try {
          worker = new Worker(url, { type: 'module' });
        } catch (error) {
          URL.revokeObjectURL(url);
          throw error;
        }
        workers.add(worker);
        const terminate = worker.terminate.bind(worker);
        worker.terminate = () => {
          if (!workers.delete(worker)) return;
          terminate();
          URL.revokeObjectURL(url);
        };
        worker.addEventListener('message', (event) => {
          if (event.data?.type === 'wow-runtime:worker-exit') {
            event.stopImmediatePropagation();
            worker.terminate();
          }
        });
        worker.addEventListener('error', () => worker.terminate());
        return worker;
      },
      async writeFile(file: FileSystemFileHandle, data: Blob | string) {
        assertLive();
        const writer = await file.createWritable();
        activeWriters.add(writer);
        writers.add(writer);
        try {
          // The application may have exited while the native writer was opening.
          assertLive();
          await writer.write(data);
          assertLive();
          await writer.close();
        } catch (error) {
          await writer.abort().catch(() => {});
          throw error;
        } finally {
          writers.delete(writer);
          activeWriters.delete(writer);
        }
      },
      openFile(readFile: () => Promise<PickedFileResult>): RuntimeFileHandle {
        assertLive();
        let reader: typeof readFile | null = readFile;
        const handle = {
          read() {
            if (!reader) throw new DOMException('File handle is closed', 'InvalidStateError');
            return reader();
          },
          close() {
            reader = null;
            files.delete(handle);
          },
        };
        files.add(handle);
        return handle;
      },
    };
  }
  async function detach(pid: number) {
    const scope = scopes.get(pid);
    scopes.delete(pid);
    const report = {
      workers: scope?.workers.size ?? 0,
      writers: scope?.writers.size ?? 0,
      handles: scope?.files.size ?? 0,
      failures: [] as string[],
    };
    if (!scope) return report;
    const pending: Promise<void>[] = [];
    function clean(action: () => void | Promise<void>) {
      try {
        pending.push(
          Promise.resolve(action()).catch((e) => {
            report.failures.push(String(e));
          }),
        );
      } catch (e) {
        report.failures.push(String(e));
      }
    }
    for (const worker of scope.workers) clean(() => worker.terminate());
    for (const writer of scope.writers) clean(() => writer.abort());
    for (const kind of ['writers', 'handles'] as const) {
      report[kind] += scope.owned[kind].size;
      for (const close of scope.owned[kind]) clean(close);
    }
    for (const file of scope.files) clean(() => file.close());
    await Promise.all(pending);
    return report;
  }
  function snapshot() {
    let threadCount = 1;
    let handleCount = activeWriters.size;
    for (const scope of scopes.values()) {
      threadCount += scope.workers.size;
      handleCount += scope.files.size + scope.owned.handles.size;
      for (const read of scope.guests) {
        const guest = read();
        threadCount += guest?.workers ?? 0;
        handleCount += guest?.handles ?? 0;
      }
    }
    return { threadCount, handleCount };
  }
  return { attach, detach, snapshot };
}
export type RuntimeScope = ReturnType<ReturnType<typeof createRuntimeResources>['attach']>;
