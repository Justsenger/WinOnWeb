import { getWinDesktopHostConfig } from '../host-config';
import { getWowIconUrl } from './wow-store';
export { UI_ICONS } from '../shared/ui-icons';

const PNG_ICON_MAP: Record<string, string> = {
  start: '/win11/icons/start.png',
  'this-pc': '/win11/icons/this-pc.png',
  'recycle-bin': '/win11/icons/recycle-bin.png',
  'control-panel': '/win11/icons/control-panel.png',
  explorer: '/win11/icons/explorer.png',
  settings: '/win11/icons/settings.png',
  'task-manager': '/win11/icons/task-manager.png',
  terminal: '/win11/icons/terminal.png',
  survivalcraft: '/packages/survivalcraft-icon.webp',
};

let fsGradSeq = 0;

if (typeof customElements !== 'undefined' && !customElements.get('wow-package-icon')) {
  customElements.define('wow-package-icon', class extends HTMLElement {
    async connectedCallback() {
      const image = new Image();
      image.alt = '';
      image.draggable = false;
      image.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain;pointer-events:none';
      try {
        image.src = await getWowIconUrl(this.dataset.app!, this.dataset.version!, decodeURIComponent(this.dataset.path!));
        try { await image.decode(); } finally { URL.revokeObjectURL(image.src); }
        if (this.isConnected) this.replaceChildren(image);
      } catch {
        // Leave the fallback visible if the installed icon is missing or invalid.
      }
    }
  });
}

/**
 * 渲染 Windows 11 应用/系统图标（优先使用宿主注入图标或本地提取的高清透明 PNG）。
 */
export function getAppIconSvg(key: string, size = 32): string {
  if (key.startsWith('wow:')) {
    const [, appId, version, ...pathParts] = key.split(':');
    const iconPath = pathParts.join(':') || 'icon.svg';
    const fallback = appId === 'magic-tower' ? '🏯' : appId === 'cf-lite' ? '🎯' : appId === 'ouro-lite' ? '🐍' : '🎮';
    return `<wow-package-icon aria-hidden="true" data-version="${encodeURIComponent(version)}" data-app="${encodeURIComponent(appId)}" data-path="${encodeURIComponent(iconPath)}" style="width:${size}px;height:${size}px;display:grid;place-items:center;font-size:${Math.max(14, Math.round(size * 0.54))}px;line-height:1">${fallback}</wow-package-icon>`;
  }
  const src = getWinDesktopHostConfig().icons?.[key] ?? PNG_ICON_MAP[key];
  if (src) {
    return `<img src="${src}" width="${size}" height="${size}" alt="" draggable="false" loading="eager" decoding="async" style="width:${size}px;height:${size}px;object-fit:contain;display:block;pointer-events:none;" />`;
  }

  if (key === 'storage-lab') {
    const gradId = `w11SlabBg-${++fsGradSeq}`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="${gradId}" x1="6" y1="8" x2="42" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#4CC2FF"/>
          <stop offset="100%" stop-color="#005FB8"/>
        </linearGradient>
      </defs>
      <rect x="5" y="10" width="38" height="28" rx="6" fill="url(#${gradId})"/>
      <rect x="5.5" y="10.5" width="37" height="27" rx="5.5" stroke="white" stroke-opacity="0.28"/>
      <rect x="9" y="27" width="30" height="7" rx="3.5" fill="#0B243E" fill-opacity="0.72"/>
      <circle cx="14" cy="30.5" r="2" fill="#6CCB5F"/>
      <rect x="20" y="29.5" width="14" height="2" rx="1" fill="#7DD3FC"/>
      <path d="M24 14V23M19.5 18.5H28.5" stroke="white" stroke-width="2.4" stroke-linecap="round"/>
    </svg>`;
  }

  if (key === 'fullscreen') {
    const gradId = `w11FsBg-${++fsGradSeq}`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="${gradId}" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#38BDF8"/>
          <stop offset="100%" stop-color="#0066CC"/>
        </linearGradient>
      </defs>
      <rect x="5" y="5" width="38" height="38" rx="10" fill="url(#${gradId})"/>
      <rect x="5.5" y="5.5" width="37" height="37" rx="9.5" stroke="white" stroke-opacity="0.28"/>
      <path d="M18 14H14V18M30 14H34V18M18 34H14V30M30 34H34V30" stroke="white" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="19" y="19" width="10" height="10" rx="2" fill="white" fill-opacity="0.26" stroke="white" stroke-opacity="0.7" stroke-width="1.4"/>
    </svg>`;
  }

  if (key === 'notepad') {
    const gradId = `w11NpBg-${++fsGradSeq}`;
    return `<svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="${gradId}" x1="10" y1="6" x2="38" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#60CDFF"/>
          <stop offset="100%" stop-color="#0078D4"/>
        </linearGradient>
      </defs>
      <rect x="9" y="8" width="30" height="34" rx="5" fill="#1E293B" stroke="rgba(255,255,255,0.22)"/>
      <rect x="9" y="8" width="30" height="9" rx="4" fill="url(#${gradId})"/>
      <path d="M15 23H33M15 29H33M15 35H25" stroke="#93C5FD" stroke-width="2.4" stroke-linecap="round"/>
    </svg>`;
  }

  if (key === 'app-store') {
    const gradId = `w11StoreBg-${++fsGradSeq}`;
    return `<svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="${gradId}" x1="8" y1="12" x2="40" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#38BDF8"/>
          <stop offset="100%" stop-color="#005FB8"/>
        </linearGradient>
      </defs>
      <path d="M18 14V11C18 8.79 19.79 7 22 7H26C28.21 7 30 8.79 30 11V14" stroke="#93C5FD" stroke-width="2.6" stroke-linecap="round"/>
      <rect x="7" y="14" width="34" height="27" rx="6" fill="url(#${gradId})" stroke="rgba(255,255,255,0.25)"/>
      <rect x="16" y="21" width="7" height="7" rx="1.4" fill="white" fill-opacity="0.92"/>
      <rect x="25" y="21" width="7" height="7" rx="1.4" fill="white" fill-opacity="0.72"/>
      <rect x="16" y="30" width="7" height="7" rx="1.4" fill="white" fill-opacity="0.72"/>
      <rect x="25" y="30" width="7" height="7" rx="1.4" fill="white" fill-opacity="0.92"/>
    </svg>`;
  }

  return `<svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" aria-hidden="true">
    <rect x="6" y="6" width="36" height="36" rx="8" fill="#0078D4"/>
    <rect x="14" y="14" width="20" height="20" rx="3" fill="#60CDFF" fill-opacity="0.88"/>
  </svg>`;
}
