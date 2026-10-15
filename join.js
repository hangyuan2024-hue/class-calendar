/* 5.6.0 高校开发者招募页：报名表（数据库 dev_apply）、联系方式 / 仓库链接（site-config.js）、管理员看报名 */
(function () {
  "use strict";
  var C = window.LAOLAO_SITE || {}, CFG = window.APP_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var DIRS = ["思维导图本地化", "微信小程序", "课表 / 截图识别", "群消息整理规则", "界面与插画", "测试与校园推广", "网页前端", "后端与数据库"];

  // ---------- 仓库链接 / 联系方式 ----------
  var repo = String(C.repo || "").trim();
  if (/^https:\/\/[^"'<>\s]+$/.test(repo)) {
    var a = $("repoLink"); a.href = repo; a.target = "_blank"; a.rel = "noopener"; a.textContent = "查看开源仓库 ↗";
    $("repoState").innerHTML = '开源仓库已开放：<a href="' + esc(repo) + '" target="_blank" rel="noopener">' + esc(repo.replace(/^https:\/\//, "")) + "</a>。欢迎 Star、提 Issue、发 PR。";
  }
  var ct = C.contact || {}, rows = [];
  if (ct.email) rows.push('<a href="mailto:' + esc(ct.email) + '">✉️ ' + esc(ct.email) + "</a>");
  if (ct.qq) rows.push("<span>💬 QQ 群 " + esc(ct.qq) + "</span>");
  if (ct.wechat) rows.push("<span>🟢 微信 " + esc(ct.wechat) + "</span>");
  $("contactBox").innerHTML = rows.join("");

  // ---------- 方向多选 ----------
  var picked = {};
  try { var h = decodeURIComponent(location.hash.slice(1)); if (DIRS.indexOf(h) >= 0) picked[h] = 1; } catch (e) {}
  $("dirChips").innerHTML = DIRS.map(function (d) { return '<button type="button" class="jn-chip' + (picked[d] ? " on" : "") + '" aria-pressed="' + (picked[d] ? "true" : "false") + '" data-d="' + esc(d) + '">' + esc(d) + "</button>"; }).join("");
  $("dirChips").onclick = function (e) {
    var b = e.target.closest(".jn-chip"); if (!b) return;
    var d = b.getAttribute("data-d"); picked[d] = !picked[d];
    b.classList.toggle("on", !!picked[d]); b.setAttribute("aria-pressed", picked[d] ? "true" : "false");
  };
  // 点招募方向卡片 → 跳到报名表并选好这个方向
  Array.prototype.forEach.call(document.querySelectorAll(".jn-dirs article"), function (art) {
    art.tabIndex = 0; art.setAttribute("role", "button");
    var go = function () {
      var t = art.querySelector("h3").textContent.trim();
      var b = document.querySelector('.jn-chip[data-d="' + t + '"]');
      if (b && !picked[t]) b.click();
      $("apply").scrollIntoView({ behavior: "smooth" });
    };
    art.addEventListener("click", go);
    art.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  });

  // ---------- 报名 ----------
  function rpc(fn, body, token) {
    // 国内线路连不上就走海外中转（和网页版同一套逻辑，5.7.0）
    var bases = [CFG.SUPABASE_URL, CFG.SUPABASE_URL_ALT].filter(Boolean);
    try { var rt = JSON.parse(localStorage.getItem("cc_api_route_v1") || "null"); if (rt && rt.i > 0 && bases[rt.i]) bases.reverse(); } catch (e) {}
    var go = function (b) {
      return fetch(b + "/rest/v1/rpc/" + fn, {
        method: "POST",
        headers: { apikey: CFG.SUPABASE_ANON_KEY, Authorization: "Bearer " + (token || CFG.SUPABASE_ANON_KEY), "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
    };
    return go(bases[0]).catch(function (e) { if (bases.length < 2) throw e; return go(bases[1]); }).then(function (r) {
      return r.text().then(function (t) {
        var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
        if (!r.ok) { var m = (j && (j.message || j.error)) || ("HTTP " + r.status); var err = new Error(m); err.status = r.status; err.code = j && j.code; throw err; }
        return j;
      });
    });
  }
  var LS_DONE = "jn_applied_v1";
  var form = $("applyForm"), btn = $("applyBtn"), msg = $("applyMsg");
  function say(t, kind) { msg.textContent = t; msg.className = "jn-msg" + (kind ? " " + kind : ""); }
  try { if (localStorage.getItem(LS_DONE)) say("你已经报过名啦，我们会尽快联系你。想补充信息可以再提交一次。", "ok"); } catch (e) {}
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var f = form.elements, v = function (k) { return String(f[k].value || "").trim(); };
    var need = [["name", "请填写称呼"], ["school", "请填写学校"], ["contact", "请留一个联系方式"]];
    for (var i = 0; i < need.length; i++) if (!v(need[i][0])) { say(need[i][1], "err"); f[need[i][0]].focus(); return; }
    if (v("contact").length < 4) { say("联系方式好像太短了", "err"); f.contact.focus(); return; }
    var gh = v("github"); if (gh && !/^https?:\/\//i.test(gh)) gh = "https://" + gh;
    var body = { name: v("name"), school: v("school"), major: v("major"), contact: v("contact"), github: gh, intro: v("intro"), hp: v("hp"),
      dirs: DIRS.filter(function (d) { return picked[d]; }) };
    btn.disabled = true; say("正在提交…");
    rpc("dev_apply", { p: body }).then(function (r) {
      try { localStorage.setItem(LS_DONE, String(Date.now())); } catch (e) {}
      say(r && r.dup ? "这个联系方式今天已经报过名了，我们会尽快联系你 🙌" : "报名成功！我们会通过你留的联系方式联系你，欢迎加入捞捞 🎉", "ok");
      form.reset(); picked = {};
      Array.prototype.forEach.call(document.querySelectorAll(".jn-chip"), function (b) { b.classList.remove("on"); b.setAttribute("aria-pressed", "false"); });
    }).catch(function (err) {
      var m = err.message || "";
      if (err.status === 404 || /dev_apply|PGRST202|Could not find/i.test(m)) m = "报名通道还在准备中" + (ct.email ? "，可以先发邮件到 " + ct.email : "，请稍后再试");
      else if (/Failed to fetch|NetworkError|Load failed/i.test(m)) m = "网络连不上，请检查网络后再试";
      say(m, "err");
    }).then(function () { btn.disabled = false; });
  });

  // ---------- 管理员：看报名 ----------
  (function admin() {
    var s = null; try { s = JSON.parse(localStorage.getItem("cc_session_v1") || "null"); } catch (e) {}
    if (!s || !s.access_token || (s.expires_at && s.expires_at * 1000 < Date.now())) return;
    var ST = { "new": "新报名", contacted: "已联系", joined: "已加入", skip: "不合适" };
    function load() {
      rpc("dev_apply_list", {}, s.access_token).then(function (list) {
        if (!Array.isArray(list)) return;
        $("adminBox").hidden = false; $("adminCount").textContent = "· " + list.length + " 人";
        $("adminList").innerHTML = list.length ? list.map(function (r) {
          return '<div class="jn-app st-' + esc(r.status) + '"><div class="jn-app-h"><b>' + esc(r.name) + "</b><span>" + esc(r.school) + (r.major ? " · " + esc(r.major) : "") + "</span><time>" + esc(new Date(r.at).toLocaleString("zh-CN", { hour12: false })) + "</time></div>" +
            '<div class="jn-app-b"><span>📮 ' + esc(r.contact) + "</span>" + (r.github ? '<a href="' + esc(/^https?:\/\//.test(r.github) ? r.github : "#") + '" target="_blank" rel="noopener nofollow">🔗 ' + esc(r.github) + "</a>" : "") + "</div>" +
            ((r.dirs || []).length ? '<div class="jn-app-d">' + r.dirs.map(function (d) { return "<i>" + esc(d) + "</i>"; }).join("") + "</div>" : "") +
            (r.intro ? '<p class="jn-app-p">' + esc(r.intro) + "</p>" : "") +
            '<div class="jn-app-s">' + Object.keys(ST).map(function (k) { return '<button type="button" data-id="' + r.id + '" data-st="' + k + '"' + (k === r.status ? ' class="on"' : "") + ">" + ST[k] + "</button>"; }).join("") + "</div></div>";
        }).join("") : '<p class="jn-empty">还没有人报名。</p>';
      }).catch(function () { /* 不是管理员 / 登录过期：不显示 */ });
    }
    $("adminList").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-st]"); if (!b) return;
      rpc("dev_apply_mark", { aid: +b.getAttribute("data-id"), st: b.getAttribute("data-st") }, s.access_token).then(load).catch(function (err) { alert(err.message); });
    });
    load();
  })();
})();
