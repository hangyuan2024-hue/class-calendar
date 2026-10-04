// 模拟网站的数据库（Supabase）接口，给电脑版测试用
const http = require("http");
function createMock(opts = {}) {
  const S = {
    users: { "u-1": { account: "hangyuan", pw: "12345678" } },
    tokens: {}, kv: [], rev: 0, calls: [], growth: [], wall: [],
    items: opts.items || [], courses: opts.courses || { courses: [], meta: {} },
  };
  const send = (res, code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(body === undefined ? "" : JSON.stringify(body)); };
  const srv = http.createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
      const u = new URL(req.url, "http://x"), body = b ? JSON.parse(b) : {}, auth = (req.headers.authorization || "").slice(7), uid = S.tokens[auth];
      S.calls.push(u.pathname);
      if (u.pathname === "/auth/v1/token") {
        if (u.searchParams.get("grant_type") === "password") {
          const e = Object.entries(S.users).find(([, x]) => x.account + "@calendar.test" === body.email && x.pw === body.password);
          if (!e) return send(res, 400, { error_description: "Invalid login credentials" });
          const t = "tok" + Math.random(); S.tokens[t] = e[0];
          return send(res, 200, { access_token: t, refresh_token: "r-" + e[0], expires_in: opts.expiresIn || 3600, user: { id: e[0] } });
        }
        if (body.refresh_token && body.refresh_token.startsWith("r-")) { const t = "tok" + Math.random(); S.tokens[t] = body.refresh_token.slice(2); S.refreshed = (S.refreshed || 0) + 1; return send(res, 200, { access_token: t, refresh_token: body.refresh_token, expires_in: 3600, user: { id: body.refresh_token.slice(2) } }); }
        return send(res, 400, { error_description: "bad refresh" });
      }
      if (u.pathname === "/auth/v1/logout") return send(res, 204);
      const m = /^\/rest\/v1\/rpc\/(\w+)$/.exec(u.pathname);
      if (m) {
        if (!uid) return send(res, 401, { message: "JWT expired" });
        const fn = m[1];
        if (fn === "app_bootstrap") return send(res, 200, { me: { id: uid, display_name: "杭远", account: "hangyuan", role: "student" }, perms: [], classes: [{ id: "c-1", name: "计科2601班", status: "approved", is_teacher: false }], cid: "c-1", items: S.items, wall: { cid: "c-1", posts: S.wall } });
        if (fn === "courses_get") return send(res, 200, S.courses);
        if (fn === "udata_push") { for (const r of body.p) { const i = S.kv.findIndex((x) => x.ns === r.ns && x.k === r.k); if (i >= 0 && S.kv[i].t > r.t) continue; const row = { ...r, rev: ++S.rev }; if (i >= 0) S.kv[i] = row; else S.kv.push(row); } return send(res, 200, { applied: body.p.length }); }
        if (fn === "udata_pull") { const rows = S.kv.filter((x) => x.rev > (body.since || 0)).sort((a, b) => a.rev - b.rev); return send(res, 200, { rows: rows.map(({ ns, k, v, t }) => ({ ns, k, v, t })), rev: rows.length ? rows[rows.length - 1].rev : body.since || 0, more: false }); }
        if (fn === "growth_log") { S.growth.push(body); return send(res, 200, null); }
        if (fn === "wall_post") { S.wall.unshift({ id: S.wall.length + 1, title: body.p_title, body: body.p_body, author_name: "杭远", created_at: new Date().toISOString(), is_notice: body.p_notice }); return send(res, 200, S.wall.length); }
        return send(res, 404, { message: "Could not find the function " + fn });
      }
      send(res, 404, { message: "not found" });
    });
  });
  return { S, srv, listen: () => new Promise((r) => srv.listen(0, "127.0.0.1", () => r("http://127.0.0.1:" + srv.address().port))) };
}
module.exports = { createMock };
