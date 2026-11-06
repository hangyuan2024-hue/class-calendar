// 7.55 班级调课、早晚自习（和小程序 1.22 的 lib/classadj.js 一样，数据库 7.15：class_adj_get / class_adj_set）
//   老师、能增改事项的班委把调课 / 停课 / 加课、早晚自习时间「发给全班」；全班同学的课表、首页、日历都跟着变。
//   同学自己记的调课照样有效，两份合在一起算（ClassAdj.all）。自己设过早晚自习的，以自己的为准（ClassAdj.study）。
//   要在 courses.js 之后、app.js 之前加载（currentClass 用的时候才去取）
const ClassAdj = (() => {
  "use strict";
  const LS = "cls_adj_v1";   // { [班级id]: { adj, study, can, at, by } }
  let busy = null; const lastAt = {};
  const rd = () => { try { return JSON.parse(localStorage.getItem(LS) || "{}") || {}; } catch (e) { return {}; } };
  const wr = (o) => { try { localStorage.setItem(LS, JSON.stringify(o)); } catch (e) {} };
  const cid = () => (typeof currentClass !== "undefined" && currentClass ? String(currentClass.id) : "");
  const cache = (id) => rd()[id || cid()] || null;
  // 班级的调课（id 前面加 cls_，和自己的区分开）
  function adj() {
    const c = cache(); if (!c || !Array.isArray(c.adj)) return [];
    return c.adj.filter((x) => x && x.date && x.type).map((x) => ({ ...x, id: "cls_" + String(x.id || "").replace(/^cls_/, ""), cls: true }));
  }
  // 自己的 + 班级的
  function all(own) { return (own || []).concat(adj()); }
  // 早晚自习：自己设过的以自己的为准，没设过就用班级的
  function study(kind) {
    let own = null;
    try { own = JSON.parse(localStorage.getItem(kind === "morning" ? "morning_v1" : "evening_v1") || "null"); } catch (e) {}
    if (own && typeof own === "object") return own;
    const c = cache(); const x = c && c.study && c.study[kind];
    return x && typeof x === "object" ? x : null;
  }
  function canManage() {
    const c = cache(); if (c && c.can) return true;
    const k = typeof currentClass !== "undefined" ? currentClass : null;
    return !!(k && (k.is_teacher || (k.member_role === "monitor" && k.can_edit)));
  }
  async function load(force) {
    const id = cid(); if (!id || typeof CCAuth === "undefined") return null;
    if (!force && Date.now() - (lastAt[id] || 0) < 10 * 60000) return cache(id);
    if (busy) return busy;
    busy = (async () => {
      try {
        const r = await CCAuth.rpc("class_adj_get", { p_cid: id });
        lastAt[id] = Date.now();
        const o = rd(), old = JSON.stringify(o[id] || null);
        o[id] = { adj: Array.isArray(r && r.adj) ? r.adj : [], study: (r && r.study) || {}, can: !!(r && r.can_manage), at: (r && r.updated_at) || "", by: (r && r.by) || "" };
        wr(o);
        if (JSON.stringify(o[id]) !== old) document.dispatchEvent(new CustomEvent("classadj"));
        return o[id];
      } catch (e) { lastAt[id] = Date.now(); return cache(id); }
      finally { busy = null; }
    })();
    return busy;
  }
  // 改全班的：adj（不带 cls_ 前缀的原始数组）或 study
  async function save(patch) {
    const id = cid(); if (!id) throw new Error("先选一个班级");
    const p = { p_cid: id, p_adj: null, p_study: null };
    if (patch.adj) p.p_adj = patch.adj.map((x) => { const o = { ...x }; delete o.cls; o.id = String(o.id || "").replace(/^cls_/, ""); return o; });
    if (patch.study) p.p_study = patch.study;
    try { await CCAuth.rpc("class_adj_set", p); }
    catch (e) { if (/class_adj_set|PGRST202|Could not find/i.test(e.message || "")) throw new Error("发给全班要先在数据库执行 7.15 的 SQL"); throw e; }
    lastAt[id] = 0; await load(true);
  }
  const rawAdj = () => { const c = cache(); return c && Array.isArray(c.adj) ? c.adj.slice() : []; };
  const rawStudy = () => ({ ...((cache() || {}).study || {}) });
  // 打开网页、切回页面时看一眼（10 分钟内不重复问）；换了班马上问
  let lastCid = "";
  setInterval(() => { const id = cid(); if (id && id !== lastCid) { lastCid = id; load(true); } }, 2000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(false); });
  return { adj, all, study, canManage, load, save, rawAdj, rawStudy };
})();
// 班级的调课、自习变了：重新画一遍（首页、课表、日历）
document.addEventListener("classadj", () => { try { if (typeof renderAll === "function") renderAll(); } catch (e) {} });
