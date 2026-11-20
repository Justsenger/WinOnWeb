// Run in a fresh WinOnWeb browser profile. The fixture is saved to the virtual desktop.
export async function verifyRuntimeResources() {
  const find = selector => document.querySelector(selector);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function waitFor(get, description) {
    for (let i = 0; i < 100; i++) {
      const value = get();
      if (value) return value;
      await sleep(100);
    }
    throw Error('Timed out: ' + description + '\n' + document.body.innerText.slice(-900));
  }
  async function click(selector) {
    (await waitFor(() => find(selector), selector)).click();
  }
  await click('[data-launch-app=task-manager]');
  await click('[data-tm-tab=performance]');
  const log = [];
  function counts() {
    return ['thread', 'handle'].map(id => Number(find('[data-dui-id="' + id + '"] .dui-dynamic-data')?.textContent));
  }
  async function check(action, threads, handles) {
    await waitFor(() => counts().join() === [threads, handles].join(), action + ' expected ' + [threads, handles]);
    log.push({ action, threads, handles });
  }
  await check('空桌面与任务管理器', 1, 0);
  await click('[data-launch-app=storage-lab]');
  await click('[data-slab-action=monitor]');
  await waitFor(() => find('.w11-slab')?.innerText.includes('Worker 读取的存储用量'), 'worker response');
  await check('Worker 已返回配额', 2, 0);
  await click('[data-slab-action=monitor]');
  await check('停止 Worker', 1, 0);
  await click('[data-slab-action=monitor]');
  await check('再次启动 Worker', 2, 0);
  await click('[data-launch-app=notepad]');
  const editor = await waitFor(() => find('[data-np-editor]'), 'editor');
  const content = 'WOW resource lifecycle verification';
  editor.value = content;
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  await click('[data-np-act=save-as]');
  const grant = await waitFor(() => find('[data-fp-filename]') || [...document.querySelectorAll('.w11-tm-modal button')].find(b => b.textContent.includes('允许（记住授权）')), 'virtual file access');
  if (grant.tagName === 'BUTTON') grant.click();
  const name = 'wow-runtime-' + Date.now() + '.txt';
  const input = await waitFor(() => find('[data-fp-filename]'), 'save picker');
  input.value = name;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await click('.w11-tm-modal:has([data-fp-body]) .w11-tm-modal-foot .is-primary');
  await check('保存文件并持有句柄', 2, 1);
  await click('[data-np-act=new]');
  await check('新建文档释放文件', 2, 0);
  await click('[data-np-act=open]');
  const desktop = await waitFor(() => [...document.querySelectorAll('[data-fp-nav]')].find(b => b.dataset.fpNav.endsWith('桌面')), 'virtual desktop');
  desktop.click();
  const item = await waitFor(() => [...document.querySelectorAll('[data-fp-idx]')].find(b => b.textContent.includes(name)), name);
  item.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  await waitFor(() => find('[data-np-editor]')?.value === content, 'read file contents');
  await check('打开同一文件并读回内容', 2, 1);
  await click('.w11-window:has([data-slab-action=monitor]) [data-win-close]');
  await check('退出仍持有 Worker 的应用', 1, 1);
  await click('.w11-window:has([data-np-editor]) [data-win-close]');
  await check('退出仍持有文件的应用', 1, 0);
  await sleep(2500);
  await check('空闲后仍为基线', 1, 0);
  return log;
}
