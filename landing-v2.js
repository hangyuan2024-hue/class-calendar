/* Small, local-only product demonstrations. No account data or network calls. */
(() => {
  "use strict";
  const tabs = [...document.querySelectorAll("#demo-tabs [data-demo]")];
  const panels = [...document.querySelectorAll(".s-demo-panel")];
  let running = false, deadline = 0, remaining = 25 * 60, tick = null;
  const clock = document.getElementById("demo-pomo-clock");
  const toggle = document.getElementById("demo-pomo-toggle");
  const format = (n) => String(Math.floor(n / 60)).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0");
  function paintClock() {
    clock.textContent = format(remaining);
    clock.setAttribute("aria-label", "专注示例剩余 " + Math.floor(remaining / 60) + " 分 " + remaining % 60 + " 秒");
    toggle.textContent = running ? "暂停专注" : remaining === 1500 ? "开始专注" : "继续专注";
    toggle.setAttribute("aria-pressed", String(running));
  }
  function pause() {
    if (running) remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    running = false;
    clearInterval(tick);
    tick = null;
    paintClock();
  }
  function activate(tab, focus = false) {
    if (tab.dataset.demo !== "focus") pause();
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
    });
    panels.forEach((p) => { p.hidden = p.id !== "demo-" + tab.dataset.demo; });
    if (focus) tab.focus({ preventScroll: true });
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => activate(tab));
    tab.addEventListener("keydown", (e) => {
      let next;
      if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
      if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
      if (e.key === "Home") next = 0;
      if (e.key === "End") next = tabs.length - 1;
      if (next === undefined) return;
      e.preventDefault();
      activate(tabs[next], true);
    });
  });
  const taskButtons = [...document.querySelectorAll("[data-demo-task]")];
  taskButtons.forEach((button) => button.addEventListener("click", () => {
    button.setAttribute("aria-pressed", String(button.getAttribute("aria-pressed") !== "true"));
    const done = taskButtons.filter((b) => b.getAttribute("aria-pressed") === "true").length;
    document.getElementById("demo-task-progress").textContent = done + " / " + taskButtons.length + " 已完成";
  }));
  toggle.addEventListener("click", () => {
    if (running) { pause(); return; }
    if (!remaining) remaining = 1500;
    deadline = Date.now() + remaining * 1000;
    running = true;
    paintClock();
    tick = setInterval(() => {
      remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      if (!remaining) {
        pause();
        toggle.textContent = "再专注一会儿";
      } else paintClock();
    }, 250);
  });
  document.getElementById("demo-pomo-reset").addEventListener("click", () => { pause(); remaining = 1500; paintClock(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && running) pause();
  });
  window.addEventListener("pagehide", pause);
  document.querySelectorAll("[data-login-focus]").forEach((link) => link.addEventListener("click", () => {
    requestAnimationFrame(() => {
      const account = document.getElementById("account");
      const target = account && account.offsetParent !== null ? account : document.getElementById("continueBtn");
      if (target) target.focus({ preventScroll: true });
    });
  }));
  if (location.hash === "#login" || new URLSearchParams(location.search).has("mode")) {
    document.getElementById("login").scrollIntoView({ behavior: "auto" });
    document.getElementById("account").focus({ preventScroll: true });
  }
  const wx = document.getElementById("wx");
  const close = wx.querySelector(".s-wx-close");
  let previousFocus = null;
  new MutationObserver(() => {
    const open = wx.classList.contains("show");
    if (open) { previousFocus = document.activeElement; close.focus(); }
    else if (previousFocus) { previousFocus.focus({ preventScroll: true }); previousFocus = null; }
  }).observe(wx, { attributes: true, attributeFilter: ["class"] });
  close.addEventListener("click", () => wx.classList.remove("show"));
  wx.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); wx.classList.remove("show"); }
    if (e.key === "Tab") { e.preventDefault(); close.focus(); }
  });
  paintClock();
})();
