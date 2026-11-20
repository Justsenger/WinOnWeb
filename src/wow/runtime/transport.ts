import { WOW_PROTOCOL, MAX_PENDING, ERROR } from '../contracts';
import type { WireBody } from '../contracts/wire';
export const fault = (code: string, message: string) => Object.assign(new Error(message), { code });
type Handler = (
  method: string,
  params: unknown,
  ports: readonly MessagePort[],
  signal: AbortSignal,
) => unknown;
export function connectPort(
  port: MessagePort,
  handle: Handler,
  event: (name: string, value: unknown, ports: readonly MessagePort[]) => void,
  disconnected = () => {},
) {
  const outgoing = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const incoming = new Map<string, AbortController>();
  let sequence = 0,
    lastRequest = 0,
    closed = false;
  function send(msg: WireBody, transfer: Transferable[] = []) {
    if (closed) throw fault(ERROR.revoked, '端口已吊销');
    port.postMessage({ ...msg, protocol: WOW_PROTOCOL }, transfer);
  }
  function close() {
    if (closed) return;
    try {
      send({ type: 'disconnect' });
    } finally {
      closed = true;
      port.close();
      for (const request of incoming.values()) request.abort();
      for (const request of outgoing.values()) request.reject(fault(ERROR.revoked, '实例已断开'));
      outgoing.clear();
      incoming.clear();
      disconnected();
    }
  }
  port.onmessageerror = close;
  port.onmessage = async ({ data, ports }) => {
    if (closed || data?.protocol !== WOW_PROTOCOL) return;
    if (data.type === 'disconnect') {
      close();
      return;
    }
    if (data.type === 'event') {
      event(data.name, data.value, ports);
      return;
    }
    if (typeof data.id !== 'string' || data.id.length > 20) return;
    if (data.type === 'response') {
      const call = outgoing.get(data.id);
      if (data.ok === true) call?.resolve(data.value);
      else call?.reject(fault(data.error?.code ?? ERROR.failed, String(data.error?.message)));
      return;
    }
    if (data.type === 'cancel') {
      incoming.get(data.id)?.abort();
      return;
    }
    if (data.type !== 'request') return;
    const seq = Number(data.id);
    if (!Number.isSafeInteger(seq) || seq <= lastRequest || String(seq) !== data.id) return;
    lastRequest = seq;
    const controller = new AbortController();
    try {
      if (incoming.size >= MAX_PENDING) throw fault(ERROR.busy, '请求队列已满');
      incoming.set(data.id, controller);
      const result = await handle(data.method, data.params, ports, controller.signal);
      if (!controller.signal.aborted && !closed)
        send({ type: 'response', id: data.id, ok: true, value: result });
    } catch (err) {
      if (!closed && !controller.signal.aborted)
        send({
          type: 'response',
          id: data.id,
          ok: false,
          error: {
            code: (err as { code?: string })?.code ?? ERROR.failed,
            message: String(err instanceof Error ? err.message : err),
          },
        });
    } finally {
      incoming.delete(data.id);
    }
  };
  return {
    close,
    event: (name: string, value: unknown, transfer?: Transferable[]) =>
      send({ type: 'event', name, value }, transfer),
    request<T>(
      method: string,
      params: unknown = {},
      opts: { timeout?: number; signal?: AbortSignal; transfer?: Transferable[] } = {},
    ) {
      if (closed || outgoing.size >= MAX_PENDING)
        return Promise.reject(fault(closed ? ERROR.revoked : ERROR.busy, '端口不可用或队列已满'));
      const id = String(++sequence);
      const signal = opts.signal;
      let timer: ReturnType<typeof setTimeout>;
      function cancel(code: string) {
        outgoing.get(id)?.reject(fault(code, '请求已取消或超时'));
        if (!closed) send({ type: 'cancel', id });
      }
      const abort = () => cancel(ERROR.cancelled);
      return new Promise<T>((resolve, reject) => {
        if (signal?.aborted) {
          reject(fault(ERROR.cancelled, '请求已取消'));
          return;
        }
        outgoing.set(id, { resolve: (value) => resolve(value as T), reject });
        timer = setTimeout(() => cancel(ERROR.timeout), opts.timeout ?? 30000);
        signal?.addEventListener('abort', abort, { once: true });
        send({ type: 'request', id, method, params }, opts.transfer);
      }).finally(() => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        outgoing.delete(id);
      });
    },
  };
}
export type Peer = ReturnType<typeof connectPort>;
