// 7.3 发布班级事项：发到哪几个班（自己带的、院系里的）、发给谁（全班 / 某个组 / 只发班委 / 指定的人）；发布记录（收到情况）。
// 依赖 app.js：currentClass currentUser classGroups GROUPS_OK openClassForm loadClass popupItems esc showBanner；extras.js：exFormTake exUploadTo；teacher.js：TEACH
// 数据库函数在 7.3-dept-audience.sql：manage_classes class_pick_people class_item_send sent_items item_viewers dept_mine
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const h = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const noDb = (e) => /class_item_send|class_pick_people|sent_items|dept_mine|PGRST202|Could not find|schema cache/i.test(String(e && e.message));
  const NODB = "数据库还没执行 7.3 的 SQL（7.3-dept-audience.sql），现在只能发给当前班级的全班或某个组";
  if (!$("cform")) return;

  const css = `
  .rc-box{border:1px solid var(--line);border-radius:14px;padding:10px 12px;margin:4px 0 10px;background:var(--bg2);display:flex;flex-direction:column;gap:8px}
  .rc-row{display:flex;gap:8px;align-items:flex-start}
  .rc-k{flex:none;width:34px;font-size:13px;font-weight:700;color:var(--sub);padding-top:5px}
  .rc-v{flex:1;display:flex;gap:6px;flex-wrap:wrap;align-items:center;min-width:0}
  .rc-c{border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:999px;padding:4px 11px;font-size:13px;cursor:pointer;font-weight:600}
  .rc-c.on{border-color:var(--accent);background:var(--selected);color:var(--accent)}
  .rc-c.add{border-style:dashed;color:var(--sub)}
  .rc-note{font-size:12px;color:var(--sub)}
  .rc-dlg{position:fixed;inset:0;z-index:2200;background:rgba(10,20,40,.45);display:flex;align-items:center;justify-content:center;padding:16px}
  .rc-dlg .bx{background:var(--card);color:var(--text);border-radius:20px;width:min(560px,100%);max-height:min(720px,calc(100vh - 32px));display:flex;flex-direction:column;box-shadow:0 30px 70px rgba(8,20,40,.35)}
  .rc-dlg .hd{padding:16px 18px 8px;display:flex;align-items:center;gap:8px}
  .rc-dlg .hd b{font-size:16px;flex:1}
  .rc-dlg .bd{overflow:auto;padding:4px 18px 10px;flex:1}
  .rc-dlg .ft{padding:10px 18px 16px;display:flex;gap:8px;align-items:center;border-top:1px solid var(--line)}
  .rc-dlg .ft .sp{flex:1}
  .rc-g{margin:10px 0 4px;display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:700;color:var(--sub)}
  .rc-g .sp{flex:1}
  .rc-i{display:flex;align-items:center;gap:10px;padding:8px 6px;border-radius:10px;cursor:pointer;font-size:14px}
  .rc-i:hover{background:var(--hover)}
  .rc-i input{width:17px;height:17px;flex:none}
  .rc-i small{color:var(--sub);font-size:12px}
  .rc-i .grow{flex:1;min-width:0}
  .rc-q{width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:12px;padding:8px 12px;background:var(--bg2);color:inherit;font-size:14px;margin:6px 0}
  .sn-ov{position:fixed;inset:0;z-index:2000;background:var(--bg2);color:var(--text);display:flex;flex-direction:column}
  .sn-top{display:flex;align-items:center;gap:8px;padding:10px 20px;background:var(--card);border-bottom:1px solid var(--line);flex-wrap:wrap}
  .sn-top b{font-size:18px;margin-right:6px}
  .sn-top .sp{flex:1}
  .sn-top select{border:1px solid var(--line);border-radius:10px;padding:6px 10px;background:var(--card);color:inherit}
  .sn-bd{flex:1;overflow:auto;padding:16px max(16px,calc(50% - 460px)) 60px}
  .sn-sum{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px}
  .sn-sum div{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:12px 14px}
  .sn-sum b{font-size:22px;display:block}
  .sn-sum span{font-size:12px;color:var(--sub)}
  .sn-it{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:12px 14px;margin-bottom:10px}
  .sn-h{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .sn-h b{font-size:15px;flex:1;min-width:0}
  .sn-tag{font-size:11.5px;font-weight:700;border-radius:6px;padding:1px 7px;background:var(--muted-bg)}
  .sn-m{font-size:12.5px;color:var(--sub);margin-top:4px}
  .sn-bar{display:flex;align-items:center;gap:8px;margin-top:7px;font-size:12.5px}
  .sn-bar span:first-child{width:30px;color:var(--sub)}
  .sn-bar .bar{flex:1;height:7px;border-radius:4px;background:var(--muted-bg);overflow:hidden}
  .sn-bar .bar i{display:block;height:100%;background:var(--accent);border-radius:4px}
  .sn-bar .bar i.ok{background:var(--green)}
  .sn-bar small{width:64px;text-align:right;color:var(--sub)}
  .sn-cls{margin-top:8px;border-top:1px dashed var(--line);padding-top:6px}
  .sn-c{display:flex;align-items:center;gap:8px;padding:5px 0;font-size:13px;flex-wrap:wrap}
  .sn-c b{flex:1;min-width:120px}
  .sn-who{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 8px}
  .sn-who span{background:var(--muted-bg);border-radius:999px;padding:2px 9px;font-size:12.5px}
  .sn-who span.ok{color:var(--green)}
  @media (max-width:640px){.sn-sum b{font-size:18px}.rc-k{width:30px}}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  // ---------- 发布表单：发到哪几个班、发给谁 ----------
  const R = { cls: null, err: "", cids: [], aud: "all", uids: [], unames: [], ppl: null, ok: true };
  const box = document.createElement("div"); box.className = "rc-box";
  const anchor = $("cGroupRow") || $("cConfirm").closest("label");
  anchor.before(box);

  async function loadCls() {
    if (R.cls) return R.cls;
    try {
      R.cls = ((window.TEACH && TEACH.classes) || (await CCAuth.rpc("manage_classes")) || []).filter((c) => c.kind !== "staff");
    } catch (e) { R.cls = []; }
    return R.cls;
  }
  const curId = () => (typeof currentClass !== "undefined" && currentClass ? currentClass.id : null);
  const clsName = (id) => { const c = (R.cls || []).find((x) => x.id === id) || (curId() === id ? currentClass : null); return c ? c.name : "这个班"; };
  const editing = () => !!$("cId").value;
  const multi = () => R.cids.length > 1 || (R.cids[0] && R.cids[0] !== curId());
  function paint() {
    const ed = editing(), list = R.cls || [];
    const gopt = $("cGroup");
    const hiddenG = ed && gopt && gopt.value && gopt.selectedOptions[0] && gopt.selectedOptions[0].dataset.hid;
    if (ed) {
      box.innerHTML = hiddenG ? `<div class="rc-row"><span class="rc-k">发给</span><div class="rc-v"><span class="rc-note">🎯 这条是定向发送的，只有收件人看得到；发送范围不能改（要换人就删掉重新发）</span></div></div>` : "";
      box.classList.toggle("hidden", !hiddenG);
      if ($("cGroupRow")) $("cGroupRow").classList.toggle("hidden", !!hiddenG || !(typeof GROUPS_OK !== "undefined" && GROUPS_OK && (classGroups || []).length));
      return;
    }
    box.classList.remove("hidden");
    const many = list.length > 1 || (list.length === 1 && list[0].id !== curId());
    const chips = R.cids.map((id) => `<button type="button" class="rc-c on" data-rc-x="${h(id)}" title="点一下去掉">${h(clsName(id))}${R.cids.length > 1 ? " ✕" : ""}</button>`).join("");
    const grp = typeof GROUPS_OK !== "undefined" && GROUPS_OK && !multi() && (classGroups || []).length;
    const auds = [["all", "全班"], ...(grp ? [["group", "某个组"]] : []), ["staff", "只发班委"], ["people", "指定的人"]];
    if (!grp && R.aud === "group") R.aud = "all";
    box.innerHTML = `${many ? `<div class="rc-row"><span class="rc-k">发到</span><div class="rc-v">${chips}<button type="button" class="rc-c add" data-rc="cls">＋ 选几个班 / 整个院系</button></div></div>` : ""}
      <div class="rc-row"><span class="rc-k">发给</span><div class="rc-v">${auds.map(([k, t]) => `<button type="button" class="rc-c${R.aud === k ? " on" : ""}" data-rc-aud="${k}">${t}</button>`).join("")}</div></div>
      ${R.aud === "people" ? `<div class="rc-row"><span class="rc-k"></span><div class="rc-v"><span class="rc-note">${R.uids.length ? `已选 ${R.uids.length} 人：${h(R.unames.slice(0, 6).join("、"))}${R.uids.length > 6 ? " 等" : ""}` : "还没选人"}</span><button type="button" class="rc-c add" data-rc="ppl">${R.uids.length ? "改" : "选人"}</button></div></div>` : ""}
      ${R.aud === "staff" ? `<div class="rc-row"><span class="rc-k"></span><div class="rc-v"><span class="rc-note">只有${multi() ? "这几个班的" : "本班"}班委（和老师）看得到，提醒也只发给他们</span></div></div>` : ""}
      ${R.aud === "people" ? `<div class="rc-row"><span class="rc-k"></span><div class="rc-v"><span class="rc-note">只有选中的人（和老师、发布人）看得到，别的同学看不到这条</span></div></div>` : ""}
      ${!R.ok ? `<div class="rc-note">⚠ ${NODB}</div>` : ""}`;
    if ($("cGroupRow")) $("cGroupRow").classList.toggle("hidden", R.aud !== "group");
    $("cform").dispatchEvent(new Event("input"));   // 让「同学们看到的样子」跟着变
  }
  window.rcScope = () => {   // form-ui.js 预览里用
    if (editing()) return "";
    const n = R.cids.length, where = n > 1 ? `${n} 个班` : "";
    const who = R.aud === "staff" ? "班委" : R.aud === "people" ? `${R.uids.length} 人` : R.aud === "group" && $("cGroup") && $("cGroup").value ? "组：" + $("cGroup").selectedOptions[0].text.replace(/^👥\s*/, "").replace(/（.*$/, "") : "";
    return [where, who].filter(Boolean).join(" · ");
  };
  box.addEventListener("click", (e) => {
    const a = e.target.closest("[data-rc-aud]");
    if (a) { R.aud = a.dataset.rcAud; if (R.aud === "people" && !R.uids.length) pickPeople(); paint(); return; }
    const x = e.target.closest("[data-rc-x]");
    if (x && R.cids.length > 1) { R.cids = R.cids.filter((id) => id !== x.dataset.rcX); prunePeople(); paint(); return; }
    const b = e.target.closest("[data-rc]");
    if (b && b.dataset.rc === "cls") pickClasses();
    if (b && b.dataset.rc === "ppl") pickPeople();
  });
  function prunePeople() { if (R.ppl) { const keep = new Set(R.ppl.filter((g) => R.cids.includes(g.cid)).flatMap((g) => g.people.map((p) => p.id))); const ix = R.uids.map((u, i) => keep.has(u) ? i : -1).filter((i) => i >= 0); R.uids = ix.map((i) => R.uids[i]); R.unames = ix.map((i) => R.unames[i]); } }

  function dialog(title, body, foot, onOk) {
    const d = document.createElement("div"); d.className = "rc-dlg";
    d.innerHTML = `<div class="bx" role="dialog" aria-label="${h(title)}"><div class="hd"><b>${h(title)}</b><button type="button" class="small" data-x>✕</button></div><div class="bd">${body}</div>
      <div class="ft">${foot || ""}<span class="sp"></span><button type="button" class="small" data-x>取消</button><button type="button" class="small primary" data-ok>确定</button></div></div>`;
    document.body.appendChild(d);
    d.addEventListener("click", (e) => { if (e.target === d || e.target.closest("[data-x]")) d.remove(); if (e.target.closest("[data-ok]")) { if (onOk(d) !== false) d.remove(); } });
    return d;
  }
  async function pickClasses() {
    const list = await loadCls();
    if (!list.length) { alert("没有拿到你管理的班级"); return; }
    const by = {};
    list.forEach((c) => { const k = c.dept || (c.role === "monitor" ? "我是班委的班" : "我带的班"); (by[k] ||= []).push(c); });
    const body = Object.entries(by).map(([g, cs]) => `<div class="rc-g">${c0(g)}<span class="sp"></span><button type="button" class="small" data-all="${h(g)}">全选</button></div>
      ${cs.map((c) => `<label class="rc-i"><input type="checkbox" value="${h(c.id)}" data-g="${h(g)}"${R.cids.includes(c.id) ? " checked" : ""}><span class="grow">${h(c.name)}${c.role === "monitor" ? " <small>（班委）</small>" : ""}</span><small>${c.total} 人</small></label>`).join("")}`).join("");
    function c0(g) { return (list.some((c) => c.dept === g) ? "🏛 " : "") + h(g); }
    const d = dialog("发到哪几个班", body, `<span class="rc-note" data-cnt></span>`, (d) => {
      const ids = [...d.querySelectorAll("input:checked")].map((i) => i.value);
      if (!ids.length) { alert("至少选一个班"); return false; }
      R.cids = ids; if (R.cids.length > 1 && R.aud === "group") R.aud = "all"; prunePeople(); paint();
    });
    const cnt = () => { const n = d.querySelectorAll("input:checked").length; d.querySelector("[data-cnt]").textContent = `已选 ${n} 个班`; };
    d.addEventListener("change", cnt); cnt();
    d.addEventListener("click", (e) => { const a = e.target.closest("[data-all]"); if (!a) return; const bs = [...d.querySelectorAll(`input[data-g="${CSS.escape(a.dataset.all)}"]`)]; const on = !bs.every((b) => b.checked); bs.forEach((b) => (b.checked = on)); cnt(); });
  }
  async function pickPeople() {
    let ppl;
    try { ppl = R.ppl = await CCAuth.rpc("class_pick_people", { cids: R.cids }); R.ok = true; }
    catch (e) { if (noDb(e)) { R.ok = false; R.aud = "all"; paint(); alert(NODB); return; } alert(e.message); return; }
    if (!ppl.length) { alert("你在这些班里不能定向发送（要老师，或者能发布事项的班委）"); R.aud = "all"; paint(); return; }
    const sel = new Set(R.uids);
    const body = `<input class="rc-q" placeholder="搜名字或账号" type="search">` + ppl.map((g) => `<div class="rc-g" data-cg="${h(g.cid)}">${h(g.cname)} · ${g.people.length} 人<span class="sp"></span><button type="button" class="small" data-mon="${h(g.cid)}">只选班委</button><button type="button" class="small" data-all="${h(g.cid)}">全选</button></div>
      ${g.people.map((p) => `<label class="rc-i" data-q="${h((p.name || "") + " " + (p.account || ""))}"><input type="checkbox" value="${h(p.id)}" data-n="${h(p.name || p.account)}" data-c="${h(g.cid)}" data-m="${p.role === "monitor" ? 1 : 0}"${sel.has(p.id) ? " checked" : ""}><span class="grow">${h(p.name || p.account)}${p.role === "monitor" ? " <small>班委</small>" : ""}</span><small>${h(p.account || "")}</small></label>`).join("")}`).join("");
    const d = dialog("发给谁", body, `<span class="rc-note" data-cnt></span>`, (d) => {
      const on = [...d.querySelectorAll("input[type=checkbox]:checked")];
      const seen = new Set(); R.uids = []; R.unames = [];
      on.forEach((i) => { if (!seen.has(i.value)) { seen.add(i.value); R.uids.push(i.value); R.unames.push(i.dataset.n); } });
      if (!R.uids.length) { alert("至少选一个人"); return false; }
      paint();
    });
    const cnt = () => { d.querySelector("[data-cnt]").textContent = `已选 ${new Set([...d.querySelectorAll("input[type=checkbox]:checked")].map((i) => i.value)).size} 人`; };
    d.addEventListener("change", cnt); cnt();
    d.querySelector(".rc-q").oninput = (e) => { const q = e.target.value.trim().toLowerCase(); d.querySelectorAll("[data-q]").forEach((l) => l.classList.toggle("hidden", !!q && !l.dataset.q.toLowerCase().includes(q))); };
    d.addEventListener("click", (e) => {
      const a = e.target.closest("[data-all]"), m = e.target.closest("[data-mon]");
      if (a) { const bs = [...d.querySelectorAll(`input[data-c="${CSS.escape(a.dataset.all)}"]`)]; const on = !bs.every((b) => b.checked); bs.forEach((b) => (b.checked = on)); cnt(); }
      if (m) { d.querySelectorAll(`input[data-c="${CSS.escape(m.dataset.mon)}"]`).forEach((b) => (b.checked = b.dataset.m === "1")); cnt(); }
    });
  }

  // 打开表单时：默认发到当前班级、全班；编辑定向发送的事项时保持原来的范围
  function onOpen(r, opt) {
    R.aud = "all"; R.uids = []; R.unames = []; R.ppl = null;
    R.cids = opt && opt.cids ? opt.cids.slice() : curId() ? [curId()] : [];
    const g = $("cGroup");
    if (r && r.group_id && g && !(classGroups || []).some((x) => String(x.id) === String(r.group_id))) {
      g.insertAdjacentHTML("beforeend", `<option value="${h(r.group_id)}" data-hid="1">🎯 定向发送（保持不变）</option>`);
      g.value = String(r.group_id);
    }
    paint();
    loadCls().then(() => { if (!R.cids.length && R.cls.length) R.cids = [R.cls[0].id]; paint(); });
  }
  const orig = window.openClassForm;
  window.openClassForm = function (r, opt) { const x = orig.apply(this, arguments); try { onOpen(r, opt); } catch (e) { console.error(e); } return x; };
  // 7.3 院系管理员 / 老师从「班级情况」「班级空间」直接发到几个班（不在任何班里也能发）
  window.openReachForm = async (cids) => {
    await loadCls();
    window.openClassForm(null, { cids: cids && cids.length ? cids : R.cls.filter((c) => c.role !== "monitor").map((c) => c.id) });
  };

  // ---------- 保存：发到几个班 / 定向发送走 class_item_send，其余照旧 ----------
  const save0 = $("cform").onsubmit;
  $("cform").onsubmit = async function (e) {
    if (editing() || (!multi() && R.aud !== "staff" && R.aud !== "people")) return save0.call(this, e);
    e.preventDefault();
    const date = $("cDate").value, time = $("cTime").value;
    const rec = { msg_type: $("cType").value, subject: $("cSubject").value.trim(), summary: $("cSummary").value.trim(),
      event_time: date ? date + (time ? " " + time : "") : "", location: $("cLoc").value.trim(), prepare: $("cPrep").value.trim(),
      need_confirm: $("cConfirm").checked || !date, publish_date: keyOf(ccDate()), original: "（由" + ((currentUser && currentUser.display_name) || "老师") + "手动发布）" };
    if (!rec.subject) { alert("请填写标题"); return; }
    if (R.aud === "people" && !R.uids.length) { pickPeople(); return; }
    const aud = R.aud === "people" ? { kind: "people", uids: R.uids } : R.aud === "group" ? { kind: "group", gid: +$("cGroup").value || null } : { kind: R.aud === "staff" ? "staff" : "all" };
    const btn = $("cSave"); btn.disabled = true;
    try {
      const r = await CCAuth.rpc("class_item_send", { cids: R.cids, rec, aud });
      const items = r.items || [], skipped = r.skipped || [];
      $("cmodal").classList.remove("open");
      // 附件：每个班的那条都传一份；弹窗提醒：每条都开
      const files = window.exFormTake ? exFormTake("c") : [];
      const pop = $("cPopup") && $("cPopup").checked;
      for (const it of items) {
        if (pop) try { await CCAuth.rpc("popup_set", { p_cid: it.cid, p_item: it.id, p_on: true }); } catch (e2) {}
        if (files.length && window.exUploadTo) await exUploadTo(it.cid, String(it.id), files, (t) => showBanner(t));
      }
      if (files.length) setTimeout(() => showBanner(""), 2500);
      try { await loadClass(); } catch (e3) {}
      const who = R.aud === "staff" ? "班委" : R.aud === "people" ? `选中的 ${R.uids.length} 人` : "全班";
      let msg = items.length ? `已发到 ${items.length} 个班（发给${who}）` : "一个班都没发出去";
      if (skipped.length) msg += `\n\n这些班没发：\n` + skipped.map((s) => `· ${s.name || "某个班"}：${s.why}`).join("\n");
      if (items.length && !skipped.length) { showBanner(msg + " · 在「班级情况 → 发布记录」看谁看了"); setTimeout(() => showBanner(""), 4000); } else alert(msg);
    } catch (err) { alert(noDb(err) ? NODB : "发布失败：" + err.message); }
    finally { btn.disabled = false; }
  };

  // ---------- 发布记录（收到情况） ----------
  const S = { days: 30, did: "", depts: null, list: null, err: "", open: new Set(), who: {} };
  let ov = null;
  async function openSent(did) {
    if (!ov) {
      ov = document.createElement("div"); ov.className = "sn-ov hidden";
      ov.innerHTML = `<div class="sn-top"><button class="small" data-sn="x">‹ 返回</button><b>📮 发布记录</b><span class="rc-note">每条几个人看了、几个人完成；点开看谁还没看</span><span class="sp"></span>
        <select data-sn="scope" aria-label="看谁发的"></select><select data-sn="days" aria-label="时间范围"><option value="7">最近 7 天</option><option value="30" selected>最近 30 天</option><option value="90">最近 90 天</option></select></div><div class="sn-bd"></div>`;
      document.body.appendChild(ov);
      ov.addEventListener("click", onSentClick);
      ov.addEventListener("change", (e) => {
        if (e.target.dataset.sn === "days") { S.days = +e.target.value; load(); }
        if (e.target.dataset.sn === "scope") { S.did = e.target.value; load(); }
      });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && ov && !ov.classList.contains("hidden")) close(); });
    }
    S.did = did || ""; S.open.clear();
    ov.classList.remove("hidden"); document.body.style.overflow = "hidden";
    if (!S.depts) { try { S.depts = (await CCAuth.rpc("dept_mine")) || []; } catch (e) { S.depts = []; } }
    ov.querySelector('[data-sn="scope"]').innerHTML = `<option value="">我发的</option>` + S.depts.map((d) => `<option value="${h(d.id)}">🏛 ${h(d.name)}（全院系）</option>`).join("");
    ov.querySelector('[data-sn="scope"]').value = S.did;
    ov.querySelector('[data-sn="scope"]').classList.toggle("hidden", !S.depts.length);
    load();
  }
  function close() { ov.classList.add("hidden"); document.body.style.overflow = ""; if (/^#sent/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search); }
  async function load() {
    const bd = ov.querySelector(".sn-bd"); bd.innerHTML = `<div class="meta">加载中…</div>`;
    try { S.list = (await CCAuth.rpc("sent_items", { days: S.days, did: S.did || null })) || []; S.err = ""; }
    catch (e) { S.list = []; S.err = noDb(e) ? NODB : e.message; }
    paintSent();
  }
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const fmt = (t) => { const m = /(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(t || ""); return m ? `${+m[2]}月${+m[3]}日${m[4] ? " " + m[4] : ""}` : "时间待定"; };
  const ago = (t) => { const d = new Date(t); return isNaN(d) ? "" : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  function paintSent() {
    const bd = ov.querySelector(".sn-bd"), l = S.list || [];
    if (S.err) { bd.innerHTML = `<div class="aempty surface">${h(S.err)}</div>`; return; }
    if (!l.length) { bd.innerHTML = `<div class="aempty surface">最近 ${S.days} 天${S.did ? "这个院系" : "你"}还没发过班级事项。</div>`; return; }
    const aud = l.reduce((a, x) => a + (+x.aud || 0), 0), views = l.reduce((a, x) => a + (+x.views || 0), 0);
    const hw = l.filter((x) => x.type === "作业"), hwAud = hw.reduce((a, x) => a + (+x.aud || 0), 0), hwDone = hw.reduce((a, x) => a + (+x.done || 0), 0);
    bd.innerHTML = `<div class="sn-sum"><div><b>${l.length}</b><span>条事项</span></div><div><b>${pct(views, aud)}%</b><span>看过（${views}/${aud} 人次）</span></div><div><b>${hw.length ? pct(hwDone, hwAud) + "%" : "–"}</b><span>作业完成率</span></div></div>
      ${l.map((x) => {
        const cls = x.classes || [], k = x.key, open = S.open.has(k);
        return `<div class="sn-it" data-k="${h(k)}"><div class="sn-h"><span class="sn-tag tag t-${h(x.type)}">${h(x.type || "通知")}</span><b>${h(x.subject || x.summary || "事项")}</b><button class="small" data-sn="open">${open ? "收起" : cls.length > 1 ? `${cls.length} 个班 ›` : "谁没看 ›"}</button></div>
          <div class="sn-m">${h(fmt(x.time))} · ${ago(x.at)} 发布${x.by && S.did ? " · " + h(x.by) : ""}${x.scope ? " · 🎯 " + h(x.scope) : ""}${cls.length === 1 ? " · " + h(cls[0].cname) : ""}</div>
          <div class="sn-bar"><span>看过</span><span class="bar"><i style="width:${pct(x.views, x.aud)}%"></i></span><small>${x.views}/${x.aud}</small></div>
          ${x.type === "作业" ? `<div class="sn-bar"><span>完成</span><span class="bar"><i class="ok" style="width:${pct(x.done, x.aud)}%"></i></span><small>${x.done}/${x.aud}</small></div>` : ""}
          ${open ? `<div class="sn-cls">${cls.map((c) => `<div class="sn-c"><b>${h(c.cname)}</b><span class="rc-note">看过 ${c.views}/${c.aud}${x.type === "作业" ? ` · 完成 ${c.done}` : ""}</span><button class="small" data-sn="who" data-cid="${h(c.cid)}" data-id="${h(c.id)}">${S.who[c.id] ? "收起名单" : "谁没看"}</button></div>${S.who[c.id] ? whoHtml(S.who[c.id], x.type === "作业") : ""}`).join("")}</div>` : ""}
        </div>`;
      }).join("")}`;
  }
  function whoHtml(l, hw) {
    if (l === "…") return `<div class="rc-note">加载中…</div>`;
    if (typeof l === "string") return `<div class="rc-note">${h(l)}</div>`;
    const no = l.filter((p) => !p.seen_at && !p.done), notDone = l.filter((p) => !p.done);
    const names = (a) => a.map((p) => "@" + (p.name || p.account)).join(" ");
    return `<div class="rc-note">还没看（${no.length}）${no.length ? ` <button class="small" data-sn="copy" data-v="${h(names(no))}">复制名字</button>` : ""}</div>
      <div class="sn-who">${no.length ? no.map((p) => `<span>${h(p.name || p.account)}</span>`).join("") : `<span class="ok">都看过了 🎉</span>`}</div>
      ${hw ? `<div class="rc-note">还没完成（${notDone.length}）${notDone.length ? ` <button class="small" data-sn="copy" data-v="${h(names(notDone))}">复制名字</button>` : ""}</div>
      <div class="sn-who">${notDone.length ? notDone.map((p) => `<span>${h(p.name || p.account)}</span>`).join("") : `<span class="ok">都完成了 🎉</span>`}</div>` : ""}`;
  }
  async function onSentClick(e) {
    const b = e.target.closest("[data-sn]"); if (!b) return;
    const k = b.dataset.sn;
    if (k === "x") { close(); return; }
    if (k === "open") { const key = b.closest("[data-k]").dataset.k; S.open.has(key) ? S.open.delete(key) : S.open.add(key); paintSent();
      const x = (S.list || []).find((y) => y.key === key); if (S.open.has(key) && x && x.classes.length === 1 && !S.who[x.classes[0].id]) who(x.classes[0].cid, x.classes[0].id); return; }
    if (k === "who") { const id = b.dataset.id; if (S.who[id]) { delete S.who[id]; paintSent(); return; } who(b.dataset.cid, id); return; }
    if (k === "copy") { const v = b.dataset.v; (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(() => { b.textContent = "已复制 ✓"; }, () => prompt("复制下面的名字：", v)); }
  }
  async function who(cid, id) {
    S.who[id] = "…"; paintSent();
    try { S.who[id] = await CCAuth.rpc("item_viewers", { cid, iid: Number(id) }); } catch (e) { S.who[id] = e.message; }
    paintSent();
  }
  window.openSent = openSent;

  // 班级空间页的链接：index.html#sent=院系 / #pub=院系
  async function fromHash() {
    const m = /^#(sent|pub)=?([\w-]*)/.exec(location.hash || ""); if (!m) return;
    if (!currentUser) { setTimeout(fromHash, 800); return; }
    if (m[1] === "sent") openSent(m[2]);
    else {
      let cids = null;
      if (m[2]) { try { const d = ((await CCAuth.rpc("dept_mine")) || []).find((x) => x.id === m[2]); cids = d ? d.classes.map((c) => c.id) : null; } catch (e) {} }
      history.replaceState(null, "", location.pathname + location.search);
      openReachForm(cids);
    }
  }
  window.addEventListener("hashchange", fromHash);
  setTimeout(fromHash, 1200);
})();
