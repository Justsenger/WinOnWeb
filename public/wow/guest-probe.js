// This shim runs before scripts in a locally installed WOW document or worker.
function installWowGuestResources() {
  const key = Symbol.for('wow.guest-probe.v1');
  if (self[key]) return;
  if (typeof document !== 'undefined') {
    const path = location.pathname.split('/');
    const appId = path[1] === 'wow' && path[2] === 'apps' ? path[3] : 'standalone:' + location.pathname;
    const prefix = 'wow:kv:guest:' + appId + ':';
    const nativeKv = window.localStorage;
    const kv = {
      getItem: (key) => nativeKv.getItem(prefix + key),
      setItem: (key, value) => nativeKv.setItem(prefix + key, value),
      removeItem: (key) => nativeKv.removeItem(prefix + key),
      key: (index) =>
        Object.keys(nativeKv)
          .filter((key) => key.startsWith(prefix))
          [index]?.slice(prefix.length) ?? null,
      clear: () => {
        for (const key of Object.keys(nativeKv)) if (key.startsWith(prefix)) nativeKv.removeItem(key);
      },
      get length() {
        return Object.keys(nativeKv).filter((key) => key.startsWith(prefix)).length;
      },
    };
    Object.defineProperty(window, 'wowStorage', {
      value: {
        kv,
        openDatabase(name, stores) {
          return new Promise((resolve, reject) => {
            const req = indexedDB.open('wow:db:guest:' + appId + ':' + name, 1);
            req.onupgradeneeded = () => {
              for (const store of stores) req.result.createObjectStore(store);
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
        },
      },
    });
    if (path[1] === 'wow' && path[2] === 'apps') {
      Object.defineProperty(window, 'localStorage', {
        value: new Proxy(kv, {
          get: (target, key) =>
            Reflect.has(target, key)
              ? Reflect.get(target, key)
              : typeof key === 'string'
                ? (kv.getItem(key) ?? undefined)
                : undefined,
          set: (_, key, value) => {
            kv.setItem(String(key), value);
            return true;
          },
          deleteProperty: (_, key) => {
            kv.removeItem(String(key));
            return true;
          },
        }),
      });
    }
    const held = new Map();
    const pointers = new Map();
    addEventListener(
      'pointerdown',
      (e) => pointers.set(e.pointerId, { target: e.target, id: e.pointerId, kind: e.pointerType }),
      true,
    );
    for (const name of ['pointerup', 'pointercancel'])
      addEventListener(name, (e) => pointers.delete(e.pointerId), true);
    addEventListener('keydown', (e) => held.set(e.code, { key: e.key, code: e.code }), true);
    addEventListener('keyup', (e) => held.delete(e.code), true);
    const release = () => {
      const target = document.activeElement ?? document;
      for (const key of held.values())
        target.dispatchEvent(new KeyboardEvent('keyup', { ...key, bubbles: true }));
      held.clear();
      for (const p of pointers.values())
        p.target?.dispatchEvent(
          new PointerEvent('pointercancel', { pointerId: p.id, pointerType: p.kind, bubbles: true }),
        );
      pointers.clear();
      dispatchEvent(new Event('wow-input-release'));
    };
    addEventListener('blur', release);
    addEventListener('pagehide', release);
    document.addEventListener('fullscreenchange', () =>
      dispatchEvent(new Event('wow-window-fullscreen-change')),
    );
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement) release();
    });
    addEventListener('message', (e) => {
      if (e.source !== parent || e.data?.protocol !== 'wow/v1') return;
      if (e.data.type === 'probe-connect' && e.ports[0]) {
        const monitor = e.ports[0];
        monitor.onmessage = ({ data }) => {
          if (data === 'sample') monitor.postMessage(snapshot());
        };
        addEventListener('pagehide', () => monitor.close(), { once: true });
      }
      if (e.data.type === 'release-input') release();
      if (e.data.type === 'probe-fullscreen') {
        self.wowViewFullscreen = e.data.active === true;
        dispatchEvent(new Event('wow-window-fullscreen-change'));
      }
    });
  }
  const tag = 'wow:resource-port:v1';
  const children = new Map();
  const localFiles = new Set();
  let port;
  let queued = false;

  function snapshot() {
    let workers = children.size;
    let handles = localFiles.size;
    for (const child of children.values()) {
      workers += child.workers;
      handles += child.handles;
    }
    return { workers, handles };
  }

  function changed() {
    if (!port || queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      port?.postMessage(snapshot());
    });
  }
  function retain() {
    const token = {};
    localFiles.add(token);
    changed();
    return () => {
      if (localFiles.delete(token)) changed();
    };
  }

  // WasmFS gives FileSystemFileHandle and read-only Blob references explicit slot lifetimes.
  // Native sync access handles and writable streams are counted at their own APIs below.
  function watchFileTable(table) {
    const slots = new Map();
    const allocate = table.allocate;
    const free = table.free;
    table.allocate = function (...args) {
      const slot = allocate.apply(this, args);
      slots.set(slot, retain());
      return slot;
    };
    table.free = function (slot) {
      const result = free.call(this, slot);
      slots.get(slot)?.();
      slots.delete(slot);
      return result;
    };
    return table;
  }
  Object.defineProperty(self, key, { value: { snapshot, watchFileTable } });

  if (typeof document === 'undefined' && typeof self.postMessage === 'function') {
    self.addEventListener(
      'message',
      (event) => {
        if (event.data !== tag || !event.ports[0]) return;
        event.stopImmediatePropagation();
        port = event.ports[0];
        port.postMessage(snapshot());
      },
      true,
    );
    const close = self.close.bind(self);
    self.close = () => {
      self.postMessage({ type: tag, exit: true });
      close();
    };
    self.postMessage({ type: tag });
  }

  const NativeWorker = self.Worker;
  if (NativeWorker) {
    self.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        const state = { workers: 0, handles: 0, port: null };
        children.set(this, state);
        changed();
        this.addEventListener(
          'message',
          (event) => {
            if (event.data?.type !== tag) return;
            event.stopImmediatePropagation();
            if (event.data.exit) {
              this.terminate();
              return;
            }
            if (state.port || !children.has(this)) return;
            const channel = new MessageChannel();
            state.port = channel.port1;
            channel.port1.onmessage = ({ data }) => {
              if (!children.has(this)) return;
              if (
                !Number.isSafeInteger(data?.workers) ||
                data.workers < 0 ||
                !Number.isSafeInteger(data?.handles) ||
                data.handles < 0
              )
                return;
              state.workers = data.workers;
              state.handles = data.handles;
              changed();
            };
            this.postMessage(tag, [channel.port2]);
          },
          true,
        );
      }
      terminate() {
        const result = super.terminate();
        children.get(this)?.port?.close();
        if (children.delete(this)) changed();
        return result;
      }
    };
  }

  const prototype = self.FileSystemFileHandle?.prototype;
  for (const [method, endings] of [
    ['createSyncAccessHandle', ['close']],
    ['createWritable', ['close', 'abort']],
  ]) {
    const open = prototype?.[method];
    if (!open) continue;
    // Preserve function.length: WasmFS uses it to select the browser's access mode.
    prototype[method] = new Proxy(open, {
      async apply(target, receiver, args) {
        const handle = await Reflect.apply(target, receiver, args);
        const release = retain();
        function watchClose(object, name) {
          const original = object[name];
          if (typeof original !== 'function') return;
          object[name] = function (...params) {
            const result = original.apply(this, params);
            if (result?.then)
              return result.then((value) => {
                release();
                return value;
              });
            release();
            return result;
          };
        }
        for (const name of endings) watchClose(handle, name);
        if (handle.getWriter) {
          const getWriter = handle.getWriter;
          handle.getWriter = function () {
            const writer = getWriter.call(this);
            // Releasing a writer lock can reject closed while the file stays open.
            writer.closed.then(release, () => {});
            watchClose(writer, 'abort');
            return writer;
          };
        }
        return handle;
      },
    });
  }
}

if (typeof document !== 'undefined') installWowGuestResources();
