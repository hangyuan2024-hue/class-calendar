const { rest, rpc, esc, ROLE_NAMES } = CCAuth;
const $ = (id) => document.getElementById(id);
let me = null, plugins = [], drafts = [];

function toast(msg, err) {
  const t = $("toast"); t.textContent = msg; t.className = "show" + (err ? " err" : "");
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.className = ""), 2600);
}
async function guard(btn, fn) {
  if (btn) btn.disabled = true;
  try { await fn(); } catch (e) { toast(e.message, true); } finally { if (btn) btn.disabled = false; }
}
const fmt = (t) => t ? new Date(t).toLocaleString("zh-CN", { hour12: false }).replace(/:\d\d$/, "") : "";
const ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const VER_RE = /^\d+\.\d+\.\d+$/;
const bump = (v) => { const m = String(v || "").match(/^(\d+)\.(\d+)\.(\d+)$/); return m ? `${m[1]}.${m[2]}.${+m[3] + 1}` : "1.0.0"; };
const cmpVer = (a, b) => { const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };

// ---------- 代码体检（上传前 & 审核时共用） ----------
function scan(code, html, id) {
  const out = []; // [级别 e/w/o, 文字]
  const all = (code || "") + "\n" + (html || "");
  if (code != null) {
    if (!/CalendarApp\.register\s*\(/.test(code)) out.push(["e", "plugin.js 里没有 CalendarApp.register(...)"]);
    else if (id && !new RegExp(`id\\s*:\\s*["'\`]${id.replace(/[-]/g, "\\-")}["'\`]`).test(code)) out.push(["e", `plugin.js 里注册的 id 必须是 "${id}"`]);
  }
  if (html != null && !/<html[\s>]|<!doctype html/i.test(html)) out.push(["w", "app.html 看起来不是完整的 HTML 页面"]);
  if (/cc_session|access_token|refresh_token/.test(all)) out.push(["e", "代码里出现了登录凭证相关字样（cc_session / token），插件不应读取登录信息"]);
  if (/\beval\s*\(|new\s+Function\s*\(/.test(all)) out.push(["w", "使用了 eval / new Function，请确认用途"]);
  if (/getClassItems/.test(all) && /\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|new\s+Image/.test(all))
    out.push(["w", "既读取班级事项又会联网：请确认没有把同学们的班级信息发到别的网站（隐私）"]);
  if (/document\.cookie/.test(all)) out.push(["w", "读取了 document.cookie"]);
  const hosts = [...new Set((all.match(/https?:\/\/[a-z0-9.-]+/gi) || []).map((u) => u.replace(/^https?:\/\//i, "").toLowerCase()))]
    .filter((h) => !/^(www\.w3\.org|reactbits\.dev)$/.test(h));
  if (hosts.length) out.push(["w", "会访问外部网址：" + hosts.join("、") + "（离线时这些功能可能不可用，涉及隐私需在说明里写清）"]);
  if (/<script[^>]+src\s*=\s*["']https?:/i.test(all)) out.push(["w", "从外部网站加载脚本，国内网络可能打不开"]);
  const keys = [...all.matchAll(/localStorage\.(?:setItem|getItem)\(\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1])
    .filter((k) => !/^(personal_|plg_)/.test(k));
  if (keys.length) out.push(["w", "本地存储键没有用 personal_ 前缀：" + [...new Set(keys)].slice(0, 5).join("、")]);
  // 文件大小不限；比较大时提醒一下：同学们第一次添加要多等一会儿（之后存在本机，不再下载）
  const mb = ((code || "").length + (html || "").length) / 1048576;
  if (mb > 3) out.push(["w", `文件一共约 ${mb.toFixed(1)} MB，比较大：同学们第一次添加时要多等一会儿（之后存在本机，不用再下载）`]);
  if (!out.some((x) => x[0] !== "o")) out.push(["o", "没有发现问题"]);
  return out;
}
const scanHtml = (list) => list.map(([lv, t]) => `<div class="${lv}">${lv === "e" ? "✗" : lv === "w" ? "⚠" : "✓"} ${esc(t)}</div>`).join("");

// ---------- 数据 ----------
async function loadData() {
  const cols = "id,author_id,author_name,name,icon,description,version,default_on,published_at,created_at";
  plugins = await rest(`plugins?select=${cols}&order=created_at.asc`);
  drafts = await rest("plugin_drafts?select=plugin_id,name,icon,description,version,status,review_note,updated_at&order=updated_at.desc");
  // 更新说明（数据库还没加这一列时就跳过）
  try { const notes = await rest("plugin_drafts?select=plugin_id,changelog"); for (const n of notes) { const d = draftOf(n.plugin_id); if (d) d.changelog = n.changelog || ""; } } catch (e) {}
}
const draftOf = (id) => drafts.find((d) => d.plugin_id === id);
const pluginOf = (id) => plugins.find((p) => p.id === id);

function statusBadges(p) {
  const d = draftOf(p.id); const b = [];
  if (p.published_at) b.push(`<span class="badge pub">已发布 v${esc(p.version)}</span>`);
  if (d && d.status === "testing") b.push(`<span class="badge test">测试中 v${esc(d.version)}</span>`);
  if (d && d.status === "rejected") b.push(`<span class="badge rej">被驳回 v${esc(d.version)}</span>`);
  if (!p.published_at && !d) b.push(`<span class="badge">草稿（还没提交文件）</span>`);
  if (p.default_on && p.published_at) b.push(`<span class="badge">默认开启</span>`);
  return b.join(" ");
}

function renderMine() {
  const mine = plugins.filter((p) => p.author_id === me.id);
  $("mineList").className = mine.length ? "" : "empty";
  $("mineList").innerHTML = mine.length ? mine.map((p) => {
    const d = draftOf(p.id); const show = d || p;
    return `<div class="row"><div class="icon">${esc(show.icon || "🧩")}</div>
      <div class="info"><div class="name">${esc(show.name || p.id)} <span class="meta">${esc(p.id)}</span></div>
        <div class="meta">${statusBadges(p)}</div>
        ${d && d.changelog ? `<div class="note" style="white-space:pre-wrap">v${esc(d.version)} 更新说明：${esc(d.changelog)}</div>` : ""}
        ${d && d.status === "rejected" && d.review_note ? `<div class="note">驳回意见：${esc(d.review_note)}</div>` : ""}</div>
      <div class="ops">
        <button class="small primary" data-act="update" data-id="${esc(p.id)}">上传新版本</button>
        ${d ? `<button class="small" data-act="view" data-id="${esc(p.id)}">查看代码</button>
               <button class="small danger" data-act="withdraw" data-id="${esc(p.id)}">撤回测试版</button>` : ""}
        ${!p.published_at ? `<button class="small danger" data-act="delete" data-id="${esc(p.id)}">删除</button>` : ""}
      </div></div>`;
  }).join("") : "还没有插件。在上面上传第一个吧。";

  const sel = $("upTarget"), cur = sel.value;
  sel.innerHTML = `<option value="__new">＋ 新插件</option>` +
    mine.map((p) => `<option value="${esc(p.id)}">${esc((draftOf(p.id) || p).name || p.id)}（${esc(p.id)}）</option>`).join("");
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

function renderTesting() {
  const list = drafts.filter((d) => d.status === "testing");
  $("testList").className = list.length ? "" : "empty";
  $("testList").innerHTML = list.length ? list.map((d) => {
    const p = pluginOf(d.plugin_id) || {};
    return `<div class="row"><div class="icon">${esc(d.icon)}</div>
      <div class="info"><div class="name">${esc(d.name)} <span class="badge test">v${esc(d.version)}</span></div>
        <div class="meta">作者 ${esc(p.author_name || "未知")} · 提交于 ${fmt(d.updated_at)}${p.published_at ? ` · 线上版本 v${esc(p.version)}` : " · 新插件"}</div>
        <div class="meta">${esc(d.description)}</div></div></div>`;
  }).join("") : "现在没有测试中的插件。";
}

function renderReview() {
  const list = drafts.filter((d) => d.status === "testing");
  $("reviewList").className = list.length ? "" : "empty";
  $("reviewList").innerHTML = list.length ? list.map((d) => {
    const p = pluginOf(d.plugin_id) || {};
    return `<div class="row"><div class="icon">${esc(d.icon)}</div>
      <div class="info"><div class="name">${esc(d.name)} <span class="badge test">v${esc(d.version)}</span></div>
        <div class="meta">${esc(d.plugin_id)} · 作者 ${esc(p.author_name || "未知")} · ${fmt(d.updated_at)}${p.published_at ? ` · 替换线上 v${esc(p.version)}` : " · 首次发布"}</div>
        <div class="meta">${esc(d.description)}</div></div>
      <div class="ops">
        ${can("view_code") ? `<button class="small" data-act="view" data-id="${esc(d.plugin_id)}">查看代码</button>` : ""}
        ${can("publish") ? (p.author_id === me.id && me.role !== "admin"
          ? `<button class="small" disabled title="不能发布自己写的插件">发布（需他人审核）</button>`
          : `<button class="small primary" data-act="publish" data-id="${esc(d.plugin_id)}">发布</button>`) : ""}
        ${can("reject") ? `<button class="small danger" data-act="reject" data-id="${esc(d.plugin_id)}">驳回</button>` : ""}
      </div></div>`;
  }).join("") : "没有待审核的插件。";

  const pub = plugins.filter((p) => p.published_at);
  $("pubList").className = pub.length ? "" : "empty";
  $("pubList").innerHTML = pub.length ? pub.map((p) => `<div class="row"><div class="icon">${esc(p.icon)}</div>
      <div class="info"><div class="name">${esc(p.name)} <span class="badge pub">v${esc(p.version)}</span></div>
        <div class="meta">${esc(p.id)} · 作者 ${esc(p.author_name || "未指定")} · 发布于 ${fmt(p.published_at)}</div></div>
      <div class="ops">
        ${can("set_default") ? `<label class="meta" style="display:flex;align-items:center;gap:4px"><input type="checkbox" data-act="default" data-id="${esc(p.id)}" ${p.default_on ? "checked" : ""}> 默认开启</label>` : ""}
        ${can("transfer") ? `<button class="small" data-act="author" data-id="${esc(p.id)}">转交作者</button>` : ""}
        ${can("unpublish") ? `<button class="small danger" data-act="unpublish" data-id="${esc(p.id)}">下架</button>` : ""}
      </div></div>`).join("") : "还没有已发布的插件。";
}

let users = [];
async function loadUsers() {
  users = await rest("profiles?select=id,account,display_name,role,created_at&order=created_at.asc");
  renderUsers();
}
function renderUsers() {
  const q = $("userFilter").value.trim().toLowerCase();
  const list = users.filter((u) => !q || u.account.includes(q) || u.display_name.toLowerCase().includes(q));
  $("userRows").innerHTML = list.map((u) => `<tr><td>${esc(u.account)}</td><td>${esc(u.display_name)}</td>
    <td><select data-uid="${esc(u.id)}" ${u.id === me.id ? "disabled title=\"不能修改自己的身份\"" : (u.role === "admin" && me.role !== "admin") ? "disabled title=\"只有管理员能修改管理员\"" : ""}>
      ${Object.entries(ROLE_NAMES).filter(([k]) => k !== "admin" || me.role === "admin" || u.role === "admin")
        .map(([k, v]) => `<option value="${k}" ${u.role === k ? "selected" : ""}>${v}</option>`).join("")}
    </select></td><td class="meta">${fmt(u.created_at)}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">没有匹配的用户</td></tr>`;
}
$("userFilter").oninput = renderUsers;
$("userRows").onchange = (e) => {
  const s = e.target.closest("select[data-uid]"); if (!s) return;
  const u = users.find((x) => x.id === s.dataset.uid);
  guard(s, async () => {
    await rpc("set_user_role", { uid: u.id, new_role: s.value });
    u.role = s.value; toast(`${u.display_name} 已设为${ROLE_NAMES[u.role]}`);
  }).then(() => { if (u.role !== s.value) renderUsers(); });
};

async function refresh() { await loadData(); renderAll(); }
function renderAll() {
  if (can("upload")) renderMine();
  if (can("try_testing")) renderTesting();
  renderReview();
}
const has = (...roles) => roles.includes(me.role);
const can = (perm) => CCAuth.can(me, perm);

// ---------- 身份权限（仅管理员） ----------
let rolePerms = [];
async function loadPerms() {
  rolePerms = await rest("role_perms?select=role,perm");
  const on = (r, p) => rolePerms.some((x) => x.role === r && x.perm === p);
  $("permRows").innerHTML = Object.entries(CCAuth.STAFF_PERMS).map(([p, name]) => `<tr><td>${esc(name)}</td>
    ${["developer", "tester"].map((r) => `<td style="text-align:center"><input type="checkbox" data-role="${r}" data-perm="${p}" ${on(r, p) ? "checked" : ""}></td>`).join("")}</tr>`).join("");
}
$("permRows").onchange = (e) => {
  const c = e.target.closest("input[data-perm]"); if (!c) return;
  guard(c, async () => {
    await rpc("set_role_perm", { r: c.dataset.role, p: c.dataset.perm, enabled: c.checked });
    toast(`${ROLE_NAMES[c.dataset.role]}：${c.checked ? "已开通" : "已关闭"}「${CCAuth.STAFF_PERMS[c.dataset.perm]}」`);
  }).then(() => loadPerms().catch(() => {}));
};

// ---------- 全站功能开关（仅管理员） ----------
const FEAT_ROLES = ["student", "teacher", "tester", "developer"];
let feats = [];
async function loadFeats() {
  feats = await rpc("admin_features");
  $("featRows").innerHTML = feats.map((f) => `<tr data-key="${esc(f.key)}" class="${f.enabled ? "" : "off"}">
    <td><b>${esc(f.name)}</b>${f.enabled ? "" : `<span class="pill">已暂停</span>`}<div class="fdesc">${esc(f.descr)}</div></td>
    <td style="text-align:center"><input type="checkbox" data-f="enabled" ${f.enabled ? "checked" : ""} aria-label="全站开关"></td>
    ${FEAT_ROLES.map((r) => `<td style="text-align:center"><input type="checkbox" data-f="${r}" ${f.roles[r] === false ? "" : "checked"} ${f.enabled ? "" : "disabled"} aria-label="${ROLE_NAMES[r]}"></td>`).join("")}
    <td><input type="text" data-f="note" maxlength="100" value="${esc(f.note || "")}" placeholder="如：AI 维护中，预计今晚恢复"></td></tr>`).join("");
}
// 改动按顺序一条条保存（填原因后马上点开关会连着触发两次保存，并发时后发的可能先到，结果被旧值覆盖）
let featQueue = Promise.resolve();
function saveFeat(row) {
  const roles = {}; for (const r of FEAT_ROLES) roles[r] = row.querySelector(`[data-f="${r}"]`).checked;
  const v = { k: row.dataset.key, en: row.querySelector('[data-f="enabled"]').checked, rls: roles, nt: row.querySelector('[data-f="note"]').value };
  const name = feats.find((f) => f.key === v.k).name;
  const job = featQueue.then(async () => {
    await rpc("admin_set_feature", v);
    toast(v.en ? `「${name}」已保存` : `已暂停「${name}」，全站立即生效`);
    await loadFeats();
  });
  featQueue = job.catch(() => {});
  return job;
}
$("featRows").addEventListener("change", (e) => {
  const row = e.target.closest("tr[data-key]"); if (!row) return;
  const en = row.querySelector('[data-f="enabled"]');
  if (e.target === en && !en.checked && !confirm(`确定对全站暂停「${feats.find((f) => f.key === row.dataset.key).name}」？`)) { en.checked = true; return; }
  guard(e.target, () => saveFeat(row)).catch(() => loadFeats().catch(() => {}));
});

// ---------- 上传 ----------
function fillForm(id) {
  const isNew = id === "__new";
  $("idWrap").classList.toggle("hidden", !isNew);
  $("upCode").value = ""; $("upHtml").value = ""; $("checks").innerHTML = "";
  $("upNotes").value = "";
  if (isNew) { $("upId").value = ""; $("upName").value = ""; $("upIcon").value = "🧩"; $("upVersion").value = "1.0.0"; $("upDesc").value = ""; $("upNotes").value = "第一个版本"; return; }
  const p = pluginOf(id), d = draftOf(id), src = d || p;
  $("upName").value = src.name || ""; $("upIcon").value = src.icon || "🧩"; $("upDesc").value = src.description || "";
  const base = [d && d.version, p && p.version].filter(Boolean).sort(cmpVer).pop();
  $("upVersion").value = base ? bump(base) : "1.0.0";
}
$("upTarget").onchange = (e) => fillForm(e.target.value);
$("upReset").onclick = () => { $("upTarget").value = "__new"; fillForm("__new"); };

// ---------- 大文件分块上传：服务器网关不收太大的单次请求，切成 20 万字一块，一块块传，最后在数据库里拼起来 ----------
const CHUNK = 200 * 1024, CHUNK_AT = 400 * 1024;
function splitText(text) {
  const out = [];
  for (let i = 0; i < text.length;) {
    let j = Math.min(text.length, i + CHUNK);
    const c = text.charCodeAt(j - 1);
    if (j < text.length && c >= 0xd800 && c <= 0xdbff) j--;   // 别把一个 emoji 切成两半
    out.push(text.slice(i, j)); i = j;
  }
  return out.length ? out : [""];
}
async function chunkedSubmit({ id, name, icon, description, version, notes, code, html }) {
  const parts = { code: code == null ? null : splitText(code), app_html: html == null ? null : splitText(html) };
  const all = (parts.code || []).length + (parts.app_html || []).length;
  let done = 0;
  const btn = $("upBtn"), label = btn.textContent;
  try {
    for (const field of ["code", "app_html"]) {
      if (!parts[field]) continue;
      for (let i = 0; i < parts[field].length; i++) {
        for (let t = 0; ; t++) {   // 网络抖一下就重试，最多 3 次
          try { await rpc("plugin_chunk_put", { p_pid: id, p_field: field, p_seq: i, p_data: parts[field][i] }); break; }
          catch (e) {
            if (/Could not find the function|PGRST202/i.test(e.message)) throw new Error("后台还没装「分块上传」：请在扣子编程终端运行 python3 setup_miniapp.py 后再提交");
            if (t >= 2 || /权限/.test(e.message)) throw e;
            await new Promise((r) => setTimeout(r, 1000 * (t + 1)));
          }
        }
        done++; btn.textContent = `上传中 ${Math.round((done / all) * 100)}%`;
      }
    }
    btn.textContent = "正在保存…";
    await rpc("plugin_draft_submit", { p_pid: id, p_name: name, p_icon: icon, p_description: description, p_version: version, p_changelog: notes,
      p_code_parts: parts.code ? parts.code.length : null, p_html_parts: parts.app_html ? parts.app_html.length : null });
  } finally { btn.textContent = label; }
}

async function readFile(inp) { const f = inp.files[0]; return f ? await f.text() : null; }
async function previousFiles(id) {
  const tryGet = async (path) => { try { const r = await rest(path); return r && r[0]; } catch { return null; } };
  return (await tryGet(`plugin_drafts?select=code,app_html&plugin_id=eq.${encodeURIComponent(id)}`))
      || (await tryGet(`plugins?select=code,app_html&id=eq.${encodeURIComponent(id)}`)) || {};
}

$("upForm").onsubmit = (e) => {
  e.preventDefault();
  guard($("upBtn"), async () => {
    const isNew = $("upTarget").value === "__new";
    const id = isNew ? $("upId").value.trim().toLowerCase() : $("upTarget").value;
    const name = $("upName").value.trim(), icon = $("upIcon").value.trim() || "🧩";
    const version = $("upVersion").value.trim(), description = $("upDesc").value.trim();
    if (!ID_RE.test(id)) throw new Error("插件 ID 只能用小写字母、数字和连字符，2~40 位，比如 study-log");
    if (isNew && pluginOf(id)) throw new Error("这个 ID 已经被用了，换一个");
    if (!name) throw new Error("请填写名称");
    if (!VER_RE.test(version)) throw new Error("版本号格式应为 1.0.0");
    const p = pluginOf(id);
    if (p && p.version && cmpVer(version, p.version) <= 0) throw new Error(`版本号要比线上的 v${p.version} 大`);

    let code = await readFile($("upCode")), html = await readFile($("upHtml"));
    if (!isNew && code == null && html == null) { const prev = await previousFiles(id); code = prev.code ?? null; html = prev.app_html ?? null; }
    if (code == null && html == null) throw new Error("请至少选择 plugin.js 或 app.html 其中一个文件");

    const checks = scan(code, html, id);
    $("checks").innerHTML = scanHtml(checks);
    if (checks.some((c) => c[0] === "e")) throw new Error("文件没通过检查，请按上面的红色提示修改");

    if (isNew) await rest("plugins", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ id }) });
    const notes = $("upNotes").value.trim().slice(0, 1000);
    const draft = { plugin_id: id, name, icon, description, version, code, app_html: html };
    const send = (body) => rest("plugin_drafts?on_conflict=plugin_id", {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(body),
    });
    let noteSaved = true;
    if ((code || "").length + (html || "").length > CHUNK_AT) {
      await chunkedSubmit({ id, name, icon, description, version, notes, code, html });   // 文件大：分块上传
    } else {
      try { await send({ ...draft, changelog: notes }); }
      catch (err) {
        if (!/changelog/i.test(err.message)) throw err;
        await send(draft); noteSaved = false;   // 数据库还没装「更新日志」：先只提交插件
      }
    }
    toast(noteSaved ? "已提交，进入测试中" : "已提交，进入测试中（数据库还没装更新日志，这次的说明没保存）");
    await refresh();
    $("upTarget").value = id; fillForm(id);
    $("checks").innerHTML = `<div style="color:var(--sub)">刚才提交的 v${esc(version)} 体检结果：</div>` + scanHtml(checks);
  });
};

// ---------- 列表里的按钮 ----------
document.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-act]"); if (!b) return;
  const id = b.dataset.id, act = b.dataset.act;
  if (act === "update") { $("upTarget").value = id; fillForm(id); $("uploadCard").scrollIntoView({ behavior: "smooth" }); return; }
  if (act === "view") { openViewer(id); return; }
  guard(b, async () => {
    if (act === "withdraw") { if (!confirm("撤回测试版？已发布的版本不受影响。")) return;
      await rest(`plugin_drafts?plugin_id=eq.${encodeURIComponent(id)}`, { method: "DELETE" }); toast("已撤回"); }
    if (act === "delete") { if (!confirm(`删除插件 ${id}？此操作不能撤销。`)) return;
      await rest(`plugins?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" }); toast("已删除"); }
    if (act === "publish") { const d = draftOf(id);
      if (!reviewed[id]) { openViewer(id); toast("请先看一遍代码，再点发布"); return; }
      if (!confirm(`发布「${d.name}」v${d.version}？发布后所有同学都能看到。`)) return;
      await rpc("publish_plugin_v2", { pid: id, sha: reviewed[id] }); delete reviewed[id]; toast("已发布"); }
    if (act === "reject") { const note = prompt("驳回意见（作者能看到）："); if (note === null) return;
      await rpc("reject_plugin", { pid: id, note }); toast("已驳回"); }
    if (act === "unpublish") { if (!confirm("下架后同学们将看不到这个插件，确定吗？")) return;
      await rpc("unpublish_plugin", { pid: id }); toast("已下架"); }
    if (act === "author") { const acct = prompt("转交给哪个账号？（对方需要先注册）"); if (!acct) return;
      await rpc("set_plugin_author", { pid: id, acct: acct.trim() }); toast("作者已更新"); }
    await refresh();
  });
});
document.addEventListener("change", (e) => {
  const c = e.target.closest("input[data-act=default]"); if (!c) return;
  guard(c, async () => {
    await rest(`plugins?id=eq.${encodeURIComponent(c.dataset.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ default_on: c.checked }) });
    toast(c.checked ? "新用户默认开启" : "已取消默认开启"); await refresh();
  });
});

// ---------- 代码查看 ----------
let viewing = null;
const reviewed = {};   // 插件 id -> 查看代码时的指纹
async function draftSha(r) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode((r.code || "") + "\u0001" + (r.app_html || "")));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function openViewer(id) {
  const d = draftOf(id);
  const r = (await rest(`plugin_drafts?select=code,app_html&plugin_id=eq.${encodeURIComponent(id)}`))[0] || {};
  viewing = r;
  reviewed[id] = await draftSha(r);   // 记下审核时看到的代码指纹，发布时服务器会比对
  $("vTitle").textContent = `${d ? d.name + " v" + d.version : id}`;
  $("vScan").innerHTML = scanHtml(scan(r.code, r.app_html, id)).replace(/class="(\w)"/g, (m, lv) =>
    `style="color:var(--${lv === "e" ? "red" : lv === "w" ? "orange" : "green"})"`);
  $("vTabCode").disabled = r.code == null; $("vTabHtml").disabled = r.app_html == null;
  showCode(r.code != null ? "code" : "html");
  const canPub = !!document.querySelector(`#reviewList button[data-act=publish][data-id="${CSS.escape(id)}"]`);
  $("vPublish").hidden = !canPub; $("vPublish").dataset.id = id;
  $("viewer").classList.add("open");
}
function showCode(which) {
  const txt = which === "code" ? viewing.code : viewing.app_html;
  $("vBody").textContent = txt == null ? "（没有这个文件）" : txt;
  $("vTabCode").classList.toggle("primary", which === "code"); $("vTabHtml").classList.toggle("primary", which === "html");
}
$("vTabCode").onclick = () => showCode("code");
$("vPublish").onclick = () => guard($("vPublish"), async () => {
  const id = $("vPublish").dataset.id, d = draftOf(id);
  if (!confirm(`发布「${d.name}」v${d.version}？发布后所有同学都能看到。`)) return;
  await rpc("publish_plugin_v2", { pid: id, sha: reviewed[id] }); delete reviewed[id];
  $("viewer").classList.remove("open"); toast("已发布"); await refresh();
});
$("vTabHtml").onclick = () => showCode("html");
$("vClose").onclick = () => $("viewer").classList.remove("open");
$("viewer").onclick = (e) => { if (e.target.id === "viewer") $("viewer").classList.remove("open"); };

// ---------- 启动 ----------
$("logout").onclick = async () => { await CCAuth.signOut(); location.href = "login.html"; };
(async () => {
  const s = await CCAuth.session();
  if (!s) { location.href = "login.html?next=dev.html"; return; }
  me = await CCAuth.me();
  if (!me) { toast("读取账号信息失败，请重新登录", true); await CCAuth.signOut(); setTimeout(() => (location.href = "login.html?next=dev.html"), 1200); return; }
  $("who").innerHTML = `${esc(me.display_name)}（${esc(me.account)}） <span class="badge">${esc(ROLE_NAMES[me.role] || me.role)}</span>`;
  const staff = (me.perms || []).length > 0;
  $("noRole").classList.toggle("hidden", staff);
  document.querySelectorAll("[data-roles]").forEach((el) => el.classList.toggle("hidden", !el.dataset.roles.split(" ").includes(me.role)));
  document.querySelectorAll("[data-perms]").forEach((el) => el.classList.toggle("hidden", !el.dataset.perms.split(" ").some(can)));
  if (!staff) return;
  fillForm("__new");
  try { await refresh(); } catch (e) { toast(e.message, true); }
  if (can("manage_users")) loadUsers().catch((e) => toast(e.message, true));
  if (has("admin")) loadPerms().catch((e) => toast(e.message, true));
  if (has("admin")) loadFeats().then(() => { if (location.hash === "#features") $("featCard").scrollIntoView(); }).catch((e) => toast("功能开关读取失败：" + e.message + "（需要在扣子终端运行 setupaccounts.py）", true));
})();
