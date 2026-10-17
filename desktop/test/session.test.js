// 3.3.3：电脑版不再「无缘无故自己退出登录」
//   令牌过期 / 电脑时钟不准 / 睡醒后被 401 拒：先换新令牌再试；网络不好时保留登录；只有服务器明确说登录无效才退出
const assert = require("assert");
const { Api } = require("../core/api.js");

let n = 0;
const ok = (name) => console.log("✓ " + name);
function mk(handler) {
  let saved = { access_token: "A1", refresh_token: "R1", expires_at: Math.floor(Date.now() / 1000) + 3600, user_id: "u" };
  const store = { load: () => saved && { ...saved }, save: (s) => { saved = s; } };
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, auth: opts.headers.Authorization, body: opts.body });
    const r = await handler(url, opts, calls.length);
    if (r === "hang") return new Promise((_, rej) => opts.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    if (r instanceof Error) throw r;
    return { ok: r.status < 300, status: r.status, text: async () => JSON.stringify(r.body) };
  };
  const api = new Api({ url: "https://a.example", alt: "https://b.example", key: "anon", store, fetchImpl, routeStore: { load: () => 0, save() {} } });
  return { api, store, calls, get saved() { return saved; } };
}

(async () => {
  // 1. 服务器回 401（令牌其实已经过期）：自动换令牌再试一次，登录保留
  {
    const t = mk((url, opts) => {
      if (url.includes("grant_type=refresh_token")) return { status: 200, body: { access_token: "A2", refresh_token: "R2", expires_in: 3600 } };
      if (opts.headers.Authorization === "Bearer A1") return { status: 401, body: { message: "JWT expired" } };
      return { status: 200, body: { ok: 1 } };
    });
    const r = await t.api.rpc("app_bootstrap2", {});
    assert.deepStrictEqual(r, { ok: 1 });
    assert.strictEqual(t.saved.access_token, "A2");
    ok("被 401 拒了：自动换新令牌再试，没有退出登录");
  }
  // 2. 换令牌时网络断了：保留登录
  {
    const t = mk((url) => { if (url.includes("refresh_token")) return new TypeError("fetch failed"); return { status: 401, body: { message: "JWT expired" } }; });
    await assert.rejects(t.api.rpc("x", {}), (e) => e.status === 401 && e.keep === true);
    assert.ok(t.saved && t.saved.refresh_token === "R1");
    ok("换令牌时断网：登录还在，过一会儿再试");
  }
  // 3. 服务器明确说登录已无效：才退出
  {
    const t = mk((url) => url.includes("refresh_token") ? { status: 400, body: { error: "invalid_grant", error_description: "Invalid Refresh Token: Already Used" } } : { status: 401, body: { message: "JWT expired" } });
    await assert.rejects(t.api.rpc("x", {}), (e) => e.status === 401 && !e.keep);
    assert.strictEqual(t.saved, null);
    ok("服务器说登录已经无效：退出登录");
  }
  // 4. 时钟不准：过期时间按本机时间 + 有效秒数算
  {
    const t = mk((url) => ({ status: 200, body: { access_token: "A3", refresh_token: "R3", expires_in: 3600, expires_at: 1 } }));
    const s = await t.api.signIn("hang", "12345678");
    assert.ok(Math.abs(s.expires_at - (Date.now() / 1000 + 3600)) < 5);
    ok("电脑时钟不准也不会拿着过期令牌去请求");
  }
  // 5. 快过期了提前换；换令牌的线路卡住：6 秒就换另一条，用同一个旧令牌在服务器允许的 10 秒内重试
  {
    const t = mk((url, opts, i) => {
      if (url.includes("refresh_token")) return url.startsWith("https://a.") ? "hang" : { status: 200, body: { access_token: "A4", refresh_token: "R4", expires_in: 3600 } };
      return { status: 200, body: [] };
    });
    t.store.save({ ...t.store.load(), expires_at: Math.floor(Date.now() / 1000) + 120 });
    const t0 = Date.now();
    await t.api.rpc("x", {});
    const dt = Date.now() - t0;
    assert.strictEqual(t.saved.access_token, "A4");
    assert.ok(dt < 7500, "换令牌太慢 " + dt);
    ok(`线路卡住时 ${Math.round(dt / 100) / 10} 秒内换另一条线路拿到新令牌`);
  }
  console.log("登录保持：全部通过");
})().catch((e) => { console.error("✗", e); process.exit(1); });
