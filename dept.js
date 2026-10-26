// 7.3 院系（班级空间页 class.html）：建院系、加院系管理员、看挂进来的班；班主任输入院系码把自己的班挂进院系。
// 院系管理员对院系里每个班都有班主任的权限：发布事项（可以一次发好几个班）、看班级情况和收到情况、管签到、管成员。
// 数据库函数在 7.3-dept-audience.sql：dept_create dept_mine dept_save dept_delete dept_code_reset dept_admin_add dept_admin_remove
//   dept_lookup dept_class_link dept_class_unlink class_dept
(function () {
  "use strict";
  const { rpc, esc } = CCAuth;
  const $ = (id) => document.getElementById(id);
  const say = (m, err) => (typeof toast === "function" ? toast(m, err) : alert(m));
  const noDb = (e) => /dept_|PGRST202|Could not find|schema cache/i.test(String(e && e.message));
  let depts = null, ok = true;

  const css = `
  #deptCard .dp{border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-top:12px;background:var(--muted)}
  #deptCard .dp-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  #deptCard .dp-h b{font-size:15px}
  #deptCard .dp-code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:18px;letter-spacing:3px;font-weight:700}
  #deptCard table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}
  #deptCard th{text-align:left;color:var(--sub);font-weight:600;font-size:12px;padding:6px;border-bottom:1px solid var(--line)}
  #deptCard td{padding:7px 6px;border-bottom:1px solid var(--line)}
  #deptCard .warn{color:var(--orange)}
  .deptbox{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0 2px;font-size:13px}
  .deptbox input{width:120px;text-transform:uppercase}
  @media (max-width:640px){#deptCard table .opt{display:none}}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  function card() {
    let c = $("deptCard");
    if (c) return c;
    c = document.createElement("section"); c.className = "card hidden"; c.id = "deptCard";
    c.innerHTML = `<h2>🏛 院系 <span class="badge">7.3</span></h2>
      <div class="desc">管一个系、一个年级的老师用：建一个院系，把院系码发给各班班主任，他们在下面自己的班里输入院系码，班就挂进来了。
        院系管理员对挂进来的每个班都有班主任的权限：可以一次给几个班、整个院系发通知，看每个班谁看了、谁没完成，管签到。</div>
      <form class="row" id="deptNew"><input id="deptName" maxlength="40" placeholder="院系名称，如 计算机学院 2025 级" style="flex:1;min-width:200px"><button class="primary" type="submit">建院系</button></form>
      <div id="deptList"></div>`;
    const t = $("teachCard"); t.parentNode.insertBefore(c, t.nextSibling);
    $("deptNew").onsubmit = (e) => {
      e.preventDefault();
      const n = $("deptName").value.trim(); if (!n) return;
      act(async () => { const r = await rpc("dept_create", { p_name: n, p_org: null }); $("deptName").value = ""; say(`院系已建好，院系码 ${r.code}`); });
    };
    c.addEventListener("click", onClick);
    return c;
  }
  async function act(fn) { try { await fn(); await load(); } catch (e) { say(noDb(e) ? "数据库还没执行 7.3 的 SQL（7.3-dept-audience.sql）" : e.message, true); } }

  async function load() {
    const c = card();
    try { depts = (await rpc("dept_mine")) || []; ok = true; }
    catch (e) { depts = []; ok = !noDb(e); if (!ok) { c.classList.add("hidden"); return; } }
    let me = null; try { me = await CCAuth.me(); } catch (e) {}
    const teacher = me && (me.role === "teacher" || me.role === "admin" || me.role === "developer");
    c.classList.toggle("hidden", !teacher && !depts.length);
    $("deptNew").classList.toggle("hidden", !teacher);
    if (location.hash === "#dept" && !load._scrolled) { load._scrolled = true; setTimeout(() => c.scrollIntoView({ behavior: "smooth" }), 200); }
    $("deptList").innerHTML = depts.length ? depts.map(deptHtml).join("") : `<div class="empty">还没有院系。管多个班的老师可以建一个；只带一个班的老师不用建，等院系负责人把院系码发给你，在下面自己的班里填上就行。</div>`;
    fill();
  }
  function deptHtml(d) {
    const own = d.role === "owner", cl = d.classes || [];
    const total = cl.reduce((a, x) => a + (x.total || 0), 0), pend = cl.reduce((a, x) => a + (x.pending || 0), 0);
    return `<div class="dp" data-did="${esc(d.id)}">
      <div class="dp-h"><b>${esc(d.name)}</b><span class="badge ${own ? "ok" : "mon"}">${own ? "我建的" : "管理员"}</span><span class="spacer"></span>
        <span class="meta">院系码</span><span class="dp-code">${esc(d.code)}</span>
        <button class="small" data-dp="copy" data-code="${esc(d.code)}" data-name="${esc(d.name)}">复制给班主任</button>
        <button class="small" data-dp="code">换码</button><button class="small" data-dp="rename" data-name="${esc(d.name)}">改名</button>
        ${own ? `<button class="small danger" data-dp="del" data-name="${esc(d.name)}">解散</button>` : `<button class="small danger" data-dp="leave">退出管理</button>`}</div>
      <div class="meta" style="margin-top:6px">${cl.length} 个班 · ${total} 名学生${pend ? ` · <span class="warn">${pend} 人待审批</span>` : ""}
        · <a href="index.html#teach">去「班级情况」看每个班 ›</a> · <a href="index.html#sent=${esc(d.id)}">收到情况 ›</a> · <a href="index.html#pub=${esc(d.id)}">📣 发到院系 ›</a></div>
      <h3>挂进来的班</h3>
      ${cl.length ? `<table><tr><th>班级</th><th>班主任</th><th>人数</th><th class="opt">这两周作业</th><th class="opt">签到</th><th></th></tr>
        ${cl.map((x) => `<tr><td><b>${esc(x.name)}</b>${x.pending ? ` <span class="badge wait">${x.pending} 待批准</span>` : ""}</td><td>${esc(x.teacher || "")}</td><td>${x.total}</td>
          <td class="opt">${x.hw}</td><td class="opt">${x.ck_open ? "进行中" : "—"}</td><td><button class="small danger" data-dp="unlink" data-cid="${esc(x.id)}" data-name="${esc(x.name)}">移出</button></td></tr>`).join("")}</table>`
        : `<div class="empty">还没有班挂进来。点上面「复制给班主任」，把院系码发给各班班主任：他们在「班级空间 → 我管理的班级」里自己的班下面填院系码就行。</div>`}
      <h3>院系管理员</h3>
      <div class="chips">${(d.admins || []).map((a) => `<span class="chip${a.role === "owner" ? " lead" : ""}">${esc(a.name)} <span class="meta">${esc(a.account || "")}</span>${a.role === "owner" ? "<b>负责人</b>" : own ? `<button data-dp="rm" data-uid="${esc(a.user_id)}" data-name="${esc(a.name)}" title="移除">✕</button>` : ""}</span>`).join("")}
        ${own ? `<button class="small" data-dp="add">＋ 按账号加管理员</button>` : ""}</div>
    </div>`;
  }
  function onClick(e) {
    const b = e.target.closest("[data-dp]"); if (!b) return;
    const did = b.closest("[data-did]") && b.closest("[data-did]").dataset.did, k = b.dataset.dp;
    if (k === "copy") {
      const t = `「${b.dataset.name}」院系码：${b.dataset.code}\n班主任请打开捞捞课程表 → 班级空间（${location.origin}${location.pathname.replace(/[^/]*$/, "")}class.html）→ 在自己的班下面「所属院系」里填这个码，班就挂进院系了。挂进来后院系管理员可以一起给各班发通知、看收到情况。`;
      navigator.clipboard.writeText(t).then(() => say("已复制，发给各班班主任"), () => prompt("复制下面这段：", t));
      return;
    }
    if (k === "code" && !confirm("换码后旧的院系码立即失效（已经挂进来的班不受影响）。继续？")) return;
    if (k === "del" && !confirm(`解散「${b.dataset.name}」？班级本身不受影响，只是不再挂在院系下，院系管理员也就管不到这些班了。`)) return;
    if (k === "leave" && !confirm("退出后你就管不到这个院系的班了。继续？")) return;
    if (k === "unlink" && !confirm(`把「${b.dataset.name}」移出院系？`)) return;
    if (k === "rm" && !confirm(`移除管理员 ${b.dataset.name}？`)) return;
    let name = null, acct = null;
    if (k === "rename") { name = prompt("院系的新名称：", b.dataset.name); if (!name || !name.trim()) return; }
    if (k === "add") { acct = prompt("要加的老师账号（对方先注册好）："); if (!acct || !acct.trim()) return; }
    act(async () => {
      if (k === "code") { const c = await rpc("dept_code_reset", { did }); say("新的院系码 " + c); }
      if (k === "rename") { await rpc("dept_save", { did, p_name: name.trim(), p_org: null }); say("已改名"); }
      if (k === "del") { await rpc("dept_delete", { did }); say("已解散"); }
      if (k === "leave") { const me = await CCAuth.me(); await rpc("dept_admin_remove", { did, uid: me.id }); say("已退出"); }
      if (k === "unlink") { await rpc("dept_class_unlink", { cid: b.dataset.cid }); say("已移出"); }
      if (k === "add") { const r = await rpc("dept_admin_add", { did, p_account: acct.trim() }); say(`已加 ${r.name} 为院系管理员`); }
      if (k === "rm") { await rpc("dept_admin_remove", { did, uid: b.dataset.uid }); say("已移除"); }
      if (typeof window.reloadClasses === "function") window.reloadClasses();
    });
  }

  // 每个自己建的班下面：所属院系（显示 / 填院系码挂进去 / 移出）
  async function fill() {
    if (!ok) return;
    for (const box of document.querySelectorAll("[data-deptbox]")) {
      if (box.dataset.done) continue; box.dataset.done = "1";
      const cid = box.dataset.deptbox;
      let d = null;
      try { d = await rpc("class_dept", { cid }); } catch (e) { if (noDb(e)) { box.remove(); continue; } }
      box.innerHTML = d ? `<span class="meta">所属院系</span><b>🏛 ${esc(d.name)}</b><span class="meta">院系管理员也能给这个班发通知、看情况</span><button class="small" data-dl="out">移出院系</button>`
        : `<span class="meta">所属院系</span><input maxlength="6" placeholder="院系码" aria-label="院系码"><button class="small" data-dl="in">挂进院系</button><span class="meta">系里 / 年级统一管理时用，不填也行</span>`;
    }
  }
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-dl]"); if (!b) return;
    const box = b.closest("[data-deptbox]"), cid = box.dataset.deptbox;
    try {
      if (b.dataset.dl === "in") {
        const code = box.querySelector("input").value.trim().toUpperCase(); if (!code) return;
        const d = await rpc("dept_lookup", { p_code: code });
        if (!d) { say("院系码不对", true); return; }
        if (!confirm(`把这个班挂进「${d.name}」${d.by ? `（${d.by} 建的，已经有 ${d.classes} 个班）` : ""}？\n挂进去后，这个院系的管理员对本班也有老师权限：能发通知、看谁没看 / 没完成、管签到和成员。`)) return;
        await rpc("dept_class_link", { p_code: code, cid }); say(`已挂进「${d.name}」`);
      } else {
        if (!confirm("把这个班移出院系？院系管理员就管不到这个班了。")) return;
        await rpc("dept_class_unlink", { cid }); say("已移出");
      }
      delete box.dataset.done; await load();
    } catch (err) { say(noDb(err) ? "数据库还没执行 7.3 的 SQL" : err.message, true); }
  });
  window.DEPT = { load, fill };
  // class.js 可能在本文件加载前就跑完了 load()：自己补一次
  setTimeout(() => { if (!depts && document.querySelector("[data-deptbox]")) load(); }, 300);
})();
