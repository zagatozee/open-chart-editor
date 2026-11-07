import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {makeProject} from '../src/model.js';

const require=createRequire(import.meta.url),{chromium}=require(process.env.OCE_PLAYWRIGHT||'C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');
const browser=await chromium.launch({headless:true,args:['--mute-audio'],executablePath:process.env.OCE_CHROMIUM||'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe'}),page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
let report;

// Real ML separation can't run in CI, so /stems/split is intercepted with a canned
// response — this test is only about the UI wiring (request shape, merge into the
// project, Spectrum view picking the new stem up), not the separation itself.
const rate=48000;
function tone(frequency,seconds=2){
 const buffer=Buffer.alloc(44+rate*seconds*2);buffer.write('RIFF',0);buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(rate,24);buffer.writeUInt32LE(rate*2,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(rate*seconds*2,40);
 for(let i=0;i<rate*seconds;i++)buffer.writeInt16LE(Math.round(14000*Math.sin(2*Math.PI*frequency*i/rate)),44+i*2);
 return buffer;
}
async function open(project){
 await page.locator('#ws-open-file').setInputFiles({name:'stem-split-test.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});if(await page.locator('#ws-dialog[open]').count())await page.locator('#ws-dialog-submit').click();await page.waitForFunction(title=>document.querySelector('#ws-title').textContent.includes(title),project.title);
}

try{
 await page.goto(process.env.OCE_URL||'http://127.0.0.1:8766');await page.waitForSelector('#ws-app[data-mounted="true"]');

 const project=makeProject();project.title='Stem split browser test';project.duration=2;project.beats=project.beats.filter(beat=>beat.time<=2);project.arrangements[0].notes=[];
 project._pack={manifest:{stems:[{id:'full',file:'stems/full.wav',default:true}]},entries:{'stems/full.wav':tone(220).toString('base64')}};
 await open(project);
 await page.locator('#ws-spectrum-button').click();

 const splitButton=page.locator('[data-action="spectrum-split-stems"]'),serverUrlInput=page.locator('[data-stem-split-server-url]');
 assert.equal(await splitButton.count(),1,'A project with audio offers a Split stems action');
 assert.equal(await splitButton.isDisabled(),true,'No server URL yet, so splitting is disabled');
 const stem=page.locator('[data-spectrum-stem]');
 assert.equal(await stem.count(),0,'No instrument stems exist yet, so no Audio selector is shown');

 await serverUrlInput.fill('http://localhost:7865');await serverUrlInput.dispatchEvent('change');
 assert.equal(await splitButton.isDisabled(),false,'Entering a server URL enables splitting');

 let requestBody=null;
 await page.route('**/stems/split',async route=>{
  const request=route.request();
  requestBody={method:request.method(),multipart:!!(await request.allHeaders())['content-type']?.includes('multipart'),postDataLength:(request.postData()||'').length};
  const drums=tone(80).toString('base64'),bass=tone(55).toString('base64');
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
   ok:true,
   stem_separation:{engine:'demucs',model:'htdemucs_6s',version:'1.0.0'},
   stems:[{id:'drums',codec:'pcm',bytes_base64:drums},{id:'bass',codec:'pcm',bytes_base64:bass}],
  })});
 });

 await splitButton.click();
 await page.waitForFunction(()=>document.querySelector('[data-spectrum-stem] option[value="drums"]'),null,{timeout:10000});
 assert.ok(requestBody&&requestBody.method==='POST','The split request was a POST');
 assert.ok(requestBody.postDataLength>0,'The split request carried the audio bytes');

 const options=await stem.locator('option').allTextContents();
 assert.ok(options.includes('drums'),'The new drums stem is offered after splitting');
 assert.ok(options.includes('bass'),'The new bass stem is offered after splitting');
 assert.match(await page.locator('.ws-spectrum-split').textContent(),/Split into 2 stems \(demucs\)/,'Status reports the split result');

 // Re-opening the Spectrum view keeps the merged stems (they are now part of the project).
 await page.locator('#ws-tab-button').click();await page.locator('#ws-spectrum-button').click();
 assert.deepEqual((await stem.locator('option').allTextContents()).sort(),['Backing track','bass','drums'].sort());

 assert.deepEqual(errors,[]);report={ok:true};
}catch(error){report={ok:false,error:error.stack,status:await page.locator('.ws-spectrum-split').textContent().catch(()=>null),appStatus:await page.locator('#ws-status').textContent().catch(()=>null),errors};process.exitCode=1;}finally{console.log(JSON.stringify(report,null,2));await browser.close();}
