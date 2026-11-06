// 7.55 课堂互动 · 同学这一侧（和小程序 1.28「课堂互动」页、lib/actwatch.js 一样，7.41 SQL）
//   · 成长页多一个「课堂互动」入口：抢答（点「抢」）、小组互评（点星星打分、写一句评语）
//   · 老师 / 班委一发起抢答或小组互评：开着网页的同学马上弹一张卡片（同一轮只弹一次）
//   · 发起、看结果、给前几名加分还在「管理中心 → 学情」
(function () {
  "use strict";
  const E = (s) => (typeof esc === "function" ? esc(s) : String(s ?? ""));
  const cls = () => (typeof currentClass !== "undefined" ? currentClass : null);
  const logged = () => typeof currentUser !== "undefined" && !!currentUser;
  const meId = () => (logged() && currentUser.id) || "";
  const rpc = (n, a) => CCAuth.rpc(n, a);
  const SEEN = "act_seen_v1";
  const seenGet = () => { try { return JSON.parse(localStorage.getItem(SEEN) || "{}") || {}; } catch (e) { return {}; } };
  const seenSet = (o) => { try { localStorage.setItem(SEEN, JSON.stringify(o)); } catch (e) {} };

  try {
    const st = document.createElement("style");
    st.textContent = `.ca-tabs{display:flex;gap:6px;margin:6px 0 10px}.ca-tabs button.on{background:var(--accent,#3a7afe);color:#fff;border-color:transparent}
.ca-hit{display:block;width:150px;height:150px;border-radius:50%;margin:14px auto;border:0;font-size:34px;font-weight:800;color:#fff;background:var(--accent,#3a7afe);cursor:pointer;box-shadow:0 10px 30px -10px var(--accent,#3a7afe)}
.ca-hit:active{transform:scale(.96)}.ca-hit[disabled]{opacity:.5;cursor:default}
.ca-big{text-align:center;font-size:15px;margin:8px 0}.ca-rank{margin:8px 0;padding:0;list-style:none}
.ca-rank li{display:flex;gap:10px;padding:6px 4px;border-bottom:1px solid var(--line,rgba(127,127,127,.2));font-size:14px}.ca-rank li.top b{color:#e08a00}.ca-rank li.me{font-weight:700}
.ca-rank li span:last-child{margin-left:auto;color:var(--sub,#888)}
.ca-pr{border:1px solid var(--line,rgba(127,127,127,.25));border-radius:12px;padding:10px 12px;margin:8px 0}
.ca-t{display:flex;align-items:center;gap:8px;padding:5px 0}.ca-t .nm{flex:1;min-width:0}.ca-st{display:flex;gap:2px}
.ca-st button{border:0;background:none;font-size:22px;line-height:1;padding:0 1px;cursor:pointer;color:rgba(127,127,127,.4)}.ca-st button.on{color:#f5a623}
.ca-st button[disabled]{cursor:default}
@media (min-width:1001px){[data-view=growth]>#actEntry{grid-row:3;width:auto!important;min-height:74px;padding:12px 16px!important;box-sizing:border-box}
[data-view=growth]>#farmEntry:not(.hidden){grid-column:1/5!important}[data-view=growth]>#farmEntry:not(.hidden)~#rankEntry{grid-column:5/9!important}[data-view=growth]>#farmEntry:not(.hidden)~#actEntry{grid-column:9/-1}
[data-view=growth]>#farmEntry.hidden~#rankEntry{grid-column:1/7!important}[data-view=growth]>#farmEntry.hidden~#actEntry{grid-column:7/-1}}`;
    document.head.appendChild(st);
  } catch (e) {}

  let d = null, tab = "rush", tmr = 0, hitting = false;
  function dlg() {
    if (!d) {
      d = document.createElement("dialog"); d.className = "dlg ck-dlg"; document.body.appendChild(d);
      d.addEventListener("close", () => clearTimeout(tmr));
    }
    return d;
  }
  async function open(t) {
    const c = cls();
    if (!logged() || !c) { alert("先登录并选一个班级"); return; }
    tab = t || tab; dlg();
    d.innerHTML = `<h3>课堂互动<small>${E(c.name)}</small></h3><div class="meta">加载中…</div>`;
    if (!d.open) d.showModal();
    paint();
  }
  const head = (c, staff) => `<h3>课堂互动<small>${E(c.name)}${staff ? " · 发起抢答、小组互评，看结果：管理中心 → 学情" : ""}</small></h3>
    <div class="ca-tabs"><button class="small${tab === "rush" ? " on" : ""}" data-t="rush">抢答</button><button class="small${tab === "peer" ? " on" : ""}" data-t="peer">小组互评</button><span class="spacer"></span>${staff ? `<a class="small" href="manage.html" style="text-decoration:none">去发起 ›</a>` : ""}</div>`;
  async function paint() {
    clearTimeout(tmr);
    const c = cls(); if (!d || !d.open || !c) return;
    let html = "", again = 0, staff = false;
    try {
      if (tab === "rush") {
        const r = await rpc("rush_state", { p_cid: c.id });
        staff = !!(r && r.staff);
        if (!r || r.none) html = `<div class="empty">现在没有抢答。老师 / 班委发起后，这里会出现「抢」按钮，开着网页也会弹出提醒。</div>`;
        else {
          const t0 = Date.parse(r.ends_at), open = !!r.open && t0 > Date.now();
          const rows = r.rows || [], mine = rows.findIndex((x) => x.uid === meId());
          const canHit = r.can_hit != null ? !!r.can_hit : !r.staff;
          html = `<div class="ca-big"><b>${E(r.title || "抢答")}</b> · 前 ${r.top_n} 名${open ? ` · 还剩 ${Math.max(0, Math.ceil((t0 - Date.now()) / 1000))} 秒` : " · 已结束"}</div>
            ${mine >= 0 ? `<div class="ca-big">你抢到了第 <b>${mine + 1}</b> 名${mine < r.top_n ? " 🎉" : ""}</div>` : open && canHit ? `<button class="ca-hit" data-hit>抢！</button>` : open ? `<div class="ca-big meta">发起人不能抢，同学们正在抢…</div>` : `<div class="ca-big meta">你这次没抢</div>`}
            <ol class="ca-rank">${rows.map((x, i) => `<li class="${i < r.top_n ? "top" : ""}${x.uid === meId() ? " me" : ""}"><b>${i + 1}</b><span>${E(x.name || "同学")}</span><span>${(x.ms / 1000).toFixed(1)} 秒${x.points ? ` · +${x.points}` : ""}</span></li>`).join("") || `<li class="meta">还没有人抢</li>`}</ol>`;
          if (open) again = 1500;
        }
      } else {
        const [list, rs] = await Promise.all([rpc("peer_todo", { p_cid: c.id }), rpc("rush_state", { p_cid: c.id }).catch(() => null)]);
        staff = !!(rs && rs.staff);
        const L = list || [];
        html = L.length ? L.map((r) => {
          const ts = r.targets || [], left = ts.filter((t) => !t.score).length, end = new Date(r.ends_at);
          return `<div class="ca-pr"><b>${E(r.title)}</b> <span class="meta">${r.kind === "cross" ? "组间评分" : "组内评分"} · ${r.open ? `${end.getMonth() + 1}/${end.getDate()} 前评完${left ? ` · 还有 ${left} 个没评` : " · 都评完了 ✓"}` : "已结束"}</span>
            ${ts.map((t) => `<div class="ca-t"><span class="nm">${E(t.name)}</span><span class="ca-st">${[1, 2, 3, 4, 5].map((n) => `<button data-rate="${r.id}" data-tg="${E(t.id)}" data-s="${n}" class="${n <= (t.score || 0) ? "on" : ""}"${r.open ? "" : " disabled"} aria-label="${n} 星">★</button>`).join("")}</span>${r.open ? `<button class="small" data-cm="${r.id}" data-tg="${E(t.id)}" data-nm="${E(t.name)}" data-sc="${t.score || 0}">评语</button>` : ""}</div>`).join("") || `<div class="meta">没有要评的${r.kind === "cross" ? "小组" : "组员"}（可能还没分组）</div>`}</div>`;
        }).join("") : `<div class="empty">现在没有小组互评。老师 / 班委发起后会出现在这里。</div>`;
      }
    } catch (e) { html = `<div class="empty">${E(e.message || "打不开")}</div>`; }
    if (!d.open) return;
    d.innerHTML = head(c, staff) + html + `<div class="row"><span class="spacer"></span><button class="small" data-x>关闭</button></div>`;
    d.querySelector("[data-x]").onclick = () => d.close();
    d.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => { tab = b.dataset.t; paint(); }));
    const h = d.querySelector("[data-hit]");
    if (h) h.onclick = async () => {
      if (hitting) return; hitting = true; h.disabled = true;
      try {
        const st = await rpc("rush_state", { p_cid: c.id });
        const r = await rpc("rush_hit", { p_id: st.id });
        if (r && r.ok === false) alert(r.why || "没抢上");
      } catch (e) { alert(e.message || "没抢上"); }
      hitting = false; paint();
    };
    d.querySelectorAll("[data-rate]").forEach((b) => (b.onclick = async () => {
      try { await rpc("peer_rate", { p_rid: +b.dataset.rate, p_target: b.dataset.tg, p_score: +b.dataset.s, p_comment: null }); paint(); } catch (e) { alert(e.message); }
    }));
    d.querySelectorAll("[data-cm]").forEach((b) => (b.onclick = async () => {
      if (!+b.dataset.sc) { alert("先点星星打分"); return; }
      const t = prompt("给「" + b.dataset.nm + "」写一句（选填）", ""); if (t == null) return;
      try { await rpc("peer_rate", { p_rid: +b.dataset.cm, p_target: b.dataset.tg, p_score: +b.dataset.sc, p_comment: t.trim().slice(0, 100) }); } catch (e) { alert(e.message); }
    }));
    if (again) tmr = setTimeout(paint, again);
  }

  // ---------- 提醒：开着网页时，老师 / 班委一发起就弹（同一轮只弹一次） ----------
  let busy = false, pop = null;
  function ask(title, text, go, cancel, cb) {
    if (pop) return;
    pop = document.createElement("dialog"); pop.className = "dlg pop-dlg";
    pop.innerHTML = `<div class="pop-b"><span class="pop-k">🙋 课堂互动</span><h3>${E(title)}</h3><div class="pop-s">${E(text)}</div><div class="pop-a"><span class="pop-n"></span><button class="small" data-no>${E(cancel)}</button><button class="btn" data-ok>${E(go)}</button></div></div>`;
    document.body.appendChild(pop);
    const end = (ok) => { pop.close(); pop.remove(); pop = null; if (ok) cb(); };
    pop.querySelector("[data-ok]").onclick = () => end(true);
    pop.querySelector("[data-no]").onclick = () => end(false);
    pop.addEventListener("cancel", (e) => { e.preventDefault(); end(false); });
    pop.showModal();
  }
  async function check() {
    const c = cls();
    if (!logged() || !c || busy || pop || document.hidden || (d && d.open)) return;
    busy = true;
    try {
      const seen = seenGet();
      const r = await rpc("rush_state", { p_cid: c.id });
      if (r && !r.none && r.open && (r.can_hit != null ? r.can_hit && !r.by_me : !r.staff) && !seen["r" + r.id] && Date.parse(r.ends_at) > Date.now() + 3000) {
        seen["r" + r.id] = 1; seenSet(seen);
        ask("抢答开始", (r.title || "抢答") + "（前 " + r.top_n + " 名）", "去抢", "不抢", () => open("rush"));
        return;
      }
      const list = (await rpc("peer_todo", { p_cid: c.id })) || [];
      const p = list.find((x) => x.open && !seen["p" + x.id] && (x.targets || []).some((t) => !t.score));
      if (p) { seen["p" + p.id] = 1; seenSet(seen); ask("小组评分", "「" + p.title + "」开始了，" + (p.kind === "cross" ? "给别的小组" : "给同组的组员") + "打个分吧", "去评", "稍后", () => open("peer")); }
    } catch (e) { /* 服务器还没有 7.41：不提醒 */ }
    finally { busy = false; }
  }
  // 15 秒看一次（页面在后台时不看）；切回页面时马上看一次
  setInterval(check, 15000);
  setTimeout(check, 4000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) setTimeout(check, 1200); });

  // 成长页的入口
  function entry() {
    const after = document.getElementById("rankEntry"); if (!after || document.getElementById("actEntry")) return;
    const b = document.createElement("button");
    b.className = "rank-entry surface"; b.id = "actEntry"; b.type = "button";
    b.innerHTML = `<span class="re-i">🙋</span><span><b>课堂互动</b><small>抢答、小组互评</small></span><span class="re-go">›</span>`;
    b.onclick = () => open("rush");
    after.insertAdjacentElement("afterend", b);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", entry); else entry();
  window.CCAct = { open, check };
})();
