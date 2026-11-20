import { MAX_PENDING, WOW_PROTOCOL, type Capability, type HardwareSummary } from '../contracts';
import type { BootInfo } from '../contracts/wire';
import { activateVhost } from '../hal/vhost';
import { createChannel, uniqueId } from '../hal/platform';
import { acquireVersion } from '../kernel/package-security';
import { syscallProxy, type Syscalls } from './syscall-proxy';
import { connectPort, type Peer } from './transport';

export interface FrameOptions {
  container: HTMLElement;
  entryUrl: string;
  title: string;
  className?: string;
  allow?: string;
  sandbox?: string;
  boot: () => BootInfo;
  authorize: (cap: Capability) => Promise<boolean>;
  methods: Syscalls;
  packageVersion?: string;
  requiresIsolation?: boolean;
  singleThreadUrl?: string;
  passQuery?: boolean;
  observeGuest: (read: () => { workers: number; handles: number } | undefined) => () => void;
  ownPort: (close: () => void) => () => void;
  releaseInput: () => void;
  setFullscreen?: (active: boolean) => void;
}
export function mountIframeApp(options: FrameOptions) {
  const boot = options.boot(),
    { instanceId, appId } = boot;
  const url = new URL(options.entryUrl, location.href);
  if (!['https:', 'http:'].includes(url.protocol)) throw Error('无效应用网址');
  const origin = url.origin;
  const frame = document.createElement('iframe');
  frame.className = options.className ?? '';
  frame.title = options.title;
  frame.allow = options.allow ?? '';
  if (options.sandbox !== undefined) frame.setAttribute('sandbox', options.sandbox);
  let peer: Peer | undefined,
    generation = '',
    release: (() => void) | undefined,
    dead = false;
  const pending: { channel: string; payload: unknown; from?: string }[] = [];
  let probe: MessagePort | undefined,
    sampled: { workers: number; handles: number } | undefined,
    sampling = false;
  function closeProbe() {
    probe?.close();
    probe = undefined;
    sampled = undefined;
    sampling = false;
  }
  function drop() {
    if (peer) {
      peer.event('inputRelease', 'disconnect');
      peer.close();
      peer = undefined;
    }
    pending.length = 0;
  }
  function challenge() {
    if (generation && !peer)
      frame.contentWindow?.postMessage(
        { protocol: WOW_PROTOCOL, type: 'challenge', instanceId, generation },
        origin,
      );
  }
  function load() {
    closeProbe();
    if (options.packageVersion && origin !== location.origin) {
      const channel = createChannel();
      probe = channel.port1;
      channel.port1.onmessage = ({ data }) => {
        sampling = false;
        if (
          Number.isSafeInteger(data?.workers) &&
          data.workers >= 0 &&
          Number.isSafeInteger(data?.handles) &&
          data.handles >= 0
        )
          sampled = data;
      };
      frame.contentWindow?.postMessage({ protocol: WOW_PROTOCOL, type: 'probe-connect' }, origin, [
        channel.port2,
      ]);
    }
    if (generation || peer) drop();
    generation = uniqueId();
    challenge();
  }
  function hello(e: MessageEvent) {
    if (dead || e.source !== frame.contentWindow || e.origin !== origin || e.data?.protocol !== WOW_PROTOCOL)
      return;
    const d = e.data;
    if (d.type === 'knock') {
      challenge();
      return;
    }
    if (
      peer ||
      !generation ||
      d.type !== 'hello' ||
      d.instanceId !== instanceId ||
      d.generation !== generation ||
      typeof d.documentId !== 'string'
    )
      return;
    const channel = createChannel();
    const current = generation;
    let releasePort: (() => void) | undefined;
    peer = connectPort(
      channel.port1,
      syscallProxy(options.methods, options.authorize),
      () => {},
      () => {
        releasePort?.();
        if (current === generation) {
          peer = undefined;
          generation = '';
          options.releaseInput();
        }
      },
    );
    releasePort = options.ownPort(peer.close);
    frame.contentWindow!.postMessage(
      { protocol: WOW_PROTOCOL, type: 'connected', instanceId, generation, documentId: d.documentId },
      origin,
      [channel.port2],
    );
    peer.event('init', options.boot());
    for (const msg of pending.splice(0)) peer.event('message', msg);
  }
  function setFullscreen(active: boolean) {
    frame.toggleAttribute('data-wow-fullscreen', active);
    peer?.event('fullscreen', active);
    if (options.packageVersion)
      frame.contentWindow?.postMessage({ protocol: WOW_PROTOCOL, type: 'probe-fullscreen', active }, origin);
  }
  frame.addEventListener('wow-window-fullscreen', (event) =>
    options.setFullscreen?.((event as CustomEvent).detail === true),
  );
  frame.addEventListener('load', load);
  window.addEventListener('message', hello);
  const stopProbe = options.observeGuest(() => {
    if (probe) {
      if (!sampling) {
        sampling = true;
        probe.postMessage('sample');
      }
      return sampled;
    }
    try {
      const guest = frame.contentWindow as
        (Window & Record<symbol, { snapshot: () => { workers: number; handles: number } }>) | null;
      return guest?.[Symbol.for('wow.guest-probe.v1')]?.snapshot();
    } catch {
      return undefined;
    }
  });
  async function navigate() {
    if (options.packageVersion) {
      release = await acquireVersion(appId, options.packageVersion);
      if (dead) {
        release();
        return;
      }
      await activateVhost(appId);
    }
    if (dead) return;
    if (options.passQuery && origin === location.origin) {
      for (const key of ['theme', 'volume', 'pid', 'appId'] as const)
        url.searchParams.set(key, String(boot[key]));
    }
    if (options.requiresIsolation) {
      url.searchParams.set('__wow_compute', '1');
      if (options.singleThreadUrl) url.searchParams.set('__wow_fallback', options.singleThreadUrl);
    }
    frame.src = url.href;
    options.container.replaceChildren(frame);
    if (!options.packageVersion && origin !== location.origin) {
      const link = document.createElement('a');
      link.href = url.href;
      link.dataset.wowOpenExternal = '';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = '在新标签页打开';
      options.container.append(link);
    }
  }
  void navigate().catch((error) => {
    release?.();
    release = undefined;
    if (!dead) options.container.textContent = String(error);
  });
  return {
    onThemeChange: (theme: string) => peer?.event('theme', theme),
    onVolumeChange: (volume: number) => peer?.event('volume', volume),
    onFocusChange: (focused: boolean) => peer?.event('focus', focused),
    onVisibilityChange: (minimized: boolean) => peer?.event('visibility', minimized),
    onHardwareUpdate: (hardware: HardwareSummary) => peer?.event('hardware', hardware),
    onFullscreenChange: setFullscreen,
    onInputRelease: (reason: string) => {
      peer?.event('inputRelease', reason);
      frame.contentWindow?.postMessage({ protocol: WOW_PROTOCOL, type: 'release-input' }, origin);
    },
    onMessage: (channel: string, payload: unknown, from?: string) => {
      if (peer) peer.event('message', { channel, payload, from });
      else if (!dead && pending.length < MAX_PENDING) pending.push({ channel, payload, from });
      else throw Error('实例消息队列已满');
    },
    onAppRequest: (method: string, payload: unknown, from: string, signal?: AbortSignal) => {
      if (!peer) throw Error('实例尚未完成握手');
      return peer.request('app.invoke', { method, payload, from }, { signal });
    },
    onDataPort: (port: MessagePort, from: string) => {
      if (!peer) throw Error('目标实例尚未就绪');
      peer.event('data', { from }, [port]);
    },
    destroy() {
      if (dead) return;
      dead = true;
      stopProbe();
      closeProbe();
      drop();
      release?.();
      release = undefined;
      window.removeEventListener('message', hello);
      frame.removeEventListener('load', load);
      frame.remove();
    },
  };
}
