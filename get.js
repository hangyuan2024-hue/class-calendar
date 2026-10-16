// 下载按钮：按设备（安卓 / 苹果 / Windows 电脑 / 微信里）给出合适的下载方式
// data-get="apk"  安卓安装包（不写值也是安卓，下载页用的旧写法）
// data-get="exe"  Windows 电脑版安装包
// data-get="auto" 看设备：安卓手机给 App，Windows 电脑给电脑版，苹果手机给网页版
(() => {
  const root = new URL(document.body.dataset.root || "./", location.href);
  const ua = navigator.userAgent;
  const plat = {
    app: /ClassCalendarApp\//.test(ua),
    wx: /MicroMessenger|\sQQ\/|WeiBo|DingTalk/i.test(ua),
    ios: /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1),
    android: /Android/i.test(ua),
  };
  plat.desktop = !plat.ios && !plat.android && !/Mobile/i.test(ua);
  plat.windows = plat.desktop && /Windows/i.test(ua);
  const cls = document.body.classList;
  for (const k of Object.keys(plat)) if (plat[k]) cls.add("is-" + k);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const mb = (n) => (n / 1048576).toFixed(1) + " MB";
  const day = (s) => { const d = new Date(s); return isNaN(d) ? "" : `${d.getMonth() + 1}月${d.getDate()}日`; };

  const EXE_GH = "https://github.com/hangyuan2024-hue/class-calendar/releases/latest/download/LaolaoKechengbiao-Setup.exe";
  // 5.8.3：海外线路（Cloudflare 中转）也能下电脑版安装包，海外直连 GitHub 经常下到一半断掉。
  // 在海外（时区不是国内，或者这台设备已经在用海外线路）而且海外线路能下载时，按钮直接用海外线路；另一条放在按钮下面「换一条线路」
  const ALT = ((window.APP_CONFIG && window.APP_CONFIG.SUPABASE_URL_ALT) || "https://laolao-relay.hangyuan2024.workers.dev").replace(/\/+$/, "");
  const EXE_ALT = ALT + "/dl/windows";
  const overseas = (() => {
    try { if (window.CCAuth && CCAuth.route && CCAuth.route() === 1) return true; } catch (e) {}
    try { const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; return !!tz && !/^Asia\/(Shanghai|Chongqing|Chungking|Harbin|Urumqi|Kashgar|Hong_Kong|Macau|Taipei)$/.test(tz) && !/^PRC$/.test(tz); } catch (e) { return false; }
  })();
  let altOk = false, EXE = EXE_GH;
  const web = new URL("index.html", root).href;
  const originalApk = new URL("download/class-calendar.apk", root).href;
  let apk = originalApk, backupApk = originalApk, ver = null;
  const alternatives = new WeakMap();

  function useDownload(a, url) {
    a.href = url;
    // 跨域 Releases 由服务端 Content-Disposition 下载；不依赖浏览器忽略的 download 属性。
    if (new URL(url).origin === root.origin) a.setAttribute("download", "");
    else a.removeAttribute("download");
  }

  function showAlternative(a, kind) {
    let hint = alternatives.get(a);
    const visible = (kind === "apk" && apk !== backupApk) || (kind === "exe" && altOk);
    if (!hint && visible) {
      hint = document.createElement("p"); hint.className = "after";
      hint.append(kind === "exe" ? "下载慢或下到一半断了？" : "下载慢或打不开？");
      const link = document.createElement("a");
      link.dataset.downloadFallback = "1"; link.dataset.kind = kind;
      link.textContent = "换用备用线路";
      link.style.textDecoration = "underline"; link.style.textUnderlineOffset = "3px";
      hint.append(link); a.insertAdjacentElement("afterend", hint);
      alternatives.set(a, hint);
    }
    if (hint) {
      hint.hidden = !visible;
      const l = hint.querySelector("a");
      if (kind === "exe") { l.href = EXE === EXE_ALT ? EXE_GH : EXE_ALT; l.textContent = EXE === EXE_ALT ? "换用 GitHub 下载" : "换用海外线路下载"; l.dataset.kind = "exe"; l.removeAttribute("download"); }
      else useDownload(l, backupApk);
    }
  }

  // 这个按钮实际下载什么：apk / exe / web（苹果手机、已经在 App 里）/ pick（苹果电脑、Linux：让用户自己选）
  const kindOf = (a) => {
    const k = a.dataset.get || "apk";
    if (k === "exe") return "exe";
    if (k === "apk") return plat.ios || plat.app ? "web" : "apk";
    if (plat.app || plat.ios) return "web";
    if (plat.windows) return "exe";
    if (plat.desktop) return "pick";
    return "apk";
  };
  const TEXT = {
    apk: () => ["下载安卓 App", ver ? `${ver.versionName} 版，${mb(ver.size)}` : ""],
    exe: () => ["下载 Windows 电脑版", "约 100 MB，Win10 / Win11"],
    web: () => [plat.app ? "你已经装好了，回到 App" : "苹果手机用网页版", ""],
    pick: () => ["选择你的设备下载", ""],
  };
  const META = {
    apk: () => `免费，安卓 7.0 及以上都能装。${ver && day(ver.at) ? day(ver.at) + "更新" : ""}`,
    exe: () => "免费，Windows 10 / 11（64 位）都能装，账号和手机通用",
    web: () => "账号和数据在手机、电脑上自动同步",
    pick: () => "有安卓 App 和 Windows 电脑版，苹果电脑可以直接用网页版",
  };
  function setLabel(a, t, sub) {
    const el = a.querySelector("[data-lbl]"); if (!el) return;
    el.innerHTML = ""; el.append(t);
    if (sub) { const s = document.createElement("small"); s.textContent = sub; el.append(s); }
  }
  function apply() {
    $$("[data-get]").forEach((a) => {
      const k = kindOf(a);
      a.dataset.kind = k;
      if (k === "apk") useDownload(a, apk);
      else if (k === "exe") { a.href = EXE; a.removeAttribute("download"); }
      else if (k === "web") { a.href = web; a.removeAttribute("download"); }
      else { a.href = "#get"; a.removeAttribute("download"); }
      if (!a.classList.contains("done")) setLabel(a, ...TEXT[k]());
      showAlternative(a, k);
    });
    $$("[data-meta]").forEach((el) => {
      const a = el.dataset.meta ? document.getElementById(el.dataset.meta) : null;
      el.textContent = META[a ? a.dataset.kind : "apk"]();
    });
  }

  try { localStorage.setItem("intro_seen_v1", "1"); } catch (e) {} // 看过介绍页，下次打开网站直接进网页版
  if (plat.ios || plat.app) $$("[data-web]").forEach((a) => { a.href = "#more"; a.textContent = "先看看"; }); // 主按钮已经是网页版了
  apply();
  if (plat.desktop) $$("[data-qr]").forEach((el) => (el.hidden = false));

  const info = { ready: null };
  info.ready = (async () => {
    const ctl = new AbortController();
    const timeout = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch(new URL("download/app-version.json?t=" + Date.now(), root), { cache: "no-store", signal: ctl.signal });
      if (!r.ok) return null;
      const v = await r.json();
      ver = v;
      if (v.url) apk = new URL(v.url, root).href;
      backupApk = v.fallbackUrl ? new URL(v.fallbackUrl, root).href : originalApk;
      apply();
      $$("[data-ver]").forEach((el) => (el.textContent = v.versionName));
      $$("[data-size]").forEach((el) => (el.textContent = mb(v.size)));
      $$("[data-date]").forEach((el) => (el.textContent = day(v.at)));
      return v;
    } catch (e) { return null; }
    finally { clearTimeout(timeout); }
  })();
  window.CCGet = { plat, info };
  // 海外线路能不能下载安装包（中转还没更新时这里会失败，就一直用 GitHub）
  if (plat.desktop || plat.windows) (async () => {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 6000);
    try {
      const r = await fetch(EXE_ALT, { method: "HEAD", signal: ctl.signal, cache: "no-store" });
      altOk = r.ok && /octet|exe|download|application/i.test(r.headers.get("content-type") || "application/octet-stream");
    } catch (e) { altOk = false; } finally { clearTimeout(t); }
    if (altOk && overseas) EXE = EXE_ALT;
    if (altOk) apply();
  })();

  // 微信里：点下载先教怎么在浏览器打开
  const wx = document.getElementById("wx");
  if (wx) wx.addEventListener("click", () => wx.classList.remove("show"));
  // 海外线路：在网页里分段下载（每段 4MB，哪段断了就重下哪段，最后拼成一个文件保存）。
  // 海外网络下大文件经常下到一半断掉，浏览器自己续传又会因为 GitHub 的临时地址过期而失败。
  let dlBusy = false;
  async function chunkedExe(a) {
    if (dlBusy) return; dlBusy = true;
    const say = (t, sub) => { if (a.querySelector("[data-lbl]")) setLabel(a, t, sub); else a.textContent = t; };
    const after = (t) => (a.closest("[data-dl]") || document).querySelectorAll("[data-after]").forEach((el) => (el.textContent = t));
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      let size = 0;
      for (let i = 0; i < 3 && !size; i++) { try { const h = await fetch(EXE_ALT, { method: "HEAD", cache: "no-store" }); size = +h.headers.get("content-length") || 0; } catch (e) { await wait(1500); } }
      if (!size) throw new Error("size");
      const CH = 4 * 1048576, parts = [];
      let got = 0;
      for (let off = 0; off < size; off += CH) {
        const end = Math.min(size, off + CH) - 1;
        let buf = null;
        for (let t = 0; t < 8 && !buf; t++) {
          try {
            const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 90000);
            const r = await fetch(EXE_ALT, { headers: { range: `bytes=${off}-${end}` }, cache: "no-store", signal: ctl.signal });
            const b = await r.arrayBuffer(); clearTimeout(timer);
            if (r.status === 206 && b.byteLength === end - off + 1) buf = b;
            else if (r.status === 200 && off === 0 && b.byteLength === size) { parts.push(b); got = size; off = size; break; }
            else throw new Error("bad part");
          } catch (e) { say(`网络断了，正在接着下… ${Math.round((got / size) * 100)}%`); await wait(Math.min(15000, 1000 * 2 ** t)); }
        }
        if (got >= size) break;
        if (!buf) throw new Error("part");
        parts.push(buf); got += buf.byteLength;
        say(`正在下载 ${Math.round((got / size) * 100)}%`, `${(got / 1048576).toFixed(0)} / ${(size / 1048576).toFixed(0)} MB · 断了会自动接着下，别关这个页面`);
      }
      const url = URL.createObjectURL(new Blob(parts, { type: "application/octet-stream" }));
      const x = document.createElement("a"); x.href = url; x.download = "LaolaoKechengbiao-Setup.exe"; document.body.appendChild(x); x.click();
      setTimeout(() => { x.remove(); URL.revokeObjectURL(url); }, 60000);
      say("下载好了 ✓", "在浏览器的下载列表里找到它，双击安装");
      after("下载好后双击安装。如果提示「Windows 已保护你的电脑」，点「更多信息 → 仍要运行」。");
    } catch (e) {
      say("海外线路没下完，改从 GitHub 下载");
      location.href = EXE_GH;
    } finally {
      dlBusy = false;
      setTimeout(() => { a.classList.remove("done"); if (a.querySelector("[data-lbl]")) setLabel(a, ...TEXT[a.dataset.kind || "exe"]()); }, 8000);
    }
  }
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-get], [data-download-fallback]");
    if (!a) return;
    const k = a.dataset.kind;
    if (k === "exe" && a.href === EXE_ALT && !plat.wx && window.fetch && window.Blob) { e.preventDefault(); a.classList.add("done"); chunkedExe(a); return; }
    if (k === "web") return;
    if (k === "pick") { e.preventDefault(); const g = document.getElementById("get"); if (g) g.scrollIntoView({ behavior: "smooth" }); return; }
    if (plat.wx && wx) { e.preventDefault(); wx.classList.add("show"); return; }
    a.classList.add("done");
    setLabel(a, "开始下载了");
    const box = a.closest("[data-dl]") || document;
    box.querySelectorAll("[data-after]").forEach((el) => {
      el.textContent = k === "exe" ? "下载好后双击安装。如果提示「Windows 已保护你的电脑」，点「更多信息 → 仍要运行」。"
        : plat.desktop ? "这是手机安装包，用手机扫下面的码下载更方便。" : "下载好后，点通知栏里的 class-calendar.apk 安装。";
    });
    clearTimeout(a._t);
    a._t = setTimeout(() => { a.classList.remove("done"); setLabel(a, ...TEXT[k]()); }, 4000);
  });
  if (plat.wx && wx && document.body.dataset.autowx) setTimeout(() => wx.classList.add("show"), 600);
})();
