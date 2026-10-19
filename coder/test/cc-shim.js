// 测试时注入到页面里的 window.cc（代替 Electron 的 preload）
window.cc = (() => {
  const subs = {};
  const es = new EventSource("/events");
  es.onmessage = (e) => { const { ch, data } = JSON.parse(e.data); (subs[ch] || []).forEach((f) => f(data)); };
  return {
    call: async (method, ...args) => { const r = await (await fetch("/call", { method: "POST", body: JSON.stringify({ method, args }) })).json(); if (!r.ok) throw new Error(r.e); return r.r; },
    on: (ev, fn) => { (subs[ev] ||= []).push(fn); },
    closingOk: async () => {},
  };
})();
