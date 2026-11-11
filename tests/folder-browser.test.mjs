import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleCategories,treeRows,TAG_ORDER,evaluateFilter,filterTree,emptyFilterGroup,makeFormatCondition,makeTagCondition,addFilterChild,updateFilterNode,removeFilterNode,filterIsEmpty,filterGroupHtml,createFolderBrowser} from '../src/folder-browser.js';

// A minimal stand-in for a DOM element: just enough of the surface render()
// touches (innerHTML, plus no-op query methods) to exercise its pure string
// output without a real DOM, consistent with how the rest of this module's
// view layer is left untested beyond its data transforms.
function fakeContainer(){
 return {innerHTML:'',querySelectorAll(){return[];},querySelector(){return null;}};
}

const emptyTags=()=>Object.fromEntries([...TAG_ORDER,'humstrum','other','audio'].map(c=>[c,false]));

test('visibleCategories follows a fixed display order and respects the HumStrum toggle',()=>{
 const tags={lead:true,rhythm:false,bass:true,vocals:true,piano:false,drums:false,humstrum:true,other:false,audio:true};
 assert.deepEqual(visibleCategories(tags,true),['lead','bass','vocals','humstrum']);
 assert.deepEqual(visibleCategories(tags,false),['lead','bass','vocals']);
});

test('visibleCategories reports nothing for a format-badge-only leaf (e.g. GPA)',()=>{
 assert.deepEqual(visibleCategories(null,true),[]);
});

test('visibleCategories includes Other when the sniffer could not classify a chart',()=>{
 assert.deepEqual(visibleCategories({...Object.fromEntries(TAG_ORDER.map(c=>[c,false])),humstrum:false,other:true,audio:false},true),['other']);
});

test('treeRows flattens a group/song tree with depth and a stable open-path per leaf',()=>{
 const tree={kind:'group',name:'root',children:[
  {kind:'group',name:'Artist',children:[
   {kind:'song',name:'Song A',format:'rplus',tags:{lead:true,rhythm:false,bass:false,vocals:false,piano:false,drums:false,humstrum:false,other:false,audio:true}},
  ]},
  {kind:'song',name:'Song B',format:'gpa',tags:null},
 ]};
 const rows=treeRows(tree,{humstrumVisible:true});
 assert.deepEqual(rows.map(r=>[r.kind,r.name,r.depth]),[
  ['group','root',0],['group','Artist',1],['song','Song A',2],['song','Song B',1],
 ]);
 const songA=rows.find(r=>r.name==='Song A');
 assert.equal(songA.path,'Artist/Song A');
 assert.deepEqual(songA.categories,['lead']);
 const songB=rows.find(r=>r.name==='Song B');
 assert.equal(songB.path,'Song B');
 assert.deepEqual(songB.categories,[]); // format badge only, no per-instrument tags
});

test('treeRows surfaces an unreadable subfolder as an error row instead of dropping the whole tree',()=>{
 const tree={kind:'group',name:'root',children:[{kind:'group',name:'bad',error:'Could not read folder'}]};
 const rows=treeRows(tree,{humstrumVisible:true});
 assert.deepEqual(rows.map(r=>r.kind),['group','error']);
});

test('evaluateFilter: an empty filter (or no filter) matches everything',()=>{
 const song={format:'rplus',tags:{...emptyTags(),bass:true}};
 assert.equal(evaluateFilter(null,song),true);
 assert.equal(evaluateFilter(emptyFilterGroup(),song),true);
});

test('evaluateFilter: "is EOF AND does not have Bass"',()=>{
 let group=emptyFilterGroup('all');
 const isEof={...makeFormatCondition(),value:'eof'};
 const noBass={...makeTagCondition(),op:'lacks',value:'bass'};
 group={...group,children:[isEof,noBass]};
 assert.equal(evaluateFilter(group,{format:'eof',tags:{...emptyTags()}}),true);
 assert.equal(evaluateFilter(group,{format:'eof',tags:{...emptyTags(),bass:true}}),false);
 assert.equal(evaluateFilter(group,{format:'rplus',tags:{...emptyTags()}}),false);
});

test('evaluateFilter: "is Rocksmith+ AND has Piano"',()=>{
 const isRplus={...makeFormatCondition(),value:'rplus'};
 const hasPiano={...makeTagCondition(),op:'has',value:'piano'};
 const group={...emptyFilterGroup('all'),children:[isRplus,hasPiano]};
 assert.equal(evaluateFilter(group,{format:'rplus',tags:{...emptyTags(),piano:true}}),true);
 assert.equal(evaluateFilter(group,{format:'rplus',tags:{...emptyTags()}}),false);
 assert.equal(evaluateFilter(group,{format:'eof',tags:{...emptyTags(),piano:true}}),false);
});

test('evaluateFilter: nested groups, e.g. (is EOF AND no Bass) OR (is R+ AND has Piano)',()=>{
 const left={...emptyFilterGroup('all'),children:[{...makeFormatCondition(),value:'eof'},{...makeTagCondition(),op:'lacks',value:'bass'}]};
 const right={...emptyFilterGroup('all'),children:[{...makeFormatCondition(),value:'rplus'},{...makeTagCondition(),op:'has',value:'piano'}]};
 const top={...emptyFilterGroup('any'),children:[left,right]};
 assert.equal(evaluateFilter(top,{format:'eof',tags:emptyTags()}),true);
 assert.equal(evaluateFilter(top,{format:'rplus',tags:{...emptyTags(),piano:true}}),true);
 assert.equal(evaluateFilter(top,{format:'rplus',tags:emptyTags()}),false);
 assert.equal(evaluateFilter(top,{format:'eof',tags:{...emptyTags(),bass:true}}),false);
});

test('filterTree combines quick search text (matched against name or any ancestor) with the advanced filter, pruning empty branches',()=>{
 const tree={kind:'group',name:'root',children:[
  {kind:'group',name:'Cradle Of Filth',children:[
   {kind:'song',name:'Heaven Torn Asunder',format:'rplus',tags:{...emptyTags(),vocals:true,humstrum:true}},
  ]},
  {kind:'group',name:'Other Artist',children:[
   {kind:'song',name:'Some Song',format:'eof',tags:{...emptyTags(),bass:true}},
  ]},
 ]};
 const byQuery=filterTree(tree,{query:'cradle'});
 assert.equal(byQuery.children.length,1);
 assert.equal(byQuery.children[0].name,'Cradle Of Filth');
 const byFilter=filterTree(tree,{filter:{...emptyFilterGroup('all'),children:[{...makeTagCondition(),op:'has',value:'bass'}]}});
 assert.equal(byFilter.children.length,1);
 assert.equal(byFilter.children[0].name,'Other Artist');
 assert.equal(filterTree(tree,{query:'nothing matches this'}),null);
});

test('filter tree mutation helpers preserve ids of untouched nodes (stable across re-renders)',()=>{
 let tree=emptyFilterGroup('all');
 const condition=makeFormatCondition();
 tree=addFilterChild(tree,tree.id,condition);
 const group=addFilterChild(tree,tree.id,emptyFilterGroup('any'));
 const [firstId,secondId]=group.children.map(c=>c.id);
 assert.equal(firstId,condition.id); // the original condition's id is untouched
 const updated=updateFilterNode(group,secondId,{mode:'all'});
 assert.equal(updated.children[0].id,firstId);
 assert.equal(updated.children[1].mode,'all');
 const removed=removeFilterNode(updated,firstId);
 assert.equal(removed.children.length,1);
 assert.equal(removed.children[0].id,secondId);
});

test('removing the root filter group resets it to an empty group rather than null',()=>{
 const tree=emptyFilterGroup('all');
 const removed=removeFilterNode(tree,tree.id);
 assert.equal(removed.type,'group');
 assert.equal(removed.children.length,0);
});

test('filterIsEmpty reflects whether any condition exists anywhere',()=>{
 assert.equal(filterIsEmpty(emptyFilterGroup()),true);
 assert.equal(filterIsEmpty({...emptyFilterGroup(),children:[makeFormatCondition()]}),false);
});

test('the Clear button only appears once a search or advanced filter is actually active',async()=>{
 const browser=createFolderBrowser({fetcher:async()=>({ok:true,json:async()=>({roots:['/library']})})});
 await browser.loadRoots();
 const container=fakeContainer();
 browser.render(container);
 assert.doesNotMatch(container.innerHTML,/data-role="clear-filter"/);
 browser.setQuery('cradle');
 browser.render(container);
 assert.match(container.innerHTML,/data-role="clear-filter"/);
 browser.setQuery('');
 browser.setFilter({...emptyFilterGroup('all'),children:[makeFormatCondition()]});
 browser.render(container);
 assert.match(container.innerHTML,/data-role="clear-filter"/);
});

test('filterGroupHtml renders selected op/value and nested groups without throwing',()=>{
 const group={...emptyFilterGroup('any'),children:[{...makeFormatCondition(),value:'eof'},{...emptyFilterGroup('all'),children:[makeTagCondition()]}]};
 const html=filterGroupHtml(group,{esc:s=>String(s)});
 assert.match(html,/value="eof" selected/);
 assert.match(html,/ws-filter-group/);
 assert.match(html,/ws-filter-row/);
});

test('Chart Combiner mode (issue #33): a song row gets an inclusion checkbox instead of an open-on-click, reflecting the caller\'s own included set',async()=>{
 const tree={kind:'group',name:'root',children:[{kind:'song',name:'Some Song',format:'rplus',tags:{lead:true,rhythm:false,bass:false,vocals:false,piano:false,drums:false,humstrum:false,other:false,audio:true}}]};
 const fetcher=async(url)=>url.includes('folder-tree')?{ok:true,json:async()=>tree}:{ok:true,json:async()=>({roots:['/library']})};
 const browser=createFolderBrowser({fetcher});
 await browser.loadRoots();
 const container=fakeContainer();
 browser.render(container); // triggers the lazy folder-tree fetch
 await new Promise(resolve=>setTimeout(resolve,0));
 browser.render(container);
 assert.match(container.innerHTML,/data-open="0:Some Song"/);
 assert.doesNotMatch(container.innerHTML,/data-include/);
 browser.setCombinerMode(true);
 browser.setIncluded(path=>path==='0:Some Song');
 browser.render(container);
 assert.doesNotMatch(container.innerHTML,/data-open=/);
 assert.match(container.innerHTML,/data-include="0:Some Song"[^>]*checked/);
});
