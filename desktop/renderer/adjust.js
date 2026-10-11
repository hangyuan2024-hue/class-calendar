// 调课 / 调休：学校临时通知换课、补课、放假、停课、加课。和网页版 courses.js、服务器（邮件提醒、手机日历订阅）是同一套规则：
//   swap：那天按另一天的课上（调休补课：周六上周三的课）；off：放假 / 停课；cancel：某门课不上；add：加一节课
"use strict";
Object.assign(CourseEd, {
  adjTab: "swap",
  adjList() { return M.adjOf(App.S.courses); },
  upcoming() { const t = todayKey(); return this.adjList().filter((a) => a.date >= t).length; },
  async adjSave(list, msg) {
    try { await call("adj:save", list); toast(msg || "已保存"); await new Promise((r) => setTimeout(r, 160)); return true; } catch (e) { return false; }   // 等新数据推过来再重画
  },
  adjust(preset) {
    preset = preset || {};
    if (!(App.S.courses.courses || []).length) return toast("先导入或填写课程表，再记调课", { bad: true });
    if (preset.tab) this.adjTab = preset.tab;
    const nextSat = () => { const d = App.now(); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7)); return M.dayKey(d); };
    const d = h(`<div class="dialog wide adj-dlg" role="dialog"><h3>调课 / 调休<small class="muted" style="font-weight:400;margin-left:10px">记一下学校的临时通知，课程表、今日、月历、提醒都会跟着变，网页和手机上也一样</small></h3><div class="dbody"></div>
      <div class="dfoot"><span class="muted grow adj-st" style="font-size:12.5px"></span><button class="btn" data-a="close">关闭</button><button class="btn primary" data-a="add">添加</button></div></div>`);
    const body = $(".dbody", d), st = $(".adj-st", d);
    const meta = App.S.courses.meta || {}, times = M.periodTimes(meta);
    const nper = Math.max(times.filter(Boolean).length, 10, ...(App.S.courses.courses || []).map((c) => +c.end || 0));
    const pers = Array.from({ length: nper }, (_, i) => `<option value="${i + 1}">第 ${i + 1} 节${times[i] ? "（" + times[i].split("-")[0] + "）" : ""}</option>`).join("");
    const names = [...new Set((App.S.courses.courses || []).map((c) => c.name))];
    const draw = () => {
      const t = todayKey(), list = this.adjList(), coming = list.filter((a) => a.date >= t), past = list.filter((a) => a.date < t);
      const row = (a) => `<div class="adj-row${a.date < t ? " past" : ""}"><b>${esc(M.mdw(a.date))}</b><span>${esc(M.adjText(a))}</span><button class="btn ghost sm danger" data-del="${esc(a.id)}">删除</button></div>`;
      const tab = this.adjTab;
      body.innerHTML = `<div class="seg adj-tabs">${[["swap", "🔁 换课（调休）"], ["off", "🏖 放假 / 停课"], ["add", "➕ 加一节课"]].map(([k, n]) => `<button data-tab="${k}" class="${tab === k ? "on" : ""}">${n}</button>`).join("")}</div>
        <div class="adj-form">${tab === "swap" ? `<div class="row"><label class="field" style="flex:1">哪天上课<input type="date" name="B" value="${preset.date || nextSat()}"></label><label class="field" style="flex:1">上哪天的课<input type="date" name="A"></label></div>
            <label class="row" style="gap:6px;font-size:13px"><input type="checkbox" name="Aoff" checked>那天（课被挪走的那天）放假，不上课</label>`
          : tab === "off" ? `<div class="row"><label class="field" style="flex:1">日期<input type="date" name="D" value="${preset.date || t}"></label><label class="field" style="flex:1">到（放好几天时填）<input type="date" name="D2"></label></div>
            <label class="field">停哪些课<select name="which"><option value="">整天都不上</option></select></label>
            <label class="field">说明（可以不填）<input name="note" maxlength="30" placeholder="如 国庆放假、运动会停课"></label>`
          : `<div class="row"><label class="field" style="flex:1">日期<input type="date" name="D" value="${preset.date || t}"></label><label class="field" style="flex:1.4">课程<input name="name" list="adjNames" maxlength="60" placeholder="课程名"><datalist id="adjNames">${names.map((n) => `<option value="${esc(n)}">`).join("")}</datalist></label></div>
            <div class="row"><label class="field" style="flex:1">第几节开始<select name="S">${pers}</select></label><label class="field" style="flex:1">到第几节<select name="E">${pers}</select></label><label class="field" style="flex:1.3">地点<input name="loc" maxlength="60" placeholder="可以不填"></label><label class="field" style="flex:1">老师<input name="tch" maxlength="40" placeholder="可以不填"></label></div>`}
          <div class="adj-prev muted"></div></div>
        <div class="adj-list"><div class="sec"><b>已经记下的</b><small>${coming.length ? coming.length + " 条" : ""}</small></div>
          ${coming.length ? coming.map(row).join("") : `<div class="muted" style="font-size:12.5px">还没有。比如「国庆调休：10月11日（周日）上 10月8日（周四）的课」</div>`}
          ${past.length ? `<details><summary class="muted" style="font-size:12.5px;margin-top:8px">已经过去的 ${past.length} 条</summary>${past.map(row).join("")}<button class="btn ghost sm" data-clean>清掉已经过去的</button></details>` : ""}</div>`;
      preview();
    };
    const q = (n) => body.querySelector(`[name="${n}"]`);
    const names0 = (k) => { const l = M.baseOn(App.S.courses, M.fromKey(k)); return l.length ? l.map((c) => c.name).join("、") : "没有课"; };
    const preview = () => {
      const pv = $(".adj-prev", body); if (!pv) return;
      if (this.adjTab === "swap") { const A = q("A").value, B = q("B").value; pv.textContent = A && B ? `${M.mdw(B)} 上 ${M.mdw(A)} 的课：${names0(A)}${q("Aoff").checked ? `；${M.mdw(A)} 放假` : ""}` : "选好两个日期，这里会显示要上哪些课"; }
      else if (this.adjTab === "off") {
        const D = q("D").value, sel = q("which"), cur = sel.value, l = D ? M.coursesOn(App.S.courses, M.fromKey(D)) : [];
        sel.innerHTML = `<option value="">整天都不上</option>` + l.filter((c) => !c._add).map((c) => `<option value="${esc(c.name)}|${c.start}">只停「${esc(c.name)}」第${c.start}${c.end > c.start ? "-" + c.end : ""}节</option>`).join("");
        if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
        pv.textContent = D ? `${M.mdw(D)} 原来的课：${l.length ? l.map((c) => c.name).join("、") : "没有课"}` : "";
      } else {
        const n = q("name").value.trim(), c = (App.S.courses.courses || []).find((x) => x.name === n);
        if (c && !q("loc").value && !q("tch").value) { q("loc").value = c.location || ""; q("tch").value = c.teacher || ""; }
        if (+q("E").value < +q("S").value) q("E").value = q("S").value;
        pv.textContent = "";
      }
    };
    const rid = () => Math.random().toString(36).slice(2, 10);
    d.addEventListener("input", preview); d.addEventListener("change", preview);
    d.onclick = async (e) => {
      const tb = e.target.closest("[data-tab]"); if (tb) { this.adjTab = tb.dataset.tab; draw(); return; }
      const del = e.target.closest("[data-del]"); if (del) { await this.adjSave(this.adjList().filter((a) => a.id !== del.dataset.del), "已删除"); draw(); return; }
      if (e.target.closest("[data-clean]")) { const t = todayKey(); await this.adjSave(this.adjList().filter((a) => a.date >= t), "已清掉过去的"); draw(); return; }
      const a = e.target.closest("[data-a]"); if (!a) return;
      if (a.dataset.a === "close") return closeOverlay();
      const list = this.adjList(); st.textContent = "";
      if (this.adjTab === "swap") {
        const A = q("A").value, B = q("B").value;
        if (!A || !B) { st.textContent = "两个日期都要选"; return; }
        if (A === B) { st.textContent = "两个日期不能一样"; return; }
        const rest = list.filter((x) => !(x.date === B && (x.type === "swap" || x.type === "off")));
        rest.push({ id: rid(), date: B, type: "swap", from: A });
        if (q("Aoff").checked && !rest.some((x) => x.date === A && x.type === "off")) rest.push({ id: rid(), date: A, type: "off", note: `课挪到 ${M.mdw(B)}` });
        if (await this.adjSave(rest, `已记下：${M.mdw(B)} 上 ${M.mdw(A)} 的课`)) draw();
      } else if (this.adjTab === "off") {
        const D = q("D").value, D2 = q("D2").value || D, which = q("which").value, note = q("note").value.trim();
        if (!D) { st.textContent = "选一个日期"; return; }
        if (D2 < D) { st.textContent = "结束日期比开始早"; return; }
        let msg;
        if (which) { const [name, start] = which.split("|"); list.push({ id: rid(), date: D, type: "cancel", name, start: +start, note }); msg = `已记下：${M.mdw(D)}「${name}」不上`; }
        else { let k = D, n = 0; while (k <= D2 && n < 60) { if (!list.some((x) => x.date === k && x.type === "off")) list.push({ id: rid(), date: k, type: "off", note }); k = shiftDay(k, 1); n++; } msg = n > 1 ? `已记下：放假 ${n} 天` : `已记下：${M.mdw(D)} 放假`; }
        if (await this.adjSave(list, msg)) draw();
      } else {
        const D = q("D").value, name = q("name").value.trim();
        if (!D || !name) { st.textContent = "日期和课程名都要填"; return; }
        list.push({ id: rid(), date: D, type: "add", name, start: +q("S").value, end: Math.max(+q("S").value, +q("E").value), location: q("loc").value.trim(), teacher: q("tch").value.trim() });
        if (await this.adjSave(list, `已记下：${M.mdw(D)} 加课「${name}」`)) draw();
      }
    };
    openOverlay(d);
    draw();
  },
});
