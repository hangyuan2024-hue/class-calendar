// 1.33 资料里选院系（和小程序一样，数据库 7.54 SQL 的 org_me / org_dept_set / org_dept_suggest）
// 选了学校就自动挂到这所学校下面（学校还没开通也一样），院系自己填或从提示里点；学校开通后管理员一键整理。
(function () {
  "use strict";
  const SCH = ["university", "college", "high", "middle", "primary"];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let root = null, me = null, dept0 = "", cur = { type: "", name: "" }, saved = { type: "", name: "" }, sugT = 0, noDb = false;

  function attach(after) {
    if (root || !after) return;
    root = document.createElement("div"); root.id = "pfDept"; root.className = "org-dept hidden";
    root.innerHTML = `<label for="pfDeptIn">院系 <span class="opt-tag">选填，方便学校开通后统一管理</span></label>
      <input id="pfDeptIn" maxlength="40" placeholder="比如：计算机学院、软件工程系" autocomplete="off">
      <div class="org-dept-sug" id="pfDeptSug"></div><div class="org-dept-info" id="pfDeptInfo"></div>`;
    after.insertAdjacentElement("afterend", root);
    const inp = root.querySelector("#pfDeptIn");
    inp.addEventListener("focus", () => suggest(inp.value));
    inp.addEventListener("input", () => { clearTimeout(sugT); sugT = setTimeout(() => suggest(inp.value), 300); });
    root.querySelector("#pfDeptSug").addEventListener("click", (e) => { const b = e.target.closest("[data-dept]"); if (b) { inp.value = b.dataset.dept; root.querySelector("#pfDeptSug").innerHTML = ""; } });
  }
  const isSch = (v) => !!(v && SCH.includes(v.type) && String(v.name || "").trim());
  // 打开资料时：已保存的学校、院系
  async function open(v) {
    if (!root) return;
    cur = saved = { type: (v && v.type) || "", name: (v && v.name) || "" };
    root.querySelector("#pfDeptIn").value = ""; root.querySelector("#pfDeptSug").innerHTML = ""; dept0 = "";
    paint();
    if (!isSch(v)) return;
    try { me = await CCAuth.rpc("org_me", {}); noDb = false; } catch (e) { me = null; noDb = /org_me|PGRST202|Could not find/i.test(e.message); }
    if (me && me.dept) { dept0 = me.dept; root.querySelector("#pfDeptIn").value = me.dept; }
    paint();
  }
  // 学校选择器变了
  function changed(v) { cur = { type: (v && v.type) || "", name: (v && v.name) || "" }; paint(); }
  function paint() {
    if (!root) return;
    root.classList.toggle("hidden", !isSch(cur) || noDb);
    const info = root.querySelector("#pfDeptInfo");
    const same = cur.type === saved.type && cur.name === saved.name;
    if (!same) { info.textContent = "换了学校：保存时会一起改，院系也要重新选"; return; }
    if (!me || !me.school) { info.textContent = ""; return; }
    info.textContent = me.opened
      ? `${me.school}已在捞捞开通${me.dept ? (me.dept_ok ? "，你的院系已对上学校建好的院系" : "，你的院系还没对上学校建好的院系，从提示里选一个更准") : ""}。`
      : `${me.school}还没开通，已经有 ${me.n_school || 1} 位同学选了这所学校${me.dept ? `，其中 ${me.n_dept || 1} 位在${me.dept}` : ""}。学校开通后会按院系一键整理。`;
  }
  async function suggest(q) {
    const box = root && root.querySelector("#pfDeptSug"); if (!box) return;
    if (!(cur.type === saved.type && cur.name === saved.name)) { box.innerHTML = `<span class="meta">先保存学校，再选院系</span>`; return; }
    try {
      const l = (await CCAuth.rpc("org_dept_suggest", { p_q: String(q || "").trim() })) || [];
      box.innerHTML = l.slice(0, 12).map((x) => `<button type="button" class="${x.real ? "real" : ""}" data-dept="${esc(x.name)}">${esc(x.name)}<small>${x.real ? "学校已建" : x.n + " 人选了"}</small></button>`).join("");
    } catch (e) { box.innerHTML = ""; }
  }
  // 保存资料时：学校先存好（app.js 里），再存院系；返回出错文字或空
  async function save() {
    if (!root || root.classList.contains("hidden")) return "";
    const n = root.querySelector("#pfDeptIn").value.trim();
    const schoolChanged = !(cur.type === saved.type && cur.name === saved.name);
    if (n === dept0 && !schoolChanged) return "";
    if (schoolChanged && n === dept0) return "";   // 换了学校、没重新填院系：数据库已经把院系清掉了
    try { me = await CCAuth.rpc("org_dept_set", { p_name: n }); dept0 = me && me.dept || ""; saved = cur; paint(); return ""; }
    catch (e) { return /org_dept_set|PGRST202|Could not find/i.test(e.message) ? "院系要等管理员升级数据库后才能填" : "院系没保存：" + e.message; }
  }
  window.LaoDept = { attach, open, changed, save };
})();
