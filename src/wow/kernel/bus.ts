export interface Endpoint<Cancel = unknown> {
  message(channel: string, payload: unknown, from?: string): void;
  call(method: string, payload: unknown, from: string, cancel?: Cancel): unknown;
}
export class ControlBus<Cancel = unknown> {
  private routes = new Map<string, Endpoint<Cancel>>();
  bind(instanceId: string, endpoint: Endpoint<Cancel>) {
    if (this.routes.has(instanceId)) throw Error('实例已绑定');
    this.routes.set(instanceId, endpoint);
    return () => this.routes.delete(instanceId);
  }
  route(instanceId: string) {
    const endpoint = this.routes.get(instanceId);
    if (!endpoint) throw Object.assign(Error('目标实例已退出'), { code: 'NOT_FOUND' });
    return endpoint;
  }
}
