// Insert 8 diagnostic probes into the unpacked extension's background.js.
// Logs ship over WebSocket to the local collector (SW fetch to 127.0.0.1 is
// silently blocked by Chrome 150 Private Network Access; WS is allowed by the
// extension CSP). Requires log-collector.js running. Reload the extension in
// chrome://extensions afterwards. Idempotent; restore from the .bak-probes
// backup when done.
//
//   node instrument-extension.js [--ext-dir <path>] [--port 8791]
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const EXT_DIR = opt("--ext-dir", "/Users/dmeck/project/CodexChromePlug/codex-1.1.5_0/1.1.5_0");
const PORT = opt("--port", "8791");
const FILE = join(EXT_DIR, "background.js");

const PRELUDE =
  ';globalThis.__xev=0;globalThis.__xbuf=[];globalThis.__xws=null;' +
  `globalThis.__xwsInit=()=>{try{if(globalThis.__xws&&globalThis.__xws.readyState<=1)return;const w=new WebSocket("ws://127.0.0.1:${PORT}/ws");globalThis.__xws=w;w.onopen=()=>{try{const b=globalThis.__xbuf;globalThis.__xbuf=[];for(const m of b)w.send(m)}catch(e){}};w.onclose=()=>{globalThis.__xws=null};w.onerror=()=>{try{w.close()}catch(e){}globalThis.__xws=null}}catch(e){globalThis.__xws=null}};` +
  'globalThis.__xlog=(tag,data)=>{const line=JSON.stringify({t:Date.now(),tag:String(tag),data:data??null});try{globalThis.__xwsInit();const w=globalThis.__xws;if(w&&w.readyState===1){w.send(line)}else if(globalThis.__xbuf.length<4000){globalThis.__xbuf.push(line)}}catch(e){}};' +
  '__xlog("sw.start",{v:2});';

const REPLACEMENTS = [
  {
    name: "cn/attach",
    old: 'async function cn(t){await xt(t,async()=>{if(!se.has(t)){try{await chrome.debugger.attach({tabId:t},"1.3")}catch(e){if(!Ma(e))throw e}await un(t),se.add(t)}})}',
    next: 'async function cn(t){await xt(t,async()=>{if(!se.has(t)){__xlog("attach.begin",{tabId:t});try{await chrome.debugger.attach({tabId:t},"1.3");__xlog("attach.ok",{tabId:t})}catch(e){if(__xlog("attach.err",{tabId:t,msg:String(e&&e.message||e)}),!Ma(e))throw e}await un(t),se.add(t)}})}',
  },
  {
    name: "session.executeCdp",
    old: 'async executeCdp(t){const e=t.target.tabId;if(typeof e=="number"&&(await this.requireSessionTab(e),!se.has(e)))throw new Error("Debugger unattached");try{return await En(t)}catch(a){throw $n(a)&&typeof e=="number"&&await hn(e),a}}',
    next: 'async executeCdp(t){const e=t.target.tabId;if(__xlog("execCdp.in",{m:t.method,tab:e}),typeof e=="number"&&(await this.requireSessionTab(e),!se.has(e)))throw new Error("Debugger unattached");try{const r=await En(t);return __xlog("execCdp.ok",{m:t.method}),r}catch(a){throw __xlog("execCdp.err",{m:t.method,msg:String(a&&a.message||a),to:$n(a)}),$n(a)&&typeof e=="number"&&await hn(e),a}}',
  },
  {
    name: "dispatcher.executeCdp",
    old: 'async executeCdp(t){return await(await this.activateSession(t)).executeCdp(t)}',
    next: 'async executeCdp(t){__xlog("dispatch.execCdp",{m:t&&t.method});return await(await this.activateSession(t)).executeCdp(t)}',
  },
  {
    name: "activateSession",
    old: 'async activateSession(t){const e=this.resolveSession(t);return await e.activateTurn(this.requireTurnId(t)),e}',
    next: 'async activateSession(t){const e=this.resolveSession(t);return __xlog("activateSession.begin"),await e.activateTurn(this.requireTurnId(t)),__xlog("activateSession.done"),e}',
  },
  {
    name: "En (cdp timeout race)",
    old: 'async function En(t){const e=Mn(t.timeoutMs);let a;const s=new Promise((r,i)=>{a=setTimeout(()=>{i(new Na(t.method,e))},e)});try{return await Promise.race([La(t),s])}finally{a!==void 0&&clearTimeout(a)}}',
    next: 'async function En(t){const e=Mn(t.timeoutMs);__xlog("En.begin",{m:t.method,ms:e});let a;const s=new Promise((r,i)=>{a=setTimeout(()=>{__xlog("En.timeout",{m:t.method,ms:e}),i(new Na(t.method,e))},e)});try{return await Promise.race([La(t).then(v=>(__xlog("En.resp",{m:t.method}),v),err=>{__xlog("En.cmdErr",{m:t.method,msg:String(err&&err.message||err)});throw err}),s])}finally{a!==void 0&&clearTimeout(a)}}',
  },
  {
    name: "handleIncomingRequest",
    old: 'async handleIncomingRequest(t){if(t.id===void 0){(this.eventHandlers.get(t.method??"")??[]).forEach(a=>a(t.params));return}const e=this.requestHandlers.get(t.method??"");if(!e){this.transport.sendMessage({jsonrpc:"2.0",id:t.id,error:{code:-1,message:`No handler registered for method: ${t.method}`}});return}try{const a=await e(t.params);this.transport.sendMessage({jsonrpc:"2.0",id:t.id,result:a})}catch(a){this.transport.sendMessage({jsonrpc:"2.0",id:t.id,error:{code:1,message:a instanceof Error?a.message:String(a)}})}}',
    next: 'async handleIncomingRequest(t){if(t.id!==void 0)__xlog("rpc.in",{m:t.method,id:t.id});if(t.id===void 0){(this.eventHandlers.get(t.method??"")??[]).forEach(a=>a(t.params));return}const e=this.requestHandlers.get(t.method??"");if(!e){this.transport.sendMessage({jsonrpc:"2.0",id:t.id,error:{code:-1,message:`No handler registered for method: ${t.method}`}});return}try{const a=await e(t.params);__xlog("rpc.out",{id:t.id,ok:1});this.transport.sendMessage({jsonrpc:"2.0",id:t.id,result:a})}catch(a){__xlog("rpc.out",{id:t.id,ok:0,msg:String(a&&a.message||a)});this.transport.sendMessage({jsonrpc:"2.0",id:t.id,error:{code:1,message:a instanceof Error?a.message:String(a)}})}}',
  },
  {
    name: "onDetach",
    old: 'chrome.debugger.onDetach.addListener(t=>{typeof t.tabId=="number"&&se.delete(t.tabId),typeof t.targetId=="string"&&(Ze.delete(t.targetId),Fe.delete(t.targetId))})',
    next: 'chrome.debugger.onDetach.addListener(t=>{__xlog("dbg.onDetach",{tabId:t.tabId??null,targetId:t.targetId??null,reason:t.reason??null}),typeof t.tabId=="number"&&se.delete(t.tabId),typeof t.targetId=="string"&&(Ze.delete(t.targetId),Fe.delete(t.targetId))})',
  },
  {
    name: "onEvent (capped)",
    old: 'chrome.debugger.onEvent.addListener((i,o,d)=>{r.sendCdpEvent({source:i,method:o,params:d})})',
    next: 'chrome.debugger.onEvent.addListener((i,o,d)=>{if(globalThis.__xev+=1,globalThis.__xev<=400)__xlog("dbg.onEvent",{m:o});r.sendCdpEvent({source:i,method:o,params:d})})',
  },
];

let src = readFileSync(FILE, "utf8");
if (src.includes("__xlog")) {
  console.log("already instrumented, nothing to do");
  process.exit(0);
}
copyFileSync(FILE, FILE + ".bak-probes");
for (const { name, old: oldStr, next } of REPLACEMENTS) {
  const count = src.split(oldStr).length - 1;
  if (count !== 1) {
    console.error(`ABORT: anchor "${name}" matched ${count}x (expected 1) — file untouched since backup`);
    process.exit(1);
  }
  src = src.replace(oldStr, next);
  console.log(`probed: ${name}`);
}
src = PRELUDE + src;
writeFileSync(FILE, src);
execFileSync(process.execPath, ["--check", FILE]);
console.log("syntax ok. Reload the extension in chrome://extensions to activate probes.");
console.log("Restore afterwards with: cp", FILE + ".bak-probes", FILE);
