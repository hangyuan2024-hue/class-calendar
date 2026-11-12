// 浏览器里假装有 window.lg（Electron 的 preload 给的）：调用转给测试服务器，事件轮询 /events
window.lg = {
  call: async (method, ...args) => {
    const enc = (x) => { if (!(x instanceof Uint8Array)) return x; let s = ""; for (let i = 0; i < x.length; i += 32768) s += String.fromCharCode.apply(null, x.subarray(i, i + 32768)); return { __b64: btoa(s) }; };
    const r = await (await fetch("/call", { method: "POST", body: JSON.stringify({ method, args: args.map(enc) }) })).json();
    if (!r.ok) throw new Error(r.e);
    return r.r;
  },
  on(ch, fn) {
    const L = (window.__lgOn = window.__lgOn || { fns: {}, next: 0, timer: 0 });
    (L.fns[ch] = L.fns[ch] || []).push(fn);
    if (L.timer) return;
    L.timer = setInterval(async () => {
      try { const r = await (await fetch("/events?since=" + L.next)).json(); L.next = r.next; for (const e of r.ev) for (const f of L.fns[e.ch] || []) f(e.d); } catch (e) {}
    }, 200);
  },
};
