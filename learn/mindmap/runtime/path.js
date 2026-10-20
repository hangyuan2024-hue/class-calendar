// Node 的 path（只用 POSIX 风格）
"use strict";
function norm(p) {
  const abs = p.startsWith("/"), out = [];
  for (const s of p.split("/")) { if (!s || s === ".") continue; if (s === "..") { if (out.length && out[out.length - 1] !== "..") out.pop(); else if (!abs) out.push(".."); } else out.push(s); }
  const r = (abs ? "/" : "") + out.join("/");
  return r || (abs ? "/" : ".");
}
const path = {
  sep: "/", delimiter: ":",
  normalize: norm,
  join: (...a) => norm(a.filter((x) => x !== "").join("/")),
  resolve: (...a) => { let r = ""; for (let i = a.length - 1; i >= 0 && !r.startsWith("/"); i--) r = a[i] + (r ? "/" + r : ""); if (!r.startsWith("/")) r = "/app/" + r; return norm(r); },
  dirname: (p) => { const n = norm(p), i = n.lastIndexOf("/"); return i <= 0 ? (n.startsWith("/") ? "/" : ".") : n.slice(0, i); },
  basename: (p, ext) => { const b = norm(p).split("/").pop(); return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b; },
  extname: (p) => { const b = norm(p).split("/").pop(), i = b.lastIndexOf("."); return i <= 0 ? "" : b.slice(i); },
  relative: (a, b) => { const x = norm(a).split("/").filter(Boolean), y = norm(b).split("/").filter(Boolean); let i = 0; while (i < x.length && x[i] === y[i]) i++; return [...x.slice(i).map(() => ".."), ...y.slice(i)].join("/"); },
  isAbsolute: (p) => p.startsWith("/"),
};
path.posix = path;
module.exports = path;
