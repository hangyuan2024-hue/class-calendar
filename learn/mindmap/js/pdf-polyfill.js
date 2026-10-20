/* pdf-polyfill.js —— PDF.js 6 用了很多最新的浏览器功能（2025 年以后的 Chrome 才有），
 * 微信里的浏览器、学校机房的旧版 Chrome 都没有，PDF 就打不开。这里把用到的补上。
 * 页面里用 <script> 加载；PDF 的后台线程通过 vendor/pdfjs/build/pdf.worker.poly.mjs 先加载它。 */
(function () {
  "use strict";
  var G = typeof globalThis !== "undefined" ? globalThis : self;
  function def(o, k, v) { if (o && !(k in o)) Object.defineProperty(o, k, { value: v, writable: true, configurable: true }); }
  [G.Map, G.WeakMap].forEach(function (C) {
    if (!C) return;
    def(C.prototype, "getOrInsert", function (k, v) { if (!this.has(k)) this.set(k, v); return this.get(k); });
    def(C.prototype, "getOrInsertComputed", function (k, f) { if (!this.has(k)) this.set(k, f(k)); return this.get(k); });
  });
  def(G.Promise, "withResolvers", function () { var a, b, p = new this(function (r, j) { a = r; b = j; }); return { promise: p, resolve: a, reject: b }; });
  def(G.Promise, "try", function (f) { var args = [].slice.call(arguments, 1), P = this; return new P(function (r) { r(f.apply(void 0, args)); }); });
  def(Math, "sumPrecise", function (it) { var s = 0, c = 0; for (var x of it) { var y = x - c, t = s + y; c = (t - s) - y; s = t; } return s; });
  def(Array.prototype, "at", function (i) { i = Math.trunc(i) || 0; if (i < 0) i += this.length; return this[i]; });
  def(Array.prototype, "findLast", function (f, t) { for (var i = this.length - 1; i >= 0; i--) if (f.call(t, this[i], i, this)) return this[i]; });
  def(Array.prototype, "findLastIndex", function (f, t) { for (var i = this.length - 1; i >= 0; i--) if (f.call(t, this[i], i, this)) return i; return -1; });
  def(Object, "hasOwn", function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); });
  if (G.Uint8Array) {
    def(Uint8Array.prototype, "toBase64", function () { var s = ""; for (var i = 0; i < this.length; i += 0x8000) s += String.fromCharCode.apply(null, this.subarray(i, i + 0x8000)); return btoa(s); });
    def(Uint8Array.prototype, "toHex", function () { var s = ""; for (var i = 0; i < this.length; i++) s += (this[i] < 16 ? "0" : "") + this[i].toString(16); return s; });
    def(Uint8Array, "fromBase64", function (b) { var s = atob(String(b).replace(/[\s]/g, "").replace(/-/g, "+").replace(/_/g, "/")), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; });
    def(Uint8Array, "fromHex", function (h) { var u = new Uint8Array(h.length >> 1); for (var i = 0; i < u.length; i++) u[i] = parseInt(h.substr(i * 2, 2), 16); return u; });
  }
  if (G.Response) def(Response.prototype, "bytes", function () { return this.arrayBuffer().then(function (b) { return new Uint8Array(b); }); });
  if (G.Blob) def(Blob.prototype, "bytes", function () { return this.arrayBuffer().then(function (b) { return new Uint8Array(b); }); });
  if (G.Set) {
    var S = Set.prototype, keys = function (o) { return o && typeof o.has === "function" ? o : new Set(o); };
    def(S, "intersection", function (o) { o = keys(o); var r = new Set(); this.forEach(function (x) { if (o.has(x)) r.add(x); }); return r; });
    def(S, "union", function (o) { var r = new Set(this); (o.keys ? o.keys() : o).forEach ? o.forEach(function (x) { r.add(x); }) : null; return r; });
    def(S, "difference", function (o) { o = keys(o); var r = new Set(); this.forEach(function (x) { if (!o.has(x)) r.add(x); }); return r; });
    def(S, "isSubsetOf", function (o) { o = keys(o); var ok = true; this.forEach(function (x) { if (!o.has(x)) ok = false; }); return ok; });
    def(S, "isSupersetOf", function (o) { var me = this, ok = true; (o.forEach ? o : new Set(o)).forEach(function (x) { if (!me.has(x)) ok = false; }); return ok; });
    def(S, "isDisjointFrom", function (o) { o = keys(o); var ok = true; this.forEach(function (x) { if (o.has(x)) ok = false; }); return ok; });
    def(S, "symmetricDifference", function (o) { var r = new Set(this), me = this; (o.forEach ? o : new Set(o)).forEach(function (x) { if (me.has(x)) r.delete(x); else r.add(x); }); return r; });
  }
  // 迭代器上的 filter / map / toArray……（Chrome 122 以后才有）
  var IterProto = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));
  if (typeof G.Iterator === "undefined") {
    var It = function Iterator() {}; It.prototype = IterProto;
    Object.defineProperty(G, "Iterator", { value: It, writable: true, configurable: true });
  }
  var P = G.Iterator.prototype;
  function* gen(it, f) { yield* f(it); }
  def(P, "toArray", function () { var r = []; for (var x of this) r.push(x); return r; });
  def(P, "map", function (f) { var it = this, i = 0; return gen(it, function* () { for (var x of it) yield f(x, i++); }); });
  def(P, "filter", function (f) { var it = this, i = 0; return gen(it, function* () { for (var x of it) if (f(x, i++)) yield x; }); });
  def(P, "flatMap", function (f) { var it = this, i = 0; return gen(it, function* () { for (var x of it) yield* f(x, i++); }); });
  def(P, "take", function (n) { var it = this; return gen(it, function* () { if (n <= 0) return; for (var x of it) { yield x; if (--n <= 0) return; } }); });
  def(P, "drop", function (n) { var it = this; return gen(it, function* () { for (var x of it) { if (n > 0) { n--; continue; } yield x; } }); });
  def(P, "forEach", function (f) { var i = 0; for (var x of this) f(x, i++); });
  def(P, "some", function (f) { var i = 0; for (var x of this) if (f(x, i++)) return true; return false; });
  def(P, "every", function (f) { var i = 0; for (var x of this) if (!f(x, i++)) return false; return true; });
  def(P, "find", function (f) { var i = 0; for (var x of this) if (f(x, i++)) return x; });
  def(P, "reduce", function (f, acc) { var i = 0, first = arguments.length < 2; for (var x of this) { if (first) { acc = x; first = false; } else acc = f(acc, x, i); i++; } return acc; });
})();
