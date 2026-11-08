// 捞捞编程 · 刷题：看你做题的情况估计水平，从力扣 / Codeforces 的题库里推荐「跳一跳够得着」的题
// 题在原网站上做（点「去做」用浏览器打开），做完回来点一下结果；软件里的练习检查通过也会自动算进去。
"use strict";
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  let LC = null, st = null, recs = [], src = "", tag = "", opened = {}, busy = false;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const SRC = { lc: "力扣", cf: "CF", ex: "练习" };
  const MARKS = [["solved", "做出来了"], ["hint", "看了题解"], ["failed", "没做出来"], ["easy", "太简单"]];
  const LANGS = [["c", "C"], ["cpp", "C++"], ["python", "Python"], ["java", "Java"], ["javascript", "JS"], ["go", "Go"]];
  let lang = (() => { try { return localStorage.getItem("lc_lang") || "c"; } catch (e) { return "c"; } })();
  const ago = (t) => { if (!t) return "还没更新过"; const d = Math.floor((Date.now() - t) / 864e5); return d <= 0 ? "今天更新" : d + " 天前更新"; };

  async function load(refreshRecs = true) {
    try { st = await LC.call("judgeState"); if (refreshRecs) recs = await LC.call("judgeRecommend", { n: 6, src, tag }); } catch (e) { LC.toast(e.message); }
    paint();
  }

  function paint() {
    const box = $("#lcBody"); if (!box || !st) return;
    const k = st.skill, b = st.bank;
    const lo = [0, 900, 1100, 1300, 1500, 1750, 2000].filter((x) => x <= k.r).pop();
    const pct = k.next === Infinity || k.next == null ? 100 : Math.max(4, Math.min(100, ((k.r - lo) / (k.next - lo)) * 100));
    const tags = (k.tags || []).filter((x) => x.n > 0).slice(0, 8);
    const maxT = Math.max(1, ...tags.map((x) => x.r));
    box.innerHTML = `
      <div class="lc-card">
        <div class="lc-lv"><span class="lc-r">${k.r}</span><span class="lc-ln">${esc(k.level)}</span><span class="grow"></span><small>做了 ${k.n} 次</small></div>
        <div class="ex-bar"><i style="width:${pct}%"></i></div>
        <small class="lc-sub">${k.n ? (k.next && k.next !== Infinity ? `再涨 ${k.next - k.r} 分升一级` : "已经是最高一级") + (k.weak.length ? ` · 弱一点：${k.weak.map(esc).join("、")}` : "") : "做几道题，捞捞就知道你现在是什么水平了"}</small>
        ${tags.length ? `<div class="lc-tags">${tags.map((x) => `<button class="lc-t${tag === x.t ? " on" : ""}" data-tag="${esc(x.t)}" title="${esc(x.t)}：${x.r} 分，做过 ${x.n} 次（点一下只看这个知识点的题）"><span>${esc(x.t)}</span><i style="width:${Math.max(8, (x.r / maxT) * 100)}%" class="${k.weak.includes(x.t) ? "weak" : ""}"></i><b>${x.r}</b></button>`).join("")}</div>` : ""}
      </div>
      <div class="lc-filter">
        <div class="seg">${[["", "全部"], ["lc", "力扣"], ["cf", "Codeforces"]].map(([v, n]) => `<button data-src="${v}" class="${src === v ? "on" : ""}">${n}</button>`).join("")}</div>
        <select id="lcLang" title="用什么语言做（点「开始做」时用）">${LANGS.map(([v, n]) => `<option value="${v}"${v === lang ? " selected" : ""}>用 ${n} 做</option>`).join("")}</select>
        <button class="ic-btn" id="lcMore" title="换一批">${ICON("refresh", 15)}</button>
      </div>
      ${tag ? `<div class="lc-tagon">只看「${esc(tag)}」<button class="link" data-tag="">不限</button></div>` : ""}
      <div class="lc-list">${recs.length ? recs.map(item).join("") : `<div class="lc-empty">${src === "cf" && !b.cf ? "Codeforces 的题还没下载：点下面「更新题库」" : "这类题都做过了，换个筛选试试"}</div>`}</div>
      <details class="lc-acc"${k.accounts && (k.accounts.lc || k.accounts.cf) ? "" : ""}>
        <summary>同步我在网站上做过的题</summary>
        <p class="ex-note">填上你的用户名（公开主页能看到的那个），捞捞把你在网站上做出来的题拿过来一起算水平，做过的就不再推了。只读公开信息，不用密码。</p>
        <label>力扣用户名<input id="lcUser" value="${esc((k.accounts || {}).lc || "")}" placeholder="leetcode.cn/u/ 后面那段"></label>
        <label>Codeforces 用户名<input id="cfUser" value="${esc((k.accounts || {}).cf || "")}" placeholder="handle"></label>
        <button class="btn sm pri" id="lcSync">同步</button>
      </details>
      <div class="lc-foot">
        <span>题库：力扣 ${b.lc} 道${b.lcLive ? "" : "（自带的常见题）"}${b.cf ? ` · CF ${b.cf} 道` : ""}<br><small>${esc(ago(b.at && b.at.lc))}${b.err && b.err.lc ? ` · 上次没连上：${esc(b.err.lc)}` : ""}</small></span>
        <button class="btn sm ghost" id="lcRefresh">更新题库</button>
      </div>
      ${k.log && k.log.length ? `<details class="lc-log"><summary>最近做的</summary>${k.log.slice(0, 12).map((x) => `<div><span class="lc-src ${x.src}">${SRC[x.src] || ""}</span>${esc(x.title)}<span class="grow"></span><small>${esc(x.how)}</small><b class="${x.delta >= 0 ? "up" : "dn"}">${x.delta >= 0 ? "+" : ""}${x.delta}</b></div>`).join("")}</details>` : ""}
      <p class="ex-note lc-cr">题目来自 力扣（leetcode.cn）和 Codeforces，点「开始做」在软件里看题、写代码、提交。</p>`;
  }

  function item(p) {
    const on = opened[p.id];
    const no = p.src === "lc" ? p.no + "." : p.no;
    return `<div class="lc-item${on ? " open" : ""}" data-id="${esc(p.id)}">
      <div class="lc-i1"><span class="lc-src ${p.src}">${SRC[p.src]}</span><b title="${esc(p.title)}">${esc(no)} ${esc(p.title)}</b></div>
      <div class="lc-i2"><span class="lv lv-${esc(p.level)}">${esc(p.src === "cf" ? "难度 " + p.level : p.level)}</span>${(p.tags || []).slice(0, 2).map((t) => `<span class="tg">${esc(t)}</span>`).join("")}<span class="grow"></span><small class="pb" title="按你现在的水平，大概有这么大把握做出来">把握 ${p.prob}%</small></div>
      <div class="lc-why">${esc(p.why)}</div>
      <div class="lc-acts">${on ? MARKS.map(([v, n]) => `<button class="btn sm ghost" data-mark="${v}">${n}</button>`).join("") + `<button class="btn sm pri" data-do>${ICON("code", 13)}接着做</button>` : `<button class="btn sm pri" data-do title="在软件里看题、写代码、运行样例、提交">${ICON("code", 13)}开始做</button><button class="ic-btn" data-go title="在网站上打开">${ICON("external", 14)}</button><button class="btn sm ghost" data-mark="skip" title="不想做这道，30 天内不再推">跳过</button>`}</div>
    </div>`;
  }

  async function onClick(e) {
    const t = e.target;
    const s = t.closest("[data-src]"); if (s) { src = s.dataset.src; return load(); }
    const tg = t.closest("[data-tag]"); if (tg) { tag = tag === tg.dataset.tag ? "" : tg.dataset.tag; return load(); }
    if (t.closest("#lcMore")) return load();
    if (t.closest("#lcRefresh")) return refresh(t.closest("#lcRefresh"));
    if (t.closest("#lcSync")) return syncUsers(t.closest("#lcSync"));
    const it = t.closest(".lc-item"); if (!it) return;
    const p = recs.find((x) => x.id === it.dataset.id); if (!p) return;
    if (t.closest("[data-go]")) { LC.call("openUrl", p.url); opened[p.id] = true; paint(); LC.toast("在浏览器里打开了。做完回来点一下结果，捞捞好估计你的水平"); return; }
    if (t.closest("[data-do]")) {
      const b = t.closest("[data-do]"); b.disabled = true; b.innerHTML = ICON("radar", 13, "spin") + "打开中…";
      try { await window.LaolaoProb.open(p.id, lang); opened[p.id] = true; }
      catch (e) { LC.toast(e.message, 4000); }
      paint(); return;
    }
    const m = t.closest("[data-mark]");
    if (m && !busy) {
      busy = true;
      try {
        const r = await LC.call("judgeMark", p.id, m.dataset.mark);
        delete opened[p.id];
        st = r;
        if (m.dataset.mark !== "skip") LC.toast(r.delta ? `水平分 ${r.delta > 0 ? "+" : ""}${r.delta}，现在 ${r.skill.r}（${r.skill.level}）` : "记下了");
        // 换掉这一道，别的不动
        // 水平变了，重新推荐（已经点开在做的那几道留着）
        const keep = recs.filter((x) => x.id !== p.id && opened[x.id]);
        const more = await LC.call("judgeRecommend", { n: 6, src, tag });
        recs = keep.concat(more.filter((x) => !keep.some((y) => y.id === x.id))).slice(0, Math.max(6, keep.length));
      } catch (err) { LC.toast(err.message); }
      busy = false; paint();
    }
  }

  async function refresh(btn) {
    btn.disabled = true; btn.textContent = "更新中…";
    try {
      const r = await LC.call("judgeRefresh", src === "cf" ? "cf" : "");
      const msg = Object.entries(r.res).map(([k, v]) => `${k === "lc" ? "力扣" : "Codeforces"}：${v.error ? "没连上（" + v.error + "）" : v.n + " 道"}`).join("；");
      LC.toast(msg, 4500);
      st = r; recs = await LC.call("judgeRecommend", { n: 6, src, tag });
    } catch (e) { LC.toast(e.message); }
    paint();
  }

  async function syncUsers(btn) {
    btn.disabled = true; btn.textContent = "同步中…";
    try {
      await LC.call("judgeSetUser", "lc", $("#lcUser").value);
      await LC.call("judgeSetUser", "cf", $("#cfUser").value);
      const r = await LC.call("judgeSync");
      const msg = Object.entries(r.out).map(([k, v]) => `${k === "lc" ? "力扣" : "Codeforces"}：${v.error ? v.error : `找到 ${v.seen} 道，新算进去 ${v.n} 道`}`).join("；");
      LC.toast(msg || "两个用户名都没填", 5000);
      st = r; recs = await LC.call("judgeRecommend", { n: 6, src, tag });
    } catch (e) { LC.toast(e.message); }
    paint();
  }

  function hook() {
    LC = window.LC;
    const body = $("#lcBody"); if (!body) return;
    body.addEventListener("click", onClick);
    body.addEventListener("change", (e) => { if (e.target.id === "lcLang") { lang = e.target.value; try { localStorage.setItem("lc_lang", lang); } catch (x) {} } });
    document.addEventListener("side", (e) => { if (e.detail === "lc") load(!recs.length); });
    document.addEventListener("skill", () => { if (!$("#sideLc").hidden) load(false); else st = null; });
    if (!$("#sideLc").hidden) load();
  }
  if (window.LC) hook(); else document.addEventListener("lc-ready", hook, { once: true });
})();
