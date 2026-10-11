// 局域网互传（和网页版 live.js 同一套协议，网页、手机、电脑之间都能互传）
// 「只存在这台设备」的事项不上传云端；同一账号的设备在同一个网络（同一个 Wi-Fi）里时，用 WebRTC 直接点对点传，
// 数据不经过服务器，服务器只帮两台设备交换一下连接信息。不用外网中转（不给 STUN / TURN），连不上就是不在同一个网络。
// 主进程每次 sync_ping 后把在线设备 peers 和发给我的连接信息 sig 推过来（"lan" 事件）
(function () {
  "use strict";
  const LIST_KINDS = ["personal_events_v1", "habits_v1", "quad_todos_v1", "countdown_v1"];
  const LS_META = "lan_meta_v1";
  const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const lsPut = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + s.length.toString(36); };

  const peers = {};          // dev → { pc, ch, st: connecting | open | failed, at, buf, kind }
  let meta = null, waitOffer = false, dev = "", lastPeers = [], lastPing = 0, applying = 0, got = 0, gotAt = 0;
  const M = () => meta || (meta = Object.assign({ t: {}, h: {} }, lsGet(LS_META, {})));
  const saveMeta = () => lsPut(LS_META, meta);
  const S = () => App.S || {};
  const on = () => S().loggedIn && S().settings && S().settings.lanSync !== false && S().settings.liveSync !== false && typeof RTCPeerConnection === "function";
  const now = () => Date.now() + (S().clockOff || 0);   // 用服务器校准过的时间（和网页版一样）

  function recsOf(k) {
    const o = {}, v = k === "personal_events_v1" && Array.isArray(S().mine) ? S().mine : (S().kv || {})[k];
    for (const x of Array.isArray(v) ? v : []) if (x && x.id != null && x.local) o[String(x.id)] = x;
    return o;
  }
  function hasLocal() { for (const k of LIST_KINDS) if (Object.keys(recsOf(k)).length) return true; return false; }
  function scan(k) {
    const m = M(), recs = recsOf(k), h = (m.h[k] = m.h[k] || {}), t = (m.t[k] = m.t[k] || {}), ch = [], n = now();
    for (const r in recs) { const hv = hash(JSON.stringify(recs[r])); if (h[r] !== hv) { h[r] = hv; t[r] = Math.max(n, (t[r] || 0) + 1); ch.push({ k, r, v: recs[r], t: t[r] }); } }
    for (const r in h) if (!(r in recs) && h[r] !== "-") { h[r] = "-"; t[r] = Math.max(n, (t[r] || 0) + 1); ch.push({ k, r, v: null, t: t[r] }); }
    return ch;
  }
  function scanAll() { let ch = []; for (const k of LIST_KINDS) ch = ch.concat(scan(k)); saveMeta(); return ch; }
  function snapshot() {
    scanAll();
    const m = M(), out = [];
    for (const k of LIST_KINDS) { const recs = recsOf(k); for (const r in m.t[k] || {}) out.push({ k, r, v: m.h[k][r] === "-" || recs[r] === undefined ? null : recs[r], t: m.t[k][r] }); }
    return out;
  }
  // 收到另一台设备的：每一条以后改的为准
  async function apply(list) {
    const m = M(), go = [];
    for (const x of list || []) {
      if (!x || !LIST_KINDS.includes(x.k) || x.r == null || typeof x.t !== "number") continue;
      const t = (m.t[x.k] = m.t[x.k] || {}), h = (m.h[x.k] = m.h[x.k] || {}), r = String(x.r);
      if ((t[r] || 0) >= x.t) continue;
      const v = x.v == null ? null : Object.assign({}, x.v, { local: true });
      t[r] = x.t; h[r] = v == null ? "-" : hash(JSON.stringify(v));
      go.push({ k: x.k, r, v });
    }
    saveMeta();
    if (!go.length) return 0;
    applying = Date.now();
    try { const n = await window.cc.call("lan:apply", go); if (n) { got += n; gotAt = Date.now(); } return n; } catch (e) { return 0; }
  }

  function send(p, msg) {
    if (!p.ch || p.ch.readyState !== "open") return;
    const s = JSON.stringify(msg);
    if (s.length < 60000) { p.ch.send(s); return; }
    const id = Math.random().toString(36).slice(2), n = Math.ceil(s.length / 60000);
    for (let i = 0; i < n; i++) p.ch.send(JSON.stringify({ chunk: id, i, n, d: s.slice(i * 60000, (i + 1) * 60000) }));
  }
  function onMsg(p, data) {
    let m; try { m = JSON.parse(data); } catch (e) { return; }
    if (m.chunk) {
      const b = (p.buf = p.buf || {}), c = (b[m.chunk] = b[m.chunk] || []); c[m.i] = m.d;
      if (c.filter((x) => x != null).length < m.n) return;
      delete b[m.chunk]; try { m = JSON.parse(c.join("")); } catch (e) { return; }
    }
    if (m.type === "hello" || m.type === "delta") apply(m.list);
    if (m.type === "hello" && !p.helloSent) { p.helloSent = true; send(p, { type: "hello", list: snapshot() }); }
    ui();
  }
  function wire(p, ch) {
    p.ch = ch;
    ch.onopen = () => { p.st = "open"; p.since = Date.now(); p.helloSent = true; send(p, { type: "hello", list: snapshot() }); busy(); ui(); };
    ch.onmessage = (e) => onMsg(p, e.data);
    ch.onclose = () => { p.st = "failed"; p.at = Date.now(); ui(); };
  }
  function newPc(dv) {
    const pc = new RTCPeerConnection({ iceServers: [] });
    const p = { pc, ch: null, st: "connecting", at: Date.now(), kind: (lastPeers.find((x) => x.dev === dv) || {}).kind || "" };
    peers[dv] = p;
    pc.onconnectionstatechange = () => { if (["failed", "closed", "disconnected"].includes(pc.connectionState)) { p.st = "failed"; p.at = Date.now(); ui(); } };
    pc.ondatachannel = (e) => wire(p, e.channel);
    setTimeout(() => { if (p.st === "connecting") { p.st = "failed"; p.at = Date.now(); try { pc.close(); } catch (e) {} busy(); ui(); } }, 20000);
    return p;
  }
  const gathered = (pc) => new Promise((res) => {
    if (pc.iceGatheringState === "complete") return res();
    pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") res(); });
    setTimeout(res, 3000);
  });
  const signal = (to, body) => window.cc.call("lan:send", to, body).catch(() => {});
  async function connect(dv) {
    const p = newPc(dv);
    wire(p, p.pc.createDataChannel("cc-lan", { ordered: true }));
    await p.pc.setLocalDescription(await p.pc.createOffer());
    await gathered(p.pc);
    signal(dv, { type: "offer", sdp: p.pc.localDescription.sdp });
  }
  async function onSignal(from, body) {
    if (!body || !body.type) return;
    if (body.type === "offer") {
      if (peers[from] && peers[from].st === "open") return;
      if (peers[from]) { try { peers[from].pc.close(); } catch (e) {} }
      const p = newPc(from);
      await p.pc.setRemoteDescription({ type: "offer", sdp: body.sdp });
      await p.pc.setLocalDescription(await p.pc.createAnswer());
      await gathered(p.pc);
      signal(from, { type: "answer", sdp: p.pc.localDescription.sdp });
    } else if (body.type === "answer") {
      const p = peers[from]; if (!p || p.pc.signalingState !== "have-local-offer") return;
      try { await p.pc.setRemoteDescription({ type: "answer", sdp: body.sdp }); } catch (e) {}
    }
  }
  function closeAll() { for (const dv in peers) { try { peers[dv].pc.close(); } catch (e) {} delete peers[dv]; } busy(); ui(); }
  let busyWas = false;
  function busy() {
    const b = waitOffer || Object.values(peers).some((p) => p.st === "connecting");
    if (b !== busyWas) { busyWas = b; window.cc.call("lan:busy", b).catch(() => {}); }
    return b;
  }
  function onPing(r) {
    lastPing = Date.now(); dev = r.dev || dev; lastPeers = (r.peers || []).filter((x) => x && x.dev && x.dev !== dev);
    if (!on() || !r.on) { closeAll(); return; }
    (r.sig || []).forEach((s) => onSignal(s.from, s.body).catch(() => {}));
    const mine = hasLocal(), alive = new Set(lastPeers.map((x) => x.dev));
    waitOffer = lastPeers.some((x) => dev > x.dev && (mine || /\+L$/.test(x.kind || "")) && !(peers[x.dev] && peers[x.dev].st === "open"));
    for (const x of lastPeers) {
      const p = peers[x.dev]; if (p) p.kind = x.kind || p.kind;
      const need = mine || /\+L$/.test(x.kind || "");
      // 编号小的一方主动连；失败了 30 秒后再试
      if (need && dev < x.dev && (!p || (p.st === "failed" && Date.now() - p.at > 30000))) connect(x.dev).catch(() => {});
    }
    for (const dv in peers) if (!alive.has(dv) && peers[dv].st !== "open") { try { peers[dv].pc.close(); } catch (e) {} delete peers[dv]; }
    busy(); ui();
  }
  // 本机改了「只存本机」的事项：马上发给已经连上的设备
  let deltaT = 0, lastSig = "";
  function onState() {
    if (!on()) { if (Object.keys(peers).length) closeAll(); return; }
    const sig = LIST_KINDS.map((k) => JSON.stringify(recsOf(k))).join("|");
    if (sig === lastSig) return; lastSig = sig;
    if (!Object.values(peers).some((p) => p.st === "open")) return;
    clearTimeout(deltaT);
    deltaT = setTimeout(() => { const ch = scanAll(); if (ch.length) for (const dv in peers) send(peers[dv], { type: "delta", list: ch }); }, 250);
  }

  const KIND_NAME = (k) => { k = String(k || "").replace(/\+L$/, ""); return k === "desktop" ? "电脑" : k === "phone" ? "手机" : k === "web" ? "网页" : k || "设备"; };
  function status() {
    const open = Object.entries(peers).filter(([, p]) => p.st === "open");
    let text, tone;
    if (!S().settings || S().settings.lanSync === false) { text = "已关闭"; tone = "off"; }
    else if (S().settings.liveSync === false) { text = "要先打开上面的「实时同步」"; tone = "off"; }
    else if (S().lanOk === false) { text = "服务器还没升级，暂时用不了"; tone = "off"; }
    else if (open.length) { text = `已连上同一网络里的 ${open.length} 台设备（${open.map(([, p]) => KIND_NAME(p.kind)).join("、")}），「只存本机」的事项会直接互传`; tone = "ok"; }
    else if (!hasLocal() && !lastPeers.some((x) => /\+L$/.test(x.kind || ""))) { text = lastPeers.length ? `同一账号有 ${lastPeers.length} 台设备在线，都没有「只存在这台设备」的事项，不需要互传` : "没有「只存在这台设备」的事项，不需要互传"; tone = "idle"; }
    else if (Object.values(peers).some((p) => p.st === "connecting")) { text = "正在连接同一网络里的设备…"; tone = "busy"; }
    else if (!lastPeers.length) { text = lastPing ? "还没发现别的设备：同一账号的手机、电脑打开捞捞课程表（网页版也行），连着同一个 Wi-Fi 就会自动连上" : "正在找同一个网络（同一个 Wi-Fi）里登录同一账号的设备…"; tone = "idle"; }
    else { text = `同一账号有 ${lastPeers.length} 台设备在线，正在试着局域网直连（不在同一个 Wi-Fi 里会连不上）…`; tone = "busy"; }
    return { text, tone, open: open.length, online: lastPeers.length, local: LIST_KINDS.reduce((n, k) => n + Object.keys(recsOf(k)).length, 0), got, gotAt,
      peers: Object.entries(peers).map(([d, p]) => ({ dev: d, st: p.st, kind: KIND_NAME(p.kind) })) };
  }
  // 设置页里的状态行（id="lanSt"）、标题栏同步点的提示
  function ui() {
    const st = status(), el = document.getElementById("lanSt");
    if (el) el.textContent = st.text;
    const dot = document.getElementById("lanDot"); if (dot) dot.className = "lan-dot " + st.tone;
    document.querySelectorAll("[data-lan-n]").forEach((x) => { x.textContent = st.open ? `局域网 ${st.open}` : ""; x.hidden = !st.open; });
  }
  setInterval(ui, 5000);

  if (window.cc) {
    window.cc.on("lan", (r) => { try { onPing(r || {}); } catch (e) {} });
    window.cc.on("state", () => setTimeout(onState, 0));
  }
  window.Lan = { status, closeAll, hasLocal, ui, debug: () => Object.fromEntries(Object.entries(peers).map(([k, p]) => [k, { st: p.st, ice: p.pc.iceConnectionState, conn: p.pc.connectionState, ch: p.ch && p.ch.readyState }])) };
})();
