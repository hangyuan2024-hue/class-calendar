// 班级事项：发布、修改、删除、修改记录（老师、班委、组长、打开了「全班都能维护」的同学）；作业附件
"use strict";
const CTYPES = ["作业", "会议", "活动", "通知"];

// 发布 / 修改班级事项。x 为空 = 新发布；preset 可带 day、time
function editClassItem(x, preset) {
  const S = App.S, isNew = !x; preset = preset || {};
  const groups = S.groupsOk ? (S.groups || []).filter((g) => App.canEditIn(g.id)) : [];
  const cur = x ? x.gid || "" : preset.gid || "";
  const scopes = (App.canEditIn(null) || (x && !x.gid) ? [["", "全班"]] : []).concat(groups.map((g) => [String(g.id), `👥 ${g.name}（${(g.members || []).length} 人）`]));
  if (!scopes.length) { toast("你没有在这个班发布事项的权限", { bad: true }); return; }
  const r = x ? x.raw || {} : {};
  const p = x ? { day: x.day, time: x.time } : { day: preset.day || todayKey(), time: preset.time || "" };
  const d = h(`<form class="dialog" role="dialog">
    <h3>${isNew ? "发布班级事项" : "修改班级事项"}<small class="muted" style="font-weight:400;margin-left:8px">${esc(App.className())}</small></h3>
    <div class="dbody">
      <div class="row"><label class="field" style="flex:0 0 120px">类型<select name="type">${CTYPES.map((t) => `<option${(x ? x.type : "作业") === t ? " selected" : ""}>${t}</option>`).join("")}</select></label>
        <label class="field" style="flex:1">科目 / 标题<input name="subject" maxlength="60" required value="${esc(x ? r.subject || x.title : "")}" placeholder="例如：高等数学"></label></div>
      <label class="field">内容<textarea name="summary" rows="2" maxlength="300" placeholder="例如：第三章习题 1-15，交到学习通">${esc(x ? r.summary || x.summary : "")}</textarea></label>
      <div class="row"><label class="field" style="flex:1">日期<input name="day" type="date" value="${esc(p.day || "")}"></label><label class="field" style="flex:1">时间（可不填）<input name="time" type="time" value="${esc(p.time || "")}"></label></div>
      <div class="row"><label class="field" style="flex:1">地点<input name="location" maxlength="60" value="${esc(x ? x.location : "")}"></label><label class="field" style="flex:1">需准备<input name="prepare" maxlength="100" value="${esc(x ? x.prepare : "")}"></label></div>
      ${scopes.length > 1 || cur ? `<label class="field">发给<select name="gid">${scopes.map(([k, t]) => `<option value="${k}"${String(cur) === k ? " selected" : ""}>${esc(t)}</option>`).join("")}</select><small class="muted">发给某个组的事项，只有组员（和老师、班委）能看到</small></label>` : ""}
      <label class="row" style="gap:6px;font-size:13px;color:var(--text2)"><input type="checkbox" name="confirm"${x && x.confirm ? " checked" : ""}> 信息还不确定（提醒同学去群里核实）</label>
    </div>
    <div class="dfoot">${!isNew && App.canDelItem(x) ? `<button type="button" class="btn danger" data-a="del">${icon("trash")}删除</button>` : ""}<span class="grow"></span><button type="button" class="btn" data-a="cancel">取消</button><button class="btn primary">${isNew ? "发布到班级" : "保存修改"}</button></div>
  </form>`);
  const f = d.elements;
  d.onsubmit = async (e) => {
    e.preventDefault();
    const date = f.day.value, time = f.time.value;
    const rec = { msg_type: f.type.value, subject: f.subject.value.trim(), summary: f.summary.value.trim(), event_time: date ? date + (time ? " " + time : "") : "",
      location: f.location.value.trim(), prepare: f.prepare.value.trim(), need_confirm: f.confirm.checked || !date };
    if (!rec.subject) return f.subject.focus();
    const btn = d.querySelector("button.primary"); btn.disabled = true;
    try {
      if (S.groupsOk) {
        rec.group_id = f.gid && f.gid.value ? +f.gid.value : null;
        if (isNew) { rec.publish_date = todayKey(); rec.original = "（由" + ((S.me && S.me.display_name) || "同学") + "在电脑版发布）"; }
        await api("class_item_save", { cid: S.cid, iid: isNew ? null : x.id, rec });
      } else {
        // 服务器还没更新到有「分组」的版本：老办法，只有老师和有权限的班委能发
        if (!isNew) throw new Error("服务器还没更新，修改请先用网页版");
        await api("publish_parsed_items", { cid: S.cid, items: [{ ...rec, original: "（电脑版发布）", publish_date: todayKey() }] });
      }
      closeOverlay(); toast(isNew ? "已发布到班级" : "已保存");
      await call("class:reload");
    } catch (err) { btn.disabled = false; }
  };
  d.onclick = (e) => {
    const a = e.target.closest("[data-a]"); if (!a) return;
    if (a.dataset.a === "cancel") closeOverlay();
    if (a.dataset.a === "del") { closeOverlay(); deleteClassItem(x); }
  };
  openOverlay(d); f.subject.focus();
}

async function deleteClassItem(x) {
  const g = App.group(x.gid);
  if (!(await confirmBox(`删除「${x.title}」？`, `${g ? "「" + g.name + "」组里的同学" : "全班"}都会看不到它，删除后不能恢复。`, "删除", true))) return;
  try {
    await api("class_item_delete", { iid: x.id });
    toast("已删除"); await call("class:reload");
  } catch (e) {}
}

const HIST_ACT = { create: "添加", update: "修改", delete: "删除" };
async function showItemHistory(x) {
  const d = infoBox("修改记录 · " + x.title, `<div class="muted">加载中…</div>`);
  try {
    const list = await api("class_item_history", { iid: x.id });
    $(".dbody", d).innerHTML = list.length ? `<div class="hist">${list.map((hh) => {
      const s = hh.snap || {}, g = App.group(s.group_id);
      const bits = [s.event_time && "🕒 " + s.event_time, s.location && "📍 " + s.location, s.prepare && "🎒 " + s.prepare, g && "👥 " + g.name].filter(Boolean);
      return `<div class="hrow"><div><b>${esc(hh.who)}</b> ${HIST_ACT[hh.action] || esc(hh.action)} <span class="muted">${esc(whenStr(hh.at))}</span></div>
        <div class="hsnap">${esc(s.subject || "")}${s.summary ? " · " + esc(s.summary) : ""}${bits.length ? `<div class="muted">${bits.map(esc).join("　")}</div>` : ""}</div></div>`;
    }).join("")}</div>` : `<div class="muted">还没有记录（这条是功能上线前添加的）。</div>`;
  } catch (e) { $(".dbody", d).innerHTML = `<div class="muted">加载失败：${esc(cleanErr(e))}</div>`; }
}

// ---------- 作业附件：把电脑上的文件（作业要求、参考资料、写了一半的报告）挂在事项上，一点就打开 ----------
function attachList(key) { return (App.S.attach || {})[key] || []; }
const fileName = (p) => String(p).split(/[\\/]/).pop();
const fileIcon = (p) => { const e = (fileName(p).split(".").pop() || "").toLowerCase(); return { pdf: "📕", doc: "📘", docx: "📘", xls: "📗", xlsx: "📗", ppt: "📙", pptx: "📙", zip: "🗜", rar: "🗜", "7z": "🗜", png: "🖼", jpg: "🖼", jpeg: "🖼", gif: "🖼", txt: "📄", md: "📄", py: "🐍", c: "💻", cpp: "💻", java: "☕", js: "💻", mp4: "🎬", mp3: "🎵" }[e] || "📎"; };
function attachHtml(key) {
  const list = attachList(key);
  return `<div class="att" data-att="${esc(key)}" data-drop="1">
    ${list.map((p) => `<div class="att-f" data-p="${esc(p)}" title="${esc(p)}"><span>${fileIcon(p)}</span><b>${esc(fileName(p))}</b><button class="btn ghost sm" data-att-a="show" title="在文件夹里显示">📂</button><button class="btn ghost sm" data-att-a="rm" title="移除（不会删除文件）">✕</button></div>`).join("")}
    <button class="att-add" data-att-a="add">${icon("clip")}${list.length ? "再加附件" : "加附件"}<small>或者把文件拖到这里</small></button></div>`;
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-att-a]"), box = e.target.closest("[data-att]");
  const f = e.target.closest(".att-f");
  if (!box) return;
  const key = box.dataset.att;
  if (b && b.dataset.attA === "add") { await call("attach:pick", key); return; }
  if (b && b.dataset.attA === "show") { call("attach:show", key, f.dataset.p); return; }
  if (b && b.dataset.attA === "rm") { await call("attach:remove", key, f.dataset.p); toast("已移除附件（文件还在原来的地方）"); return; }
  if (f) call("attach:open", key, f.dataset.p);
});
document.addEventListener("dragover", (e) => { const box = e.target.closest("[data-att]"); if (box && e.dataTransfer.types.includes("Files")) { e.preventDefault(); box.classList.add("over"); } });
document.addEventListener("dragleave", (e) => { const box = e.target.closest("[data-att]"); if (box && !box.contains(e.relatedTarget)) box.classList.remove("over"); });
document.addEventListener("drop", async (e) => {
  const box = e.target.closest("[data-att]"); if (!box) return;
  e.preventDefault(); box.classList.remove("over");
  const paths = [...e.dataTransfer.files].map((f) => window.cc.pathOf(f)).filter(Boolean);
  if (!paths.length) return toast("没拿到文件位置，换成点「加附件」选择", { bad: true });
  await call("attach:add", box.dataset.att, paths); toast(`已添加 ${paths.length} 个附件`);
});

// 事项右键菜单：在原来的基础上加上班级事项的修改、删除、修改记录和附件
const _itemMenu0 = itemMenu;
itemMenu = function (e, x) {
  e.preventDefault();
  const can = !x.mine && App.canEditIn(x.gid), del = App.canDelItem(x);
  menu(e.clientX, e.clientY, [
    { label: x.done ? "标记为没完成" : "标记完成", icon: "tasks", fn: () => toggleDone(x.key, !x.done) },
    x.mine ? { label: "编辑", icon: "edit", fn: () => editItem(x) } : can ? { label: "修改这条班级事项", icon: "edit", fn: () => editClassItem(x) } : null,
    !x.mine && App.S.groupsOk && x.updated ? { label: "修改记录", icon: "history", fn: () => showItemHistory(x) } : null,
    { label: "在事项里查看", icon: "eye", fn: () => App.go("tasks", { key: x.key }) },
    { label: "专注做这件事", icon: "focus", fn: () => App.go("focus", { task: x.title }) },
    { label: "加附件…", icon: "clip", fn: () => call("attach:pick", x.key) },
    "-",
    x.mine ? { label: "删除", icon: "trash", danger: true, fn: () => deleteMine(x.key) } : { label: x.hidden ? "取消隐藏" : "隐藏这条", icon: "eye", fn: () => hideItem(x.key, !x.hidden) },
    del ? { label: "从班级里删除", icon: "trash", danger: true, fn: () => deleteClassItem(x) } : null,
  ]);
};
void _itemMenu0;
