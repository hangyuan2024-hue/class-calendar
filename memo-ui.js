/* 5.8.0 导入手机备忘录（网页）：粘贴 / 选 txt 文件 / 从手机「分享」过来 → 拆成事项 → 勾选 → 加到「我的事项」
 * 依赖 app.js：mine save LS_MINE renderAll esc keyOf ccDate showBanner；拆分规则在 memo.js（CCMemo） */
(function () {
  "use strict";
  if (typeof CCMemo === "undefined") return;
  var dlg = null, rows = [];
  var $q = function (s) { return dlg.querySelector(s); };
  var HELP_IOS = "iPhone 备忘录：打开那条备忘录 → 右上角「···」→「拷贝」（或长按全选 → 拷贝），回来粘贴到下面。";
  var HELP_AND = "安卓备忘录 / 便签：打开那条 → 分享 →「复制文本」，或者导出成 txt 文件，点下面「选 txt 文件」。";
  function ensure() {
    if (dlg) return dlg;
    dlg = document.createElement("dialog");
    dlg.className = "dlg crs-x memo-dlg";
    dlg.innerHTML =
      '<form method="dialog" class="memo-f">' +
      '<div class="memo-h"><h3>📝 导入备忘录 / 作业</h3><button type="button" class="small" data-x aria-label="关闭">✕</button></div>' +
      '<p class="memo-tip">把备忘录里的待办、群里老师发的作业一次搬进来：<b>一行一条</b>，日期、时间、「下节课前」会自动认出来；单独一行的「周三：」「10月20日」算作下面几行的日期。没写截止时间的作业，按课程表自动填「下次上这门课之前」。</p>' +
      '<details class="memo-how"><summary>怎么从手机备忘录里拿出来？</summary><p>' + HELP_IOS + '</p><p>' + HELP_AND + '</p><p>微信里收藏的笔记也一样：打开 → 复制 → 粘贴。</p></details>' +
      '<textarea id="memoText" rows="7" placeholder="粘贴备忘录内容，例如：&#10;周三：&#10;交高数作业第三章&#10;下午3点 社团例会 A201&#10;10月20日 牙医 上午9:30&#10;- [ ] 买牛奶"></textarea>' +
      '<div class="memo-row"><button type="button" class="small" id="memoFileBtn">📄 选 txt 文件</button><input type="file" id="memoFile" accept=".txt,.md,.csv,text/plain" hidden>' +
      '<button type="button" class="small" id="memoPaste">📋 从剪贴板粘贴</button><span class="spacer"></span><button type="button" class="btn ink sm" id="memoGo">拆成事项</button></div>' +
      '<div id="memoSt" class="memo-st"></div>' +
      '<div id="memoList" class="memo-list"></div>' +
      '<div class="memo-row memo-foot hidden" id="memoFoot"><label class="memo-all"><input type="checkbox" id="memoAll" checked> 全选</label><span class="spacer"></span>' +
      '<label class="memo-skipdone"><input type="checkbox" id="memoSkipDone" checked> 已勾完的不导入</label>' +
      '<label class="memo-skipdone hidden" id="memoClassWrap" title="课代表、班委：把老师发的作业直接发布给全班"><input type="checkbox" id="memoClass"> 发布给全班</label>' +
      '<button type="button" class="btn ink" id="memoSave">加到我的事项</button></div>' +
      "</form>";
    document.body.appendChild(dlg);
    $q("[data-x]").onclick = function () { dlg.close(); };
    $q("#memoFileBtn").onclick = function () { $q("#memoFile").click(); };
    $q("#memoFile").onchange = function (e) {
      var f = e.target.files && e.target.files[0]; e.target.value = "";
      if (!f) return;
      if (f.size > 2 * 1024 * 1024) { say("文件太大了（最多 2MB）", true); return; }
      var r = new FileReader();
      r.onload = function () { $q("#memoText").value = String(r.result || ""); run(); };
      r.readAsText(f, "utf-8");
    };
    $q("#memoPaste").onclick = function () {
      if (!navigator.clipboard || !navigator.clipboard.readText) { say("这个浏览器不让网页读剪贴板，请长按输入框选「粘贴」", true); $q("#memoText").focus(); return; }
      navigator.clipboard.readText().then(function (t) { if (t) { $q("#memoText").value = t; run(); } else say("剪贴板是空的", true); })
        .catch(function () { say("没拿到剪贴板内容，请长按输入框选「粘贴」", true); $q("#memoText").focus(); });
    };
    $q("#memoGo").onclick = run;
    $q("#memoText").addEventListener("paste", function () { setTimeout(run, 30); });
    $q("#memoAll").onchange = function (e) { rows.forEach(function (r) { r.on = e.target.checked; }); paint(); };
    $q("#memoSkipDone").onchange = function () { paint(); };
    $q("#memoClass").onchange = function (e) { if (e.target.checked) rows.forEach(function (r) { if (!r.kind) { r.kind = "作业"; autoNext(r); } }); paint(); };
    $q("#memoList").addEventListener("change", function (e) {
      var row = e.target.closest("[data-i]"); if (!row) return;
      var r = rows[+row.dataset.i]; if (!r) return;
      var f = e.target.dataset.f;
      if (f === "on") r.on = e.target.checked;
      else if (f === "subject") r.subject = e.target.value.trim();
      else if (f === "date") r.date = e.target.value;
      else if (f === "time") r.time = e.target.value;
      else if (f === "kind") { r.kind = e.target.checked ? "作业" : undefined; if (r.kind) { autoNext(r); paint(); } }
      else if (f === "next") {
        var n = (r._nx || [])[+e.target.value];
        if (n) { r.date = n.day; r.time = n.time; r.kind = "作业"; r.auto = "下次" + n.name + "课前"; paint(); }
      }
      if (f === "date" || f === "time") r.auto = "";
    });
    $q("#memoSave").onclick = save_;
    return dlg;
  }
  // 作业没写截止时间：自动填「下次上这门课之前」（按课程表）
  function autoNext(r) {
    if (r.kind !== "作业" || r.date || typeof CCNext === "undefined") return;
    var c = window.ccNextCtx && window.ccNextCtx(); if (!c) return;
    var m = CCNext.match(r.subject, c.names); if (!m) return;
    var n = CCNext.nextOf(m, c); if (!n) return;
    r.date = n.day; r.time = n.time; r.auto = "下次" + m + "课前";
  }
  var staff = function () { try { return typeof canEditIn === "function" && canEditIn(null); } catch (e) { return false; } };
  function say(t, err) { var s = $q("#memoSt"); s.textContent = t || ""; s.className = "memo-st" + (err ? " err" : ""); }
  function run() {
    var text = $q("#memoText").value;
    if (!text.trim()) { say("先粘贴备忘录内容", true); return; }
    var lines = text.replace(/\r/g, "").split("\n");
    rows = CCMemo.parse(text, ccDate()).map(function (x) {
      var r = { on: true, subject: x.subject, note: x.note, done: x.done, kind: x.kind, date: x.event_time.slice(0, 10), time: x.event_time.slice(11, 16), auto: "" };
      // 原句里写了「下节课前 / 下次上课前」：按那门课的课表算
      var c = window.ccNextCtx && window.ccNextCtx();
      if (c && !r.date) {
        var src = x.src || lines.filter(function (l) { return l.indexOf(x.subject.slice(0, 6)) >= 0; })[0] || x.subject;
        var n = CCNext.resolve(src, c);
        if (n) { r.date = n.day; r.time = n.time; r.kind = "作业"; r.subject = CCNext.strip(r.subject) || r.subject; r.auto = "下次" + n.name + "课前"; }
      }
      autoNext(r);
      return r;
    });
    if (!rows.length) { say("没拆出事项，看看内容是不是空的", true); paint(); return; }
    var nd = rows.filter(function (r) { return r.date; }).length;
    say("拆出 " + rows.length + " 条，其中 " + nd + " 条认出了日期。不对的地方直接改。");
    paint();
  }
  function nextSel(r) {
    var c = window.ccNextCtx && window.ccNextCtx(); if (!c) return "";
    r._nx = CCNext.choices(r.subject, c, 5);
    if (!r._nx.length) return "";
    return '<select class="memo-nx" data-f="next" title="截止时间设成下次上某门课之前"><option value="">📚 下次上课前…</option>' +
      r._nx.map(function (n, i) { return '<option value="' + i + '">下次' + esc(n.name) + "课前 · " + esc(n.text) + "</option>"; }).join("") + "</select>";
  }
  function paint() {
    $q("#memoClassWrap").classList.toggle("hidden", !staff());
    var skipDone = $q("#memoSkipDone").checked;
    $q("#memoList").innerHTML = rows.map(function (r, i) {
      var off = !r.on || (skipDone && r.done);
      return '<div class="memo-r' + (off ? " off" : "") + '" data-i="' + i + '">' +
        '<input type="checkbox" data-f="on"' + (r.on ? " checked" : "") + ' aria-label="导入这条">' +
        '<input class="memo-s" data-f="subject" value="' + esc(r.subject) + '" maxlength="60">' +
        '<input type="date" data-f="date" value="' + esc(r.date) + '"><input type="time" data-f="time" value="' + esc(r.time) + '">' +
        '<label class="memo-k" title="勾上会显示在作业页"><input type="checkbox" data-f="kind"' + (r.kind === "作业" ? " checked" : "") + '>作业</label>' +
        nextSel(r) + (r.auto ? '<span class="memo-auto">' + esc(r.auto) + "</span>" : "") +
        (r.done ? '<span class="memo-done">已勾完</span>' : "") + "</div>";
    }).join("");
    $q("#memoFoot").classList.toggle("hidden", !rows.length);
    var n = rows.filter(function (r) { return r.on && !(skipDone && r.done); }).length;
    var toCls = staff() && $q("#memoClass").checked;
    $q("#memoSave").textContent = (toCls ? "发布给全班" : "加到我的事项") + (n ? "（" + n + " 条）" : "");
    $q("#memoSave").disabled = !n;
  }
  async function publish_() {
    var skipDone = $q("#memoSkipDone").checked, list = rows.filter(function (r) { return r.on && !(skipDone && r.done) && r.subject; });
    if (!list.length) return;
    if (!confirm("把这 " + list.length + " 条发布给全班？全班同学都会看到，也会收到提醒。")) return;
    var btn = $q("#memoSave"), n = 0; btn.disabled = true;
    try {
      for (var i = 0; i < list.length; i++) {
        var r = list[i], et = r.date ? r.date + (r.time ? " " + r.time : "") : "";
        var rec = { msg_type: r.kind === "作业" ? "作业" : "通知", subject: r.subject, summary: r.note || "", event_time: et, location: "", prepare: "", need_confirm: !r.date,
          publish_date: keyOf(ccDate()), original: "（由" + ((currentUser && currentUser.display_name) || "课代表") + "导入发布）" };
        if (typeof GROUPS_OK !== "undefined" && GROUPS_OK) { rec.group_id = null; await CCAuth.rpc("class_item_save", { cid: currentClass.id, iid: null, rec: rec }); }
        else { rec.class_id = currentClass.id; await CCAuth.rest("class_info", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(rec) }); }
        n++;
      }
      dlg.close();
      rows = []; $q("#memoText").value = ""; $q("#memoList").innerHTML = ""; $q("#memoFoot").classList.add("hidden"); say("");
      if (typeof showBanner === "function") { showBanner("已发布 " + n + " 条给全班 ✓"); setTimeout(function () { showBanner(""); }, 4000); }
    } catch (e) { say("发布了 " + n + " 条，后面的没成功：" + e.message, true); }
    finally { btn.disabled = false; try { await loadClass(); } catch (e) {} }
  }
  function save_() {
    if (staff() && $q("#memoClass").checked) { publish_(); return; }
    var skipDone = $q("#memoSkipDone").checked, stamp = Date.now(), n = 0;
    var have = {};
    mine.forEach(function (m) { have[(m.subject || "") + "|" + (m.event_time || "")] = 1; });
    rows.forEach(function (r, i) {
      if (!r.on || (skipDone && r.done) || !r.subject) return;
      var et = r.date ? r.date + (r.time ? " " + r.time : "") : "";
      if (have[r.subject + "|" + et]) return;   // 已经导入过的不重复
      mine.push({ id: "p" + stamp + "_m" + i, subject: r.subject, event_time: et, location: "", note: r.note || "", done: !!r.done, kind: r.kind || undefined, src: "memo" });
      n++;
    });
    save(LS_MINE, mine);
    try { renderAll(); } catch (e) {}
    dlg.close();
    rows = []; $q("#memoText").value = ""; $q("#memoList").innerHTML = ""; $q("#memoFoot").classList.add("hidden"); say("");
    if (typeof showBanner === "function") { showBanner(n ? "已导入 " + n + " 条到「我的事项」✓ 有日期的会显示在日历和首页" : "没有新的事项（可能都导入过了）"); setTimeout(function () { showBanner(""); }, 4000); }
  }
  window.openMemo = function (text) {
    ensure();
    if (text) { $q("#memoText").value = text; }
    if (!dlg.open) dlg.showModal();
    if (text) run(); else setTimeout(function () { $q("#memoText").focus(); }, 60);
  };
  var fb = document.getElementById("fMemo");
  if (fb) fb.onclick = function () { var m = document.getElementById("modal"); if (m) m.classList.remove("open"); window.openMemo(); };
  // 安卓「分享」到捞捞（装到桌面以后，manifest 里的 share_target）：index.html?share=1&text=…
  try {
    var q = new URLSearchParams(location.search);
    if (q.get("share") === "1") {
      var t = [q.get("title"), q.get("text"), q.get("url")].filter(Boolean).join("\n");
      history.replaceState(null, "", location.pathname);
      if (t) setTimeout(function () { window.openMemo(t); }, 800);
    }
  } catch (e) {}
})();
