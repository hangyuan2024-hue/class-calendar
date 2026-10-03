// 下载按钮：读最新版本信息，按设备（安卓 / 苹果 / 电脑 / 微信里）给出合适的下载方式
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
  const cls = document.body.classList;
  for (const k of Object.keys(plat)) if (plat[k]) cls.add("is-" + k);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const mb = (n) => (n / 1048576).toFixed(1) + " MB";
  const day = (s) => { const d = new Date(s); return isNaN(d) ? "" : `${d.getMonth() + 1}月${d.getDate()}日`; };

  let apk = new URL("download/class-calendar.apk", root).href;
  const setHref = () => $$("[data-get]").forEach((a) => {
    if (plat.ios) { a.href = new URL("index.html", root).href; a.removeAttribute("download"); }
    else if (plat.app) { a.href = new URL("index.html", root).href; a.removeAttribute("download"); }
    else a.href = apk;
  });
  const label = (t, sub) => $$("[data-lbl]").forEach((el) => { el.innerHTML = ""; el.append(t); if (sub) { const s = document.createElement("small"); s.textContent = sub; el.append(s); } });

  try { localStorage.setItem("intro_seen_v1", "1"); } catch (e) {} // 看过介绍页，下次打开网站直接进网页版
  if (plat.ios || plat.app) $$("[data-web]").forEach((a) => { a.href = "#more"; a.textContent = "先看看"; }); // 主按钮已经是网页版了
  if (plat.ios) label("苹果手机用网页版");
  else if (plat.app) label("你已经装好了，回到 App");
  setHref();
  if (plat.desktop) $$("[data-qr]").forEach((el) => (el.hidden = false));

  const info = { ready: null };
  info.ready = (async () => {
    try {
      const ctl = new AbortController(); setTimeout(() => ctl.abort(), 8000);
      const r = await fetch(new URL("download/app-version.json?t=" + Date.now(), root), { cache: "no-store", signal: ctl.signal });
      if (!r.ok) return null;
      const v = await r.json();
      if (v.url) apk = new URL(v.url, root).href;
      setHref();
      if (!plat.ios && !plat.app) label("下载安卓 App", `${v.versionName} 版，${mb(v.size)}`);
      $$("[data-meta]").forEach((el) => (el.textContent = `免费，安卓 7.0 及以上都能装。${day(v.at) ? day(v.at) + "更新" : ""}`));
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
    if (!a || plat.ios || plat.app) return;
    if (plat.wx && wx) { e.preventDefault(); wx.classList.add("show"); return; }
    a.classList.add("done");
    label("开始下载了");
    $$("[data-after]").forEach((el) => { el.textContent = plat.desktop ? "下载好后，可以拖进 MuMu 模拟器安装，或者用手机扫下面的码。" : "下载好后，点通知栏里的 class-calendar.apk 安装。"; });
    clearTimeout(a._t);
    a._t = setTimeout(() => { a.classList.remove("done"); info.ready.then((v) => label("下载安卓 App", v ? `${v.versionName} 版，${mb(v.size)}` : "")); }, 4000);
  });
  if (plat.wx && wx && document.body.dataset.autowx) setTimeout(() => wx.classList.add("show"), 600);
})();
