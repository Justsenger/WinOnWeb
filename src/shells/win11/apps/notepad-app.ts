import type { WinAppHostContext, WinAppLifecycle, WinAppModule } from '../types';

function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const notepadApp: WinAppModule = {
  mount(ctx: WinAppHostContext): WinAppLifecycle {
    const { container, shell, wid } = ctx;
    let handle: Awaited<ReturnType<typeof shell.openVirtualFile>> | null = null;
    let generation = 0;
    let currentPath: string | null = null;
    let fileName = '无标题.txt';
    let text = '';
    let dirty = false;
    let statusMsg = '就绪';
    let textareaEl: HTMLTextAreaElement | null = null;

    function updateTitle() {
      shell.setWindowTitle(wid, `${dirty ? '*' : ''}${fileName} - 记事本`);
    }

    function render() {
      const selStart = textareaEl?.selectionStart ?? 0;
      const before = text.slice(0, selStart);
      const lines = before.split('\n');
      const lineNum = lines.length;
      const colNum = (lines[lines.length - 1]?.length ?? 0) + 1;
      const charCount = text.length;

      container.innerHTML = `
        <div class="w11-np-root" style="height:100%;display:flex;flex-direction:column;background:#1f1f1f;color:#f3f3f3;font-family:'Segoe UI Variable Text','Segoe UI','Microsoft YaHei UI',sans-serif;">
          <div style="display:flex;align-items:center;gap:4px;padding:6px 10px;background:#262626;border-bottom:1px solid rgba(255,255,255,0.08);font-size:12.5px;">
            <button type="button" data-np-act="new" style="padding:4px 10px;border:none;border-radius:4px;background:transparent;color:#f3f3f3;cursor:pointer;">新建</button>
            <button type="button" data-np-act="open" style="padding:4px 10px;border:none;border-radius:4px;background:transparent;color:#f3f3f3;cursor:pointer;">打开...</button>
            <button type="button" data-np-act="save" style="padding:4px 10px;border:none;border-radius:4px;background:transparent;color:#f3f3f3;cursor:pointer;">保存</button>
            <button type="button" data-np-act="save-as" style="padding:4px 10px;border:none;border-radius:4px;background:transparent;color:#f3f3f3;cursor:pointer;">另存为...</button>
            <span style="flex:1;"></span>
            <span style="font-size:11.5px;color:#9cc9ff;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(currentPath ?? '临时缓冲区')}">
              ${esc(currentPath ?? '未保存文件')}
            </span>
          </div>
          <textarea data-np-editor spellcheck="false" placeholder="在此输入文本内容，可保存至临时系统盘 C: 或真实挂载的 D: 盘..." style="flex:1;width:100%;resize:none;border:none;outline:none;padding:14px 16px;background:#191919;color:#f3f3f3;font-family:'Cascadia Mono','Consolas','Microsoft YaHei UI',monospace;font-size:13.5px;line-height:1.6;box-sizing:border-box;user-select:text;-webkit-user-select:text;"></textarea>
          <footer style="display:flex;align-items:center;justify-content:space-between;padding:4px 12px;background:#222222;border-top:1px solid rgba(255,255,255,0.07);font-size:11.5px;color:#aaaaaa;">
            <span>${esc(statusMsg)}</span>
            <span>行 ${lineNum}，列 ${colNum}，${charCount} 字符，UTF-8</span>
          </footer>
        </div>
      `;

      textareaEl = container.querySelector<HTMLTextAreaElement>('[data-np-editor]');
      if (textareaEl) {
        textareaEl.value = text;
        textareaEl.addEventListener('input', () => {
          text = textareaEl?.value ?? '';
          if (!dirty) {
            dirty = true;
            updateTitle();
          }
        });
        textareaEl.addEventListener('keyup', syncCursorBar);
        textareaEl.addEventListener('click', syncCursorBar);
      }
      updateTitle();
    }

    function syncCursorBar() {
      if (!textareaEl) return;
      const before = text.slice(0, textareaEl.selectionStart ?? 0);
      const lines = before.split('\n');
      const footerSpan = container.querySelectorAll('footer span')[1];
      if (footerSpan) {
        footerSpan.textContent = `行 ${lines.length}，列 ${(lines[lines.length - 1]?.length ?? 0) + 1}，${text.length} 字符，UTF-8`;
      }
    }

    async function loadFileByPath(path: string) {
      const request = ++generation;
      try {
        statusMsg = `正在读取 ${path}...`;
        const next = await shell.openVirtualFile(path);
        let res;
        try {
          res = await next.read();
        } finally {
          if (!res || request !== generation) next.close();
        }
        if (request !== generation) return;
        handle?.close();
        handle = next;
        currentPath = res.path;
        fileName = res.name;
        text = res.content;
        dirty = false;
        statusMsg = `已打开 ${res.name}（${res.sizeBytes} 字节）`;
        render();
      } catch (err) {
        if (request !== generation) return;
        statusMsg = `打开失败：${err instanceof Error ? err.message : String(err)}`;
        render();
      }
    }

    async function saveToPath(targetPath: string, targetName: string) {
      const request = ++generation;
      const content = text;
      try {
        const res = await shell.writeVirtualFile(targetPath, content);
        if (request !== generation) return;
        if (res.path !== currentPath || !handle) {
          const next = await shell.openVirtualFile(res.path);
          if (request !== generation) {
            next.close();
            return;
          }
          handle?.close();
          handle = next;
        }
        currentPath = res.path;
        fileName = res.name || targetName;
        dirty = false;
        statusMsg = `已保存到 ${res.path}（${res.sizeBytes} 字节）`;
        render();
        void shell.showNotification({ title: '记事本已保存文件', body: res.path }).catch(() => {});
      } catch (err) {
        if (request !== generation) return;
        statusMsg = `保存失败：${err instanceof Error ? err.message : String(err)}`;
        render();
      }
    }

    async function handleClick(e: Event) {
      const btn = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-np-act]');
      if (!btn) return;
      const act = btn.dataset.npAct;

      if (act === 'new') {
        generation++;
        handle?.close();
        handle = null;
        currentPath = null;
        fileName = '无标题.txt';
        text = '';
        dirty = false;
        statusMsg = '已新建空白文档';
        render();
        return;
      }

      if (act === 'open') {
        const request = ++generation;
        try {
          const picked = await shell.showOpenFileDialog({
            extensions: ['.txt', '.md', '.json', '.log', '.ini', '.cfg', '.xml', '.ps1', '.bat', '.cmd'],
          });
          if (!picked || request !== generation) return;
          await loadFileByPath(picked.path);
        } catch (err) {
          statusMsg = `无法打开文件：${err instanceof Error ? err.message : String(err)}`;
          render();
        }
        return;
      }

      if (act === 'save' && currentPath) {
        await saveToPath(currentPath, fileName);
        return;
      }

      if (act === 'save' || act === 'save-as') {
        try {
          const target = await shell.showSaveFileDialog({
            defaultFileName: fileName === '无标题.txt' ? '新建笔记.txt' : fileName,
            initialPath: 'C:\\Users\\Administrator\\桌面',
          });
          if (!target) return;
          await saveToPath(target.path, target.name);
        } catch (err) {
          statusMsg = `无法保存文件：${err instanceof Error ? err.message : String(err)}`;
          render();
        }
      }
    }

    container.addEventListener('click', handleClick);
    render();

    const initialPath = typeof ctx.launchArgs?.openPath === 'string' ? ctx.launchArgs.openPath : null;
    if (initialPath) {
      void loadFileByPath(initialPath);
    }

    return {
      onMessage: (channel, payload) => {
        if (channel === 'notepad:append' && typeof payload === 'string') {
          text = text ? `${text}\n${payload}` : payload;
          dirty = true;
          statusMsg = '收到来自其他应用的追加内容';
          render();
        } else if (channel === 'notepad:open' && typeof payload === 'string') {
          void loadFileByPath(payload);
        }
      },
      onAppRequest: (method, payload, fromAppId) => {
        if (method === 'notepad.getText') {
          return { path: currentPath, fileName, text, dirty };
        }
        if (method === 'notepad.appendText') {
          const line = typeof payload === 'string' ? payload : JSON.stringify(payload ?? '');
          text = text ? `${text}\n${line}` : line;
          dirty = true;
          statusMsg = `已被 ${fromAppId} 协同写入文本`;
          render();
          return { ok: true, length: text.length };
        }
        if (method === 'notepad.setText' && typeof payload === 'string') {
          text = payload;
          dirty = true;
          statusMsg = `已被 ${fromAppId} 替换文本`;
          render();
          return { ok: true, length: text.length };
        }
        throw new Error(`记事本不支持协同方法：${method}`);
      },
      destroy: () => {
        generation++;
        handle?.close();
        container.removeEventListener('click', handleClick);
      },
    };
  },
};
