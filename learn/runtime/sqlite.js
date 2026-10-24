// 网页版用的 node:sqlite 替身：用 sql.js（SQLite 的 WebAssembly 版）实现 DatabaseSync / StatementSync 的常用方法。
// 数据库文件放在浏览器里的虚拟磁盘（memfs），每次请求处理完把有改动的库写回去。
"use strict";
const fs = require("node:fs");

const PARAM_RE = /'(?:[^']|'')*'|"(?:[^"]|"")*"|--[^\n]*|\/\*[\s\S]*?\*\/|([:@$][A-Za-z_][A-Za-z0-9_]*)/g;
function namedTokens(sql) {
  const out = new Set(); let m; PARAM_RE.lastIndex = 0;
  while ((m = PARAM_RE.exec(sql))) if (m[1]) out.add(m[1]);
  return [...out];
}
const val = (v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : typeof v === "bigint" ? Number(v) : v instanceof ArrayBuffer ? new Uint8Array(v) : v);
const isPlain = (o) => o && typeof o === "object" && !(o instanceof Uint8Array) && !ArrayBuffer.isView(o) && !Array.isArray(o);

const all = new Set();      // 打开的库，请求结束后统一保存

class StatementSync {
  constructor(db, sql) { this._db = db; this._sql = sql; this._named = null;
    const s = db._raw.prepare(sql); s.free();           // 和 node:sqlite 一样：语法错误在 prepare 时就报
  }
  _bind(args) {
    if (!args.length) return undefined;
    if (isPlain(args[0])) {
      const obj = args[0]; this._named = this._named || namedTokens(this._sql);
      const out = {};
      for (const t of this._named) { const bare = t.slice(1); if (t in obj) out[t] = val(obj[t]); else if (bare in obj) out[t] = val(obj[bare]); }
      if (args.length > 1) { const rest = args.slice(1).map(val); rest.forEach((v, i) => { out[i + 1] = v; }); }
      return out;
    }
    return args.map(val);
  }
  _rows(args, first) {
    const s = this._db._raw.prepare(this._sql);
    try {
      const p = this._bind(args); if (p !== undefined) s.bind(p);
      const rows = [];
      while (s.step()) { rows.push(s.getAsObject()); if (first) break; }
      return rows;
    } finally { s.free(); }
  }
  run(...args) {
    const s = this._db._raw.prepare(this._sql);
    try { const p = this._bind(args); if (p !== undefined) s.bind(p); while (s.step()) {} } finally { s.free(); }
    this._db._dirty = true;
    const changes = this._db._raw.getRowsModified();
    const r = this._db._raw.exec("select last_insert_rowid() as id");
    const id = r.length ? r[0].values[0][0] : 0;
    return { changes, lastInsertRowid: id };
  }
  get(...args) { const r = this._rows(args, true); return r.length ? r[0] : undefined; }
  all(...args) { return this._rows(args, false); }
  *iterate(...args) { yield* this._rows(args, false); }
  columns() { const s = this._db._raw.prepare(this._sql); try { return s.getColumnNames().map((name) => ({ name })); } finally { s.free(); } }
  setReadBigInts() { return this; } setAllowBareNamedParameters() { return this; } setReturnArrays() { return this; }
  get sourceSQL() { return this._sql; }
}

class DatabaseSync {
  constructor(file, opt) {
    const SQL = self.__SQL;
    if (!SQL) throw new Error("数据库组件还没加载好");
    this._file = file && file !== ":memory:" ? String(file) : null;
    let bytes = null;
    if (this._file && fs.existsSync(this._file)) bytes = new Uint8Array(fs.readFileSync(this._file));
    this._raw = bytes && bytes.length ? new SQL.Database(bytes) : new SQL.Database();
    this._dirty = !bytes;
    this.isOpen = true;
    all.add(this);
  }
  exec(sql) { this._raw.exec(sql); if (!/^\s*(select|pragma\s+\w+\s*;?\s*$)/i.test(sql)) this._dirty = true; }
  prepare(sql) { return new StatementSync(this, sql); }
  close() { this._save(); this.isOpen = false; all.delete(this); }
  open() { this.isOpen = true; }
  function() { throw new Error("网页版不支持自定义 SQL 函数"); }
  _save() {
    if (!this._dirty || !this._file) return false;
    const dir = this._file.slice(0, this._file.lastIndexOf("/")); if (dir) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this._file, this._raw.export());
    this._dirty = false;
    // export() 之后 sql.js 会关掉外键开关，重新打开
    try { this._raw.exec("PRAGMA foreign_keys = ON"); } catch (e) {}
    return true;
  }
  // 账号同步用：整库导出 / 用别处的库替换
  _export() { return this._raw.export(); }
  _replace(bytes) { try { this._raw.close(); } catch (e) {} this._raw = bytes ? new self.__SQL.Database(bytes) : new self.__SQL.Database(); this._dirty = true; try { this._raw.exec("PRAGMA foreign_keys = ON"); } catch (e) {} }
}
function saveAll() { let any = false; for (const d of all) any = d._save() || any; return any; }
module.exports = { DatabaseSync, StatementSync, __saveAll: saveAll, __all: all };
