// Interaction test for footnotes: hover card, click -> definition, back-link -> text.
//   F=note.md PLAYWRIGHT=/path/to/playwright-core [CSS=theme.css] [SHOT=hover.png] node test/footnote_click.js
const {chromium}=require(process.env.PLAYWRIGHT||"playwright-core"),fs=require("fs"),path=require("path");
(async()=>{const E=path.resolve(__dirname,"../build/unpacked/extension");
 fs.writeFileSync(__dirname+"/index.html",`<!DOCTYPE html><html><head><meta charset="UTF-8"/><link rel="stylesheet" href="file://${E}/media/webview-ui.css"/><link rel="stylesheet" href="file://${E}/media/webview-editor-theme.css"/></head><body><div id="mlp-root"></div><script>window.acquireVsCodeApi=()=>({postMessage:()=>{},getState:()=>null,setState:()=>{}});</script><script src="file://${E}/dist/webview-editor.js"></script></body></html>`);
 const b=await chromium.launch({executablePath:"/usr/bin/google-chrome",args:["--allow-file-access-from-files"]});
 const p=await b.newPage({viewport:{width:900,height:700}});p.on("pageerror",e=>console.log("PAGEERROR",e.message));
 await p.goto("file://"+__dirname+"/index.html");
 const css=process.env.CSS?fs.readFileSync(process.env.CSS,"utf8"):"";
 await p.evaluate(([t,c])=>window.postMessage({type:"init",text:t,version:1,css:c,codeTheme:"auto",baseUri:"file:///tmp/"},"*"),[fs.readFileSync(process.env.F,"utf8"),css]);
 await p.waitForTimeout(1500);
 for(let i=0;i<60&&!(await p.$(".mlp-fn-ref"));i++){await p.evaluate(()=>{document.querySelector(".cm-scroller").scrollTop+=500});await p.waitForTimeout(150)}
 const ref=p.locator(".mlp-fn-ref").first();await ref.scrollIntoViewIfNeeded();await ref.hover();await p.waitForTimeout(300);
 const pop=await p.evaluate(()=>{const c=document.querySelector(".mlp-fn.mlp-fn-open .mlp-fn-pop");if(!c)return "no hover card";const r=c.getBoundingClientRect();return `visible=${getComputedStyle(c).visibility} box=${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)}x${Math.round(r.bottom)} vw=${innerWidth} | `+c.textContent.slice(0,50)});
 console.log("hover:",pop); if(process.env.SHOT)await p.screenshot({path:process.env.SHOT});
 const scr=()=>p.evaluate(()=>document.querySelector(".cm-scroller").scrollTop);
 const before=await scr(); await ref.dispatchEvent("mousedown",{button:0}); await p.waitForTimeout(400);
 const after=await scr(); let flash=null; for(let i=0;i<15&&!flash;i++){flash=await p.evaluate(()=>{const l=document.querySelector(".mlp-fn-flashbox");return l?("box top="+l.style.top):null});if(!flash)await p.waitForTimeout(100)}
 if(process.env.SHOT2)await p.screenshot({path:process.env.SHOT2});
 console.log("click ref: scrollTop",before,"->",after,"| flashed line:",flash);
 const back=p.locator(".mlp-fn-back").first(); await back.dispatchEvent("mousedown",{button:0}); await p.waitForTimeout(400);
 const flash2=await p.evaluate(()=>{const l=document.querySelector(".mlp-fn-flashbox");return l?("box top="+l.style.top):null});
 console.log("click back: scrollTop ->",await scr(),"| flashed line:",flash2);
 await b.close()})();
