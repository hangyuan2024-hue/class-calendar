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

  const EXE = "https://github.com/hangyuan2024-hue/class-calendar/releases/latest/download/LaolaoKechengbiao-Setup.exe";
  const web = new URL("index.html", root).href;
  let apk = new URL("download/class-calendar.apk", root).href, ver = null;

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
      if (k === "apk") { a.href = apk; a.setAttribute("download", ""); }
      else if (k === "exe") { a.href = EXE; a.removeAttribute("download"); }
      else if (k === "web") { a.href = web; a.removeAttribute("download"); }
      else { a.href = "#get"; a.removeAttribute("download"); }
      if (!a.classList.contains("done")) setLabel(a, ...TEXT[k]());
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
    try {
      const ctl = new AbortController(); setTimeout(() => ctl.abort(), 8000);
      const r = await fetch(new URL("download/app-version.json?t=" + Date.now(), root), { cache: "no-store", signal: ctl.signal });
      if (!r.ok) return null;
      const v = await r.json();
      ver = v;
      if (v.url) apk = new URL(v.url, root).href;
      apply();
      $$("[data-ver]").forEach((el) => (el.textContent = v.versionName));
      $$("[data-size]").forEach((el) => (el.textContent = mb(v.size)));
      $$("[data-date]").forEach((el) => (el.textContent = day(v.at)));
      return v;
    } catch (e) { return null; }
  })();
  window.CCGet = { plat, info };

  // 微信里：点下载先教怎么在浏览器打开
  const wx = document.getElementById("wx");
  if (wx) wx.addEventListener("click", () => wx.classList.remove("show"));
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-get]");
    if (!a) return;
    const k = a.dataset.kind;
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
