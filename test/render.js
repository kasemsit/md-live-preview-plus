// Render a markdown file with the built extension's real webview code in headless Chrome
// and print the tables, wikilinks and lines it produced.
//   F=path/to/note.md PLAYWRIGHT=/path/to/playwright-core node test/render.js
const {chromium}=require(process.env.PLAYWRIGHT||"playwright-core");
(async()=>{
 const b=await chromium.launch({executablePath:"/usr/bin/google-chrome",args:["--allow-file-access-from-files"]});
 const p=await b.newPage({viewport:{width:900,height:+(process.env.H||30000)}}); p.on("pageerror",e=>console.log("PAGEERROR",e.message)); p.on("console",m=>{if(m.type()==="error")console.log("CONSOLE",m.text())});
 const E=require("path").resolve(__dirname,"../build/unpacked/extension");require("fs").writeFileSync(__dirname+"/index.html",`<!DOCTYPE html><html><head><meta charset="UTF-8"/><link rel="stylesheet" href="file://${E}/media/webview-ui.css"/><link rel="stylesheet" href="file://${E}/media/webview-editor-theme.css"/></head><body><div id="mlp-root"></div><script>window.acquireVsCodeApi=()=>({postMessage:()=>{},getState:()=>null,setState:()=>{}});</script><script src="file://${E}/dist/webview-editor.js"></script></body></html>`);
 await p.goto("file://"+__dirname+"/index.html");
 const text=require("fs").readFileSync(process.env.F,"utf8");
 const css=process.env.CSS?require("fs").readFileSync(process.env.CSS,"utf8"):"";
 await p.evaluate(([t,c])=>window.postMessage({type:"init",text:t,version:1,css:c,codeTheme:"auto",baseUri:"file:///tmp/"},"*"),[text,css]);
 await p.waitForTimeout(1500);
 if(process.env.DARK)await p.evaluate(()=>{document.body.classList.add("vscode-dark")});
 if(process.env.SHOT)await p.screenshot({path:process.env.SHOT,fullPage:true});
 const r=await p.evaluate(()=>{
   const out={};
   out.tables=[...document.querySelectorAll("table")].map(t=>t.outerHTML);
   out.tableWraps=[...document.querySelectorAll("table")].map(t=>{let top=t;while(top.parentElement&&!top.parentElement.classList.contains("cm-content"))top=top.parentElement;return{top:top.tagName+"."+top.className,prev:top.previousElementSibling&&top.previousElementSibling.className}});
   out.wikilinks=[...document.querySelectorAll(".mlp-wikilink")].map(a=>a.outerHTML);
   out.lines=[...document.querySelectorAll(".cm-line")].map(l=>l.className+" | "+l.textContent.slice(0,80));
   return out});
 console.log(JSON.stringify(r,null,1));
 await b.close();
})();
