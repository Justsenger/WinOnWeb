export const createChannel = () => new MessageChannel();
export const uniqueId = () => crypto.randomUUID();
export async function sha256(data: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export const isHostFullscreen = () => Boolean(document.fullscreenElement);
export async function toggleHostFullscreen(root: HTMLElement) {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await (document.documentElement.requestFullscreen?.() ?? root.requestFullscreen?.());
}
export function observeInputRelease(release: (reason: string) => void) {
  const blur = () => release('blur');
  const unlock = () => {
    if (!document.pointerLockElement) release('unlock');
  };
  const hidden = () => {
    if (document.visibilityState === 'hidden') release('hidden');
  };
  window.addEventListener('blur', blur);
  document.addEventListener('pointerlockchange', unlock);
  document.addEventListener('visibilitychange', hidden);
  return () => {
    window.removeEventListener('blur', blur);
    document.removeEventListener('pointerlockchange', unlock);
    document.removeEventListener('visibilitychange', hidden);
  };
}
