// 7.36 站长后台（admin.html）：开通学校 / 审核申请 / 所有学校、全站设置（高峰节流、功能开关入口）
window.CCSite = (function () {
  "use strict";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rpc = (fn, a) => CCAuth.rpc(fn, a || {});
  const say = (m) => { const t = document.getElementById("toast"); if (!t) { alert(m); return; } t.textContent = m; t.classList.remove("hidden"); clearTimeout(say.t); say.t = setTimeout(() => t.classList.add("hidden"), 2800); };
  const day = (t) => { const d = new Date(t); return (d.getMonth() + 1) + "/" + d.getDate(); };

  async function school(box) {
    box.innerHTML = `<div class="ph"><div><h1>学校</h1><p>开通学校、审核老师的开通申请、查看所有学校</p></div></div><div class="panel pad">加载中…</div>`;
    let ap, all;
    try { [ap, all] = await Promise.all([rpc("school_apply_list"), rpc("school_all")]); }
    catch (e) { box.innerHTML = `<div class="ph"><div><h1>学校</h1></div></div><div class="panel pad">${/school_|PGRST202|Could not find/.test(e.message) ? "学校功能暂未开通（要先执行 7.30 SQL）" : esc(e.message)}</div>`; return; }
    const pend = (ap || []).filter((a) => a.status === "pending"), done = (ap || []).filter((a) => a.status !== "pending").slice(0, 20);
    box.innerHTML = `<div class="ph"><div><h1>学校</h1><p>开通学校、审核老师的开通申请、查看所有学校</p></div></div>
      <div class="panel pad"><h3>直接开通</h3>
        <div class="filters"><input class="inp" id="scName" placeholder="学校全称，如 西安交通大学" maxlength="40" style="min-width:240px"><input class="inp" id="scOwner" placeholder="主管理员账号或邮箱（不填就是你）"><button class="btn pri" id="scGo">开通</button></div>
        <div id="scSugg" class="muted" style="margin-top:6px"></div></div>
      <div class="panel pad" style="margin-top:14px"><h3>开通申请（${pend.length} 条待审核）</h3>
        ${pend.map((a, i) => `<div style="border-top:1px solid var(--line);padding:10px 0"><b>${esc(a.name)}</b>${a.exists ? ` <span class="muted">（已开通过，通过后申请人成为它的管理员）</span>` : ""}
          <div class="muted">${esc(a.who)}（${esc(a.account)}）· ${day(a.at)} · 联系 ${esc(a.contact)}${a.note ? " · " + esc(a.note) : ""}</div>
          ${a.proof ? `<img src="${a.proof}" alt="证明材料" style="max-width:220px;max-height:160px;border-radius:8px;margin-top:6px">` : ""}
          <div style="margin-top:6px;display:flex;gap:8px"><button class="btn pri sm" data-ap="${i}|1">通过</button><button class="btn sm" data-ap="${i}|0">不通过</button></div></div>`).join("") || `<div class="muted">没有等待审核的申请 ✓</div>`}
        ${done.length ? `<div class="muted" style="margin-top:8px">最近处理过：${done.map((a) => esc(a.name) + "（" + (a.status === "approved" ? "已通过" : "没通过") + "）").join("、")}</div>` : ""}</div>
      <div class="panel pad" style="margin-top:14px"><h3>所有学校（${(all || []).length}）</h3>
        <div class="tw"><table class="t"><thead><tr><th>学校</th><th>学校码</th><th>院系</th><th>班级</th><th>管理员</th></tr></thead><tbody>
        ${(all || []).map((s) => `<tr><td>${esc(s.name)}</td><td><code>${esc(s.code)}</code></td><td>${s.depts}</td><td>${s.classes}</td><td>${(s.admins || []).map((a) => esc(a.name) + (a.role === "owner" ? "（主）" : "")).join("、")}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">还没有学校</td></tr>`}</tbody></table></div></div>`;
    let sugg = [], t = 0;
    const nm = box.querySelector("#scName");
    nm.oninput = () => { clearTimeout(t); const q = nm.value.trim(); if (q.length < 2) { box.querySelector("#scSugg").textContent = ""; sugg = []; return; }
      t = setTimeout(async () => { try { sugg = (await rpc("school_suggest", { p_q: q })) || []; } catch (e) { sugg = []; }
        box.querySelector("#scSugg").innerHTML = sugg.length ? "已经开通：" + sugg.map((s) => (s.same ? "<b style='color:var(--red)'>" : "") + esc(s.name) + "（" + s.depts + " 个院系）" + (s.same ? "</b>" : "")).join("、") : "没有同名的学校，可以开通 ✓"; }, 350); };
    box.querySelector("#scGo").onclick = async () => {
      try {
        if (sugg.some((s) => s.same)) throw new Error("这个学校已经开通了");
        const me = await CCAuth.me();
        const r = await rpc("school_create", { p_name: nm.value, p_owner: box.querySelector("#scOwner").value.trim() || me.account });
        alert("「" + r.name + "」开通好了，学校码 " + r.code + "，主管理员 " + r.owner); school(box);
      } catch (e) { say(e.message); }
    };
    box.querySelectorAll("[data-ap]").forEach((b) => (b.onclick = async () => {
      const [i, ok] = b.dataset.ap.split("|"), a = pend[+i];
      let note = null;
      if (ok === "0") { note = prompt("不通过的原因（申请人会看到）", ""); if (note === null) return; }
      else if (!confirm("通过「" + a.name + "」的申请？")) return;
      try { await rpc("school_apply_review", { p_id: a.id, p_ok: ok === "1", p_note: note }); say(ok === "1" ? "已开通" : "已拒绝"); school(box); } catch (e) { say(e.message); }
    }));
  }

  async function tune(box) {
    box.innerHTML = `<div class="ph"><div><h1>全站设置</h1><p>站长专用：概况、待办、高峰节流、功能开关</p></div></div><div class="panel pad">加载中…</div>`;
    let r;
    try { r = (await rpc("site_overview")) || {}; } catch (e) { box.querySelector(".panel").textContent = /site_overview|PGRST202|Could not find/.test(e.message) ? "要先执行 7.36 SQL" : e.message; return; }
    const iv = +r.ping_iv_ms || 8000, opts = [5000, 8000, 15000, 30000, 60000];
    const todo = [r.apply_pending ? `${r.apply_pending} 个学校开通申请等你审核 <a href="#school">去处理 ›</a>` : "", r.mail_failed_1d ? `今天有 ${r.mail_failed_1d} 封邮件没发出去（多半是发信邮箱授权码失效）` : "",
      r.wx_failed_1d ? `今天有 ${r.wx_failed_1d} 条微信提醒没发出去` : ""].filter(Boolean);
    box.innerHTML = `<div class="ph"><div><h1>全站设置</h1><p>站长专用：概况、待办、高峰节流、功能开关</p></div></div>
      <div class="kpis">${[["用户", r.users], ["老师", r.teachers], ["现在在线", r.online], ["今天用过", r.active_1d], ["班级", r.classes], ["学校", r.schools]].map(([k, v]) => `<div class="panel kpi"><div class="k">${k}</div><div class="v" style="font-size:22px;font-weight:800">${v == null ? "—" : v}</div></div>`).join("")}</div>
      ${todo.length ? `<div class="panel pad">${todo.map((x) => "⚠️ " + x).join("<br>")}</div>` : ""}
      <div class="panel pad" style="margin-top:14px"><h3>高峰节流</h3><p class="muted">所有打开着的网页、小程序每隔多久问一次服务器「有没有新东西」。人特别多、服务器吃力时调大，所有人 1 分钟内自动放慢；平时 8 秒。</p>
        <select class="inp" id="ivSel">${opts.map((v) => `<option value="${v}"${v === iv ? " selected" : ""}>${v / 1000} 秒${v === 8000 ? "（默认）" : ""}</option>`).join("")}</select></div>
      <div class="panel pad" style="margin-top:14px"><h3>全站功能开关</h3><p class="muted">某个功能出问题时一键暂停，或只对某种身份关闭。</p><a class="btn" href="dev.html#features">打开功能开关 ›</a></div>`;
    box.querySelector("#ivSel").onchange = async (e) => { try { await rpc("site_tune_set", { p_key: "ping_iv_ms", p_value: e.target.value }); say("已改成 " + e.target.value / 1000 + " 秒"); } catch (err) { say(err.message); } };
  }
  return { school, tune };
})();
