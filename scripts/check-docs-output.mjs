import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(path.join(root,'apps/desktop/package.json'));
const { Window }=await import(pathToFileURL(require.resolve('happy-dom')).href);
const base=process.env.DOCS_BASE || '/gitx/';
const output=path.join(root,'docs/site/.vitepress/dist');
if(!fs.existsSync(output))throw new Error('Build docs before checking output.');
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const pages=walk(output).filter(p=>p.endsWith('.html'));
const parsed=new Map();
const window=new Window();
for(const file of pages)parsed.set(file,new window.DOMParser().parseFromString(fs.readFileSync(file,'utf8'),'text/html'));
const failures=[];let checked=0;
for(const [file,doc] of parsed) {
  const relative=path.relative(output,file).replaceAll('\\','/');
  const pageUrl=new URL(base+relative.replace(/index\.html$/,'').replace(/\.html$/,''),'https://docs.invalid');
  if(relative!=='404.html') {
    const lang=relative.startsWith('en/')?'en':'zh-CN';
    if(doc.documentElement.lang!==lang)failures.push(`${relative}: expected lang=${lang}`);
  }
  for(const el of doc.querySelectorAll('a[href], img[src], script[src], link[rel="stylesheet"][href], link[rel="icon"][href]')) {
    const value=el.getAttribute('href')??el.getAttribute('src');
    if(!value||/^(?:data:|mailto:|tel:|javascript:)/.test(value))continue;
    const url=new URL(value,pageUrl);
    if(url.origin!==pageUrl.origin)continue;
    if(!url.pathname.startsWith(base)){failures.push(`${relative}: outside base ${value}`);continue;}
    const clean=decodeURIComponent(url.pathname.slice(base.length));
    const target=path.join(output,clean);
    const candidates=[target,`${target}.html`,path.join(target,'index.html')];
    const found=candidates.find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());
    if(!found){failures.push(`${relative}: missing ${value}`);continue;}
    if(url.hash&&parsed.has(found)) {
      const id=decodeURIComponent(url.hash.slice(1));
      if(id&&!parsed.get(found).getElementById(id))failures.push(`${relative}: missing anchor ${value}`);
    }
    checked++;
  }
}
await window.happyDOM.close();
if(failures.length){console.error([...new Set(failures)].join('\n'));process.exitCode=1;}
else console.log(`Built output checked: ${pages.length} HTML pages; ${checked} local routes, anchors, and assets; both language tags valid.`);
