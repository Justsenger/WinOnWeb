import type { PickedFileResult } from '../types';

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
    guest?: GuestSnapshot;
  };
  const scopes = new Map<number, Scope>();

  function attach(pid: number) {
    const workers = new Set<Worker>();
    const files = new Set<RuntimeFileHandle>();
    if (scopes.has(pid)) throw new Error('PID already attached: ' + pid);
    const writers = new Set<FileSystemWritableFileStream>();
    const scope: Scope = { workers, files, writers };
    scopes.set(pid, scope);
    function assertLive() {
      if (scopes.get(pid) !== scope) throw new DOMException('Application has exited', 'InvalidStateError');
    }
    return {
      observeGuest(read: GuestSnapshot) {
        assertLive();
        scope.guest = read;
      },
      startWorker(entry: URL): Worker {
        assertLive();
        // Static module imports install the exit hook before any application code runs.
        const exitHook = new URL('/wow-worker-lifecycle.js', location.origin).href;
        const bootstrap = 'import ' + JSON.stringify(exitHook) + ';\nimport ' + JSON.stringify(entry.href) + ';';
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
        worker.addEventListener('message', event => {
          if (event.data?.type === 'wow-runtime:worker-exit') {
            event.stopImmediatePropagation();
            worker.terminate();
          }
        });
        worker.addEventListener('error', () => worker.terminate());
        return worker;
      },
      async writeFile(file: FileSystemFileHandle, data: File | string) {
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
  function detach(pid: number) {
    const scope = scopes.get(pid);
    if (!scope) return;
    scopes.delete(pid);
    for (const worker of scope.workers) worker.terminate();
    for (const writer of scope.writers) void writer.abort().catch(() => {});
    for (const file of scope.files) file.close();
  }
  function snapshot() {
    let threadCount = 1;
    let handleCount = activeWriters.size;
    for (const scope of scopes.values()) {
      const guest = scope.guest?.();
      threadCount += scope.workers.size + (guest?.workers ?? 0);
      handleCount += scope.files.size + (guest?.handles ?? 0);
    }
    return { threadCount, handleCount };
  }
  return { attach, detach, snapshot };
}
export type RuntimeScope = ReturnType<ReturnType<typeof createRuntimeResources>['attach']>;
