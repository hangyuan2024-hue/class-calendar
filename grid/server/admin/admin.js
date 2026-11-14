// 捞捞算力 · 控制中心
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const hhmm = (t) => new Date(t).toTimeString().slice(0, 8);
  const ago = (t) => { const s = (Date.now() - t) / 1000; return s < 60 ? "刚刚" : s < 3600 ? Math.round(s / 60) + " 分钟前" : s < 86400 ? Math.round(s / 3600) + " 小时前" : Math.round(s / 86400) + " 天前"; };
  const dur = (s) => (s == null ? "—" : s < 90 ? Math.round(s) + " 秒" : s < 5400 ? Math.round(s / 60) + " 分钟" : (s / 3600).toFixed(1) + " 小时");
  const toast = (t, err) => { const el = $("#toast"); el.textContent = t; el.className = "toast" + (err ? " err" : ""); el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 3000); };
  const cmpVer = (a, b) => { const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
  const fnName = (f) => (!f ? "" : f === "<module>" ? "主程序" : esc(f) + "()");
  const KIND = { map: "生成 / 评测", relay: "接力训练", diloco: "一起训", record: "录表情" };
  const STATE = { active: "进行中", paused: "暂停", done: "完成", failed: "失败" };

  // 口令：#t=…（从捞捞算力客户端打开）或者自己输入；只存在这个浏览器里
  let token = "";
  try { token = decodeURIComponent((location.hash.match(/t=([^&]+)/) || [])[1] || "") || localStorage.getItem("lgAdmin") || ""; } catch (e) {}
  if (location.hash) history.replaceState(null, "", location.pathname);
  async function api(p, body) {
    const r = await fetch(p, { method: body ? "POST" : "GET", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { showLogin("口令不对"); throw new Error("口令不对"); }
    if (!r.ok) throw new Error(j.error || "出错 " + r.status);
    return j;
  }
  const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, true); } };
  function showLogin(err) { $("#login").hidden = false; $("#app").hidden = true; $("#loginErr").textContent = err || ""; }
  $("#loginGo").onclick = async () => { token = $("#tok").value.trim(); try { await api("/api/admin/overview"); try { localStorage.setItem("lgAdmin", token); } catch (e) {} start(); } catch (e) {} };
  $("#tok").onkeydown = (e) => e.key === "Enter" && $("#loginGo").click();

  let ov = null, open = null;
  async function refresh() {
    try { ov = await api("/api/admin/overview"); } catch (e) { return; }
    const pct = Math.round(ov.total * 100);
    $("#kTotal").textContent = pct + "%"; $("#totalBar").style.width = pct + "%";
    $("#kOnline").textContent = ov.online; $("#kBusy").textContent = ov.busy; $("#kReview").textContent = ov.reviewsOpen || 0;
    $("#kMembers").textContent = ov.board.length; $("#kHours").textContent = (ov.board.reduce((a, b) => a + b.secs, 0) / 3600).toFixed(1);
    $("#stages").innerHTML = ov.stages.map((s, i) => `<div class="stage" data-n="${i + 1}"><b>${esc(s.name)}</b><small>${s.jobs} 个任务 · ${Math.round(s.pct * 100)}%</small><div class="bar ${s.pct >= 1 ? "done" : ""}"><i style="width:${s.pct * 100}%"></i></div></div>`).join("") || `<div class="stage"><b>还没有任务</b><small>点右上角「新任务」，或者用 node tools/grid.js job 计划.json</small></div>`;
    $("#stageList").innerHTML = ov.stages.map((s) => `<option value="${esc(s.name)}">`).join("");
    $("#jobCount").textContent = `${ov.jobs.filter((j) => j.state === "active").length} 个进行中 / 共 ${ov.jobs.length} 个`;
    $("#jobs").innerHTML = `<tr><th>任务</th><th>进度</th><th></th><th>状态</th><th></th></tr>` + ov.jobs.map((j) => `
      <tr class="click" data-job="${j.id}"><td><b>${esc(j.name)}</b><small>${KIND[j.kind] || j.kind}${j.stage ? " · " + esc(j.stage) : ""}${j.reviews.total ? ` · 审核 ${j.reviews.done}/${j.reviews.total}` : ""}${j.tasks.failed ? ` · <span style="color:var(--rd)">${j.tasks.failed} 个失败</span>` : ""}</small></td>
      <td><div class="bar ${j.state === "done" ? "done" : ""}"><i style="width:${j.pct * 100}%"></i></div></td>
      <td class="num">${j.kind === "relay" ? `${j.done}/${j.total} 步` : j.kind === "diloco" ? `${j.done}/${j.total} 轮` : `${j.done}/${j.total}`}<small>${j.state === "active" && j.eta ? "还要 " + dur(j.eta) : j.tasks.leased ? j.tasks.leased + (j.kind === "record" ? " 人在录" : " 台在算") : ""}</small></td>
      <td><span class="st ${j.state}">${STATE[j.state] || j.state}</span></td>
      <td>${j.state === "active" ? `<button class="btn sm" data-act="pause" data-id="${j.id}">暂停</button>` : j.state === "paused" ? `<button class="btn sm" data-act="resume" data-id="${j.id}">继续</button>` : ""}</td></tr>`).join("");
    $$("#jobs [data-act]").forEach((b) => (b.onclick = guard(async (e) => { e.stopPropagation(); await api("/api/admin/job/set", { id: +b.dataset.id, state: b.dataset.act === "pause" ? "paused" : "active" }); refresh(); })));
    $$("#jobs tr[data-job]").forEach((tr) => (tr.onclick = () => openJob(+tr.dataset.job)));
    $("#devCount").textContent = `${ov.online} 台在线 / 共 ${ov.devices.length} 台`;
    const newest = ov.devices.map((d) => d.version).filter(Boolean).sort(cmpVer).pop() || "";
    $("#devs").innerHTML = ov.devices.map((d) => `<div class="dev ${d.state}" data-dev="${d.id}"><i class="dot"></i><b>${esc(d.member)} · ${esc(d.name)}</b>${d.version ? ` <span class="ver ${cmpVer(d.version, newest) < 0 ? "old" : ""}" title="${cmpVer(d.version, newest) < 0 ? "不是最新版：空闲时会自动更新" : "最新版"}">v${esc(d.version)}</span>` : ""}
      <small>${esc(d.gpu || "没有显卡信息")}${d.vram ? " · " + d.vram + "G" : ""}${d.ram ? " · 内存 " + d.ram + "G" : ""}</small>
      <small>${d.online ? (d.task ? "在算「" + esc(d.task.name) + "」" : d.state === "waiting" ? "等空闲" : "在线，等任务") : "离线 · " + (d.lastSeen ? ago(d.lastSeen) : "")} · 累计 ${dur(d.secs)}</small>
      ${d.live && d.task ? `<div class="line">${fnName(d.live.fn)} 第 ${d.live.line || "—"} 行${d.live.gpu ? ` · ${d.live.gpu.temp}℃ ${d.live.gpu.util}%` : ""}</div><div class="bar"><i style="width:${(d.task.progress || 0) * 100}%"></i></div>` : ""}</div>`).join("") || `<p class="muted">还没有电脑加入：点「发邀请」</p>`;
    $$("#devs [data-dev]").forEach((el) => (el.onclick = () => openDev(+el.dataset.dev)));
    $("#feed").innerHTML = ov.events.map((e) => `<div class="${e.type}"><time>${hhmm(e.ts)}</time><span>${esc(e.msg)}</span></div>`).join("");
    $("#board").innerHTML = `<tr><th>#</th><th>名字</th><th>积分</th><th>算力</th><th>审核</th><th>录表情</th></tr>` + ov.board.map((m, i) => `<tr><td>${i + 1}</td><td>${esc(m.name)}</td><td class="num">${Math.round(m.points)}</td><td>${dur(m.secs)}</td><td>${m.reviews}</td><td>${m.records}</td></tr>`).join("");
    if (open) (open.kind === "job" ? openJob : openDev)(open.id, true);
  }
  // ---- 每日一轮、模型版本 ----
  async function loadCycle() {
    const c = await api("/api/admin/cycle").catch(() => null);
    if (!c) return;
    const RS = { done: "完成", running: "进行中", failed: "失败" };
    $("#pipes").innerHTML = c.pipelines.map((p) => `<div class="pipe"><b>${esc(p.name)}</b><small>${p.mode === "continuous" ? `不定时间：大家开着就算${p.when && p.when.manual ? " · 点「现在训练一次」才训练" : ""}${p.when && !p.when.manual ? ` · ${p.when.outputsOf || p.when.outputsLike ? "新数据" : "新审核"} <b>${p.when.fresh}</b>/${p.when.need} ${p.when.outputsOf || p.when.outputsLike ? "份" : "条"}就训练一次` : ""}${p.standing.length ? ` · ${p.standing.map((j) => `${esc(j.name)} 已做 ${j.done} 个${j.state === "paused" ? "（停下了）" : ""}`).join("，")}` : ""}` : `每天 ${esc(p.at)}`} · ${p.stages.map(esc).join(" → ")}${p.enabled ? "" : " · 已停用"}</small>
      <div class="runs">${p.runs.map((r) => `<span class="run ${r.state}" title="第 ${r.id} 轮">${esc(r.day.slice(5))} ${RS[r.state] || r.state}</span>`).join("") || `<span class="muted small">还没跑过</span>`}
      <button class="btn sm" data-run="${p.id}">${p.mode === "continuous" ? "现在训练一次" : "现在跑一轮"}</button><button class="btn sm" data-en="${p.id}" data-v="${p.enabled ? 0 : 1}">${p.enabled ? "停用" : "启用"}</button></div></div>`).join("") || `<p class="muted">还没设每日一轮：node tools/grid.js cycle 每日一轮.json</p>`;
    $$("#pipes [data-run]").forEach((b) => (b.onclick = guard(async () => { const r = await api("/api/admin/pipeline/run", { id: +b.dataset.run }); toast(`第 ${r.run} 轮开始了`); refresh(); loadCycle(); })));
    $$("#pipes [data-en]").forEach((b) => (b.onclick = guard(async () => { await api("/api/admin/pipeline/enable", { id: +b.dataset.en, enabled: b.dataset.v === "1" }); loadCycle(); })));
    const MS = { released: "已发布", candidate: "等你确认", rejected: "没发布" };
    const active = new Set(); const seen = new Set();
    for (const m of c.models) if (m.state === "released" && !seen.has(m.name)) { seen.add(m.name); active.add(m.id); }
    $("#models").innerHTML = `<tr><th>模型</th><th>版本</th><th>评测</th><th>状态</th><th></th></tr>` + c.models.map((m) => `<tr><td>${esc(m.name)}</td><td class="num">第 ${m.version} 版</td><td>${Object.entries(m.metrics).map(([k, v]) => `${esc(k)} ${typeof v === "number" ? +v.toFixed(4) : esc(v)}`).join("，")}<small>${esc(m.note || "")} · ${ago(m.created)}</small></td><td><span class="st ${m.state}">${active.has(m.id) ? "老师端在用" : m.state === "released" ? "以前发布的" : MS[m.state] || m.state}</span></td>
      <td>${m.state === "released" ? `<button class="btn sm" data-m="${m.id}" data-s="rejected">撤回</button>` : `<button class="btn sm" data-m="${m.id}" data-s="released">发布</button>`}</td></tr>`).join("");
    $$("#models [data-m]").forEach((b) => (b.onclick = guard(async () => { if (b.dataset.s === "rejected" && !confirm("撤回这一版？老师端会退回上一版。")) return; await api("/api/admin/model/set", { id: +b.dataset.m, state: b.dataset.s }); loadCycle(); })));
  }
  // ---- 老师的声音：传讲课视频 / 录音、训练、声音码 ----
  const mb = (b) => (b >= 1073741824 ? (b / 1073741824).toFixed(2) + " GB" : (b / 1048576).toFixed(1) + " MB");
  let vList = [];
  async function loadVoices() {
    vList = await api("/api/admin/voices").catch(() => vList);
    const sel = $("#vWho"), cur = sel.value;
    sel.innerHTML = vList.map((v) => `<option>${esc(v.member)}</option>`).join("");
    if (cur && vList.some((v) => v.member === cur)) sel.value = cur;
    const RS = { done: "训完了", running: "训练中…", failed: "失败了" };
    $("#voices").innerHTML = `<tr><th>老师</th><th>录的句子</th><th>导入的视频 / 录音</th><th>声音模型</th><th></th></tr>` + vList.map((v) => `<tr>
      <td>${esc(v.member)}</td><td class="num">${v.recs}</td>
      <td>${v.imports.map((i) => `${esc(i.name)} <span class="muted">${mb(i.size)}</span>`).join("<br>") || `<span class="muted">还没有</span>`}</td>
      <td>${v.model ? `第 ${v.model} 版` : `<span class="muted">还没有</span>`}${v.run ? `<small>${RS[v.run.state] || v.run.state} · ${ago(v.run.created)}</small>` : ""}</td>
      <td>${v.recs || v.imports.length ? `<button class="btn sm" data-vt="${esc(v.member)}">${v.model ? "重新训练" : "训练声音"}</button>` : ""}${v.model ? ` <button class="btn sm" data-vc="${esc(v.member)}">声音码</button>` : ""}</td></tr>`).join("");
    $$("#voices [data-vt]").forEach((b) => (b.onclick = guard(async () => {
      const who = b.dataset.vt;
      const r = await api("/api/admin/pipeline/run", { name: "声音训练", extra: { member: who, voiceOf: who } });
      toast(`开始训练${who}的声音（第 ${r.run} 轮）：等有空的电脑（6G 显存以上）来领`); loadVoices(); loadCycle();
    })));
    $$("#voices [data-vc]").forEach((b) => (b.onclick = guard(async () => {
      const who = b.dataset.vc;
      const r = await api("/api/admin/model/code", { name: "voice-" + who });
      drawer(`<h2>${esc(who)}的声音码</h2><p><code style="font-size:20px">${esc(r.code)}</code> <button class="btn sm" id="vcCopy">复制</button></p>
        <p class="muted">只发给${esc(who)}本人：在「捞捞PPT助手 → 我的声音」里填上，就用训练好的声音。没有这个码谁都下载不了。</p>
        <p><button class="btn sm" id="vcNew">泄露了：换一个（旧的作废）</button></p>`);
      $("#vcCopy").onclick = () => navigator.clipboard.writeText(r.code).then(() => toast("复制好了"));
      $("#vcNew").onclick = guard(async () => { if (!confirm("换一个新码？旧的马上作废，要把新码重新发给老师。")) return; await api("/api/admin/model/code", { name: "voice-" + who, rotate: true }); b.click(); });
    })));
  }
  $("#vAdd").onclick = guard(async () => {
    const n = (prompt("老师的名字（以后她装捞捞算力时填同一个名字）") || "").trim(); if (!n) return;
    await api("/api/admin/member/add", { name: n }); await loadVoices(); $("#vWho").value = n; toast(`登记好了：${n}`);
  });
  $("#vFiles").onchange = () => { $("#vGo").disabled = !$("#vFiles").files.length; };
  function putFile(f, who, onProg) {
    return new Promise((ok, bad) => {
      const x = new XMLHttpRequest();
      x.open("PUT", `/api/admin/upload?member=${encodeURIComponent(who)}&name=${encodeURIComponent(f.name)}`);
      x.setRequestHeader("authorization", "Bearer " + token);
      x.upload.onprogress = (e) => e.lengthComputable && onProg(e.loaded, e.total);
      x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch (e) {} x.status === 200 ? ok(j) : bad(new Error(j.error || "上传失败 " + x.status)); };
      x.onerror = () => bad(new Error("网络断了，重新传这个文件"));
      x.send(f);
    });
  }
  $("#vGo").onclick = guard(async () => {
    const who = $("#vWho").value, files = [...$("#vFiles").files];
    if (!who) throw new Error("先选老师（没有就「登记新老师」）");
    $("#vGo").disabled = true; $("#vBar").hidden = false;
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i], t0 = Date.now();
        await putFile(f, who, (a, b) => {
          const sp = a / Math.max(1, (Date.now() - t0) / 1000);
          $("#vBar i").style.width = Math.round((a / b) * 100) + "%";
          $("#vProg").textContent = `第 ${i + 1}/${files.length} 个「${f.name}」：${mb(a)} / ${mb(b)}，${(sp / 1048576).toFixed(1)} MB/秒`;
        });
      }
      toast(`传好了 ${files.length} 个：点「训练声音」开始训练`); $("#vFiles").value = "";
    } finally { $("#vBar").hidden = true; $("#vProg").textContent = ""; $("#vGo").disabled = !$("#vFiles").files.length; loadVoices(); }
  });
  async function loadInvites() {
    const list = await api("/api/admin/invites").catch(() => []);
    $("#invites").innerHTML = list.slice(0, 8).map((i) => `<div><span><code>${esc(i.code)}</code> ${esc(i.note || "")} ${i.role === "admin" ? "（管理员）" : ""}</span><span class="muted">${i.uses}/${i.max_uses} · ${i.expires < Date.now() ? "过期" : ago(i.created)}</span></div>`).join("") || `<p class="muted">还没发过邀请</p>`;
  }

  // ---- 抽屉：任务详情 ----
  async function openJob(id, quiet) {
    const d = await api("/api/admin/job?id=" + id).catch((e) => (quiet ? null : toast(e.message, true)));
    if (!d) return;
    open = { kind: "job", id };
    const keys = Object.keys(d.curves).sort((a, b) => (a === "loss" ? -1 : b === "loss" ? 1 : a.localeCompare(b)));
    const body = `<h1>${esc(d.name)}</h1><div class="sub">${KIND[d.kind]}${d.stage ? " · " + esc(d.stage) : ""} · <span class="st ${d.state}">${STATE[d.state]}</span> · ${d.kind === "relay" ? `第 ${d.done}/${d.total} 步` : d.kind === "diloco" ? `第 ${d.done}/${d.total} 轮` : `${d.done}/${d.total}`}${d.eta ? " · 预计还要 " + dur(d.eta) : ""}</div>
      <div class="acts2">${d.state === "active" ? `<button class="btn sm" data-a="pause">暂停</button>` : d.state === "paused" ? `<button class="btn sm" data-a="resume">继续</button>` : ""}
      <button class="btn sm" data-a="up">优先级 +1（现在 ${d.priority}）</button><button class="btn sm" data-a="down">优先级 −1</button>
      ${d.tasks.some((t) => t.state === "failed") ? `<button class="btn sm" data-a="retry">失败的重新排队</button>` : ""}
      ${d.reviews.length || d.outputs.length ? `<button class="btn sm" data-a="export">导出结果和审核（JSON）</button>` : ""}</div>
      ${keys.length ? `<div class="sec"><h2>曲线 <small>${keys.map((k, i) => `<a href="#" data-k="${esc(k)}" style="color:${i ? "var(--mut)" : "var(--cy)"}">${esc(k)}</a>`).join(" · ")}</small></h2><canvas id="dChart"></canvas></div>` : ""}
      ${d.thumbs && d.thumbs.length ? `<div class="sec"><h2>生成的图 <small>最近 ${d.thumbs.length} 张</small></h2><div class="thumbs">${d.thumbs.map((t) => `<img src="${esc(t.url)}" title="${esc(t.name)}">`).join("")}</div></div>` : ""}
      ${d.reviews.length ? `<div class="sec"><h2>人工审核 <small>${d.reviews.filter((r) => r.state === "done").length}/${d.reviews.length} 定了</small></h2>${d.reviews.slice(0, 12).map((r) => r.payload && r.payload.aUrl ? `<div class="rv">${r.payload.refUrl ? `<img src="${esc(r.payload.refUrl)}" class="ref" title="照片">` : ""}<img src="${esc(r.payload.aUrl)}" class="${r.result && r.result.choice === "a" ? "win" : ""}"><img src="${esc(r.payload.bUrl)}" class="${r.result && r.result.choice === "b" ? "win" : ""}"><span>${r.state === "done" ? "选了 " + esc(r.result.choice) : r.votes + " 票"}</span></div>` : "").join("")}</div>` : ""}
      ${(() => { const es = [...new Set(d.tasks.filter((t) => t.error).map((t) => String(t.error).slice(-700)))].slice(0, 3); return es.length ? `<div class="sec"><h2>出错信息 <small>最近 ${es.length} 种（截图发给维护的人）</small></h2>${es.map((e) => `<pre class="errbox">${esc(e)}</pre>`).join("")}</div>` : ""; })()}
      ${d.ckpts.length ? `<div class="sec"><h2>存档</h2><table class="tbl">${d.ckpts.map((c) => `<tr><td>${c.kind === "global" ? "第 " + c.round + " 轮合并后" : "第 " + c.step + " 步"}</td><td class="muted">${ago(c.created)}</td></tr>`).join("")}</table></div>` : ""}
      <div class="sec"><h2>小任务 <small>最近 60 个</small></h2><table class="tbl"><tr><th>#</th><th>状态</th><th>谁在算</th><th>换过电脑</th><th>出错</th></tr>${d.tasks.map((t) => `<tr><td>${t.kind === "merge" ? "合并 " + (t.round + 1) : t.round != null ? `${t.round + 1}-${t.seq + 1}` : t.seq + 1}</td><td><span class="st ${t.state === "done" ? "done" : t.state === "failed" ? "failed" : t.state === "leased" ? "active" : ""}">${{ queued: "排队", leased: "在算 " + Math.round((t.progress || 0) * 100) + "%", done: "完成", failed: "失败", dropped: "作废" }[t.state] || t.state}</span></td><td>${esc(t.member ? t.member + " · " + t.device : "")}</td><td>${t.lost || 0}</td><td title="${esc(t.error || "")}">${t.errors ? `<span style="color:var(--rd)">${t.errors} 次</span>` : ""}</td></tr>`).join("")}</table></div>`;
    drawer(body);
    const act = { pause: { state: "paused" }, resume: { state: "active" }, up: { priority: d.priority + 1 }, down: { priority: d.priority - 1 } };
    $$("#drawerBody [data-a]").forEach((b) => (b.onclick = guard(async () => {
      const a = b.dataset.a;
      if (a === "retry") await api("/api/admin/job/retry", { id });
      else if (a === "export") { const r = await api("/api/admin/export?job=" + id); const u = URL.createObjectURL(new Blob([JSON.stringify(r, null, 1)], { type: "application/json" })); const x = document.createElement("a"); x.href = u; x.download = `job-${id}.json`; x.click(); return; }
      else await api("/api/admin/job/set", { id, ...act[a] });
      refresh();
    })));
    let k = open.k && keys.includes(open.k) ? open.k : keys[0];
    const paint = () => k && window.LaoChart($("#dChart"), d.curves[k], { color: "#36e2ff" });
    paint();
    $$("#drawerBody [data-k]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); k = open.k = a.dataset.k; $$("#drawerBody [data-k]").forEach((x) => (x.style.color = x === a ? "var(--cy)" : "var(--mut)")); paint(); }));
  }
  // ---- 抽屉：电脑实时 ----
  const srcCache = {};
  async function openDev(id, quiet) {
    const d = ov && ov.devices.find((x) => x.id === id);
    if (!d) return;
    open = { kind: "dev", id };
    const L = d.live || {};
    let src = null;
    if (L.recipeId) { src = srcCache[L.recipeId] || (srcCache[L.recipeId] = await api("/api/admin/recipe?id=" + L.recipeId).then((r) => r.source).catch(() => null)); }
    const info = d.info || {};
    const body = `<h1>${esc(d.member)} · ${esc(d.name)}</h1><div class="sub">${d.online ? "在线" : "离线（" + (d.lastSeen ? ago(d.lastSeen) : "") + "）"} · ${esc(d.gpu || "")} ${d.vram ? d.vram + "G" : ""} · 内存 ${d.ram || "—"}G · 驱动 ${esc(info.driver || "—")} · 累计算了 ${dur(d.secs)}、${d.tasks} 个任务</div>
      <div class="acts2"><button class="btn sm" data-a="kick">移出训练网</button></div>
      ${d.task ? `<div class="sec"><h2>正在算「${esc(d.task.name)}」 <small>${Math.round((d.task.progress || 0) * 100)}% · ${fnName(L.fn)} 第 ${L.line || "—"} 行${L.gpu ? ` · ${L.gpu.temp}℃ · 占用 ${L.gpu.util}% · 显存 ${(+L.gpu.used || 0).toFixed(1)}/${L.gpu.vram}G · ${Math.round(L.gpu.power || 0)}W` : ""}</small></h2>
        ${src ? `<div class="code" id="dCode">${src.split("\n").map((l, i) => `<div class="${i + 1 === L.line ? "hit" : ""}"><span>${i + 1}</span>${esc(l)}</div>`).join("")}</div>` : ""}
        <div class="sec"><h2>日志</h2><div class="logs">${(L.logs || []).map((l) => `<div>${esc(l.msg)}</div>`).join("")}</div></div></div>` : `<p class="muted">现在没在算。</p>`}`;
    drawer(body);
    const hit = $("#dCode .hit"); if (hit) $("#dCode").scrollTop = hit.offsetTop - 150;
    $$("#drawerBody [data-a=kick]").forEach((b) => (b.onclick = guard(async () => { if (!confirm(`把「${d.name}」移出训练网？它正在算的任务会交给别人。`)) return; await api("/api/admin/device/set", { id, disabled: true }); closeDrawer(); refresh(); })));
  }
  function drawer(html) { $("#drawer").hidden = false; const sc = $("#drawer").scrollTop; $("#drawerBody").innerHTML = html; $("#drawer").scrollTop = sc; }
  function closeDrawer() { $("#drawer").hidden = true; open = null; }
  $("#drawerX").onclick = closeDrawer;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeDrawer(); $$(".modal").forEach((m) => (m.hidden = true)); } });

  // ---- 发邀请 ----
  $("#inviteBtn").onclick = () => { $("#mInvite").hidden = false; $("#iOut").hidden = true; };
  $("#iGo").onclick = guard(async () => {
    const r = await api("/api/admin/invite", { note: $("#iNote").value, role: $("#iRole").value, maxUses: +$("#iUses").value, hours: +$("#iHours").value, server: location.origin });
    $("#iOut").hidden = false;
    $("#iOut").innerHTML = `<div>邀请码 <b>${esc(r.code)}</b>，${new Date(r.expires).toLocaleString()} 前有效。把下面这一串发给他，在「捞捞算力」里粘贴：</div><code id="iLink">${esc(r.link)}</code><button class="btn sm" id="iCopy">复制</button>`;
    $("#iCopy").onclick = () => navigator.clipboard.writeText(r.link).then(() => toast("复制好了"));
    loadInvites();
  });
  // ---- 新任务 ----
  const TPL = {
    map: { count: 100, reviewNeed: 2 },
    relay: { totalSteps: 3000, segSteps: 500, ckptEvery: 100 },
    diloco: { rounds: 30, width: 3, innerSteps: 200, minDone: 2, roundSecs: 3600, outerLr: 0.7, outerMomentum: 0.9 },
    record: { items: [{ lines: ["同学们好，今天我们来学习冒泡排序。", "大家看黑板，这是一个还没排好的数列。"] }] },
  };
  $("#nKind").onchange = () => { $("#nParams").value = JSON.stringify(TPL[$("#nKind").value], null, 1); $("#nRecipe").disabled = $("#nKind").value === "record"; };
  $("#jobBtn").onclick = guard(async () => {
    const rs = await api("/api/admin/recipes");
    $("#nRecipe").innerHTML = rs.map((r) => `<option value="${r.id}">${esc(r.name)}（${r.id.slice(0, 8)}）</option>`).join("") || `<option value="">还没有配方：先用 tools/grid.js publish 上传</option>`;
    $("#nKind").onchange(); $("#mJob").hidden = false; $("#nErr").textContent = "";
  });
  $("#nGo").onclick = async () => {
    try {
      const params = JSON.parse($("#nParams").value || "{}"), req = JSON.parse($("#nReq").value || "{}");
      await api("/api/admin/job", { name: $("#nName").value || "新任务", stage: $("#nStage").value || null, kind: $("#nKind").value, recipe: $("#nRecipe").value || null, params, req, priority: +$("#nPri").value || 0 });
      $("#mJob").hidden = true; toast("任务建好了"); refresh();
    } catch (e) { $("#nErr").textContent = /JSON/.test(e.message) ? "参数不是正确的 JSON" : e.message; }
  };
  $$("[data-close]").forEach((b) => (b.onclick = () => (b.closest(".modal").hidden = true)));

  function start() { $("#login").hidden = true; $("#app").hidden = false; refresh(); loadInvites(); loadCycle(); loadVoices(); clearInterval(loadCycle.t); loadCycle.t = setInterval(() => { loadCycle(); loadVoices(); }, 10000); clearInterval(start.t); start.t = setInterval(refresh, 2500); }
  if (token) api("/api/admin/overview").then(start, () => {}); else showLogin();
  window.__ready = true;
})();
