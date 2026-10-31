// Original chart fixture, actual UI, Feedpak roundtrip and compatibility guard.
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {makeProject} from '../src/model.js';
import {renderGuide} from '../src/render-guide.js';
const require=createRequire(import.meta.url),{chromium}=require(process.env.OCE_PLAYWRIGHT||'C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');
const browser=await chromium.launch({headless:true,executablePath:process.env.OCE_CHROMIUM||'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe'});
const context=await browser.newContext({viewport:{width:1700,height:1050},acceptDownloads:true});
await context.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined}));
const page=await context.newPage(),errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
async function action(name){await page.locator(`[data-action="${name}"]`).first().evaluate(el=>el.click())}
async function save(format){const pending=page.waitForEvent('download');await action('saveas');await page.locator('#ws-export-format').selectOption(format);await page.locator('#ws-dialog-submit').click();const stream=await(await pending).createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);return Buffer.concat(chunks)}
let ok=false;
try{
 await page.goto(process.env.OCE_URL||'http://127.0.0.1:8766');await page.waitForSelector('#ws-app[data-mounted="true"]');
 const fixture=makeProject();fixture.title='Original destination pitch fixture';await page.locator('#ws-open-file').setInputFiles({name:'own-project.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});await page.waitForFunction(()=>document.querySelector('#ws-title').textContent.includes('Original destination pitch'));
 await page.locator('#ws-audio-file').setInputFiles({name:'own-backing.wav',mimeType:'audio/wav',buffer:Buffer.from(renderGuide(fixture,{duration:4,sampleRate:8000}))});await page.waitForFunction(()=>document.querySelector('#ws-status').textContent==='Audio ready: own-backing.wav');
 await page.locator('#ws-canvas').click({position:{x:222,y:421}});await page.keyboard.press('5');await page.locator('[data-inspector="properties"]').click();
 await page.locator('#ws-note-force-destination').selectOption('1');let project=JSON.parse(await save('json'));assert.equal(project.arrangements[0].notes[0].techniques.force_destination_pitch,1);checks.push('On is editable and retained in complete JSON');
 await page.locator('#ws-note-force-destination').selectOption('2');const pack=await save('feedpak');const form=new FormData();form.append('file',new Blob([pack]),'own.feedpak');const loaded=await(await fetch((process.env.OCE_URL||'http://127.0.0.1:8766')+'/api/plugins/open_chart_editor/load',{method:'POST',body:form})).json();assert.equal(loaded.project.arrangements[0].notes[0].techniques.force_destination_pitch,2);checks.push('Off survives native-schema Feedpak authoring extension roundtrip');
 const rejected=await fetch((process.env.OCE_URL||'http://127.0.0.1:8766')+'/api/plugins/open_chart_editor/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:loaded.project,format:'xml'})});assert.equal(rejected.status,400);assert.match(await rejected.text(),/force.destination.pitch|Auto/i);checks.push('Stock XML rejects unsupported mode instead of silently dropping it');
 await page.locator('#ws-note-force-destination').selectOption('0');project=JSON.parse(await save('json'));const allowed=await fetch((process.env.OCE_URL||'http://127.0.0.1:8766')+'/api/plugins/open_chart_editor/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project,format:'xml'})});assert.equal(allowed.status,200,await allowed.text());checks.push('Returning to Auto permits stock XML export');assert.deepEqual(errors,[]);ok=true;
}finally{const report={ok,checks,errors};await writeFile(new URL('../verification/browser-destination-pitch.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close()}
