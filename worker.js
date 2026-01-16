// ================= Durable Object =================
export class CompetitionRoom {
  constructor(state) {
    this.state = state;
    this.data = {
      skaters: [],
      judges: 9,
      pcsComponents: ["SS", "TR", "PE", "CO", "IN"]
    };
  }

  async fetch(req) {
    if (req.method === "POST") {
      const body = await req.json();
      this.data = body;
      await this.state.storage.put("data", this.data);
      return Response.json({ ok: true });
    }

    const stored = await this.state.storage.get("data");
    return Response.json(stored || this.data);
  }
}

// ================= Scoring Engine =================
function trimmed(arr) {
  if (!arr || arr.length < 3) return 0;
  const s = [...arr].sort((a,b)=>a-b);
  s.shift(); s.pop();
  return s.reduce((a,b)=>a+b,0) / s.length;
}

function calculateResult(skater, pcsComponents) {
  let tes = 0;
  skater.elements.forEach(el=>{
    const goeValues = Object.values(el.goe || {});
    tes += el.base + trimmed(goeValues);
  });

  let pcs = 0;
  pcsComponents.forEach(c=>{
    const vals = Object.values(skater.pcs?.[c] || {});
    pcs += trimmed(vals);
  });

  const total = tes + pcs - (skater.deduction || 0);
  return { tes, pcs, total };
}

// ================= Page Template =================
function page(title, body) {
  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>${title}</title>
<style>
body { font-family: Arial; padding:20px }
input, button { margin:4px }
.card { border:1px solid #ccc; padding:10px; margin:10px 0 }
</style>
</head>
<body>
<h1>${title}</h1>
<nav>
<a href="/">公示屏</a> |
<a href="/admin">比赛管理</a> |
<a href="/tech">技术面板</a> |
<a href="/judge">裁判面板</a>
</nav>
<hr/>
${body}
</body>
</html>`;
}

// ================= Pages =================
const displayPage = page("比赛公示屏", `
<div id="out"></div>
<script>
async function load(){
  const d = await fetch("/api").then(r=>r.json());
  d.skaters.forEach(s=>{
    s.result = s.result || {tes:0,pcs:0,total:0};
  });
  d.skaters.sort((a,b)=>b.result.total - a.result.total);
  out.innerHTML = d.skaters.map((s,i)=>\`
    <div class="card">
      #\${i+1} <b>\${s.name}</b><br>
      TES: \${s.result.tes.toFixed(2)}<br>
      PCS: \${s.result.pcs.toFixed(2)}<br>
      TOTAL: <b>\${s.result.total.toFixed(2)}</b>
    </div>\`).join("");
}
setInterval(load,1000);
</script>
`);

const adminPage = page("比赛管理", `
<input id="name" placeholder="选手名"/>
<button onclick="add()">添加选手</button>
<div id="list"></div>
<script>
async function add(){
  const d = await fetch("/api").then(r=>r.json());
  d.skaters.push({name:name.value,elements:[],pcs:{},deduction:0});
  await fetch("/api",{method:"POST",body:JSON.stringify(d)});
}
async function load(){
  const d = await fetch("/api").then(r=>r.json());
  list.innerHTML = d.skaters.map(s=>s.name).join("<br>");
}
setInterval(load,1000);
</script>
`);

const techPage = page("技术面板", `
<button onclick="addEl()">给首位选手添加动作</button>
<div id="els"></div>
<script>
async function addEl(){
  const d = await fetch("/api").then(r=>r.json());
  const s = d.skaters[0];
  if(!s) return alert("没有选手");
  s.elements.push({name:"3T",base:4.2,goe:{}});
  await fetch("/api",{method:"POST",body:JSON.stringify(d)});
}
async function load(){
  const d = await fetch("/api").then(r=>r.json());
  const s = d.skaters[0];
  els.innerHTML = s ? s.elements.map(e=>e.name+" base:"+e.base).join("<br>") : "";
}
setInterval(load,1000);
</script>
`);

const judgePage = page("裁判面板", `
裁判编号: <input id="jid" placeholder="J1~J9"/><br>
<button onclick="goe()">给GOE</button>
<button onclick="pcs()">给PCS</button>
<script>
async function goe(){
  const j = jid.value;
  if(!j) return alert("输入裁判编号");
  const d = await fetch("/api").then(r=>r.json());
  const s = d.skaters[0];
  s.elements.forEach(el=>{
    el.goe[j] = Math.floor(Math.random()*7)-3;
  });
  s.result = (${calculateResult.toString()})(s,d.pcsComponents);
  await fetch("/api",{method:"POST",body:JSON.stringify(d)});
}
async function pcs(){
  const j = jid.value;
  const d = await fetch("/api").then(r=>r.json());
  const s = d.skaters[0];
  d.pcsComponents.forEach(c=>{
    s.pcs[c] ||= {};
    s.pcs[c][j] = 5 + Math.random()*5;
  });
  s.result = (${calculateResult.toString()})(s,d.pcsComponents);
  await fetch("/api",{method:"POST",body:JSON.stringify(d)});
}
</script>
`);

// ================= Worker =================
export default {
  fetch(req, env) {
    const url = new URL(req.url);

    if (url.pathname === "/api") {
      const id = env.ROOM.idFromName("main");
      return env.ROOM.get(id).fetch(req);
    }

    if (url.pathname === "/admin") return new Response(adminPage,{headers:{"Content-Type":"text/html"}});
    if (url.pathname === "/tech") return new Response(techPage,{headers:{"Content-Type":"text/html"}});
    if (url.pathname === "/judge") return new Response(judgePage,{headers:{"Content-Type":"text/html"}});

    return new Response(displayPage,{headers:{"Content-Type":"text/html"}});
  }
};
