import type { Deployment } from '../contracts';
let topology: Deployment = { mode: 'single-trusted' };
export const deployment = () => topology;
export function configureDeployment(config: Deployment) {
  topology = config;
}
export function appOrigin(id: string) {
  if (topology.mode === 'single-trusted') return location.origin;
  const url = new URL(topology.bridge.originFor(id));
  if (url.protocol !== 'https:' || url.origin === location.origin) throw new Error('应用需要独立 HTTPS 源');
  return url.origin;
}
export function versionUrl(id: string, hash: string, path: string) {
  return (
    appOrigin(id) + '/wow/apps/' + id + '/v/' + hash + '/' + path.split('/').map(encodeURIComponent).join('/')
  );
}
export async function activateVhost(id: string) {
  if (topology.mode === 'isolated') return topology.bridge.activate(id);
  if (!navigator.serviceWorker) throw new Error('WOW 应用需要安全上下文和 Service Worker 支持');
  const scope = '/wow/apps/';
  const existing = await navigator.serviceWorker.getRegistration(scope);
  if (
    existing?.scope === location.origin + scope &&
    existing.active?.scriptURL === location.origin + '/wow/sw.js'
  )
    return;
  const registration = await navigator.serviceWorker.register('/wow/sw.js', { scope });
  const worker = registration.active ?? registration.installing ?? registration.waiting;
  if (!worker) throw new Error('应用服务未启动');
  await new Promise<void>((resolve, reject) => {
    function check() {
      if (worker!.state !== 'activated' && worker!.state !== 'redundant') return;
      worker!.removeEventListener('statechange', check);
      if (worker!.state === 'activated') resolve();
      else reject(new Error('应用服务激活失败'));
    }
    worker.addEventListener('statechange', check);
    check();
  });
}
