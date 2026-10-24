/* site-bridge.js —— 课内学习 · 接到捞捞网站上（捞捞学习板块）
 *   1. 顶部一条导航：回捞捞学习 / 思维导图 / 捞捞课程表
 *   2. 图片、扫描版 PDF 识别：本机版用浏览器里的 PaddleOCR 模型（71MB）；网站版改用捞捞的云端识别（要登录）
 *      PDF 读取用思维导图里已有的 pdf.js
 *   3. 从课程表导入课程（登录后读账号里的课表）
 *   4. 把原来课程表里「学习」页（kn_* 表）的内容搬过来（每个账号只搬一次）
 *   5. 有截止日期的考核同步给课程表：首页、日历、作业提醒里照旧能看到
 *   6. 从课程表点考核过来：#open=assessment:<课程>:<考核> 直接打开那门课的考核 */
(function () {
  "use strict";
  var A = function () { return window.CCAuth || null; };
  var $ = function (id) { return document.getElementById(id); };
  var api = function (p, opt) {
    return fetch(window.COURSES_API_BASE + p, Object.assign({ cache: "no-store" }, opt || {})).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.message || d.error || ("HTTP " + r.status)); return d; });
    });
  };
  var json = function (o) { return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) }; };
  function toastMsg(t) { try { if (typeof showToast === "function") return showToast(t); } catch (e) {} console.log(t); }
  async function loggedIn() { try { var s = A() && await A().session(); return s && s.user_id ? s.user_id : null; } catch (e) { return null; } }

  // ---------- 1. 顶部导航 ----------
  function bar() {
    if ($("learnBar")) return;
    var b = document.createElement("nav"); b.id = "learnBar"; b.className = "learn-bar";
    b.innerHTML = '<a class="lb-home" href="../">‹ 捞捞学习</a><span class="lb-sep"></span>' +
      '<a href="../mindmap/">🧠 思维导图</a><a href="../../index.html">📅 捞捞课程表</a>' +
      '<span class="lb-sp"></span><button type="button" id="learnImport" hidden>⇣ 从课表导入课程</button>';
    document.body.prepend(b);
    $("learnImport").onclick = importTimetable;
  }

  // ---------- 2. 识别 ----------
  window.ocrWebAvailable = function () { return true; };
  window.loadPdfJs = function () {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (window.__learnPdf) return window.__learnPdf;
    window.__learnPdf = import(new URL("../mindmap/vendor/pdfjs/build/pdf.mjs", location.href).href).then(function (lib) {
      lib.GlobalWorkerOptions.workerSrc = new URL("../mindmap/vendor/pdfjs/build/pdf.worker.poly.mjs", location.href).href;
      window.pdfjsLib = lib; return lib;
    }).catch(function (e) { window.__learnPdf = null; throw Object.assign(new Error("PDF 组件加载失败，请刷新重试"), { code: "OCR_WEB_PDF" }); });
    return window.__learnPdf;
  };
  async function imageData(input) {
    var url = URL.createObjectURL(input);
    try {
      var img = await new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = function () { rej(new Error("这张图片打不开")); }; i.src = url; });
      var k = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
      var c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      var g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", 0.86);
    } finally { URL.revokeObjectURL(url); }
  }
  window.predictWithRetry = async function (input, onProgress, signal) {
    if (!(await loggedIn())) throw Object.assign(new Error("网站版的图片识别用的是捞捞云端识别，请先登录捞捞账号（右下角「点此登录」）"), { code: "OCR_LOGIN" });
    if (signal && signal.aborted) throw Object.assign(new Error("已取消"), { name: "AbortError" });
    if (onProgress) onProgress("正在上传图片识别…");
    var started = await A().rpc("chat_ocr_start", { img: await imageData(input) });
    var t0 = Date.now();
    for (;;) {
      await new Promise(function (r) { setTimeout(r, 1300); });
      if (signal && signal.aborted) throw Object.assign(new Error("已取消"), { name: "AbortError" });
      var st = null; try { st = await A().rpc("course_ocr_status", { jid: started.job_id }); } catch (e) { st = null; }
      if (st && st.status === "done") {
        var text = st.result && typeof st.result.text === "string" ? st.result.text : "";
        return { items: text.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean).map(function (s) { return { text: s, score: 1 }; }) };
      }
      if (st && st.status === "failed") throw new Error(st.message || "识别失败，请换一张清楚一点的图片");
      if (onProgress && st) onProgress("云端识别中…" + (st.progress ? st.progress + "%" : ""));
      if (Date.now() - t0 > 150000) throw new Error("识别超时了，请稍后再试");
    }
  };

  // ---------- 3. 从课程表导入 ----------
  async function timetableNames() {
    if (!(await loggedIn())) return [];
    try { var r = await A().rpc("courses_get"); return Array.from(new Set(((r && r.courses) || []).map(function (c) { return String(c.name || "").trim(); }).filter(Boolean))); }
    catch (e) { return []; }
  }
  async function missingNames() {
    var names = await timetableNames(); if (!names.length) return [];
    var have = new Set((await api("/courses")).map(function (c) { return c.name; }));
    return names.filter(function (n) { return !have.has(n); });
  }
  async function refreshImportBtn() {
    var b = $("learnImport"); if (!b) return;
    try { var m = await missingNames(); b.hidden = !m.length; b.textContent = "⇣ 从课表导入 " + m.length + " 门课"; } catch (e) { b.hidden = true; }
  }
  async function importTimetable() {
    var b = $("learnImport"); b.disabled = true;
    try {
      var m = await missingNames();
      for (var i = 0; i < m.length; i++) await api("/courses", json({ name: m[i] }));
      toastMsg(m.length ? "已从课程表导入 " + m.length + " 门课" : "课程表里的课都已经在这里了");
      if (typeof loadCourses === "function") await loadCourses();
    } catch (e) { toastMsg("导入没成功：" + e.message); }
    finally { b.disabled = false; refreshImportBtn(); }
  }

  // ---------- 4. 搬原来的「学习」数据（kn_*） ----------
  async function migrateKn() {
    var uid = await loggedIn(); if (!uid || !window.LearnSync) return;
    var flag = "learn_kn_moved_v1:" + uid;
    try { if (localStorage.getItem(flag)) return; } catch (e) {}
    await window.LearnSync.ready;
    if (window.LearnSync.state().state !== "ok") return;          // 账号备份没开通 / 没连上：下次再说
    var done = null; try { done = await window.LearnSync.getMeta("kn-moved.json"); } catch (e) { return; }
    if (done) { try { localStorage.setItem(flag, "1"); } catch (e) {} return; }
    var s; try { s = await A().rpc("kn_state"); } catch (e) { s = null; }
    if (!s || !(s.courses || []).length) { await window.LearnSync.putMeta("kn-moved.json", { at: Date.now(), n: 0 }).catch(function () {}); try { localStorage.setItem(flag, "1"); } catch (e) {} return; }
    var tip = document.createElement("div"); tip.className = "learn-moving"; document.body.appendChild(tip);
    var say = function (t) { tip.textContent = t; };
    say("正在把课程表「学习」页里原来的内容搬过来…");
    var n = 0, failed = 0;
    try {
      var existing = await api("/courses"), byName = {};
      existing.forEach(function (c) { byName[c.name] = c.id; });
      var cmap = {}, nmap = {};
      for (var i = 0; i < s.courses.length; i++) {
        var c = s.courses[i];
        cmap[c.id] = byName[c.name] || (await api("/courses", json({ name: c.name }))).id;
        if (c.pinned && !byName[c.name]) await api("/courses/" + cmap[c.id] + "/pin", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pinned: true }) }).catch(function () {});
      }
      // 知识框架：父节点先建
      var nodes = (s.nodes || []).filter(function (x) { return !x.is_system && cmap[x.course_id]; });
      for (var guard = 0; guard < 50 && nodes.some(function (x) { return !nmap[x.id]; }); guard++) {
        for (var j = 0; j < nodes.length; j++) {
          var x = nodes[j]; if (nmap[x.id] || (x.parent_id && !nmap[x.parent_id] && nodes.some(function (y) { return y.id === x.parent_id; }))) continue;
          try { nmap[x.id] = (await api("/courses/" + cmap[x.course_id] + "/knowledge-nodes", json({ name: x.name, type: x.type, parentId: x.parent_id ? nmap[x.parent_id] || null : null }))).id; }
          catch (e) { nmap[x.id] = -1; }
        }
      }
      var tags = {}; (s.links || []).forEach(function (l) { if (nmap[l[1]] > 0) (tags[l[0]] = tags[l[0]] || []).push(nmap[l[1]]); });
      var items = (s.items || []).slice().reverse();               // 按创建时间从早到晚
      for (var k = 0; k < items.length; k++) {
        var it = items[k], cid = cmap[it.course_id]; if (!cid) continue;
        say("正在搬原来「学习」里的内容… " + (k + 1) + "/" + items.length);
        try {
          var f = new FormData(), file = null;
          if (it.file_id) {
            try { var got = await A().rpc("kn_file_get", { p_id: it.file_id }); var bin = atob(got.data), u = new Uint8Array(bin.length); for (var q = 0; q < bin.length; q++) u[q] = bin.charCodeAt(q); file = new File([u], it.file_name || got.name || "附件", { type: it.file_type || got.mime || "application/octet-stream" }); }
            catch (e) { file = null; }
          }
          if (file) f.append("file", file, file.name);
          var ids = JSON.stringify(tags[it.id] || []);
          if (it.kind === "material" || it.kind === "note") {
            f.append("title", it.title); f.append("content", it.content || ""); f.append("nodeIds", ids);
            await api("/courses/" + cid + "/" + (it.kind === "material" ? "materials" : "notes"), { method: "POST", body: f });
          } else if (it.kind === "assessment") {
            f.append("title", it.title); f.append("deadline", it.deadline ? String(it.deadline).slice(0, 10) : ""); f.append("requirement", it.requirement || it.content || "");
            await api("/courses/" + cid + "/assessments", { method: "POST", body: f });
          } else if (it.kind === "mistake") {
            f.append("title", it.title); f.append("content", it.content || ""); f.append("mistakeType", "unclassified"); f.append("knowledgeIds", ids);
            await api("/courses/" + cid + "/mistakes", { method: "POST", body: f });
          }
          n++;
        } catch (e) { failed++; console.warn("[learn] 搬运失败", it.title, e); }
      }
      await window.LearnSync.putMeta("kn-moved.json", { at: Date.now(), n: n, failed: failed });
      try { localStorage.setItem(flag, "1"); } catch (e) {}
      say("已把原来「学习」里的 " + s.courses.length + " 门课、" + n + " 条内容搬过来了" + (failed ? "（" + failed + " 条没搬成功，原来的数据仍保留在账号里）" : ""));
      if (typeof loadCourses === "function") loadCourses();
      window.LearnSync.now();
    } catch (e) { say("搬运没完成：" + e.message + "。下次打开会再试。"); }
    setTimeout(function () { tip.remove(); }, 9000);
  }

  // ---------- 5. 考核截止日期给课程表 ----------
  var dueTimer = 0, lastDue = "";
  try { lastDue = localStorage.getItem("learn_due_sig_v1") || ""; } catch (e) {}
  async function pushDue() {
    var uid = await loggedIn(); if (!uid || !window.LearnSync || window.LearnSync.state().state !== "ok") return;
    var courses = await api("/courses"), out = [];
    for (var i = 0; i < courses.length; i++) {
      var list = []; try { list = await api("/courses/" + courses[i].id + "/assessments"); } catch (e) { continue; }
      (Array.isArray(list) ? list : list.items || []).forEach(function (a) {
        if (!a.deadline || a.archived || a.completed_at) return;
        out.push({ id: a.id, course_id: courses[i].id, course: courses[i].name, title: a.title, deadline: String(a.deadline).slice(0, 10), requirement: String(a.requirement || "").slice(0, 300) });
      });
    }
    var sig = uid + JSON.stringify(out);
    if (sig === lastDue) return;
    await window.LearnSync.putMeta("due.json", { at: Date.now(), items: out });
    lastDue = sig; try { localStorage.setItem("learn_due_sig_v1", sig); } catch (e) {}
  }
  function scheduleDue(ms) { clearTimeout(dueTimer); dueTimer = setTimeout(function () { pushDue().catch(function (e) { console.warn("[learn] 考核同步失败", e); }); }, ms); }

  // ---------- 6. 从课程表点过来 ----------
  async function openFromHash() {
    var m = /open=assessment:(\d+):(\d+)/.exec(location.hash); if (!m) return;
    history.replaceState(null, "", location.pathname + location.search);
    for (var i = 0; i < 40 && typeof openCourse !== "function"; i++) await new Promise(function (r) { setTimeout(r, 100); });
    try {
      var c = (await api("/courses")).find(function (x) { return String(x.id) === m[1]; });
      if (!c) { toastMsg("这门课在这台设备上还没有（可能还在从账号同步），稍等一会儿再试"); return; }
      openCourse(c.id, c.name, "assessments");
    } catch (e) {}
  }

  function boot() {
    if (window.LEARN_BOOTING) return;
    bar();
    if (window.LearnSync) {
      window.LearnSync.on(function (info) {
        if (info.changedLocal && typeof loadCourses === "function") { try { if (typeof backToList === "function" && document.getElementById("detailPage") && getComputedStyle(document.getElementById("detailPage")).display !== "none") backToList(); loadCourses(); } catch (e) {} toastMsg("已从账号同步最新的内容"); }
        if (info.state === "ok") scheduleDue(info.changedLocal ? 500 : 3000);
        if (info.state === "ok" || info.guest) refreshImportBtn();
      });
      window.LearnSync.ready.then(function () { migrateKn().catch(function (e) { console.warn(e); }); });
    }
    if (navigator.serviceWorker) navigator.serviceWorker.addEventListener("message", function (e) { if (e.data && e.data.learnSync === "dirty") scheduleDue(6000); });
    refreshImportBtn();
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
