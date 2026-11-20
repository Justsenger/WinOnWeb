import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import {spawnSync,spawn} from 'node:child_process';
const root=path.resolve('dist');
const app=http.createServer(async(q,r)=>{try{
 const p=path.resolve(root,'.'+decodeURIComponent(new URL(q.url,'http://localhost').pathname).replace(/\/$/,'/index.html'));
 if(!p.startsWith(root+path.sep)){r.writeHead(403).end();return}
 const types={'.js':'application/javascript','.css':'text/css','.html':'text/html','.wasm':'application/wasm','.svg':'image/svg+xml','.json':'application/json'};
 r.setHeader('Content-Type',types[path.extname(p)]||'application/octet-stream');r.end(await fs.readFile(p));
}catch{r.writeHead(404).end()}});
await new Promise(r=>app.listen(0,'127.0.0.1',r));
const c=spawn(process.execPath,['work/qa-live-model.mjs'],{stdio:'inherit',env:{...process.env,CDP_ENDPOINT:'http://127.0.0.1:9333',WOW_QA_URL:'http://127.0.0.1:'+app.address().port+'/?desktop=1'}});
c.on('exit',code=>{app.close();app.closeAllConnections();process.exitCode=code});
