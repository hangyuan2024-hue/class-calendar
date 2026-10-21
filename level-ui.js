// 6.9 账号等级（经验值）· 网页版
// 经验跟着账号走、数据库里算（level.sql 的 xp_*）：完成班级事项 +10/+5、自己的事项 +2（每天最多 5 件）、
// 习惯打卡 +3（每天 5 次）、番茄钟 +2（每天 12 个）、位置签到 +5。同一件事只算一次，取消完成会扣回来，刷不出经验。
(function () {
  "use strict";
  const LS = "xp_me_v1";
  const TITLES = [[1, "新同学"], [2, "小学徒"], [3, "见习生"], [4, "进阶者"], [5, "好学者"], [6, "行动派"], [8, "学霸"], [10, "卷王"], [13, "大神"], [16, "传说"]];
  const title = (l) => { let t = TITLES[0][1]; for (const [n, s] of TITLES) if (l >= n) t = s; return t; };
  let me = (() => { try { return JSON.parse(localStorage.getItem(LS) || "null"); } catch (e) { return null; } })();
  const keep = () => { try { localStorage.setItem(LS, JSON.stringify(me)); } catch (e) {} };
  const logged = () => typeof currentUser !== "undefined" && !!currentUser && typeof CCAuth !== "undefined";
  let lastUid = "";

  // 等级小牌子：「Lv.3 见习生」
  function chip(L, cls) { return L ? `<span class="lv-chip ${cls || ""}" title="账号等级 · 经验 ${L.xp}">Lv.${L.level}<i>${esc(title(L.level))}</i></span>` : ""; }
  function bar(L) {
    if (!L) return "";
    const pct = Math.max(0, Math.min(100, Math.round(((L.xp - L.from) / Math.max(1, L.to - L.from)) * 100)));
    return `<div class="lv-bar" aria-label="升级进度 ${pct}%"><i style="width:${pct}%"></i></div><small class="lv-next">${L.xp} / ${L.to} 经验 · 再攒 ${Math.max(0, L.to - L.xp)} 升到 Lv.${L.level + 1}</small>`;
  }
  // 成长页顶部的等级卡片
  function card() {
    if (!logged()) return `<div class="lv-card surface"><b>账号等级</b><span>登录后完成事项、打卡、专注都能攒经验升级，还能和同学比等级。</span></div>`;
    const L = me && me.level;
    if (!L) return `<div class="lv-card surface"><b>账号等级</b><span>加载中…</span></div>`;
    return `<div class="lv-card surface"><div class="lv-top"><span class="lv-big">Lv.${L.level}</span><span><b>${esc(title(L.level))}</b><small>今天 +${me.today || 0} 经验 · 一共 ${L.xp}</small></span>
      <button class="small" data-tab="rank" data-lvboard="1">🏆 等级榜</button></div>${bar(L)}
      <details class="lv-rules"><summary>经验怎么攒？</summary><ul>
        <li>完成班级作业 <b>+10</b>，其它班级事项 <b>+5</b></li><li>完成自己记的事项 <b>+2</b>（每天最多 5 件）</li>
        <li>习惯打卡 <b>+3</b>（每天 5 次），番茄钟 <b>+2</b>（每天 12 个），位置签到 <b>+5</b></li>
        <li>同一件事只算一次；取消完成会把经验扣回来，再勾上也不会多给</li></ul></details></div>`;
  }
  function paint() {
    document.querySelectorAll("[data-lvslot]").forEach((el) => { el.innerHTML = logged() && me && me.level ? chip(me.level, el.dataset.lvslot) : ""; });
    const c = document.getElementById("lvCard"); if (c) c.innerHTML = card();
  }
  function toast(t) {
    let el = document.getElementById("lvToast");
    if (!el) { el = document.createElement("div"); el.id = "lvToast"; el.className = "lv-toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.textContent = t; el.classList.remove("on"); void el.offsetWidth; el.classList.add("on");
    clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("on"), 2600);
  }
  function apply(r, undo) {
    if (!r || !r.level) return;
    const old = me && me.level ? me.level.level : 0;
    me = { level: r.level, today: Math.max(0, ((me && me.today) || 0) + (undo ? 0 : r.points || 0)) };
    keep(); paint();
    if (!undo && r.points > 0) {
      if (old && r.level.level > old) {
        toast(`🎉 升级了！Lv.${r.level.level} ${title(r.level.level)}`);
        try { if (typeof confetti === "function" && !matchMedia("(prefers-reduced-motion: reduce)").matches) confetti(60); } catch (e) {}
      } else toast(`⭐ 经验 +${r.points}  ·  Lv.${r.level.level} ${r.level.xp}/${r.level.to}`);
    }
  }
  // 记一条经验。kind：done（班级事项 id）/ mine（自己的事项 id）/ habit（习惯id|日期）/ pomo（日期|序号）
  async function log(kind, ref, undo) {
    if (!logged()) return null;
    try { const r = await CCAuth.rpc("xp_log", { k: kind, r: String(ref), undo: !!undo }); apply(r, undo); return r; }
    catch (e) { return null; }      // 数据库还没升级（没运行 level.sql）：不影响打勾
  }
  async function refresh() {
    if (!logged()) { paint(); return; }
    if (currentUser.id !== lastUid) { lastUid = currentUser.id; if (me && me.uid !== currentUser.id) me = null; }
    try { const r = await CCAuth.rpc("xp_me"); if (r) { me = { level: r.level, today: r.today, uid: currentUser.id }; keep(); } } catch (e) {}
    paint();
  }
  // 等级榜（排行榜页「等级」那一栏）
  async function board(cid) { return CCAuth.rpc("xp_board", { cid }); }
  function boardHtml(d) {
    const rows = d.rows || [], av = (r) => `<div class="rav" style="background:${typeof avColor === "function" && !(r.anon && !d.teacher && !r.me) ? avColor(r.name) : "#9aa5b5"}">${esc([...r.name][0] || "?")}</div>`;
    const mine = d.me && d.me.level;
    return `${mine ? `<div class="lv-card surface"><div class="lv-top"><span class="lv-big">Lv.${mine.level}</span><span><b>我 · ${esc(title(mine.level))}</b><small>一共 ${mine.xp} 经验</small></span></div>${bar(mine)}</div>` : ""}
      ${rows.length ? `<div class="rk-list surface">${rows.map((r) => `<div class="rk-row${r.me ? " me" : ""}"><div class="rr">${r.rank <= 3 ? ["🥇", "🥈", "🥉"][r.rank - 1] : r.rank}</div>${av(r)}
        <div style="min-width:0"><div class="rn">${esc(r.name)} ${chip({ level: r.level, xp: r.xp })}</div></div><div class="rpts">${r.xp}<small>经验</small></div></div>`).join("")}</div>`
        : `<div class="rk-empty surface">班里还没有人攒经验。完成一项作业就能上榜！</div>`}
      <div class="rk-opts surface"><div>等级跟着账号走（换班、换设备都在），按账号的总经验排；排行榜里选了「匿名」「不参加」，这里也一样。</div></div>`;
  }
  window.LaoLevel = { log, refresh, paint, card, chip, title, board, boardHtml, get: () => me };
  setInterval(() => { if (logged() && (!me || currentUser.id !== lastUid)) refresh(); }, 15000);
  window.addEventListener("load", () => setTimeout(refresh, 1500));
})();
