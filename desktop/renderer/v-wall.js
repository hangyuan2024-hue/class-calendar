// 班级墙：看班里的通知和讨论，发一条
"use strict";
App.views.wall = {
  title: "班级墙", icon: "wall",
  count() { const ps = (App.S.wall && App.S.wall.posts) || []; const n = ps.filter((p) => Date.parse(p.created_at) > this.seenAt()).length; return { n }; },
  seenAt() { try { let v = +localStorage.getItem("wallSeen"); if (!v) { v = Date.now(); localStorage.setItem("wallSeen", v); } return v; } catch (e) { return Date.now(); } },
  mount(el) {
    el.innerHTML = `
      <div class="vhead"><div><h1>班级墙</h1><div class="sub" id="wlSub"></div></div><span class="grow"></span>
        <button class="btn" id="wlSync">${icon("sync")}刷新</button>
        <button class="btn" data-ext="https://www.laolaokechengbiao.cn/app.html">${icon("ext")}评论、举报去网页版</button></div>
      <div class="vbody"><div class="wl-col">
        <form class="card wl-new" id="wlForm">
          <input class="wl-title" name="t" maxlength="60" placeholder="标题（可不填）">
          <textarea name="b" rows="3" maxlength="2000" placeholder="想和班里说点什么…　Ctrl+Enter 发布"></textarea>
          <div class="row"><label class="row wl-notice hidden" id="wlNotice" style="gap:6px;font-size:13px"><input type="checkbox" name="n">作为通知（会提醒全班）</label><span class="grow"></span><small class="muted" id="wlLen">0 / 2000</small><button class="btn primary" id="wlPost">${icon("send")}发布</button></div>
        </form>
        <div id="wlList"></div>
      </div></div>`;
    const f = $("#wlForm", el);
    f.b.oninput = () => ($("#wlLen", el).textContent = `${f.b.value.length} / 2000`);
    f.b.onkeydown = (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); f.requestSubmit(); } };
    f.onsubmit = async (e) => {
      e.preventDefault(); if (!f.b.value.trim()) return f.b.focus();
      const btn = $("#wlPost", el); btn.disabled = true;
      try { await call("wall:post", f.t.value.trim(), f.b.value.trim(), f.n.checked); f.reset(); f.b.oninput(); toast("已发布"); } catch (e) {} finally { btn.disabled = false; }
    };
    $("#wlSync", el).onclick = () => call("refresh").then(() => toast("已刷新"));
  },
  show() { try { localStorage.setItem("wallSeen", Date.now()); } catch (e) {} setTimeout(() => this.el && App.view === "wall" && navCountsSoon(), 50); },
  update() {
    const el = this.el, S = App.S, posts = ((S.wall && S.wall.posts) || []).filter((p) => !p.hidden);
    $("#wlSub", el).textContent = App.className() ? `${App.className()} · ${posts.length} 条` : "还没加入班级";
    $("#wlNotice", el).classList.toggle("hidden", !App.isTeacher());
    $("#wlForm", el).classList.toggle("hidden", !S.cid);
    const sorted = posts.slice().sort((a, b) => (b.pinned_at ? 1 : 0) - (a.pinned_at ? 1 : 0) || String(b.created_at).localeCompare(String(a.created_at)));
    const ago = (t) => { const s = (Date.now() - Date.parse(t)) / 1000; if (!(s >= 0)) return ""; if (s < 60) return "刚刚"; if (s < 3600) return Math.floor(s / 60) + " 分钟前"; if (s < 86400) return Math.floor(s / 3600) + " 小时前"; const d = new Date(t); return s < 86400 * 7 ? Math.floor(s / 86400) + " 天前" : `${d.getMonth() + 1}月${d.getDate()}日`; };
    const role = (r) => (r === "teacher" ? '<span class="tag" style="--c:var(--t-会议)">老师</span>' : r === "admin" || r === "monitor" ? '<span class="tag" style="--c:var(--brand)">班委</span>' : "");
    $("#wlList", el).innerHTML = sorted.length ? sorted.map((p) => `<article class="card wl-p${p.pinned_at ? " pin" : ""}${p.is_notice ? " notice" : ""}">
        <header><span class="av sm">${esc((p.author_name || "?").slice(-1))}</span><b>${esc(p.author_name || "同学")}</b>${role(p.author_role)}${p.pinned_at ? `<span class="tag" style="--c:var(--warn)">📌 置顶</span>` : ""}${p.is_notice ? `<span class="tag" style="--c:var(--bad)">通知</span>` : ""}<span class="grow"></span><small class="muted" title="${esc(new Date(p.created_at).toLocaleString("zh-CN"))}">${ago(p.created_at)}${p.edited_at ? " · 编辑过" : ""}</small></header>
        ${p.title ? `<h3 class="selectable">${esc(p.title)}</h3>` : ""}<div class="wl-b selectable">${esc(p.body)}</div></article>`).join("")
      : `<div class="empty"><b>💬</b>${S.cid ? "班级墙还是空的，发第一条吧" : "加入班级后能看到班级墙"}</div>`;
  },
};
function navCountsSoon() { try { const el = $('.nav-item[data-view="wall"] .cnt'); if (el) el.classList.add("hidden"); } catch (e) {} }
