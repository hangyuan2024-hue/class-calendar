// 班级成长排行榜：本周 / 本月 / 总共；领奖台 + 名单；可以选择实名、匿名或不参加
"use strict";
App.views.rank = {
  title: "排行榜", icon: "rank", period: "week", data: null, synced: {},
  mount(el) {
    el.innerHTML = `
      <div class="vhead"><div><h1>班级排行榜</h1><div class="sub" id="rkSub">完成作业、打卡、专注都能攒成长值</div></div><span class="grow"></span>
        <div class="seg" id="rkPer"><button data-p="week" class="on">本周</button><button data-p="month">本月</button><button data-p="all">总共</button></div>
        <button class="btn" id="rkRe">${icon("sync")}刷新</button></div>
      <div class="vbody"><div class="rk-wrap" id="rkBox"></div></div>`;
    $("#rkPer", el).onclick = (e) => { const b = e.target.closest("[data-p]"); if (!b) return; this.period = b.dataset.p; $$("#rkPer button", el).forEach((x) => x.classList.toggle("on", x === b)); this.load(); };
    $("#rkRe", el).onclick = () => this.load();
    el.addEventListener("click", async (e) => {
      const m = e.target.closest("[data-m]"); if (m) { try { await api("rank_set_pref", { cid: App.S.cid, m: m.dataset.m }); this.load(); } catch (err) {} return; }
      const u = e.target.closest("[data-user]"); if (u && u.dataset.user) App.go("people", { uid: u.dataset.user });
    });
  },
  show() { this.load(); },
  update() { if (this.data && this.data.cid !== App.S.cid) { this.data = null; if (App.view === "rank") this.load(); } this.draw(); },
  async load() {
    const S = App.S, cid = S.cid, box = $("#rkBox", this.el);
    if (!cid) { this.data = null; this.draw(); return; }
    if (!this.data) box.innerHTML = `<div class="empty">加载中…</div>`;
    try {
      // 以前在这台电脑上勾过「完成」的班级事项，第一次打开时补记上
      if (!this.synced[cid] && !App.isTeacher()) {
        this.synced[cid] = true;
        const ids = (S.items || []).filter((r) => ((S.marks || {})["c" + r.id] || {}).done).map((r) => r.id);
        if (ids.length) await api("growth_sync_done", { cid, ids }, true).catch(() => {});
      }
      const d = await api("growth_board", { cid, period: this.period }, true);
      this.data = { cid, d };
    } catch (e) { box.innerHTML = `<div class="empty"><b>🏆</b>排行榜暂时打不开：${esc(cleanErr(e))}</div>`; return; }
    this.draw();
  },
  draw() {
    const el = this.el; if (!el) return;
    const box = $("#rkBox", el), S = App.S;
    if (!S.cid) { box.innerHTML = `<div class="empty"><b>🏆</b>加入班级后就能和同学一起攒成长值、上排行榜</div>`; return; }
    if (!this.data) return;
    const d = this.data.d, rows = d.rows || [], c = d.class || {}, P = { week: "本周", month: "本月", all: "总共" }[this.period];
    const cls = App.cls(), cname = (cls && (cls.nickname || cls.name)) || "", top = rows.length ? rows[0].points : 1, me = rows.find((r) => r.me);
    const av = (r, size) => `<span class="av ${size}" style="background:${r.anon && !d.teacher && !r.me ? "#9aa5b5" : avColor(r.name)}"${r.id && !r.anon ? ` data-user="${esc(r.id)}"` : ""}>${esc([...(r.name || "?")][0])}</span>`;
    const stat = (r) => [r.hw ? `✓ 作业 ${r.hw}` : "", r.done - r.hw > 0 ? `✓ 其它 ${r.done - r.hw}` : "", r.habits ? `🔥 打卡 ${r.habits}` : "", r.pomos ? `🍅 ${r.pomos}` : ""].filter(Boolean).join(" · ") || "刚刚起步";
    const pod = (r, i) => !r ? `<div class="pod p${i} empty"><span class="av lg">?</span><b>虚位以待</b><div class="blk">${i}</div></div>`
      : `<div class="pod p${i}${r.me ? " me" : ""}">${av(r, "lg")}<span class="medal">${["🥇", "🥈", "🥉"][i - 1]}</span><b>${esc(r.name)}</b><small>${r.points} 成长值</small><div class="blk">${r.rank}</div></div>`;
    $("#rkSub", el).textContent = `${cname} · ${P}`;
    box.innerHTML = `
      <div class="card rk-cls"><div><b>🏫 ${esc(cname)}</b><span class="muted">${P}全班一起攒了</span></div><b class="rk-num">${c.points || 0}<small> 成长值</small></b>
        ${c.hw_rate != null ? `<div class="rk-bar"><i style="width:${Math.min(100, c.hw_rate)}%"></i></div><div class="muted rk-cs"><span>本周作业完成率 <b>${c.hw_rate}%</b>（${c.hw_items} 项作业）</span><span>${c.active}/${c.members} 位同学在努力</span></div>`
          : `<div class="muted rk-cs"><span>本周还没有要交的作业</span><span>${c.active || 0}/${c.members || 0} 位同学在努力</span></div>`}</div>
      ${rows.length ? `<div class="podium">${pod(rows[1], 2)}${pod(rows[0], 1)}${pod(rows[2], 3)}</div>
        ${rows.length > 3 ? `<div class="card rk-list">${rows.slice(3).map((r) => `<div class="rk-row${r.me ? " me" : ""}"><span class="rk-n">${r.rank}</span>${av(r, "sm")}<div class="rk-m"><b>${esc(r.name)}</b><small>${stat(r)}</small><div class="rk-b"><i style="width:${Math.round(100 * r.points / Math.max(1, top))}%"></i></div></div><b class="rk-p">${r.points}</b></div>`).join("")}</div>` : ""}`
        : `<div class="card empty"><b>🏆</b>${P}还没有人上榜。完成一项作业就能上榜，先到先得！</div>`}
      ${d.member ? `<div class="card rk-me">${d.my_mode === "off" ? "你选择了<b>不参加</b>排行，成长值照样会记着。" : me ? `我：<b>第 ${me.rank} 名</b> · ${me.points} 成长值　<span class="muted">${stat(me)}</span>` : `你${P}还没有攒成长值，完成一项作业试试？`}
        <span class="grow"></span><span class="muted">在榜上显示为</span><div class="seg">${[["show", "实名"], ["anon", "匿名"], ["off", "不参加"]].map(([k, t]) => `<button data-m="${k}" class="${d.my_mode === k ? "on" : ""}">${t}</button>`).join("")}</div></div>` : ""}
      ${d.teacher ? `<div class="muted" style="margin-top:8px">👀 你是老师，能看到匿名同学的真名；老师自己不参加排名。</div>` : ""}
      <details class="card rk-how"><summary>成长值怎么算？</summary><ul><li>完成一项班级作业 <b>+10</b>，其它班级事项 <b>+5</b></li><li>习惯打卡一次 <b>+3</b>，每天最多算 5 次</li><li>完成一个番茄钟 <b>+2</b>，每天最多算 12 个</li><li>排名只是互相鼓励，可以随时选择匿名或不参加</li></ul></details>`;
  },
};
App.isTeacher = App.isTeacher || (() => false);
