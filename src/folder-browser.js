import {INSTRUMENT_COLORS} from './instrument-colors.js';

// Issue #31: a left-side tree of user-configured working folders, tagged by
// which arrangement categories each song folder already has, computed
// server-side without a full import (folder_browser.py). This module owns
// rendering + the fetch calls; opening a picked folder is handed back to the
// caller via onOpenFolder, which feeds the SAME drag-and-drop/File-menu
// pipeline every other way of opening a folder already uses.
export const TAG_ORDER=['lead','rhythm','bass','vocals','piano','drums'];
export const TAG_LABEL={lead:'Lead',rhythm:'Rhythm',bass:'Bass',vocals:'Vocals',piano:'Piano',drums:'Drums',other:'Other',humstrum:'HumStrum/AltRhythm'};
export const FORMAT_LABEL={rplus:'Rocksmith+',eof:'Editor on Fire',charter:'Charter',feedpak:'FeedPak',gpa:'Guitar Pro'};
export const FORMAT_OPTIONS=[['rplus',FORMAT_LABEL.rplus],['eof',FORMAT_LABEL.eof],['feedpak',FORMAT_LABEL.feedpak],['charter',FORMAT_LABEL.charter],['gpa',FORMAT_LABEL.gpa]];
export const TAG_OPTIONS=[['lead','Lead'],['rhythm','Rhythm'],['bass','Bass'],['vocals','Vocals'],['piano','Piano'],['drums','Drums'],['humstrum','HumStrum/AltRhythm'],['other','Other'],['audio','Has audio']];

// Pure: which coloured dots a song leaf should show, in a fixed display order
// (no DOM, so it's directly unit-testable). `tags` is null for a format-badge
// -only leaf (e.g. GPA in this first commit); humstrumVisible is the user's
// own toggle for the separate HumStrum/AltRhythm category.
export function visibleCategories(tags,humstrumVisible){
 if(!tags)return[];
 const out=TAG_ORDER.filter(category=>tags[category]);
 if(humstrumVisible&&tags.humstrum)out.push('humstrum');
 if(tags.other)out.push('other');
 return out;
}

// Pure: flatten one `list_tree` response node into render-ready rows (depth
// for indentation, a stable `path` identifying this leaf for onOpenFolder).
// No DOM; the exact HTML/CSS for a row lives in render() below.
export function treeRows(node,{path='',depth=0,humstrumVisible=true}={}){
 if(!node)return[];
 if(node.kind==='song')return[{kind:'song',name:node.name,path,depth,format:node.format,categories:visibleCategories(node.tags,humstrumVisible),audio:!!node.tags?.audio}];
 if(node.error)return[{kind:'error',name:node.name,depth,message:node.error}];
 const children=node.children||[];
 // A packaged single-file leaf (e.g. a .feedpak archive) is listed under its
 // real filename, not its display name (which is the stem, with no
 // extension) - the path sent back to /folder-open must name the real file.
 return[{kind:'group',name:node.name,depth},...children.flatMap(child=>{const segment=child.file||child.name;return treeRows(child,{path:path?`${path}/${segment}`:segment,depth:depth+1,humstrumVisible});})];
}

// --- Advanced filter: a nested AND/OR tree over format + tag conditions -----
// {type:'group',mode:'all'|'any',id,children:[...]}
// {type:'format',op:'is'|'isNot',value:'rplus'|'eof'|'feedpak'|'charter'|'gpa',id}
// {type:'tag',op:'has'|'lacks',value:'lead'|...|'audio',id}

function genId(){return globalThis.crypto?.randomUUID?.()||`f${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`;}
export function emptyFilterGroup(mode='all'){return {type:'group',mode,id:genId(),children:[]};}
export function makeFormatCondition(){return {type:'format',op:'is',value:'rplus',id:genId()};}
export function makeTagCondition(){return {type:'tag',op:'has',value:'lead',id:genId()};}

// Pure, no DOM: does one song leaf ({format,tags}) satisfy a filter tree? An
// empty group (no conditions anywhere) always matches - the filter is "off".
export function evaluateFilter(node,song){
 if(!node)return true;
 if(node.type==='group'){
  if(!node.children?.length)return true;
  const results=node.children.map(child=>evaluateFilter(child,song));
  return node.mode==='any'?results.some(Boolean):results.every(Boolean);
 }
 if(node.type==='format'){const is=song.format===node.value;return node.op==='isNot'?!is:is;}
 if(node.type==='tag'){const has=!!song.tags?.[node.value];return node.op==='lacks'?!has:has;}
 return true;
}

function matchesQuery(name,ancestorPath,query){
 if(!query)return true;
 const q=query.toLowerCase();
 return name.toLowerCase().includes(q)||ancestorPath.toLowerCase().includes(q);
}

// Pure: the same `list_tree` shape back, with non-matching song leaves and
// then-empty groups pruned; a root-load error node passes through untouched
// (it isn't real tree content). Combines the quick text search (matched
// against a song's own name or any ancestor group name) with the advanced
// filter tree, both as an implicit AND.
export function filterTree(node,{query='',filter=null}={},ancestorPath=''){
 if(!node)return null;
 if(node.error)return node;
 if(node.kind==='song')return matchesQuery(node.name,ancestorPath,query)&&evaluateFilter(filter,node)?node:null;
 const nextPath=ancestorPath?`${ancestorPath}/${node.name}`:node.name;
 const children=(node.children||[]).map(child=>filterTree(child,{query,filter},nextPath)).filter(Boolean);
 if(!children.length)return null;
 return {...node,children};
}

function mapFilterNode(node,id,fn){
 if(node.id===id)return fn(node);
 if(node.type!=='group')return node;
 return {...node,children:node.children.map(child=>mapFilterNode(child,id,fn))};
}
export function updateFilterNode(tree,id,patch){return mapFilterNode(tree,id,node=>({...node,...patch}));}
export function addFilterChild(tree,groupId,child){return mapFilterNode(tree,groupId,node=>({...node,children:[...node.children,child]}));}
function removeFilterFrom(node,id){
 if(node.type!=='group')return node;
 return {...node,children:node.children.filter(child=>child.id!==id).map(child=>removeFilterFrom(child,id))};
}
export function removeFilterNode(tree,id){return tree.id===id?emptyFilterGroup(tree.mode):removeFilterFrom(tree,id);}
export function filterIsEmpty(node){return !node||node.type!=='group'||!node.children.length;}

function conditionHtml(node,esc){
 if(node.type==='format')return `<div class="ws-filter-row" data-node="${node.id}">`+
  `<select data-field="op"><option value="is" ${node.op==='is'?'selected':''}>Format is</option><option value="isNot" ${node.op==='isNot'?'selected':''}>Format is not</option></select>`+
  `<select data-field="value">${FORMAT_OPTIONS.map(([v,l])=>`<option value="${v}" ${node.value===v?'selected':''}>${esc(l)}</option>`).join('')}</select>`+
  `<button type="button" data-action="filter-remove" title="Remove condition">✕</button></div>`;
 return `<div class="ws-filter-row" data-node="${node.id}">`+
  `<select data-field="op"><option value="has" ${node.op==='has'?'selected':''}>Has</option><option value="lacks" ${node.op==='lacks'?'selected':''}>Doesn't have</option></select>`+
  `<select data-field="value">${TAG_OPTIONS.map(([v,l])=>`<option value="${v}" ${node.value===v?'selected':''}>${esc(l)}</option>`).join('')}</select>`+
  `<button type="button" data-action="filter-remove" title="Remove condition">✕</button></div>`;
}
export function filterGroupHtml(node,{esc=s=>String(s??''),depth=0}={}){
 if(node.type!=='group')return conditionHtml(node,esc);
 const rows=node.children.map(child=>child.type==='group'?filterGroupHtml(child,{esc,depth:depth+1}):conditionHtml(child,esc)).join('');
 const removeButton=depth>0?`<button type="button" data-action="filter-remove" title="Remove group">✕ group</button>`:'';
 return `<div class="ws-filter-group" data-node="${node.id}">`+
  `<div class="ws-filter-group-head">Match <select data-field="mode"><option value="all" ${node.mode==='all'?'selected':''}>ALL</option><option value="any" ${node.mode==='any'?'selected':''}>ANY</option></select> of:`+
  `<button type="button" data-action="filter-add-format">+ Format</button><button type="button" data-action="filter-add-tag">+ Tag</button><button type="button" data-action="filter-add-group">+ Group</button>${removeButton}</div>`+
  `<div class="ws-filter-children">${rows||'<p class="ws-folder-empty">No conditions - matches every song</p>'}</div></div>`;
}

export function createFolderBrowser({fetcher=fetch,esc=s=>String(s??''),onOpenFolder,onError,onQueryChange,onToggleInclude}={}){
 let roots=[],trees=new Map(),humstrumVisible=true,loading=new Set(),query='',filter=emptyFilterGroup();
 // Chart Combiner mode (issue #33): while active, every song row gets an
 // inclusion checkbox instead of only being clickable to open/replace the
 // project - isIncluded decides its checked state (driven by the caller's
 // own set of chosen sources, not tracked here).
 let combinerMode=false,isIncluded=()=>false;
 function setCombinerMode(enabled){combinerMode=!!enabled;}
 function setIncluded(predicate){isIncluded=typeof predicate==='function'?predicate:()=>false;}
 async function loadRoots(){
  try{const response=await fetcher('/api/plugins/open_chart_editor/folder-roots');const data=await response.json();roots=Array.isArray(data?.roots)?data.roots:[];}
  catch(error){onError?.(`Could not read working-folder roots: ${error.message}`);roots=[];}
  trees=new Map();
 }
 async function loadRoot(index,onLoaded){
  if(trees.has(index)||loading.has(index))return;
  loading.add(index);
  try{
   const response=await fetcher(`/api/plugins/open_chart_editor/folder-tree?root=${index}`);
   if(!response.ok)throw Error((await response.json().catch(()=>({})))?.detail||'Folder tree request failed');
   trees.set(index,await response.json());
  }catch(error){trees.set(index,{kind:'group',children:[],error:error.message});}
  finally{loading.delete(index);onLoaded?.();}
 }
 async function saveRoots(nextRoots){
  const response=await fetcher('/api/plugins/open_chart_editor/folder-roots',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roots:nextRoots})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data?.detail||'Could not save working-folder roots');
  roots=Array.isArray(data?.roots)?data.roots:[];trees=new Map();
  return roots;
 }
 function setHumstrumVisible(next){humstrumVisible=!!next;}
 function setQuery(next){query=String(next??'');}
 function setFilter(next){filter=next&&next.type==='group'?next:emptyFilterGroup();}
 function dot(category){return `<span class="ws-folder-tag" style="background:${INSTRUMENT_COLORS[category]||INSTRUMENT_COLORS.other}" title="${esc(TAG_LABEL[category]||category)}"></span>`;}
 function rowHtml(row,rootIndex){
  if(row.kind==='group')return `<li class="ws-folder-group" style="padding-left:${row.depth*10}px">${esc(row.name)}</li>`;
  if(row.kind==='error')return `<li class="ws-folder-error" style="padding-left:${row.depth*10}px">${esc(row.name)}: ${esc(row.message)}</li>`;
  const dots=row.categories.map(dot).join('');
  const warning=row.audio?'':'<span class="ws-folder-warning" title="No audio file found in this folder">No audio</span>';
  const path=`${rootIndex}:${row.path}`;
  const include=combinerMode?`<input type="checkbox" data-include="${esc(path)}" ${isIncluded(path)?'checked':''} title="Include in the Chart Combiner">`:'';
  const openAttr=combinerMode?'':`data-open="${esc(path)}" tabindex="0" role="button"`;
  return `<li class="ws-folder-song" style="padding-left:${row.depth*10}px" ${openAttr}>${include}<span class="ws-folder-name">${esc(row.name)}</span><span class="ws-folder-dots">${dots}</span>${row.format?`<span class="ws-folder-format">${esc(FORMAT_LABEL[row.format]||row.format)}</span>`:''}${warning}</li>`;
 }
 function render(container){
  if(!roots.length){container.innerHTML='<p class="ws-folder-empty">No working folders configured yet.</p><button data-action="folder-browser-configure" class="ws-wide">Configure folders…</button>';return;}
  const active=!filterIsEmpty(filter);
  const rootsHtml=roots.map((rootPath,index)=>{
   if(!trees.has(index)){if(!loading.has(index))loadRoot(index,()=>render(container));return `<li class="ws-folder-group">${esc(rootPath)}</li><li class="ws-folder-loading">Loading…</li>`;}
   const raw=trees.get(index),node=filterTree(raw,{query,filter});
   if(!node)return `<li class="ws-folder-group" title="${esc(rootPath)}">${esc(rootPath)}</li><li class="ws-folder-empty">No songs match${query||active?' this filter':' here'}</li>`;
   const allRows=treeRows(node,{humstrumVisible}),rows=node.kind==='group'?allRows.slice(1):allRows; // drop the synthetic root-group row when present; the root path heading replaces it
   return `<li class="ws-folder-group" title="${esc(rootPath)}">${esc(rootPath)}</li>`+rows.map(row=>rowHtml(row,index)).join('');
  }).join('');
  const hasQuery=!!query;
  container.innerHTML=`<div class="ws-folder-search"><input type="search" placeholder="Search artist / album / song…" value="${esc(query)}" data-role="query"><button type="button" data-action="folder-browser-filter" class="${active?'active':''}" title="Advanced filter">▾${active?' ●':''}</button>${hasQuery||active?'<button type="button" data-role="clear-filter" title="Clear search and advanced filter">Clear</button>':''}</div>`+
   `<ul class="ws-folder-tree">${rootsHtml}</ul>`+
   `<label class="ws-folder-humstrum"><input type="checkbox" data-action="folder-browser-humstrum" ${humstrumVisible?'checked':''}>Show HumStrum/AltRhythm</label>`+
   `<button data-action="folder-browser-configure" class="ws-wide">Configure folders…</button>`;
  for(const row of container.querySelectorAll('[data-open]'))row.addEventListener('click',()=>onOpenFolder?.(row.dataset.open));
  for(const box of container.querySelectorAll('[data-include]'))box.addEventListener('change',()=>onToggleInclude?.(box.dataset.include,box.checked));
  const search=container.querySelector('[data-role="query"]');
  search?.addEventListener('input',()=>{setQuery(search.value);render(container);search.focus();search.selectionStart=search.selectionEnd=search.value.length;onQueryChange?.(query);});
  container.querySelector('[data-role="clear-filter"]')?.addEventListener('click',()=>{setQuery('');setFilter(emptyFilterGroup());render(container);onQueryChange?.(query);});
 }
 return {loadRoots,saveRoots,setHumstrumVisible,setQuery,setFilter,setCombinerMode,setIncluded,
  get roots(){return roots;},get humstrumVisible(){return humstrumVisible;},get query(){return query;},get filter(){return filter;},
  render};
}
