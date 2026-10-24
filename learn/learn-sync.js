/* learn-sync.js —— 捞捞学习 · 账号备份与多设备同步（思维导图、课内学习共用）
 * 两个工具的数据在本浏览器里（/learn/sw.js 的虚拟磁盘）。登录捞捞账号后，这里把文件和账号里的备份（learn_files 表）对比：
 *   只在本机改了 → 上传；只在别的设备改了 → 下载；本机删了 → 账号里也删；两边都改了 → 以后改的为准（另一份留在 /app/backup）。
 * 每台设备记一份「上次同步时的样子」（localStorage），用来判断是哪边改的。
 * 页面里用：LearnSync.ready（第一次同步完成）、LearnSync.now()（马上同步）、LearnSync.on(fn)（同步完的回调）。 */
(function () {
  "use strict";
  if (window.LearnSync) return;
  var API = new URL("api/__sync/", location.href).href;            // 当前工具目录下的 api/__sync/（同一个 Service Worker）
  var SMALL = 5 * 1024 * 1024, PART = 4 * 1024 * 1024, BIG = 50 * 1024 * 1024;   // ≤5MB 一次传；更大的分 4MB 一块传；超过 50MB 只留在本机
  var auth = function () { return window.MM_CCAUTH || window.CCAuth || null; };
  var listeners = [], running = null, again = false, timer = 0, lastOk = 0, lastErr = "", state = "idle", skipped = 0, firstDone;
  var ready = new Promise(function (r) { firstDone = r; });

  function key(uid) { return "learn_sync_base_v1:" + uid; }
  function loadBase(uid) { try { return JSON.parse(localStorage.getItem(key(uid)) || "{}") || {}; } catch (e) { return {}; } }
  function saveBase(uid, b) { try { localStorage.setItem(key(uid), JSON.stringify(b)); } catch (e) {} }
  function b64(buf) { var u = new Uint8Array(buf), s = ""; for (var i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
  function unb64(s) { var t = atob(s), u = new Uint8Array(t.length); for (var i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; }
  async function uid() {
    var A = auth(); if (!A || !A.session) return null;
    try { var s = await Promise.race([A.session(), new Promise(function (r) { setTimeout(function () { r(null); }, 8000); })]); return s && s.user_id ? s.user_id : null; } catch (e) { return null; }
  }
  async function swFetch(path, opt) {
    if (!navigator.serviceWorker || !navigator.serviceWorker.controller) throw new Error("本地存储还没准备好");
    var r = await fetch(API + path, Object.assign({ cache: "no-store" }, opt || {}));
    if (!r.ok) { var t = ""; try { t = (await r.json()).error; } catch (e) {} throw new Error(t || "本地存储读写失败（" + r.status + "）"); }
    return r;
  }
  var isMeta = function (p) { return p.indexOf("/meta/") === 0; };     // 账号里的附加信息（比如给课程表首页看的考核截止日期），不对应本机文件

  async function runOnce() {
    var id = await uid();
    if (!id) { state = "guest"; emit({ guest: true }); return; }
    state = "busy"; emit({});
    var A = auth();
    var remote = (await A.rpc("learn_fs_list")) || [];
    var local = await (await swFetch("manifest")).json();
    // 这个浏览器之前登录的是别的账号：不能把那个人的内容传进现在的账号。那些内容已经在那个账号里备份过了，本机这份清掉，换成现在账号的
    var owner = ""; try { owner = localStorage.getItem("learn_owner_v1") || ""; } catch (e) {}
    if (owner && owner !== id) {
      for (var z = 0; z < local.length; z++) await swFetch("file?p=" + encodeURIComponent(local[z].p), { method: "DELETE" }).catch(function () {});
      local = [];
    }
    try { localStorage.setItem("learn_owner_v1", id); } catch (e) {}
    var base = loadBase(id), R = {}, L = {}, all = {};
    remote.forEach(function (x) { if (!isMeta(x.p)) { R[x.p] = x; all[x.p] = 1; } });
    local.forEach(function (x) { L[x.p] = x; all[x.p] = 1; });
    var ups = [], downs = [], delR = [], delL = [], backups = [];
    Object.keys(all).forEach(function (p) {
      var l = L[p] && L[p].sha, r = R[p] && R[p].sha, b = base[p];
      if (l === r) { if (l) base[p] = l; else delete base[p]; return; }
      if (!l) { if (b && r === b) delR.push(p); else downs.push(p); return; }
      if (!r) { if (b && l === b) delL.push(p); else ups.push(p); return; }
      if (r === b) { ups.push(p); return; }
      if (l === b) { downs.push(p); return; }
      // 两边都改了：没同步过的新设备以账号为准；同步过的以后改的为准。被盖掉的一份留个备份
      if (!b || R[p].t >= L[p].t) { downs.push(p); backups.push(p); } else ups.push(p);
    });
    saveBase(id, base);
    var changedLocal = false; skipped = 0;
    // 先备份将被覆盖的本机文件
    for (var i = 0; i < backups.length; i++) {
      var p0 = backups[i]; if (!/^\/app\/data\//.test(p0) && !/^\/app\/storage\//.test(p0)) continue;
      try {
        var old = await (await swFetch("file?p=" + encodeURIComponent(p0))).arrayBuffer();
        var bp = p0.replace(/^\/app\//, "/app/backup/" + new Date().toISOString().slice(0, 10) + "/");
        await swFetch("file?p=" + encodeURIComponent(bp), { method: "PUT", body: old }).catch(function () {});
      } catch (e) {}
    }
    // 下载（按大小分批）
    for (var j = 0; j < downs.length;) {
      var batch = [], size = 0;
      while (j < downs.length && (batch.length === 0 || (batch.length < 20 && size + (R[downs[j]].size || 0) < 8 * 1024 * 1024))) { size += R[downs[j]].size || 0; batch.push(downs[j++]); }
      var got = (await A.rpc("learn_fs_get", { p_paths: batch })) || [];
      for (var k = 0; k < got.length; k++) {
        var bytes;
        if (got[k].parts > 0) {   // 大文件：一块块取回来再拼
          var chunks = [], total = 0;
          for (var q = 0; q < got[k].parts; q++) { var part = await A.rpc("learn_fs_get_part", { p_path: got[k].p, p_idx: q }); var u8 = unb64(part && part.data || ""); chunks.push(u8); total += u8.length; }
          bytes = new Uint8Array(total); var off = 0; chunks.forEach(function (c) { bytes.set(c, off); off += c.length; });
        } else bytes = unb64(got[k].data || "");
        await swFetch("file?p=" + encodeURIComponent(got[k].p), { method: "PUT", body: bytes });
        base[got[k].p] = got[k].sha; changedLocal = true;
      }
      saveBase(id, base);
    }
    for (var m = 0; m < delL.length; m++) { await swFetch("file?p=" + encodeURIComponent(delL[m]), { method: "DELETE" }); delete base[delL[m]]; changedLocal = true; }
    saveBase(id, base);
    if (delR.length) { for (var n = 0; n < delR.length; n += 200) await A.rpc("learn_fs_del", { p_paths: delR.slice(n, n + 200) }); delR.forEach(function (p) { delete base[p]; }); saveBase(id, base); }
    // 上传
    for (var u = 0; u < ups.length; u++) {
      var p1 = ups[u];
      if (L[p1].size > BIG) { skipped++; continue; }
      var buf = await (await swFetch("file?p=" + encodeURIComponent(p1))).arrayBuffer();
      var sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buf)), function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join("");
      if (buf.byteLength <= SMALL) await A.rpc("learn_fs_put", { p_path: p1, p_sha: sha, p_data: b64(buf) });
      else {
        try {
          var n = Math.ceil(buf.byteLength / PART);
          for (var q2 = 0; q2 < n; q2++) await A.rpc("learn_fs_put_part", { p_path: p1, p_sha: sha, p_idx: q2, p_data: b64(buf.slice(q2 * PART, (q2 + 1) * PART)) });
          await A.rpc("learn_fs_commit", { p_path: p1, p_sha: sha, p_size: buf.byteLength, p_parts: n });
        } catch (e) {
          if (/learn_fs_put_part|PGRST202|does not exist/.test(e && e.message || "")) { skipped++; continue; }   // 服务器还没升级：大文件先留在本机
          throw e;
        }
      }
      base[p1] = sha; saveBase(id, base);
    }
    lastOk = Date.now(); lastErr = ""; state = "ok";
    emit({ changedLocal: changedLocal, uploaded: ups.length - skipped, downloaded: downs.length, skipped: skipped });
  }
  function emit(info) {
    info.state = state; info.lastOk = lastOk; info.error = lastErr;
    render(info);
    listeners.forEach(function (f) { try { f(info); } catch (e) { console.error(e); } });
  }
  function now() {
    if (running) { again = true; return running; }
    running = runOnce().catch(function (e) {
      lastErr = /learn_fs|PGRST202|does not exist|404/.test(e && e.message || "") ? "服务器还没开通账号备份（管理员需要在扣子里执行 learn_files.sql）" : (e && e.message || "同步失败");
      state = "error"; emit({});
    }).then(function () { firstDone(); running = null; if (again) { again = false; schedule(1500); } });
    return running;
  }
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(now, ms); }

  // ---------- 右下角的小状态 ----------
  var chip = null;
  function ago(t) { var s = (Date.now() - t) / 1000; return s < 60 ? "刚刚" : s < 3600 ? Math.floor(s / 60) + " 分钟前" : new Date(t).toLocaleTimeString().slice(0, 5); }
  function render(info) {
    if (!document.body || window.LEARN_SYNC_NO_CHIP || window.top !== window) return;
    if (!chip) {
      chip = document.createElement("button"); chip.type = "button"; chip.className = "learn-sync-chip";
      chip.style.cssText = "position:fixed;" + (window.LEARN_SYNC_CHIP_POS === "right" ? "right" : "left") + ":12px;bottom:12px;z-index:9000;max-width:min(360px,calc(100vw - 150px));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:6px 12px;border-radius:999px;border:1px solid rgba(0,0,0,.08);background:rgba(255,255,255,.92);box-shadow:0 4px 14px rgba(20,30,60,.12);font:12px/1.4 system-ui,'PingFang SC','Microsoft YaHei',sans-serif;color:#556;cursor:pointer;backdrop-filter:blur(6px)";
      chip.onclick = function () {
        if (state === "guest") { location.href = "/login.html?next=" + encodeURIComponent(location.pathname.replace(/^\//, "")); return; }
        now();
      };
      document.body.appendChild(chip);
    }
    var t = state === "guest" ? "未登录：只存在本机 · 点此登录自动备份"
      : state === "busy" ? "☁ 正在同步到账号…"
      : state === "error" ? "⚠ 没同步上：" + lastErr + " · 点此重试"
      : state === "ok" ? "☁ 已备份到账号 · " + ago(lastOk) + (skipped ? "（" + skipped + " 个大文件只留在本机）" : "")
      : "☁ 账号备份";
    chip.textContent = t; chip.title = t;
    chip.style.color = state === "error" ? "#b3261e" : "#556";
  }
  setInterval(function () { if (state === "ok" && chip) render({}); }, 30000);

  // ---------- 什么时候同步 ----------
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener("message", function (e) { if (e.data && e.data.learnSync === "dirty") schedule(4000); });
  document.addEventListener("visibilitychange", function () { if (document.hidden) { if (timer) now(); } else if (Date.now() - lastOk > 60000) schedule(500); });
  setInterval(function () { if (!document.hidden) now(); }, 3 * 60 * 1000);
  window.addEventListener("storage", function (e) { if (e.key === "cc_session_v1") schedule(800); });   // 别的页面登录 / 退出
  function start() {
    if (window.LEARN_BOOTING || window.MM_BOOTING) return;   // 页面马上要刷新
    render({});
    if (navigator.serviceWorker && navigator.serviceWorker.controller) schedule(1200);
    else if (navigator.serviceWorker) navigator.serviceWorker.ready.then(function () { schedule(1500); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();

  window.LearnSync = {
    ready: ready, now: now,
    on: function (f) { listeners.push(f); },
    state: function () { return { state: state, lastOk: lastOk, error: lastErr }; },
    uid: uid, auth: auth,
    // 给别的数据用的小接口：直接读写账号里的 /meta/ 文件（不对应本机文件）
    putMeta: async function (name, obj) {
      var A = auth(); var data = new TextEncoder().encode(JSON.stringify(obj));
      var sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)), function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join("");
      return A.rpc("learn_fs_put", { p_path: "/meta/" + name, p_sha: sha, p_data: b64(data) });
    },
    getMeta: async function (name) {
      var A = auth(); var got = (await A.rpc("learn_fs_get", { p_paths: ["/meta/" + name] })) || [];
      return got[0] ? JSON.parse(new TextDecoder().decode(unb64(got[0].data))) : null;
    },
  };
})();
