// 浏览器里假装有 window.cc（Electron 的 preload 给的）：二进制（Uint8Array，哪一层都行）来回用 base64 包一下
window.cc = {
  call: async (method, ...args) => {
    const enc = (x) => { if (!(x instanceof Uint8Array)) return x; let s = ""; for (let i = 0; i < x.length; i += 32768) s += String.fromCharCode.apply(null, x.subarray(i, i + 32768)); return { __b64: btoa(s) }; };
    const dec = (x) => {
      if (x && typeof x === "object" && typeof x.__b64 === "string") { const s = atob(x.__b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
      if (Array.isArray(x)) return x.map(dec);
      if (x && typeof x === "object") { for (const k of Object.keys(x)) x[k] = dec(x[k]); }
      return x;
    };
    const r = await (await fetch("/call", { method: "POST", body: JSON.stringify({ method, args: args.map(enc) }) })).json();
    if (!r.ok) throw new Error(r.e);
    return dec(r.r);
  },
  // 后台的事件：轮询 /events（真的软件里是 Electron 推过来的）
  on(ch, fn) {
    const L = (window.__ccOn = window.__ccOn || { fns: {}, next: 0, timer: 0 });
    (L.fns[ch] = L.fns[ch] || []).push(fn);
    if (L.timer) return;
    L.timer = setInterval(async () => {
      try { const r = await (await fetch("/events?since=" + L.next)).json(); L.next = r.next; for (const e of r.ev) for (const f of L.fns[e.ch] || []) f(e.d); } catch (e) {}
    }, 250);
  },
};
