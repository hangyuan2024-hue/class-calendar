// ===== 实时同步 + 局域网同步（放在 app.js 后面加载） =====
// 1. 每隔几秒问一次服务器「有没有新东西」（sync_ping，只返回几个数字，很轻）：
//    · 我的数据有新版本（别的设备改了）→ 马上拉下来；
//    · 班级事项的指纹变了（老师 / 班委发布、修改、删除）→ 马上重新读班级事项；
//    · 顺便用服务器时间校准本机时钟，修改时间以服务器为准，手机时间不准也不会让旧修改盖掉新修改；
//      本机时间差太多时提醒一下（作业截止、上课提醒要靠本机时间算）。
//    在用的时候 3 秒一次，放着不动 10 秒一次，切到后台就停，回来马上问一次。
// 2. 局域网同步：「只存在这台设备」的数据（整体只存本机，或者勾了「只存在这台设备」的事项），
//    同一账号的两台设备在同一个局域网里时，直接点对点传（WebRTC，加密），数据不经过服务器；
//    服务器只帮两台设备「打个招呼」交换连接信息。只用局域网地址，不走外网中转。
// 服务器还没装 live.sql 时，自动退回原来的方式（1 分钟拉一次），什么都不会坏。
(function () {
  "use strict";
  if (typeof Sync === "undefined" || typeof CCAuth === "undefined") return;
  const LS_DEV = "device_id_v1", LS_LAN = "lan_sync_v1", LS_LAN_META = "lan_meta_v1";
  const SEP = "\u0001";
  const dev = (() => {
    let d = null; try { d = localStorage.getItem(LS_DEV); } catch (e) {}
    if (!d || !/^[A-Za-z0-9_-]{6,40}$/.test(d)) { d = "w" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); try { localStorage.setItem(LS_DEV, d); } catch (e) {} }
    return d;
  })();
  const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const lsPut = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + s.length.toString(36); };

  // ---------------- 1. 实时同步 ----------------
  let lastAct = Date.now(), timer = 0, inflight = false, failN = 0, off = 0, disabled = false, csig = null, warned = false, lastPingAt = 0;
  ["pointerdown", "keydown", "touchstart", "wheel"].forEach((t) => addEventListener(t, () => {
    const idle = Date.now() - lastAct > 120000; lastAct = Date.now();
    if (idle) kick();   // 放了很久又开始用：马上问一次
  }, { passive: true, capture: true }));
  // 正在和局域网里的设备握手时 1 秒问一次，连得快
  const interval = () => (document.hidden ? 0 : LAN.busy() ? 1000 : Date.now() - lastAct < 120000 ? 3000 : 10000);
  const lanWanted = () => LAN.wanted();

  async function ping() {
    if (inflight || disabled || typeof currentUser === "undefined" || !currentUser) return;
    if (navigator.onLine === false) return;
    inflight = true;
    const t0 = Date.now();
    try {
      const cls = typeof currentClass !== "undefined" && currentClass ? currentClass.id : null;
      const r = await CCAuth.rpc("sync_ping", { p_dev: dev, p_cid: cls, p_lan: lanWanted(), p_kind: (matchMedia("(max-width: 700px)").matches ? "phone" : "web") + (LAN.on() && LAN.hasLocal() ? "+L" : "") });
      const t1 = Date.now();
      if (r && r.now) {
        // 往返时间的一半当作单程，估计本机比服务器快 / 慢了多少
        const o = r.now - (t0 + t1) / 2;
        off = Math.abs(o - off) > 1000 || !lastPingAt ? o : off * 0.8 + o * 0.2;
        Sync.setClock(Math.round(off));
        clockCheck();
      }
      lastPingAt = Date.now(); failN = 0;
      if (Sync.active() && r && r.rev > Sync.rev()) Sync.pull();
      if (r && cls && typeof currentClass !== "undefined" && currentClass && currentClass.id === cls) {
        if (r.csig != null && csig && csig.cid === cls && csig.v !== r.csig && typeof loadClass === "function") loadClass();
        if (r.csig != null) csig = { cid: cls, v: r.csig };
      }
      LAN.onPing((r && r.peers) || [], (r && r.sig) || []);
    } catch (e) {
      failN++;
      if (e && (e.status === 404 || /sync_ping|PGRST202|找不到|Could not find/i.test(e.message || ""))) disabled = true;   // 服务器还没装 live.sql
      if (e && e.status === 401) disabled = true;
    } finally { inflight = false; }
  }
  function loop() {
    clearTimeout(timer);
    const iv = interval();
    if (!iv || disabled) return;
    const wait = failN ? Math.min(60000, iv * Math.pow(2, Math.min(failN, 5))) : iv;
    timer = setTimeout(async () => { await ping(); loop(); }, wait);
  }
  function kick() { clearTimeout(timer); ping().then(loop); }
  document.addEventListener("visibilitychange", () => { if (document.hidden) clearTimeout(timer); else kick(); });
  addEventListener("online", kick);
  addEventListener("focus", () => { if (Date.now() - lastPingAt > 2500) kick(); });
  // 自己改了数据：上传完马上再问一次（别的设备那边几秒内就会更新）
  Sync.onState(() => { const st = Sync.status(); if (st.state === "ok" && Date.now() - lastPingAt > 1500 && !document.hidden) setTimeout(kick, 200); });

  // 本机时间差太多：提醒 —— 截止倒计时、上课提醒都是按本机时间算的
  function clockCheck() {
    const min = Math.round(Math.abs(off) / 60000);
    window.CC_CLOCK_OFF = Math.round(off);
    if (min >= 2 && !warned && typeof showBanner === "function") {
      warned = true;
      showBanner(`这台设备的时间比标准时间${off > 0 ? "慢" : "快"}了约 ${min} 分钟，作业截止和上课提醒可能不准。请在系统设置里打开「自动设置时间」。`);
      setTimeout(() => showBanner(""), 12000);
    }
  }

  // ---------------- 2. 局域网同步 ----------------
  const LAN = (() => {
    const peers = {};
    let waitOffer = false;   // 对方该主动连我了：问得勤一点   // dev → { pc, ch, st: "connecting" | "open" | "failed", at, buf }
    let meta = null, applying = false;
    const M = () => meta || (meta = Object.assign({ t: {}, h: {} }, lsGet(LS_LAN_META, {})));
    const saveMeta = () => lsPut(LS_LAN_META, meta);
    const on = () => lsGet(LS_LAN, true) !== false;
    const localMode = () => Sync.mode() === "local";
    const kinds = Sync.kinds || {};
    // 这一类数据里，哪些要走局域网：整体只存本机 → 全部；否则只有勾了「只存在这台设备」的事项
    function recsOf(k) {
      const kind = kinds[k], v = lsGet(k, null), o = {};
      if (kind === "list") { for (const x of Array.isArray(v) ? v : []) if (x && x.id != null && (localMode() || x.local)) o[String(x.id)] = x; return o; }
      if (!localMode()) return o;
      if (kind === "one") { if (v != null) o._ = v; return o; }
      if (!v || typeof v !== "object") return o;
      if (kind === "map2") { for (const a in v) if (v[a] && typeof v[a] === "object") for (const b in v[a]) o[a + SEP + b] = v[a][b]; return o; }
      for (const a in v) o[a] = v[a];
      return o;
    }
    function hasLocal() {
      if (localMode()) return true;
      for (const k in kinds) if (kinds[k] === "list") { const v = lsGet(k, []); if (Array.isArray(v) && v.some((x) => x && x.local)) return true; }
      return false;
    }
    // 打开了就在线登记（别的设备有本机数据要传给我时能找到我）；真正连接只在至少一边有「只存本机」的数据时才发起
    const wanted = () => on() && typeof currentUser !== "undefined" && !!currentUser && typeof RTCPeerConnection === "function";
    // 找出改动（本机时间戳都用校准过的时间）；删掉的留一个「墓碑」，免得另一台设备又传回来
    function scan(k) {
      const m = M(), recs = recsOf(k), h = (m.h[k] = m.h[k] || {}), t = (m.t[k] = m.t[k] || {}), ch = [];
      const now = Sync.now();
      for (const r in recs) { const hv = hash(JSON.stringify(recs[r])); if (h[r] !== hv) { h[r] = hv; t[r] = Math.max(now, (t[r] || 0) + 1); ch.push({ k, r, v: recs[r], t: t[r] }); } }
      for (const r in h) if (!(r in recs) && h[r] !== "-") { h[r] = "-"; t[r] = Math.max(now, (t[r] || 0) + 1); ch.push({ k, r, v: null, t: t[r] }); }
      return ch;
    }
    function scanAll() { let ch = []; for (const k in kinds) ch = ch.concat(scan(k)); saveMeta(); return ch; }
    function snapshot() {
      scanAll();
      const m = M(), out = [];
      for (const k in m.t) {
        const recs = recsOf(k);
        for (const r in m.t[k]) out.push({ k, r, v: m.h[k][r] === "-" || recs[r] === undefined ? null : recs[r], t: m.t[k][r] });
      }
      return out;
    }
    // 收到另一台设备的改动：每一条以后改的为准
    function apply(list) {
      const m = M(), touched = new Set();
      const by = {};
      for (const x of list || []) if (x && kinds[x.k] && x.r != null && typeof x.t === "number") (by[x.k] = by[x.k] || []).push(x);
      for (const k in by) {
        const kind = kinds[k], t = (m.t[k] = m.t[k] || {}), h = (m.h[k] = m.h[k] || {});
        let v = lsGet(k, kind === "list" ? [] : kind === "one" ? null : {}), changed = false;
        for (const x of by[k]) {
          if ((t[x.r] || 0) >= x.t) continue;
          t[x.r] = x.t; h[x.r] = x.v == null ? "-" : hash(JSON.stringify(x.v)); changed = true;
          if (kind === "list") {
            if (!Array.isArray(v)) v = [];
            const i = v.findIndex((y) => y && String(y.id) === x.r);
            if (x.v == null) { if (i >= 0) v.splice(i, 1); }
            else { const rec = localMode() ? x.v : Object.assign({}, x.v, { local: true }); if (i >= 0) v[i] = rec; else v.push(rec); }
          } else if (kind === "one") v = x.v;
          else {
            if (!v || typeof v !== "object") v = {};
            if (kind === "map2") { const p = x.r.split(SEP); if (x.v == null) { if (v[p[0]]) delete v[p[0]][p[1]]; } else (v[p[0]] = v[p[0]] || {})[p[1]] = x.v; }
            else if (x.v == null) delete v[x.r]; else v[x.r] = x.v;
          }
        }
        if (changed) { applying = true; lsPut(k, v); if (!localMode()) Sync.note(k); applying = false; touched.add(k); }
      }
      saveMeta();
      if (touched.size) Sync.emitChanged(touched);
    }
    // ---- 传输：一条消息太大就切成小块 ----
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
      renderLanUI();
    }
    function wire(dv, p, ch) {
      p.ch = ch;
      ch.onopen = () => { p.st = "open"; p.helloSent = true; send(p, { type: "hello", list: snapshot() }); renderLanUI(); };
      ch.onmessage = (e) => onMsg(p, e.data);
      ch.onclose = () => { p.st = "failed"; p.at = Date.now(); renderLanUI(); };
    }
    function newPc(dv) {
      // 不给 STUN / TURN 服务器：只用本机的局域网地址，连不上就是不在同一个网络里
      const pc = new RTCPeerConnection({ iceServers: [] });
      const p = { pc, ch: null, st: "connecting", at: Date.now() };
      peers[dv] = p;
      pc.onconnectionstatechange = () => { if (["failed", "closed", "disconnected"].includes(pc.connectionState)) { p.st = "failed"; p.at = Date.now(); renderLanUI(); } };
      pc.ondatachannel = (e) => wire(dv, p, e.channel);
      setTimeout(() => { if (p.st === "connecting") { p.st = "failed"; p.at = Date.now(); try { pc.close(); } catch (e) {} renderLanUI(); } }, 20000);
      return p;
    }
    // 等本机的局域网地址都收集完（最多 3 秒），一次发过去，不用来回发很多次
    const gathered = (pc) => new Promise((res) => {
      if (pc.iceGatheringState === "complete") return res();
      const done = () => { if (pc.iceGatheringState === "complete") res(); };
      pc.addEventListener("icegatheringstatechange", done); setTimeout(res, 3000);
    });
    async function signal(to, body) { try { await CCAuth.rpc("lan_send", { p_from: dev, p_to: to, p_body: body }); } catch (e) {} setTimeout(kick, 300); }
    async function connect(dv) {
      const p = newPc(dv);
      wire(dv, p, p.pc.createDataChannel("cc-lan", { ordered: true }));
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
    function onPing(list, sig) {
      if (!wanted()) { closeAll(); return; }
      sig.forEach((s) => onSignal(s.from, s.body).catch(() => {}));
      const alive = new Set(list.map((x) => x.dev));
      waitOffer = list.some((x) => dev > x.dev && (hasLocal() || /\+L$/.test(x.kind || "")) && !(peers[x.dev] && peers[x.dev].st === "open"));
      for (const x of list) {
        const p = peers[x.dev];
        // 编号小的一方主动连；失败了 30 秒后再试
        const need = hasLocal() || /\+L$/.test(x.kind || "");
        if (need && dev < x.dev && (!p || (p.st === "failed" && Date.now() - p.at > 30000))) connect(x.dev).catch(() => {});
      }
      for (const dv in peers) if (!alive.has(dv) && peers[dv].st !== "open") { try { peers[dv].pc.close(); } catch (e) {} delete peers[dv]; }
      renderLanUI();
    }
    function closeAll() { for (const dv in peers) { try { peers[dv].pc.close(); } catch (e) {} delete peers[dv]; } renderLanUI(); }
    // 本机改了：马上发给已经连上的设备
    let deltaT = 0;
    Sync.onNote((k) => {
      if (applying || !Object.values(peers).some((p) => p.st === "open")) return;
      clearTimeout(deltaT);
      deltaT = setTimeout(() => { const ch = scanAll(); if (ch.length) for (const dv in peers) send(peers[dv], { type: "delta", list: ch }); }, 250);
    });
    const busy = () => waitOffer || Object.values(peers).some((p) => p.st === "connecting");
    const openN = () => Object.values(peers).filter((p) => p.st === "open").length;
    const debug = () => Object.fromEntries(Object.entries(peers).map(([k, p]) => [k, { st: p.st, ice: p.pc.iceConnectionState, conn: p.pc.connectionState, sig: p.pc.signalingState, ch: p.ch && p.ch.readyState }]));
    return { wanted, onPing, closeAll, openN, on, debug, busy, setOn: (v) => { lsPut(LS_LAN, !!v); if (!v) closeAll(); kick(); renderLanUI(); }, hasLocal };
  })();

  // 「我的 → 数据」里显示局域网同步的状态
  function renderLanUI() {
    const row = document.getElementById("lanRow"); if (!row) return;
    const show = typeof currentUser !== "undefined" && !!currentUser && typeof RTCPeerConnection === "function";
    row.classList.toggle("hidden", !show);
    if (!show) return;
    const sw = document.getElementById("lanOn"); if (sw) sw.checked = LAN.on();
    const n = LAN.openN(), st = document.getElementById("lanSt");
    if (st) st.textContent = !LAN.on() ? "已关闭" : !LAN.hasLocal() ? "没有「只存在这台设备」的数据，不需要" : n ? `已连上同一网络里的 ${n} 台设备，「只存本机」的数据会直接互传` : disabled ? "服务器还没升级，暂时用不了" : "正在找同一个网络（同一个 Wi-Fi）里登录同一账号的设备…";
    const dot = document.getElementById("lanDot"); if (dot) dot.className = "sdot " + (!LAN.on() || !LAN.hasLocal() ? "off" : n ? "ok" : "busy");
  }
  document.addEventListener("change", (e) => { if (e.target && e.target.id === "lanOn") LAN.setOn(e.target.checked); });
  setInterval(renderLanUI, 5000);

  window.Live = { kick, dev, lan: LAN, clockOff: () => off, status: () => ({ disabled, failN, lastPingAt, off, lan: LAN.openN() }) };
  // 等登录信息就绪后开始
  const startWhenReady = () => { if (typeof currentUser !== "undefined" && currentUser) { kick(); renderLanUI(); } else setTimeout(startWhenReady, 800); };
  startWhenReady();
})();
