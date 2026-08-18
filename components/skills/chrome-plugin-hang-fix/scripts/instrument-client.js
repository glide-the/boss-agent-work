// Insert kernel-side [XK] probes into browser-client.mjs. Logs go to
// console.error (visible in js results) AND ship in batches to the local
// collector via plain fetch (the kernel has no global WebSocket; console
// output is lost when a js call times out, so shipping is essential).
// Requires log-collector.js running. Idempotent; restore from .bak-probes.
//
//   node instrument-client.js [--client <path>] [--port 8791]
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const FILE = opt(
  "--client",
  "/Users/dmeck/.codex/plugins/cache/openai-bundled/chrome/latest/scripts/browser-client.mjs",
);
const PORT = opt("--port", "8791");

const PRELUDE = `
var __xkBuf=[],__xkTimer=null;
function xkLog(line){try{console.error(line)}catch(e){}try{__xkBuf.push(JSON.stringify({t:Date.now(),tag:"kernel",data:line}));if(!__xkTimer){__xkTimer=setTimeout(()=>{__xkTimer=null;const b=__xkBuf.splice(0,__xkBuf.length);if(b.length){fetch("http://127.0.0.1:${PORT}/log",{method:"POST",headers:{"Content-Type":"text/plain"},body:b.join("\\n")}).catch(()=>{})}},100)}}catch(e){}}
`;

const SWAPS = [
  {
    name: "pweval handler entry",
    old: 'u1=_(oe.PlaywrightEvaluate,async(e,t)=>{let r=k(e.tab_id),n=se(e),o=v5(e.script),',
    next: 'u1=_(oe.PlaywrightEvaluate,async(e,t)=>{xkLog("[XK] pweval.enter t="+Date.now());let r=k(e.tab_id),n=se(e),o=v5(e.script),',
  },
  {
    name: "executeTargetCdp entry",
    old: 'async executeTargetCdp(r,n,o,i={}){return await this.ensureAttachedTab(r.tabId),await jf(',
    next: 'async executeTargetCdp(r,n,o,i={}){xkLog("[XK] cdp."+n+" enter t="+Date.now());return await this.ensureAttachedTab(r.tabId),await jf(',
  },
  {
    name: "api.executeCdp send/recv",
    old: 'try{return await this.api.executeCdp({target:r,method:n,commandParams:o??{},timeoutMs:i.timeoutMs})}catch(s){',
    next: 'try{xkLog("[XK] cdp."+n+" apiCall t="+Date.now());let xkRes=await this.api.executeCdp({target:r,method:n,commandParams:o??{},timeoutMs:i.timeoutMs});xkLog("[XK] cdp."+n+" apiDone t="+Date.now());return xkRes}catch(s){',
  },
  {
    name: "socket sendMessage",
    old: 'sendMessage(t){if(this.socket==null)throw new Error("native pipe is closed");this.socket.write(mk(JSON.stringify(t)))}',
    next: 'sendMessage(t){if(this.socket==null)throw new Error("native pipe is closed");xkLog("[XK] sock.send "+(t&&t.method?("m="+t.method):("id="+(t&&t.id)))+" t="+Date.now());this.socket.write(mk(JSON.stringify(t)))}',
  },
  {
    name: "socket handleData",
    old: 'handleData(t){for(let r of this.frameDecoder.push(t))this.messageCallback?.(JSON.parse(r))}',
    next: 'handleData(t){for(let r of this.frameDecoder.push(t)){let xkMsg=JSON.parse(r);if(xkMsg&&xkMsg.method!=="onCDPEvent"&&xkMsg.method!=="onDownloadChange")xkLog("[XK] sock.recv "+(xkMsg&&xkMsg.method?("m="+xkMsg.method):("id="+(xkMsg&&xkMsg.id)+(xkMsg&&xkMsg.error?" err":"")))+" t="+Date.now());this.messageCallback?.(xkMsg)}}',
  },
  {
    name: "wrap Ic (origin decision)",
    old: 'catch{return null}}async function Rc',
    next: 'catch{return null}}Ic=(origIc=>async(e,t)=>{xkLog("[XK] Ic.in res="+JSON.stringify(e&&e.resource)+" conv="+String(e&&e.conversationId));let r=await origIc(e,t);xkLog("[XK] Ic.out "+JSON.stringify(r));return r})(Ic);async function Rc',
  },
  {
    name: "probe N1 elicit",
    old: 'let o=e();if(o==null)throw new Error(J(`Browser Use encountered an error attempting to request permission to access',
    next: 'xkLog("[XK] N1.elicit origin="+t);let o=e();if(o==null)throw new Error(J(`Browser Use encountered an error attempting to request permission to access',
  },
];

let src = readFileSync(FILE, "utf8");
if (src.includes("function xkLog(")) {
  console.log("already instrumented, nothing to do");
  process.exit(0);
}
copyFileSync(FILE, FILE + ".bak-probes");
for (const { name, old: oldStr, next } of SWAPS) {
  const count = src.split(oldStr).length - 1;
  if (count !== 1) {
    console.error(`ABORT: anchor "${name}" matched ${count}x (expected 1) — restore from .bak-probes if needed`);
    process.exit(1);
  }
  src = src.replace(oldStr, next);
  console.log(`probed: ${name}`);
}
src = PRELUDE + src;
writeFileSync(FILE, src);
execFileSync(process.execPath, ["--check", FILE]);
console.log("syntax ok. Probes activate on the next kernel import of browser-client.mjs.");
console.log("Restore afterwards with: cp", FILE + ".bak-probes", FILE);
