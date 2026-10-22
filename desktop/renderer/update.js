// 3.4 电脑版更新提示：有新版本时窗口底部右侧出一张小卡片「立即更新」，点了在软件里下载，下完「重启并更新」
// 设置页底部的「检查更新」也用这里
const Upd = {
  st: null, hidden: "",
  init() {
    window.cc.on("update", (s) => { this.st = s; this.paint(); if (App.view === "settings") this.paintSettings(); });
    call("update:state").then((s) => { if (s) { this.st = s; this.paint(); } }).catch(() => {});
    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-upd]"); if (!b) return;
      const a = b.dataset.upd;
      if (a === "check") { b.disabled = true; b.textContent = "检查中…"; call("update:check").then((s) => { this.st = s; if (s && s.state === "latest") toast("已经是最新版本 " + s.current); this.paint(); this.paintSettings(); }).catch(() => {}).finally(() => { b.disabled = false; }); }
      else if (a === "go") call("update:download").then((s) => { this.st = s; this.paint(); });
      else if (a === "cancel") call("update:cancel");
      else if (a === "install") call("update:install");
      else if (a === "page") call("update:page");
      else if (a === "later") { this.hidden = this.st && this.st.latest ? this.st.latest.version : "x"; this.paint(); }
    });
  },
  ver() { return (this.st && this.st.latest && this.st.latest.version) || ""; },
  line() {
    const s = this.st; if (!s) return "";
    if (s.state === "downloading") return `正在下载新版本 ${esc(this.ver())}… ${Math.round((s.progress || 0) * 100)}%${s.speed ? " · " + (s.speed >= 1024 ? (s.speed / 1024).toFixed(1) + " MB/s" : s.speed + " KB/s") : ""}${s.via ? " · " + esc(s.via) : ""}`;
    if (s.state === "ready") return `新版本 ${esc(this.ver())} 下载好了，重启一下就装好`;
    if (s.state === "available") return s.error ? esc(s.error) : `有新版本 ${esc(this.ver())}（你现在是 ${esc(s.current)}）`;
    if (s.state === "latest") return `已经是最新版本`;
    if (s.state === "error") return esc(s.error || "检查更新失败");
    return "";
  },
  btns(big) {
    const s = this.st; if (!s) return "";
    if (s.state === "downloading") return `<button class="btn sm" data-upd="cancel">取消</button>`;
    if (s.state === "ready") return `<button class="btn sm primary" data-upd="install">重启并更新</button>`;
    if (s.state === "available") return `<button class="btn sm primary" data-upd="go">${s.error ? "再试一次" : "立即更新"}</button>${s.error ? `<button class="btn sm" data-upd="page">去官网下载</button>` : ""}${big ? "" : `<button class="btn sm ghost" data-upd="later">以后</button>`}`;
    return "";
  },
  paint() {
    let el = document.getElementById("updCard");
    const s = this.st, show = s && ["available", "downloading", "ready"].includes(s.state) && (this.hidden !== this.ver() || s.state !== "available");
    if (!show) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement("div"); el.id = "updCard"; el.className = "upd-card"; document.body.appendChild(el); }
    const notes = s.state === "available" && s.latest && s.latest.notes ? `<p class="upd-notes">${esc(String(s.latest.notes).slice(0, 160))}</p>` : "";
    el.innerHTML = `<div class="upd-h">⬆️ <b>${this.line()}</b></div>${notes}${s.state === "downloading" ? `<div class="upd-bar"><i style="width:${Math.round((s.progress || 0) * 100)}%"></i></div>` : ""}<div class="upd-b">${this.btns(false)}</div>`;
  },
  // 设置页底部版本号那一行
  paintSettings() {
    const el = document.getElementById("stUpd"); if (!el) return;
    el.innerHTML = `<span>${this.line() || ""}</span> ${this.btns(true) || `<button class="btn sm" data-upd="check">检查更新</button>`}`;
  },
};
Upd.init();
