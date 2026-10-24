// 浏览器里没有 Node 的 Buffer：导图文件服务只用到其中一小部分，这里补上（Uint8Array 的子类）
"use strict";
const enc = new TextEncoder(), dec = new TextDecoder();
class Buffer extends Uint8Array {
  static from(v, encoding) {
    if (typeof v === "string") {
      if (encoding === "base64url") { v = v.replace(/-/g, "+").replace(/_/g, "/"); encoding = "base64"; }
      if (encoding === "base64") { const s = atob(v.replace(/[^A-Za-z0-9+/=]/g, "")); const b = new Buffer(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
      if (encoding === "hex") { const b = new Buffer(v.length >> 1); for (let i = 0; i < b.length; i++) b[i] = parseInt(v.substr(i * 2, 2), 16); return b; }
      if (encoding === "latin1" || encoding === "binary") { const b = new Buffer(v.length); for (let i = 0; i < v.length; i++) b[i] = v.charCodeAt(i) & 255; return b; }
      const u = enc.encode(v), b = new Buffer(u.length); b.set(u); return b;
    }
    if (v instanceof ArrayBuffer) return new Buffer(v);
    const b = new Buffer(v.length); b.set(v); return b;
  }
  static alloc(n) { return new Buffer(n); }
  static isBuffer(v) { return v instanceof Buffer; }
  static byteLength(s, encoding) { return typeof s === "string" ? (encoding === "base64" ? Buffer.from(s, "base64").length : enc.encode(s).length) : s.length; }
  static concat(list, total) {
    if (total == null) total = list.reduce((n, x) => n + x.length, 0);
    const b = new Buffer(total); let o = 0;
    for (const x of list) { b.set(x.subarray(0, Math.min(x.length, total - o)), o); o += x.length; if (o >= total) break; }
    return b;
  }
  subarray(a, b) { const s = super.subarray(a, b); return new Buffer(s.buffer, s.byteOffset, s.length); }
  slice(a, b) { return this.subarray(a, b); }
  equals(o) { if (!o || o.length !== this.length) return false; for (let i = 0; i < this.length; i++) if (this[i] !== o[i]) return false; return true; }
  copy(target, tStart = 0, sStart = 0, sEnd = this.length) { const part = this.subarray(sStart, sEnd); target.set(part, tStart); return part.length; }
  toString(encoding, start, end) {
    const v = (start != null || end != null) ? this.subarray(start || 0, end == null ? this.length : end) : this;
    if (encoding === "base64url") return v.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    if (encoding === "base64") { let s = ""; for (let i = 0; i < v.length; i += 0x8000) s += String.fromCharCode.apply(null, v.subarray(i, i + 0x8000)); return btoa(s); }
    if (encoding === "hex") { let s = ""; for (const x of v) s += (x < 16 ? "0" : "") + x.toString(16); return s; }
    if (encoding === "latin1" || encoding === "binary") { let s = ""; for (const x of v) s += String.fromCharCode(x); return s; }
    return dec.decode(v);
  }
  toJSON() { return { type: "Buffer", data: Array.from(this) }; }
}
module.exports = { Buffer };
