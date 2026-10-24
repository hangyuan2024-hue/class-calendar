// 网页版用的 Express 替身：只实现课内后端用到的那部分（路由、:参数、中间件、错误中间件、req/res 常用方法）。
// 请求来自 Service Worker（见 sw-entry.js），不经过真正的网络。
"use strict";

function compile(path, end) {
  // "/api/courses/:id" → 正则 + 参数名；end=false 时按前缀匹配（app.use）
  if (path instanceof RegExp) return { re: path, keys: [] };
  const keys = [];
  const src = String(path).replace(/\/+$/, "").replace(/[.+*?^${}()|[\]\\]/g, (c) => (c === "*" ? ".*" : "\\" + c))
    .replace(/\\?\/:([A-Za-z_][A-Za-z0-9_]*)(\\\?)?/g, (m, k, opt) => { keys.push(k); return opt ? "(?:/([^/]+))?" : "/([^/]+)"; });
  return { re: new RegExp("^" + src + (end ? "/?$" : "(?=/|$)"), "i"), keys };
}

function Layer(method, path, fn, end) {
  const c = compile(path, end);
  return { method, path, fn, end, re: c.re, keys: c.keys, isRouter: !!(fn && fn.__router) };
}

function createRouter() {
  const stack = [];
  const settings = {};
  function router(req, res, out) { return handle(req, res, out); }
  router.__router = true;
  router.stack = stack;
  function add(method, path, fns, end) {
    for (const fn of fns.flat()) stack.push(Layer(method, path, fn, end));
    return router;
  }
  router.use = (path, ...fns) => { if (typeof path !== "string" && !(path instanceof RegExp)) { fns.unshift(path); path = "/"; } return add(null, path, fns, false); };
  for (const m of ["get", "post", "put", "patch", "delete", "options", "head", "all"]) router[m] = (path, ...fns) => add(m === "all" ? "*" : m.toUpperCase(), path, fns, true);
  router.set = (k, v) => { settings[k] = v; return router; };
  router.get_setting = (k) => settings[k];
  router.disable = (k) => { settings[k] = false; return router; };
  router.enable = (k) => { settings[k] = true; return router; };
  router.listen = (port, host, cb) => { if (typeof host === "function") cb = host; if (cb) setTimeout(cb, 0); return { close() {} }; };
  router.engine = () => router;

  function handle(req, res, out) {
    let i = 0;
    const base = req.baseUrl || "";
    const full = req.__path;   // 不含 base 的路径
    const next = (err) => {
      if (res.writableEnded) return;
      const layer = stack[i++];
      if (!layer) { req.baseUrl = base; req.path = full; return out && out(err); }
      const rel = full === "" ? "/" : full;
      const m = layer.re.exec(layer.path === "/" && !layer.end ? "" : rel) || (layer.path === "/" && !layer.end ? [""] : null);
      if (!m) return next(err);
      if (layer.method && layer.method !== "*" && layer.method !== req.method && !(layer.method === "GET" && req.method === "HEAD")) return next(err);
      const params = {};
      layer.keys.forEach((k, j) => { if (m[j + 1] !== undefined) { try { params[k] = decodeURIComponent(m[j + 1]); } catch (e) { params[k] = m[j + 1]; } } });
      req.params = Object.assign({}, req.__parentParams || {}, params);
      const fn = layer.fn;
      const arity = fn.length;
      try {
        if (layer.isRouter || !layer.end) {
          // 前缀挂载：子路由看到的路径去掉挂载前缀
          const matched = m[0] || "";
          const saveBase = req.baseUrl, savePath = req.__path, saveParent = req.__parentParams;
          if (!layer.end) { req.baseUrl = base + matched; req.__path = full.slice(matched.length) || "/"; req.path = req.__path; req.__parentParams = req.params; }
          const restore = () => { req.baseUrl = saveBase; req.__path = savePath; req.path = savePath; req.__parentParams = saveParent; };
          if (err) { if (arity === 4) { const r = fn(err, req, res, (e) => { restore(); next(e); }); if (r && r.catch) r.catch((e) => { restore(); next(e); }); } else { restore(); next(err); } return; }
          if (arity === 4) { restore(); return next(); }
          const r = fn(req, res, (e) => { restore(); next(e); });
          if (r && typeof r.catch === "function") r.catch((e) => { restore(); next(e); });
          return;
        }
        req.path = full;
        if (err) { if (arity === 4) { const r = fn(err, req, res, next); if (r && r.catch) r.catch(next); } else next(err); return; }
        if (arity === 4) return next();
        const r = fn(req, res, next);
        if (r && typeof r.catch === "function") r.catch(next);
      } catch (e) { next(e); }
    };
    next();
  }
  return router;
}

function express() {
  const app = createRouter();
  app.__isApp = true;
  // 入口：sw-entry.js 调用
  app.__dispatch = (req, res) => new Promise((resolve) => {
    res.__done.then(resolve);
    req.__path = req.path; req.baseUrl = "";
    app(req, res, (err) => {
      if (res.writableEnded) return;
      if (err) { console.error("[courses-sw]", err); res.status(err.status || err.statusCode || 500).json({ error: err.message || "服务器出错了" }); }
      else res.status(404).json({ error: "没有这个接口：" + req.method + " " + req.originalUrl });
    });
  });
  return app;
}
express.Router = () => createRouter();
// JSON 请求体：sw-entry.js 已经把正文读成文本放在 req.__text
express.json = () => (req, res, next) => {
  if (req.body !== undefined && req.__bodyParsed) return next();
  if (req.is("application/json") && req.__text) {
    try { req.body = JSON.parse(req.__text); } catch (e) { return next(Object.assign(new Error("请求内容不是合法的 JSON"), { status: 400 })); }
  } else if (req.body === undefined) req.body = {};
  req.__bodyParsed = true; next();
};
express.urlencoded = () => (req, res, next) => next();
express.static = () => (req, res, next) => next();       // 静态文件由 Service Worker 外面的网站提供
module.exports = express;
module.exports.default = express;
