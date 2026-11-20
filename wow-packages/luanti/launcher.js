const canvas = document.querySelector('#canvas');
const statusLine = document.querySelector('#status');
const saveButton = document.querySelector('#save');
const root = '/luanti';
let db, active = false, isWriting = false, pendingSnapshot;
const encode = new TextEncoder();
const decode = new TextDecoder();

function openSaves() {
  return window.wowStorage.openDatabase('world',['snapshots']);
}
function restore() {
  return new Promise((resolve,reject) => {
    const req = db.transaction('snapshots').objectStore('snapshots').get('current');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function persist(data) {
  isWriting = true;
  const tx = db.transaction('snapshots', 'readwrite');
  tx.objectStore('snapshots').put(data, 'current');
  tx.oncomplete = () => {
    isWriting = false;
    statusLine.textContent = '已保存 ' + new Date().toLocaleTimeString();
    if (pendingSnapshot) {
      const next = pendingSnapshot;
      pendingSnapshot = null;
      persist(next);
    }
  };
  tx.onabort = () => {
    isWriting = false;
    statusLine.textContent = '保存失败：' + tx.error?.message;
  };
}
window.wg_files = (ptr, size) => {
  const bytes = new Uint8Array(Module.wasmMemory.buffer,ptr,size).slice();
  Module._free(ptr);
  if (isWriting) pendingSnapshot = bytes;
  else persist(bytes);
};
function writeFile(path, data) {
  Module.FS.mkdirTree(path.slice(0,path.lastIndexOf('/')));
  Module.FS.writeFile(path, data);
}
function restoreSnapshot(bytes) {
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let i=0;
  function next() {
    const length=view.getUint32(i,true);
    i += 4;
    if (length > bytes.length-i) throw Error('存档文件不完整');
    const slice=bytes.subarray(i,i+length);
    i+=length;
    return slice;
  }
  while(i<bytes.length) {
    const path=decode.decode(next());
    if (!(path==='minetest.conf'||path.startsWith('worlds/')) || path.split('/').some(p=>!p||p==='..'||p==='.')) throw Error('存档路径无效');
    writeFile(root+'/'+path,next());
  }
}
async function mountZip(url,directory) {
  const response=await fetch(url);
  if (!response.ok) throw Error(url+' '+response.status);
  const entries=fflate.unzipSync(new Uint8Array(await response.arrayBuffer()));
  for(const [path,bytes] of Object.entries(entries)) {
    if (!path.endsWith('/')) writeFile(directory+'/'+path,bytes);
  }
}
function requestSave() {
  if(active) Module._wg_request_files();
}
saveButton.onclick=requestSave;
document.addEventListener('visibilitychange', requestSave);
canvas.oncontextmenu = e=>e.preventDefault();
canvas.addEventListener('pointerdown',()=>canvas.focus());

function resize(){
  if(!canvas.clientWidth || !canvas.clientHeight) return;
  const ratio=Math.min(devicePixelRatio,2);
  Module._irrlicht_resize(Math.round(canvas.clientWidth*ratio), Math.round(canvas.clientHeight*ratio));
}

async function launch(quick){
  document.querySelector('#launch').hidden=true;
  try {
    if (!crossOriginIsolated || !WebAssembly.Suspending || !document.createElement('canvas').getContext('webgl2')) throw Error('此浏览器需要启用跨源隔离、JSPI 和 WebGL 2');
    statusLine.textContent='正在加载引擎…';
    db=await openSaves();
    let ready,failed;
    const engineReady=new Promise((resolve,reject)=>{ready=resolve;failed=reject});
    window.Module={canvas,print:console.log, printErr:console.warn, onAbort:failed};
    window.emloop_ready=ready;
    window.emloop_exited=()=>{requestSave();statusLine.textContent='游戏已退出'};
    for(const name of ['fs_ready','pack_progress','pack_installed','pack_remove_progress','pack_removed','usage_result','world_delete_progress','world_deleted','zip_progress','zip_install_progress','zip_installed','world_zipped','terminal_output']) window['emloop_'+name]=()=>{};
    window.wg_toggle_fullscreen=()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();
    const script=document.createElement('script');
    script.src='luanti.js';script.onerror=()=>failed(Error('引擎加载失败'));document.head.append(script);
    await engineReady;
    await Promise.all([mountZip('luanti.zip',root),mountZip('minetest-game.zip',root+'/games')]);
    writeFile(root+'/minetest.conf', encode.encode('language = zh_CN\nmenu_last_game = minetest\nviewing_range = 60\nfps_max = 40\nserver_map_save_interval = 3\n'));
    const snapshot=await restore();
    if(snapshot) restoreSnapshot(snapshot);
    const args=quick?['./luanti','--go','--world','/luanti/worlds/WinOnWeb','--gameid','minetest']:['./luanti'];
    const argv = Module._malloc(4*(args.length+1));
    const pointers = args.map(arg=>{
      const bytes=encode.encode(arg+'\0'),ptr=Module._malloc(bytes.length);
      new Uint8Array(Module.wasmMemory.buffer,ptr,bytes.length).set(bytes);
      return ptr;
    });
    new Uint32Array(Module.wasmMemory.buffer,argv,args.length+1).set([...pointers,0]);
    new ResizeObserver(resize).observe(canvas);resize();
    Module._emsocket_init();
    Module._emloop_invoke_main(args.length,argv);
    active=true;
    saveButton.disabled=false;
    statusLine.textContent='世界会定期保存';
    setInterval(requestSave,4000);
    canvas.focus();
  }catch(err){statusLine.textContent='启动失败：'+String(err);console.error(err)}
}
document.querySelector('#play').onclick=()=>launch(true);
document.querySelector('#menu').onclick=()=>launch(false);
