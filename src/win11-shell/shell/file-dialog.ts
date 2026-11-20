import { showModal } from '../shared/overlays';
import { EXP_ICONS, type VfsEntryInfo, type VirtualStorageService } from '../system/virtual-storage';
import type { PickedFileResult, PickedSaveTarget } from '../types';

function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function normalizeExts(exts?: string[]): string[] | null {
  if (!exts || exts.length === 0) return null;
  return exts.map((e) => (e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`));
}

export async function openSystemFileDialog(
  hostRootEl: HTMLElement,
  vfs: VirtualStorageService,
  opts: {
    mode: 'open' | 'save';
    extensions?: string[];
    defaultFileName?: string;
    initialPath?: string;
  },
): Promise<PickedFileResult | PickedSaveTarget | null> {
  let currentPath = opts.initialPath ?? '此电脑';
  let selectedEntry: VfsEntryInfo | null = null;
  let fileNameInput = opts.defaultFileName ?? (opts.mode === 'save' ? '新建文本文档.txt' : '');
  const extFilter = normalizeExts(opts.extensions);

  return new Promise((resolve) => {
    let settled = false;
    let closeDialog: (() => void) | null = null;
    let bodyEl: HTMLElement | null = null;
    let confirmBtn: HTMLButtonElement | null = null;
    let entries: VfsEntryInfo[] = [];
    let needsAuthDriveD = false;
    let statusErr = '';

    const finish = (val: PickedFileResult | PickedSaveTarget | null) => {
      if (settled) return;
      settled = true;
      closeDialog?.();
      resolve(val);
    };

    const loadAndRender = async () => {
      statusErr = '';
      needsAuthDriveD = false;
      selectedEntry = null;
      try {
        const list = await vfs.listDirectory(currentPath);
        entries = list.filter((item) => {
          if (item.kind !== 'file' || !extFilter) return true;
          const dot = item.name.lastIndexOf('.');
          if (dot === -1) return false;
          return extFilter.includes(item.name.slice(dot).toLowerCase());
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'DRIVE_D_NEEDS_AUTH') {
          needsAuthDriveD = true;
          entries = [];
        } else {
          statusErr = msg;
          entries = [];
        }
      }
      renderBody();
    };

    const getParentPath = (p: string): string => {
      if (!p || p === '此电脑') return '此电脑';
      const cleaned = p.replace(/\\+$/, '');
      const idx = cleaned.lastIndexOf('\\');
      if (idx <= 2) {
        if (cleaned.length <= 2) return '此电脑';
        return `${cleaned.slice(0, 2)}\\`;
      }
      return cleaned.slice(0, idx);
    };

    const renderBody = () => {
      if (!bodyEl) return;
      const dState = vfs.getDriveDState();
      const quickRoots = [
        { label: '此电脑', path: '此电脑', icon: EXP_ICONS.thisPc },
        { label: '本地磁盘 (C:)', path: 'C:\\', icon: EXP_ICONS.driveSystem },
        { label: '桌面 (C:)', path: 'C:\\Users\\Administrator\\桌面', icon: EXP_ICONS.desktop },
        { label: '文档 (C:)', path: 'C:\\Users\\Administrator\\文档', icon: EXP_ICONS.documents },
        ...(dState.status !== 'unmounted'
          ? [
              {
                label: dState.status === 'needs-auth' ? '本地磁盘 (D:) - 需授权' : '本地磁盘 (D:)',
                path: 'D:\\',
                icon: EXP_ICONS.driveData,
              },
            ]
          : []),
      ];

      bodyEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;">
          <button type="button" class="w11-tm-btn" data-fp-up ${currentPath === '此电脑' ? 'disabled' : ''} style="min-width:54px;height:28px;padding:0 10px;">上一级</button>
          <input type="text" readonly value="${esc(currentPath)}" style="flex:1;height:28px;padding:0 10px;border-radius:4px;border:1px solid rgba(255,255,255,0.14);background:#1b1b1b;color:#f3f3f3;font-size:12px;" />
          ${
            dState.status === 'unmounted'
              ? `<button type="button" class="w11-tm-btn" data-fp-mount-d style="height:28px;padding:0 10px;">挂载 D 盘...</button>`
              : ''
          }
        </div>
        <div style="display:grid;grid-template-columns:168px 1fr;gap:10px;height:270px;">
          <div style="border:1px solid rgba(255,255,255,0.08);border-radius:6px;background:#1c1c1c;padding:6px;display:flex;flex-direction:column;gap:4px;overflow:auto;">
            ${quickRoots
              .map(
                (q) => `
                  <button type="button" data-fp-nav="${esc(q.path)}" style="display:flex;align-items:center;gap:7px;padding:6px 8px;border:none;border-radius:4px;background:${currentPath === q.path ? 'rgba(76,194,255,0.18)' : 'transparent'};color:#f3f3f3;font-size:12px;text-align:left;cursor:pointer;">
                    <img src="${q.icon}" alt="" width="15" height="15" style="flex-shrink:0;" />
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(q.label)}</span>
                  </button>
                `,
              )
              .join('')}
          </div>
          <div style="border:1px solid rgba(255,255,255,0.08);border-radius:6px;background:#1a1a1a;overflow:auto;padding:4px;">
            ${
              needsAuthDriveD
                ? `<div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;padding:16px;">
                     <div style="color:#f6b94d;font-weight:600;">本地磁盘 (D:) - 需授权</div>
                     <div style="color:#b8b8b8;font-size:12px;">上次挂载目录“${esc(dState.volumeName ?? '')}”，浏览器需要你点击确认恢复读写权限。</div>
                     <button type="button" class="w11-tm-btn is-primary" data-fp-auth-d>点击授权并打开 D 盘</button>
                   </div>`
                : statusErr
                  ? `<div style="padding:16px;color:#ff9b9b;font-size:12px;">${esc(statusErr)}</div>`
                  : entries.length === 0
                    ? `<div style="padding:24px;color:#888;text-align:center;">此目录为空</div>`
                    : entries
                        .map((item, idx) => {
                          const isSel = selectedEntry?.path === item.path;
                          return `
                            <div data-fp-idx="${idx}" style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:4px;cursor:default;background:${isSel ? 'rgba(76,194,255,0.22)' : 'transparent'};">
                              <img src="${item.icon}" alt="" width="16" height="16" style="flex-shrink:0;" />
                              <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;">${esc(item.name)}</span>
                              <span style="font-size:11px;color:#999;">${item.kind === 'file' ? `${Math.max(1, Math.round((item.sizeBytes ?? 0) / 1024))} KB` : item.typeLabel}</span>
                            </div>
                          `;
                        })
                        .join('')
            }
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:12px;color:#ccc;min-width:60px;">文件名(N):</span>
          <input type="text" data-fp-filename value="${esc(fileNameInput)}" ${opts.mode === 'open' ? 'readonly' : ''} style="flex:1;height:28px;padding:0 10px;border-radius:4px;border:1px solid rgba(255,255,255,0.18);background:#1b1b1b;color:#f3f3f3;font-size:12.5px;" />
        </div>
      `;

      const nameInput = bodyEl.querySelector<HTMLInputElement>('[data-fp-filename]');
      nameInput?.addEventListener('input', () => {
        fileNameInput = nameInput.value;
        updateConfirmButton();
      });

      if (confirmBtn) updateConfirmButton();
    };

    const updateConfirmButton = () => {
      if (!confirmBtn) return;
      if (opts.mode === 'open') {
        confirmBtn.disabled = !(selectedEntry && selectedEntry.kind === 'file');
      } else {
        const canWrite = currentPath !== '此电脑' && !needsAuthDriveD && fileNameInput.trim().length > 0;
        confirmBtn.disabled = !canWrite;
      }
    };

    const submitSelection = async () => {
      if (opts.mode === 'open') {
        if (!selectedEntry || selectedEntry.kind !== 'file') return;
        const fileRes = await vfs.readTextFile(selectedEntry.path);
        finish(fileRes);
        return;
      }
      const cleanName = fileNameInput.trim();
      if (!cleanName || currentPath === '此电脑') return;
      const sep = currentPath.endsWith('\\') ? '' : '\\';
      finish({ path: `${currentPath}${sep}${cleanName}`, name: cleanName });
    };

    const { close } = showModal(hostRootEl, {
      title: opts.mode === 'open' ? '打开文件' : '保存文件',
      width: 600,
      bodyHtml: '<div data-fp-body style="display:flex;flex-direction:column;gap:10px;"></div>',
      footerButtons: [
        {
          label: '取消',
          onClick: () => finish(null),
        },
        {
          label: opts.mode === 'open' ? '打开(O)' : '保存(S)',
          primary: true,
          onClick: () => {
            void submitSelection();
          },
        },
      ],
      onMount: (modalEl) => {
        bodyEl = modalEl.querySelector<HTMLElement>('[data-fp-body]');
        const btns = modalEl.querySelectorAll<HTMLButtonElement>('.w11-tm-modal-foot .w11-tm-btn');
        confirmBtn = btns[btns.length - 1] ?? null;

        modalEl.querySelector('.w11-tm-modal-x')?.addEventListener('click', () => finish(null));
        modalEl.parentElement?.addEventListener('click', (e) => {
          if (e.target === modalEl.parentElement) finish(null);
        });

        bodyEl?.addEventListener('click', (e) => {
          const t = e.target as HTMLElement;
          if (t.closest('[data-fp-up]')) {
            currentPath = getParentPath(currentPath);
            void loadAndRender();
            return;
          }
          if (t.closest('[data-fp-auth-d]')) {
            void vfs.authorizeDriveD().then(() => loadAndRender());
            return;
          }
          if (t.closest('[data-fp-mount-d]')) {
            void vfs.mountDriveD().then(
              () => {
                currentPath = 'D:\\';
                return loadAndRender();
              },
              () => {},
            );
            return;
          }
          const navBtn = t.closest<HTMLElement>('[data-fp-nav]');
          if (navBtn?.dataset.fpNav) {
            currentPath = navBtn.dataset.fpNav;
            void loadAndRender();
            return;
          }
          const row = t.closest<HTMLElement>('[data-fp-idx]');
          if (row?.dataset.fpIdx) {
            const item = entries[Number(row.dataset.fpIdx)];
            if (!item) return;
            selectedEntry = item;
            if (item.kind === 'file') {
              fileNameInput = item.name;
            }
            renderBody();
          }
        });

        bodyEl?.addEventListener('dblclick', (e) => {
          const row = (e.target as HTMLElement).closest<HTMLElement>('[data-fp-idx]');
          if (!row?.dataset.fpIdx) return;
          const item = entries[Number(row.dataset.fpIdx)];
          if (!item) return;
          if (item.kind === 'file') {
            selectedEntry = item;
            void submitSelection();
          } else if (item.needsAuth) {
            void vfs.authorizeDriveD().then(() => {
              currentPath = 'D:\\';
              return loadAndRender();
            });
          } else {
            currentPath = item.path;
            void loadAndRender();
          }
        });

        void loadAndRender();
      },
    });
    closeDialog = close;
  });
}
