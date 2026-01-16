export class CompetitionRoom {
  constructor(state) {
    this.state = state;
    this.clients = new Set();
    this.data = {
      phase: "SETUP",
      pcsComponents: ["SS", "TR", "PE", "CO", "IN"],
      competitions: {
        main: {
          name: "Demo Competition",
          events: {
            FS: {
              name: "Free Skating",
              skaters: []
            }
          }
        }
      },
      active: { comp: "main", event: "FS" }
    };
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();
      this.clients.add(server);

      const stored = await this.state.storage.get("data");
      if (stored) this.data = stored;
      server.send(JSON.stringify(this.data));

      server.onmessage = async e => {
        const msg = JSON.parse(e.data);
        if (msg.type === "update") {
          this.data = msg.data;
          await this.state.storage.put("data", this.data);
          this.broadcast();
        }
      };
      server.onclose = () => this.clients.delete(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("OK");
  }

  broadcast() {
    const msg = JSON.stringify(this.data);
    for (const ws of this.clients) ws.send(msg);
  }
}

// ===== Scoring =====
function trimmed(arr) {
  if (!arr || arr.length < 3) return 0;
  const s = [...arr].sort((a, b) => a - b);
  s.shift(); s.pop();
  return s.reduce((a, b) => a + b, 0) / s.length;
}

function calc(skater, comps) {
  let tes = 0, pcs = 0;
  skater.elements.forEach(e => {
    tes += e.base + trimmed(Object.values(e.goe || {}));
  });
  comps.forEach(c => {
    pcs += trimmed(Object.values(skater.pcs?.[c] || {}));
  });
  const total = tes + pcs - (skater.deduction || 0);
  return { tes, pcs, total };
}

// ===== HTML helpers =====
const html = b => new Response(b, { headers: { "Content-Type": "text/html" } });

function page(title, body) {
  return `<!doctype html><meta charset=utf-8>
<title>${title}</title>
<style>
body{font-family:sans-serif;padding:20px}
nav a{margin-right:10px}
.card{border:1px solid #ccc;padding:10px;margin:10px}
table{border-collapse:collapse}
td,th{border:1px solid #aaa;padding:4px}
</style>
<nav>
<a href="/">公示</a>
<a href="/admin">管理</a>
<a href="/tech">技术</a>
<a href="/judge">裁判</a>
<a href="/protocol">协议表</a>
<a href="/elements">元素表</a>
<a href="/judges">裁判明细</a>
</nav><hr>${body}`;
}

const client = `
let ws,data={};
ws=new WebSocket("wss://"+location.host+"/ws");
ws.onmessage=e=>{data=JSON.parse(e.data);render();}
`;

// ===== Views =====
const display = page("公示", `
<div id=out></div>
<script>${client}
function render(){
const ev=data.competitions[data.active.comp].events[data.active.event];
const arr=[...ev.skaters];
arr.forEach(s=>s.result=(${calc.toString()})(s,data.pcsComponents));
arr.sort((a,b)=>b.result.total-a.result.total);
out.innerHTML=arr.map((s,i)=>\`
<div class=card>#\${i+1} \${s.name}<br>
TES:\${s.result.tes.toFixed(2)} PCS:\${s.result.pcs.toFixed(2)} TOTAL:\${s.result.total.toFixed(2)}
</div>\`).join("");
}
</script>`);

const admin = page("管理", `
<input id=name placeholder="选手名">
<button onclick="add()">添加选手</button>
<select onchange="phase(this.value)">
<option>SETUP</option><option>WARMUP</option>
<option>SKATING</option><option>REVIEW</option><option>FINAL</option>
</select>
<div id=list></div>
<script>${client}
function render(){
const ev=data.competitions[data.active.comp].events[data.active.event];
list.innerHTML=ev.skaters.map(s=>s.name).join("<br>");
}
function add(){
const ev=data.competitions[data.active.comp].events[data.active.event];
ev.skaters.push({name:name.value,elements:[],pcs:{}});
ws.send(JSON.stringify({type:"update",data}));
}
function phase(p){data.phase=p;ws.send(JSON.stringify({type:"update",data}))}
</script>`);

const tech = page("技术面板", `
<button onclick="add()">添加元素</button>
<div id=els></div>
<script>${client}
function render(){
const s=data.competitions[data.active.comp].events[data.active.event].skaters[0];
els.innerHTML=s?s.elements.map(e=>e.name+" "+e.base).join("<br>"):"";
}
function add(){
const s=data.competitions[data.active.comp].events[data.active.event].skaters[0];
s.elements.push({name:"3T",base:4.2,goe:{}});
ws.send(JSON.stringify({type:"update",data}));
}
</script>`);

const judge = page("裁判", `
裁判ID:<input id=jid value="J1">
<button onclick="goe()">随机GOE</button>
<button onclick="pcs()">随机PCS</button>
<script>${client}
function goe(){
if(data.phase==="FINAL")return alert("Locked");
const s=data.competitions[data.active.comp].events[data.active.event].skaters[0];
s.elements.forEach(e=>{e.goe ||= {}; e.goe[jid.value]=Math.floor(Math.random()*7)-3});
ws.send(JSON.stringify({type:"update",data}));
}
function pcs(){
if(data.phase==="FINAL")return alert("Locked");
const s=data.competitions[data.active.comp].events[data.active.event].skaters[0];
data.pcsComponents.forEach(c=>{
s.pcs ||= {}; s.pcs[c] ||= {};
s.pcs[c][jid.value]=5+Math.random()*5;
});
ws.send(JSON.stringify({type:"update",data}));
}
</script>`);

const pad = page("Judge Pad", `
<style>
body{background:#111;color:white;font-size:22px}
button{font-size:22px;padding:12px;margin:6px}
.grid{display:grid;grid-template-columns:repeat(6,1fr)}
</style>
<div id=info></div>
<div id=goe class=grid></div>
<div id=pcs></div>
<script>${client}
const judge=new URLSearchParams(location.search).get("judge")||"J1";
function render(){
const s=data.competitions[data.active.comp].events[data.active.event].skaters[0];
if(!s)return;
const e=s.elements.at(-1)||{};
info.innerHTML="Judge "+judge+"<br>Element: "+(e.name||"-");
goe.innerHTML="";
for(let i=-5;i<=5;i++){
let b=document.createElement("button");
b.textContent=i;
b.onclick=()=>{e.goe ||= {}; e.goe[judge]=i; ws.send(JSON.stringify({type:"update",data}))};
goe.appendChild(b);
}
pcs.innerHTML=data.pcsComponents.map(c=>\`
<div>\${c}:<input type=range min=0 max=10 step=0.25
value="\${s.pcs?.[c]?.[judge]||5}"
onchange="s.pcs ||= {}; s.pcs['\${c}'] ||= {}; s.pcs['\${c}'][judge]=parseFloat(this.value);
ws.send(JSON.stringify({type:'update',data}))"></div>\`).join("");
}
</script>`);

// ===== Tables =====
function buildProtocol(data){
  const ev=data.competitions[data.active.comp].events[data.active.event];
  const arr=[...ev.skaters];
  arr.forEach(s=>s.result=calc(s,data.pcsComponents));
  arr.sort((a,b)=>b.result.total-a.result.total);
  return page("Protocol",`
<table><tr><th>Rank</th><th>Name</th><th>TES</th><th>PCS</th><th>Total</th></tr>
${arr.map((s,i)=>`<tr><td>${i+1}</td><td>${s.name}</td>
<td>${s.result.tes.toFixed(2)}</td><td>${s.result.pcs.toFixed(2)}</td>
<td>${s.result.total.toFixed(2)}</td></tr>`).join("")}</table>`);
}

function buildElements(data){
  const ev=data.competitions[data.active.comp].events[data.active.event];
  return page("Elements", ev.skaters.map(s=>`
<h3>${s.name}</h3>
<ul>${s.elements.map(e=>`<li>${e.name} (${e.base})</li>`).join("")}</ul>`).join(""));
}

function buildJudges(data){
  const ev=data.competitions[data.active.comp].events[data.active.event];
  return page("Judges", ev.skaters.map(s=>`
<h3>${s.name}</h3>
<pre>${JSON.stringify(s.pcs,null,2)}</pre>`).join(""));
}

// ===== Worker =====
export default {
  fetch(req, env) {
    const url=new URL(req.url);
    const id=env.ROOM.idFromName("main");
    const stub=env.ROOM.get(id);

    if(url.pathname==="/ws") return stub.fetch(req);
    if(url.pathname==="/admin") return html(admin);
    if(url.pathname==="/tech") return html(tech);
    if(url.pathname==="/judge") return html(judge);
    if(url.pathname==="/pad") return html(pad);

    if(url.pathname==="/protocol")
      return stub.fetch(new Request("http://x")).then(r=>r.json()).then(d=>html(buildProtocol(d)));
    if(url.pathname==="/elements")
      return stub.fetch(new Request("http://x")).then(r=>r.json()).then(d=>html(buildElements(d)));
    if(url.pathname==="/judges")
      return stub.fetch(new Request("http://x")).then(r=>r.json()).then(d=>html(buildJudges(d)));

    return html(display);
  }
};
