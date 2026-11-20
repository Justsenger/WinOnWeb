import type { ShellState } from './store';
export const WALLPAPERS: Record<'dark' | 'light', string> = {
  dark: '/win11/wallpapers/bloom-dark.webp',
  light: '/win11/wallpapers/bloom-light.webp',
};

export function createWallpaper(
  root: HTMLElement,
  store: { state: ShellState },
  themeChanged: (theme: ShellState['theme']) => void,
) {
  let lastRenderedTheme: string | null = null;
  const wallpaperEl = root.querySelector<HTMLElement>('[data-wallpaper]')!;
  const brightnessOverlayEl = root.querySelector<HTMLElement>('[data-brightness-overlay]')!;
  const nightLightOverlayEl = root.querySelector<HTMLElement>('[data-nightlight-overlay]')!;
  function renderWallpaper() {
    const { theme } = store.state;
    if (lastRenderedTheme === theme) return;
    lastRenderedTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    wallpaperEl.style.backgroundImage = `url("${WALLPAPERS[theme]}")`;

    themeChanged(theme);
  }

  function renderOverlays() {
    const dimOpacity = ((100 - store.state.brightness) / 100) * 0.72;
    brightnessOverlayEl.style.opacity = dimOpacity.toFixed(3);
    nightLightOverlayEl.style.opacity = store.state.toggles.nightLight ? '0.24' : '0';
  }

  return { renderWallpaper, renderOverlays };
}
