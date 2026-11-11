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
  on() {},
};
