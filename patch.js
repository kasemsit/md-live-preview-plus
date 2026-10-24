#!/usr/bin/env node
// Patch "Markdown Live Preview Editor" (t-shoot) so Claude Code can see what you
// select in its preview, and so the selection band no longer hides the text.
//
//   node patch.js <unpacked-extension-dir> [--rename]
//
// Three edits, each anchored on a string that must occur exactly once:
//  1. dist/webview-editor.js — on selection change, read the CodeMirror selection
//     (exact markdown source + line numbers) and post it to the extension host.
//  2. dist/extension.js — save the document if dirty, then write the selection to
//     ~/.claude/live-preview-selection.json (a hook passes it to Claude).
//  3. media/webview-editor-theme.css — make the drawn selection band translucent.
// --rename gives the package its own id so a marketplace update cannot overwrite it.
// Fails loudly if an anchor is missing (the upstream bundle changed).
const fs = require("fs"), path = require("path");
const dir = process.argv[2];
if (!dir) { console.error("usage: node patch.js <extension-dir> [--rename]"); process.exit(2); }
const rename = process.argv.includes("--rename");
const MARK = "mlpSelection";

function patch(rel, anchor, replacement) {
  const p = path.join(dir, rel);
  let s = fs.readFileSync(p, "utf8");
  if (s.includes(MARK) || s.includes("Local patch (claude-selection)")) { console.log(`skip  ${rel} (already patched)`); return; }
  const n = s.split(anchor).length - 1;
  if (n !== 1) throw new Error(`${rel}: anchor found ${n} times, expected 1 — upstream changed; update patch.js`);
  fs.writeFileSync(p, s.replace(anchor, replacement));
  console.log(`patch ${rel}`);
}

// 1. webview: send the CodeMirror selection (falls back to rendered DOM text)
{
  const a = 'c(pi,"postToHost");';
  const snip =
    'document.addEventListener("selectionchange",(()=>{let t,last=null;return()=>{clearTimeout(t);t=setTimeout(()=>{' +
    'let m={type:"mlpSelection",text:String(window.getSelection()||""),source:"dom"};' +
    'try{const ed=document.querySelector(".cm-editor"),v=ed&&R.findFromDOM(ed);if(v){const r=v.state.selection.main;' +
    'm=r.empty?{type:"mlpSelection",text:"",source:"cm"}:{type:"mlpSelection",text:v.state.sliceDoc(r.from,r.to),from:r.from,to:r.to,' +
    'startLine:v.state.doc.lineAt(r.from).number,endLine:v.state.doc.lineAt(r.to).number,source:"cm"}}}catch(_){}' +
    'const k=JSON.stringify(m);if(k!==last){last=k;pi(m)}},300)}})());';
  patch("dist/webview-editor.js", a, a + snip);
}

// 2. extension host: save if dirty, then write the selection file
{
  const a = 'handleMessage(e){switch(e.type){case"ready":this.sendInit()';
  const b = 'handleMessage(e){switch(e.type){case"mlpSelection":Promise.resolve(e.text&&this.document.isDirty?this.document.save():0).catch(()=>{}).then(()=>{try{' +
    'const fs=require("fs"),os=require("os"),pth=require("path"),d=pth.join(os.homedir(),".claude");fs.mkdirSync(d,{recursive:true});' +
    'fs.writeFileSync(pth.join(d,"live-preview-selection.json"),JSON.stringify({file:this.document.uri.fsPath,text:e.text,startLine:e.startLine,endLine:e.endLine,' +
    'from:e.from,to:e.to,source:e.source,docVersion:this.document.version,time:Date.now(),dirty:this.document.isDirty}))}catch(_){}});break;' +
    'case"ready":this.sendInit()';
  patch("dist/extension.js", a, b);
}

// 3. css: translucent selection band (the layer sits above the text)
{
  const p = path.join(dir, "media/webview-editor-theme.css");
  let s = fs.readFileSync(p, "utf8");
  if (s.includes("Local patch (claude-selection)")) console.log("skip  media/webview-editor-theme.css (already patched)");
  else {
    if (!s.includes(".cm-layer.cm-selectionLayer")) throw new Error("css: selectionLayer rule not found — upstream changed");
    s += "\n/* Local patch (claude-selection): the selection layer sits above the text and an opaque\n" +
         "   theme selection colour hid it; make the drawn band translucent. */\n" +
         ".cm-layer.cm-selectionLayer .cm-selectionBackground {\n\topacity: 0.4 !important;\n}\n";
    fs.writeFileSync(p, s);
    console.log("patch media/webview-editor-theme.css");
  }
}

// 4. editor webview CSP: allow embedded (data:) and local fonts, so a CSS style
//    can carry its own font (styles/thai-readable.css embeds Sarabun).
{
  const p = path.join(dir, "dist/extension.js");
  let s = fs.readFileSync(p, "utf8");
  const a = "script-src 'nonce-${a}'; connect-src ${e.cspSource};";
  if (s.includes(a + " font-src")) console.log("skip  dist/extension.js CSP (already patched)");
  else {
    const n = s.split(a).length - 1;
    if (n !== 1) throw new Error(`dist/extension.js CSP anchor found ${n} times, expected 1 — upstream changed`);
    fs.writeFileSync(p, s.replace(a, a + " font-src ${e.cspSource} data:;"));
    console.log("patch dist/extension.js (editor CSP font-src)");
  }
}

// 5. webview: Obsidian-style wikilinks [[target#anchor|alias]].
//    In text: a ViewPlugin hides "[[target#anchor|" and "]]" and marks the label as
//    an <a class="mlp-link"> with data-href "wiki:target#anchor", unless the cursor
//    is on that line (then the raw source shows, as for ordinary links). In tables
//    and other inline renders: renderInlineInto (Xl) post-processes text nodes.
//    Clicks reach the existing link handler, which posts openLink to the host.
{
  const p = path.join(dir, "dist/webview-editor.js");
  let s = fs.readFileSync(p, "utf8");
  if (s.includes("mlpWikiExt")) console.log("skip  dist/webview-editor.js wikilinks (already patched)");
  else {
    const defs =
      'function mlpWikiRe(){return/\\[\\[([^\\[\\]|\\n\\\\]+?)(?:\\\\?\\|([^\\[\\]\\n]+?))?\\]\\]/g}' +
      'function mlpInSrc(st,pos){try{for(let n=U(st).resolveInner(pos,1);n;n=n.parent){if(/^(FencedCode|CodeBlock|InlineCode|HTMLBlock)$/.test(n.name))return!0;' +
      'if(n.name==="Table")return jt(st.doc.lineAt(n.from).from)}}catch(_){}return!1}' +
      'function mlpWikiExt(){const hide=B.replace({});function build(v){const b=new Oi();' +
      'for(const{from,to}of v.visibleRanges){const text=v.state.sliceDoc(from,to),re=mlpWikiRe();let m;' +
      'while(m=re.exec(text)){const s=from+m.index,e=s+m[0].length;if(Zi(v.state,s,e)||mlpInSrc(v.state,s))continue;' +
      'const lf=m[2]?s+m[0].indexOf("|")+1:s+2,lt=e-2;if(lt<=lf)continue;' +
      'b.add(s,lf,hide);b.add(lf,lt,B.mark({tagName:"a",class:"mlp-link mlp-wikilink",attributes:{"data-href":"wiki:"+m[1].trim(),title:m[1].trim()}}));b.add(lt,e,hide)}}' +
      'return b.finish()}' +
      'return Ne.fromClass(class{constructor(v){this.decorations=build(v)}update(u){(u.docChanged||u.viewportChanged||u.selectionSet)&&(this.decorations=build(u.view))}},{decorations:v=>v.decorations})}' +
      'function mlpWikiPre(e){const L=[];const t=String(e).replace(mlpWikiRe(),(x,a,b)=>{L.push([a.trim(),(b||a).trim()]);return"\\uE000"+(L.length-1)+"\\uE001"});return[t,L]}' +
      'function mlpWikiPost(root,L){if(!L.length)return;const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),nodes=[];let n;while(n=w.nextNode())/\\uE000\\d+\\uE001/.test(n.nodeValue)&&nodes.push(n);' +
      'for(const t of nodes){const f=document.createDocumentFragment();t.nodeValue.split(/(\\uE000\\d+\\uE001)/).forEach(part=>{const m=/^\\uE000(\\d+)\\uE001$/.exec(part);if(!m){part&&f.append(part);return}const[h,l]=L[+m[1]],a=document.createElement("a");' +
      'a.className="mlp-link mlp-wikilink";a.setAttribute("data-href","wiki:"+h);a.title=h;a.textContent=l;f.append(a)});t.replaceWith(f)}}' +
      'document.addEventListener("mousedown",ev=>{const a=ev.button===0&&ev.target&&ev.target.closest&&ev.target.closest(".mlp-wikilink");if(!a)return;ev.preventDefault();ev.stopPropagation();pi({type:"mlpLog",msg:"click "+a.getAttribute("data-href")});pi({type:"openLink",href:a.getAttribute("data-href")})},true);' +
      'function mlpWikiDom(root){try{root.normalize();const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),nodes=[];let n;' +
      'while(n=w.nextNode())n.nodeValue.includes("[[")&&!n.parentElement.closest("code,a")&&nodes.push(n);' +
      'for(const t of nodes){const str=t.nodeValue,re=mlpWikiRe(),frag=document.createDocumentFragment();let last=0,m;' +
      'while(m=re.exec(str)){frag.append(str.slice(last,m.index));const a=document.createElement("a");a.className="mlp-link mlp-wikilink";' +
      'a.setAttribute("data-href","wiki:"+m[1].trim());a.title=m[1].trim();a.textContent=(m[2]||m[1]).trim();frag.append(a);last=m.index+m[0].length}' +
      'if(last){frag.append(str.slice(last));t.replaceWith(frag)}}}catch(_){}}';
    const a1 = 'c(pi,"postToHost");';
    const a2 = 'Ty(e=>pi({type:"openLink",href:e}))';
    const a3 = 'function Xl(i,e,t){e&&Kf(i,Tv($v.parse(e)),e,t)}';
    for (const [a, name] of [[a1, "postToHost"], [a2, "link click handler"], [a3, "renderInlineInto"]]) {
      const n = s.split(a).length - 1;
      if (n !== 1) throw new Error(`webview wikilinks: ${name} anchor found ${n} times, expected 1 — upstream changed`);
    }
    s = s.replace(a1, a1 + defs)
         .replace(a2, "mlpWikiExt()," + a2)
         .replace(a3, 'function Xl(i,e,t){if(!e)return;const[q,L]=mlpWikiPre(e);Kf(i,Tv($v.parse(q)),q,t);mlpWikiPost(i,L)}');
    fs.writeFileSync(p, s);
    console.log("patch dist/webview-editor.js (wikilinks)");
  }
}

// 6. extension host: resolve "wiki:" links by file name anywhere in the workspace
//    (Obsidian semantics), open the target in Live Preview, and jump to the
//    "#Heading" or "#^block-id" anchor once that editor is ready.
{
  const p = path.join(dir, "dist/extension.js");
  let s = fs.readFileSync(p, "utf8");
  if (s.includes("mlpOpenWiki")) console.log("skip  dist/extension.js wikilinks (already patched)");
  else {
    const a1 = 'case"openLink":this.openLink(e.href);break;';
    const a2 = 'this.lastAppliedVersion=this.document.version}async applyEdit(';
    for (const [a, name] of [[a1, "openLink case"], [a2, "sendInit end"]]) {
      const n = s.split(a).length - 1;
      if (n !== 1) throw new Error(`extension wikilinks: ${name} anchor found ${n} times, expected 1 — upstream changed`);
    }
    s = s.replace(a1, 'case"mlpLog":mlpLog(e.msg);break;case"openLink":mlpLog("openLink "+e.href);if(String(e.href).startsWith("wiki:")){mlpOpenWiki(this,e.href.slice(5));break}this.openLink(e.href);break;')
         .replace(a2, 'this.lastAppliedVersion=this.document.version;mlpAfterInit(this)}async applyEdit(');
    s += `
;function mlpLog(m){try{const fs=require("fs"),p=require("path").join(require("os").homedir(),".claude","mlp-debug.log");fs.appendFileSync(p,new Date().toISOString()+" "+m+"\\n")}catch(_){}}
function mlpAfterInit(s){try{(globalThis.__mlpSessions??=new Set).add(s);const k=s.document.uri.toString(),p=globalThis.__mlpPending;
if(p&&p.has(k)){const line=p.get(k);p.delete(k);setTimeout(()=>{try{s.post({type:"jumpToLine",line})}catch(_){}},250)}}catch(_){}}
async function mlpOpenWiki(self,link){const vs=require("vscode"),path=require("path");
try{const parts=link.split("#"),name=parts[0].trim(),anchor=parts.length>1?parts[parts.length-1].trim():"";let uri;
if(!name)uri=self.document.uri;else{const isMd=/\\.md$/i.test(name),hasExt=/\\.[A-Za-z0-9]{1,5}$/.test(name)&&!isMd,rel=isMd||hasExt?name:name+".md";
const glob="**/"+rel.replace(/[\\[\\]{}?*!]/g,c=>"["+c+"]"),found=await vs.workspace.findFiles(glob,"**/node_modules/**",50);
if(!found.length){vs.window.showWarningMessage("Wikilink target not found: "+name);return}
const norm=x=>x.replace(/\\\\/g,"/").toLowerCase(),want=norm(rel),here=path.dirname(self.document.uri.fsPath),
score=u=>(norm(vs.workspace.asRelativePath(u,false))===want?0:2)+(path.dirname(u.fsPath)===here?0:1);
found.sort((a,b)=>score(a)-score(b)||a.fsPath.length-b.fsPath.length);uri=found[0]}
const md=/\\.md$/i.test(uri.fsPath);let line=0;
if(anchor&&md){const txt=Buffer.from(await vs.workspace.fs.readFile(uri)).toString("utf8").split(/\\r?\\n/);
if(anchor.startsWith("^")){const id=anchor.slice(1).replace(/[.*+?^\${}()|[\\]\\\\]/g,"\\\\$&"),re=new RegExp("(^|\\\\s)\\\\^"+id+"\\\\s*$");line=txt.findIndex(l=>re.test(l))+1}
else{const h=anchor.replace(/\\s+/g," ").toLowerCase();line=txt.findIndex(l=>{const m=/^#{1,6}\\s+(.*?)\\s*#*\\s*$/.exec(l);return!!m&&m[1].replace(/\\s+/g," ").toLowerCase()===h})+1}
if(!line)vs.window.showWarningMessage("Anchor not found in "+path.basename(uri.fsPath)+": #"+anchor)}
if(!md){await vs.commands.executeCommand("vscode.open",uri);return}
const k=uri.toString();if(line>0)(globalThis.__mlpPending??=new Map).set(k,line);
await vs.commands.executeCommand("vscode.openWith",uri,"mdLivePreview.editor");
if(line>0)setTimeout(()=>{const p=globalThis.__mlpPending;if(!p||!p.has(k))return;
for(const s of[...(globalThis.__mlpSessions||[])].reverse()){try{if(s.document.uri.toString()===k){s.post({type:"jumpToLine",line});p.delete(k);return}}catch(_){globalThis.__mlpSessions.delete(s)}}},500)}
catch(err){mlpLog("error "+(err&&err.stack||err));vs.window.showWarningMessage("Wikilink: "+(err&&err.message||err))}}
`;
    fs.writeFileSync(p, s);
    console.log("patch dist/extension.js (wikilinks)");
  }
}

// 7. webview: tables — a "|" inside [[...]] belongs to the wikilink, not to the
//    table (Obsidian behaviour), so [[note|label]] works in a cell unescaped.
//    Patches the GFM row parser (rs) and the cell counter (A0) identically.
{
  const p = path.join(dir, "dist/webview-editor.js");
  let s = fs.readFileSync(p, "utf8");
  if (s.includes("mlpWl")) console.log("skip  dist/webview-editor.js table pipes (already patched)");
  else {
    const edits = [
      ["function rs(i,e,t=0,n,r=0){let s=0,", "function rs(i,e,t=0,n,r=0){let mlpWl=0,s=0,"],
      ["for(let u=t;u<e.length;u++){let d=e.charCodeAt(u);d==124&&!h?",
       "for(let u=t;u<e.length;u++){let d=e.charCodeAt(u);d==91&&e.charCodeAt(u+1)==91&&!h?mlpWl=1:d==93&&e.charCodeAt(u+1)==93&&(mlpWl=0);d==124&&!h&&!mlpWl?"],
      ["function A0(i,e){let t=0,n=!0,r=-1,s=!1;for(let o=e;o<i.length;o++){let l=i.charCodeAt(o);l===124&&!s?",
       "function A0(i,e){let mlpWl=0,t=0,n=!0,r=-1,s=!1;for(let o=e;o<i.length;o++){let l=i.charCodeAt(o);l===91&&i.charCodeAt(o+1)===91&&!s?mlpWl=1:l===93&&i.charCodeAt(o+1)===93&&(mlpWl=0);l===124&&!s&&!mlpWl?"],
      ['n=[],r="",s=0,o=!1,l=0;for(let a of t){if(a==="|"&&!o){',
       'n=[],r="",s=0,o=!1,l=0,mlpWl=0,mlpPv="";for(let a of t){a==="["&&mlpPv==="["&&!o?mlpWl=1:a==="]"&&mlpPv==="]"&&(mlpWl=0);mlpPv=a;if(a==="|"&&!o&&!mlpWl){'],
    ];
    for (const [a] of edits) {
      const n = s.split(a).length - 1;
      if (n !== 1) throw new Error(`table pipes: anchor found ${n} times, expected 1 — upstream changed`);
    }
    for (const [a, b] of edits) s = s.replace(a, b);
    fs.writeFileSync(p, s);
    console.log("patch dist/webview-editor.js (wikilink-aware table pipes)");
  }
}

// 8. webview: render tables inside blockquotes ("> | a | b |"). The block-range
//    check (Dl) only accepted whitespace before a table; a quote prefix made it
//    return null, so the table stayed raw. Tables get a variant that also accepts
//    ">" markers. The table model already keeps that prefix as `indent` and writes
//    it back on every line when a cell is edited.
{
  const p = path.join(dir, "dist/webview-editor.js");
  let s = fs.readFileSync(p, "utf8");
  if (s.includes("mlpDlQ")) console.log("skip  dist/webview-editor.js quoted tables (already patched)");
  else {
    const a1 = 'if(s.name==="Table"){let o=i.doc.lineAt(s.from).from;if(jt(o))return;let l=Dl(i,s.from,s.to);';
    const a2 = 'c(Dl,"alignedBlockRange");';
    for (const [a, name] of [[a1, "table block case"], [a2, "alignedBlockRange"]]) {
      const n = s.split(a).length - 1;
      if (n !== 1) throw new Error(`quoted tables: ${name} anchor found ${n} times, expected 1 — upstream changed`);
    }
    // A table may interrupt a paragraph (GFM/Obsidian). Inside a quote the parser
    // looked at the next line *with* its ">" markers, so the delimiter row never
    // matched and the table was swallowed by the paragraph. Strip the markers first.
    const a3 = 'let n=i.peekLine();return og.test(n)&&rs(i,e.text,e.basePos)==rs(i,n,e.basePos)}';
    if (s.split(a3).length - 1 !== 1) throw new Error("quoted tables: table endLeaf anchor not found once — upstream changed");
    s = s.replace(a3, 'let n=i.peekLine(),mlpQ=e.basePos>0&&/^[ \\t]*>/.test(e.text)?n.match(/^(?:[ \\t]*>[ \\t]?)*/)[0].length:0;' +
                      'n=n.slice(mlpQ);return og.test(n)&&rs(i,e.text,e.basePos)==rs(i,n,mlpQ?0:e.basePos)}');
    s = s.replace(a1, a1.replace("let l=Dl(i,", "let l=mlpDlQ(i,"))
         .replace(a2, a2 + 'function mlpDlQ(i,e,t){let n=i.doc.lineAt(t);if(t!==n.to)return null;let r=i.doc.lineAt(e);' +
                  'return r.from===e?{from:e,to:t}:/^[ \\t]*(?:>[ \\t]?)*[ \\t]*$/.test(i.sliceDoc(r.from,e))?{from:r.from,to:t}:null}');
    fs.writeFileSync(p, s);
    console.log("patch dist/webview-editor.js (tables inside blockquotes)");
  }
}

// 9. webview: Obsidian callouts — "> [!type] Title" (+/- fold markers accepted).
//    Every line of the blockquote gets "mlp-callout mlp-co-<colour>" (+ -first/-last);
//    on the title line "[!type]" is replaced by an icon (+ the type name when no title
//    is given) and the title is marked "mlp-callout-title". When the cursor is on the
//    title line the raw source shows. A table inside a quote gets "mlp-table-in-quote"
//    on its wrapper so the theme can frame it. Colours/shapes live in the CSS theme.
{
  const p = path.join(dir, "dist/webview-editor.js");
  let s = fs.readFileSync(p, "utf8");
  if (s.includes("mlpCalloutExt")) console.log("skip  dist/webview-editor.js callouts (already patched)");
  else {
    const ICONS = {
      // simple stroke icons drawn for this patch (24x24, stroke=currentColor)
      info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
      warn: '<path d="M12 3 2.5 20h19z"/><path d="M12 10v5M12 17.5v.01"/>',
      danger: '<path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z"/><path d="M12 8v5M12 16v.01"/>',
      ok: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.7 2.7L16.5 9.5"/>',
      fail: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
      ask: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5v.7M12 17v.01"/>',
      tip: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
      note: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
      list: '<path d="M8 6h12M8 12h12M8 18h12M4 6v.01M4 12v.01M4 18v.01"/>',
      quote: '<path d="M7 7H4v6h3l-1 4M17 7h-3v6h3l-1 4"/>',
    };
    const TYPES = {
      note: ["blue", "note"], info: ["blue", "info"], todo: ["blue", "ok"],
      abstract: ["cyan", "list"], summary: ["cyan", "list"], tldr: ["cyan", "list"],
      tip: ["cyan", "tip"], hint: ["cyan", "tip"], important: ["cyan", "tip"],
      success: ["green", "ok"], check: ["green", "ok"], done: ["green", "ok"],
      question: ["yellow", "ask"], help: ["yellow", "ask"], faq: ["yellow", "ask"],
      warning: ["orange", "warn"], caution: ["orange", "warn"], attention: ["orange", "warn"],
      failure: ["red", "fail"], fail: ["red", "fail"], missing: ["red", "fail"],
      danger: ["red", "danger"], error: ["red", "danger"], bug: ["red", "danger"],
      example: ["purple", "list"], quote: ["gray", "quote"], cite: ["gray", "quote"],
    };
    const defs =
      `var mlpCoTypes=${JSON.stringify(TYPES)},mlpCoIcons=${JSON.stringify(ICONS)};` +
      'var mlpCoW=class extends ce{constructor(t,l){super();this.t=t;this.l=l}eq(o){return o.t===this.t&&o.l===this.l}' +
      'toDOM(){const s=document.createElement("span");s.className="mlp-callout-icon";const k=(mlpCoTypes[this.t]||["blue","note"])[1];' +
      's.innerHTML=\'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">\'+mlpCoIcons[k]+"</svg>";' +
      'if(this.l){const b=document.createElement("span");b.className="mlp-callout-title";b.textContent=this.l;s.appendChild(b)}return s}ignoreEvent(){return!1}};' +
      'function mlpCalloutExt(){function build(v){const st=v.state,doc=st.doc,out=[],seen=new Set;' +
      'for(const{from,to}of v.visibleRanges)U(st).iterate({from,to,enter:n=>{if(n.name!=="Blockquote")return;if(seen.has(n.from))return!1;seen.add(n.from);' +
      'const l1=doc.lineAt(n.from),m=/^([ \\t]*>[ \\t]?)\\[!([A-Za-z][\\w-]*)\\]([+-]?)[ \\t]*(.*)$/.exec(l1.text);if(!m)return!1;' +
      'const t=m[2].toLowerCase(),col=(mlpCoTypes[t]||["blue"])[0],last=doc.lineAt(n.to).number;' +
      'for(let k=l1.number;k<=last;k++){const L=doc.line(k);out.push(B.line({class:"mlp-callout mlp-co-"+col+(k===l1.number?" mlp-callout-first":"")+(k===last?" mlp-callout-last":"")}).range(L.from))}' +
      'if(!Zi(st,l1.from,l1.to)){const a=l1.from+m[1].length,b=a+m[2].length+3+m[3].length,rest=l1.text.slice(b-l1.from),ws=rest.length-rest.trimStart().length,ts=b+ws;' +
      'const label=m[4].trim()?"":m[2].charAt(0).toUpperCase()+m[2].slice(1);' +
      'out.push(B.replace({widget:new mlpCoW(t,label)}).range(a,ts));if(ts<l1.to)out.push(B.mark({class:"mlp-callout-title"}).range(ts,l1.to))}' +
      'return!1}});return B.set(out,!0)}' +
      'return Ne.fromClass(class{constructor(v){this.decorations=build(v)}update(u){(u.docChanged||u.viewportChanged||u.selectionSet)&&(this.decorations=build(u.view))}},{decorations:v=>v.decorations})}';
    const a1 = 'c(pi,"postToHost");';
    const a2 = 'mlpWikiExt(),';
    const a3 = 'r=document.createElement("div");r.className="mlp-table-wrap",';
    for (const [a, name] of [[a1, "postToHost"], [a2, "wikilink ext (patch 5 first)"], [a3, "table wrapper"]]) {
      const n = s.split(a).length - 1;
      if (n !== 1) throw new Error(`callouts: ${name} anchor found ${n} times, expected 1`);
    }
    s = s.replace(a1, a1 + defs).replace(a2, a2 + "mlpCalloutExt(),")
         .replace(a3, 'r=document.createElement("div");r.className="mlp-table-wrap"+(/>/.test(this.indent||"")?" mlp-table-in-quote":""),');
    fs.writeFileSync(p, s);
    console.log("patch dist/webview-editor.js (callouts)");
  }
}

// 10. Footnotes [^label] / [^label]: text (Obsidian / Pandoc / GFM).
//    Upstream parses "[^1]" as a reference link (an <a> with an empty href) and
//    "[^1]: …" as link syntax, so neither works. Both Link renderers now leave
//    "[^…]" alone, and a ViewPlugin renders:
//    - references as superscript numbers (numbered by first citation), with a hover
//      card showing the footnote (inline markdown, wikilinks included); a click scrolls
//      to the definition and flashes it;
//    - definitions as "n." + a back-link "↩" to the first citation, in a smaller line.
//    Raw source shows when the cursor is on the line; undefined references stay raw.
//    Table cells get the same superscripts through renderInlineInto (Xl).
{
  const p = path.join(dir, "dist/webview-editor.js");
  let s = fs.readFileSync(p, "utf8");
  if (s.includes("mlpFnExt")) console.log("skip  dist/webview-editor.js footnotes (already patched)");
  else {
    const defs =
      'var mlpFn={doc:null,defs:new Map,order:new Map,first:new Map,firstDefLine:0};' +
      'function mlpFnScan(st){if(mlpFn.doc===st.doc)return mlpFn;const doc=st.doc,defs=new Map,order=new Map,first=new Map;let firstDefLine=0;' +
      'for(let k=1;k<=doc.lines;k++){const L=doc.line(k),m=/^\\[\\^([^\\]\\s]+)\\]:[ \\t]?(.*)$/.exec(L.text);if(m){let t=m[2],j=k+1;' +
      'while(j<=doc.lines&&/^( {2,}|\\t)\\S/.test(doc.line(j).text)){t+=" "+doc.line(j).text.trim();j++}' +
      'defs.set(m[1],{from:L.from,line:k,text:t});firstDefLine||(firstDefLine=k);continue}' +
      '}for(let k=1;k<=doc.lines;k++){const L=doc.line(k);if(/^\\[\\^[^\\]\\s]+\\]:/.test(L.text))continue;' +
      'const re=/\\[\\^([^\\]\\s]+)\\]/g;let r;while(r=re.exec(L.text)){if(!defs.has(r[1]))continue;order.has(r[1])||order.set(r[1],order.size+1);first.has(r[1])||first.set(r[1],L.from+r.index)}}' +
      'for(const k of defs.keys())order.has(k)||order.set(k,order.size+1);' +
      'Object.assign(mlpFn,{doc,defs,order,first,firstDefLine});return mlpFn}' +
      'function mlpFnJump(dom,pos){try{const v=R.findFromDOM(dom.closest(".cm-editor"));if(!v)return;v.dispatch({effects:R.scrollIntoView(pos,{y:"center"})});' +
      'let tries=0;const go=()=>{try{const sc=v.scrollDOM,blk=v.lineBlockAt(pos),r=sc.getBoundingClientRect(),top=blk.top+v.documentTop-r.top+sc.scrollTop;if(top-sc.scrollTop<-5||top-sc.scrollTop>sc.clientHeight){++tries<12&&setTimeout(go,90);return}getComputedStyle(sc).position==="static"&&(sc.style.position="relative");const d=document.createElement("div");d.className="mlp-fn-flashbox";d.style.top=top+"px";d.style.height=blk.height+"px";sc.appendChild(d);setTimeout(()=>d.remove(),1500)}catch(_){++tries<12&&setTimeout(go,90)}};setTimeout(go,60)}catch(_){}}' +
      'function mlpFnRefDom(label){const d=mlpFn.defs.get(label),n=mlpFn.order.get(label)||"?",w=document.createElement("span");w.className="mlp-fn";' +
      'const a=document.createElement("sup");a.className="mlp-fn-ref";a.textContent=n;w.appendChild(a);' +
      'if(d){const c=document.createElement("span");c.className="mlp-fn-pop";try{Xl(c,d.text,gy)}catch(_){c.textContent=d.text}w.appendChild(c);' +
      'w.addEventListener("mouseenter",()=>{w.classList.add("mlp-fn-open");const r=a.getBoundingClientRect(),W=c.offsetWidth,H=c.offsetHeight,vw=document.documentElement.clientWidth;' +
      'c.style.left=Math.max(8,Math.min(r.left-16,vw-W-8))+"px";c.style.top=(r.top-H-6>=8?r.top-H-6:r.bottom+6)+"px"});' +
      'w.addEventListener("mouseleave",()=>w.classList.remove("mlp-fn-open"));' +
      'a.addEventListener("mousedown",e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();mlpFnJump(a,d.from)})}return w}' +
      'var mlpFnRefW=class extends ce{constructor(l,n,t){super();this.l=l;this.n=n;this.t=t}eq(o){return o.l===this.l&&o.n===this.n&&o.t===this.t}toDOM(){return mlpFnRefDom(this.l)}ignoreEvent(){return!0}};' +
      'var mlpFnDefW=class extends ce{constructor(l,n,b){super();this.l=l;this.n=n;this.b=b}eq(o){return o.l===this.l&&o.n===this.n&&o.b===this.b}' +
      'toDOM(){const w=document.createElement("span");w.className="mlp-fn-def-num";w.textContent=this.n+".";if(this.b>=0){const a=document.createElement("span");a.className="mlp-fn-back";a.textContent="\\u21a9";a.title="back to text";' +
      'const b=this.b;a.addEventListener("mousedown",e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();mlpFnJump(a,b)});w.appendChild(a)}return w}ignoreEvent(){return!0}};' +
      'function mlpFnExt(){function build(v){const st=v.state,F=mlpFnScan(st),out=[];if(!F.defs.size)return B.none;' +
      'for(const{from,to}of v.visibleRanges){for(let pos=from;pos<=to;){const L=st.doc.lineAt(pos);pos=L.to+1;' +
      'const dm=/^\\[\\^([^\\]\\s]+)\\]:[ \\t]?/.exec(L.text);' +
      'if(dm&&F.defs.has(dm[1])){out.push(B.line({class:"mlp-fn-def"+(L.number===F.firstDefLine?" mlp-fn-def-first":"")}).range(L.from));' +
      'if(!Zi(st,L.from,L.to))out.push(B.replace({widget:new mlpFnDefW(dm[1],F.order.get(dm[1])||"?",F.first.has(dm[1])?F.first.get(dm[1]):-1)}).range(L.from,L.from+dm[0].length));continue}' +
      'if(Zi(st,L.from,L.to))continue;const re=/\\[\\^([^\\]\\s]+)\\]/g;let m;' +
      'while(m=re.exec(L.text)){const s=L.from+m.index,e=s+m[0].length,d=F.defs.get(m[1]);if(!d||mlpInSrc(st,s))continue;' +
      'out.push(B.replace({widget:new mlpFnRefW(m[1],F.order.get(m[1]),d.text)}).range(s,e))}}}return B.set(out,!0)}' +
      'return Ne.fromClass(class{constructor(v){this.decorations=build(v)}update(u){(u.docChanged||u.viewportChanged||u.selectionSet)&&(this.decorations=build(u.view))}},{decorations:v=>v.decorations})}' +
      'function mlpFnDom(root){try{if(!mlpFn.defs.size)return;const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),nodes=[];let n;' +
      'while(n=w.nextNode())/\\[\\^[^\\]\\s]+\\]/.test(n.nodeValue)&&!n.parentElement.closest("code,.mlp-fn")&&nodes.push(n);' +
      'for(const t of nodes){const f=document.createDocumentFragment();t.nodeValue.split(/(\\[\\^[^\\]\\s]+\\])/).forEach(part=>{const m=/^\\[\\^([^\\]\\s]+)\\]$/.exec(part);' +
      'm&&mlpFn.defs.has(m[1])?f.append(mlpFnRefDom(m[1])):part&&f.append(part)});t.replaceWith(f)}}catch(_){}}';
    const edits = [
      ['c(pi,"postToHost");', null],                                   // definitions go here
      ['mlpWikiExt(),', 'mlpWikiExt(),mlpFnExt(),'],                   // register the plugin
      ['case"Link":{let m=p.node.getChildren("LinkMark");if(m.length<2)return;',
       'case"Link":{if(e.sliceDoc(p.from,p.from+2)==="[^")return;let m=p.node.getChildren("LinkMark");if(m.length<2)return;'],
      ['case"Link":{let{label:o,url:l,title:a}=uy(e,t),',
       'case"Link":{if(t.slice(e.from,e.from+2)==="[^"){ws(i,xs(t.slice(e.from,e.to)));return}let{label:o,url:l,title:a}=uy(e,t),'],
      ['Kf(i,Tv($v.parse(q)),q,t);mlpWikiPost(i,L)}', 'Kf(i,Tv($v.parse(q)),q,t);mlpWikiPost(i,L);mlpFnDom(i)}'],
    ];
    for (const [a] of edits) {
      const n = s.split(a).length - 1;
      if (n !== 1) throw new Error(`footnotes: anchor "${a.slice(0, 40)}" found ${n} times, expected 1`);
    }
    for (const [a, b] of edits) s = s.replace(a, b === null ? a + defs : b);
    fs.writeFileSync(p, s);

    const css = path.join(dir, "media/webview-editor-theme.css");
    fs.appendFileSync(css, `
/* Local patch (footnotes): superscript references with a hover card, numbered
   definitions with a back-link, and a brief flash on the jump target. */
.mlp-fn { position: relative; }
.mlp-fn-ref {
	color: var(--vscode-textLink-foreground, #2f6feb);
	cursor: pointer; font-weight: 600; font-size: 0.72em; padding: 0 0.12em;
}
.mlp-fn-ref:hover { text-decoration: underline; }
.mlp-fn-pop {
	display: block; visibility: hidden; position: fixed; left: 0; top: 0; z-index: 1000;
	width: max-content; max-width: min(32em, calc(100vw - 16px)); white-space: normal; text-indent: 0;
	padding: 0.55em 0.8em; border-radius: 8px; font-size: 0.86em; line-height: 1.55; font-weight: 400;
	color: var(--vscode-editorHoverWidget-foreground, var(--vscode-editor-foreground, #24292f));
	background: var(--vscode-editorHoverWidget-background, var(--vscode-editor-background, #ffffff));
	border: 1px solid var(--vscode-editorHoverWidget-border, rgba(128,128,128,0.35));
	box-shadow: 0 6px 20px rgba(0,0,0,0.20);
	pointer-events: none;
}
.mlp-fn.mlp-fn-open .mlp-fn-pop { visibility: visible; }
.cm-line.mlp-fn-def { font-size: 0.88em; line-height: 1.55; padding-left: 2.2em !important; text-indent: -2.2em; }
.cm-line.mlp-fn-def-first { border-top: 1px solid rgba(128,128,128,0.35); margin-top: 1.2em; padding-top: 0.8em !important; }
.mlp-fn-def-num { display: inline-block; min-width: 2.2em; text-indent: 0; font-weight: 600; opacity: 0.85; }
.mlp-fn-back { margin-left: 0.25em; cursor: pointer; color: var(--vscode-textLink-foreground, #2f6feb); font-weight: 400; }
.mlp-fn-flashbox { position: absolute; left: 0; right: 0; pointer-events: none; z-index: 3;
	background: rgba(255, 196, 0, 0.30); border-radius: 4px; animation: mlp-fn-fade 1.5s ease-out forwards; }
@keyframes mlp-fn-fade { 0%, 40% { opacity: 1; } 100% { opacity: 0; } }
`);
    console.log("patch dist/webview-editor.js + css (footnotes)");
  }
}

if (rename) {
  const p = path.join(dir, "package.json");
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  if (!j.name.endsWith("-claude")) {
    j.name += "-claude";
    j.publisher = "local";   // not the upstream publisher: this is a patched copy
    delete j.scripts; delete j.devDependencies;   // dist/ is prebuilt; vsce must not rebuild
    j.displayName += " (Plus)";
    j.description = "Patched build (md-live-preview-plus): wikilinks, callouts, tables in quotes, and Claude Code sees the selected text. " + j.description;
  }
  fs.writeFileSync(p, JSON.stringify(j, null, "\t") + "\n");
  console.log(`rename -> ${j.publisher}.${j.name} ${j.version}`);
}
