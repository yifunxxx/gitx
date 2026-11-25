import fs from 'node:fs';
import path from 'node:path';
import { root, coverage, getActions, getSettingIds, renderReferences } from './docs-reference.mjs';
const site = path.join(root, 'docs/site');
const readText = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const errors=[];
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.name.startsWith('.')||entry.name==='public'?[]:entry.isDirectory()?walk(path.join(dir,entry.name)):[path.join(dir,entry.name)]);
const files=walk(site).filter(p=>p.endsWith('.md'));
const chinese=files.filter(p=>!path.relative(site,p).replaceAll('\\','/').startsWith('en/'));
const english=files.filter(p=>path.relative(site,p).replaceAll('\\','/').startsWith('en/'));
for(const file of chinese)if(!fs.existsSync(path.join(site,'en',path.relative(site,file))))errors.push(`Missing English counterpart: ${file}`);
for(const file of english)if(!fs.existsSync(path.join(site,path.relative(path.join(site,'en'),file))))errors.push(`Missing Chinese counterpart: ${file}`);
const owned=Object.values(coverage).flat();
const actions=getActions().map(a=>a.id);
for(const id of actions)if(owned.filter(a=>a===id).length!==1)errors.push(`Command needs exactly one guide: ${id}`);
for(const id of owned)if(!actions.includes(id))errors.push(`Stale command mapping: ${id}`);
for(const page of Object.keys(coverage))for(const prefix of ['','en/'])if(!fs.existsSync(path.join(site,prefix,'guide',`${page}.md`)))errors.push(`Missing guide for commands: ${prefix}${page}`);
for(const [name, expected] of renderReferences())if(!fs.existsSync(path.join(site,name))||readText(path.join(site,name))!==expected)errors.push(`Reference out of date: ${name}; run pnpm docs:reference`);
for(const prefix of ['','en/']) {
  const settings=fs.readFileSync(path.join(site,prefix,'guide/settings.md'),'utf8');
  const covered=[...settings.matchAll(/<!-- settings: ([\s\S]*?) -->/g)].flatMap(m=>m[1].trim().split(/\s+/));
  for(const id of getSettingIds())if(!covered.includes(id))errors.push(`Undocumented setting: ${prefix}${id}`);
}
let links=0,images=0;
for(const file of files) {
  const text=readText(file);
  if(!text.startsWith('# ')&&!text.startsWith('---\n'))errors.push(`Missing title/frontmatter: ${file}`);
  if(/(?:TODO|TBD|待补充|coming soon)/i.test(text))errors.push(`Placeholder in ${file}`);
  const urls=[...text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map(m=>({url:m[1],image:m[0].startsWith('!')}));
  for(const {url,image} of urls) {
    if(/^(?:https?:|mailto:|#)/.test(url))continue;
    const clean=decodeURIComponent(url.split(/[?#]/)[0]);
    const target=clean.startsWith('/')?path.join(site,image?'public':'',clean):path.resolve(path.dirname(file),clean);
    const candidates=image?[target]:[target,`${target}.md`,path.join(target,'index.md'),path.join(site,'public',clean)];
    if(!candidates.some(p=>fs.existsSync(p)&&fs.statSync(p).isFile()))errors.push(`Broken ${image?'image':'link'}: ${path.relative(site,file)} → ${url}`);
    if(image)images++;else links++;
  }
}
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}
else console.log(`Docs checked: ${chinese.length} Chinese + ${english.length} English pages; ${actions.length} commands; ${getSettingIds().length} settings; ${links} local links; ${images} image references.`);
