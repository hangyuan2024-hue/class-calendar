package com.laolao.classcalendar;

import android.content.Context;
import java.io.*;
import java.net.*;
import org.json.*;

/** Real native HTTP client for the same auth, PostgREST, and RPC endpoints as auth.js. */
final class CampusApi {
  static class Failure extends IOException {
    final int status;

    Failure(int status, String message) {
      super(message);
      this.status = status;
    }
  }

  final Context context;
  final String base, anon, domain;
  private JSONObject session;

  CampusApi(Context c) {
    context = c.getApplicationContext();
    try (InputStream in = context.getResources().openRawResource(R.raw.campus_config)) {
      JSONObject cfg = new JSONObject(read(in, 100000));
      base = cfg.getString("base");
      anon = cfg.getString("anon");
      domain = cfg.getString("accountDomain");
      String s = CampusSecret.read(context);
      session = s == null ? null : new JSONObject(s);
    } catch (Exception e) {
      throw new IllegalStateException("无法读取连接配置或设备登录信息", e);
    }
  }

  synchronized boolean logged() {
    return session != null && session.has("access_token");
  }

  synchronized String uid() {
    return session == null
        ? "guest"
        : session.optJSONObject("user") == null
            ? session.optString("user_id", "guest")
            : session.optJSONObject("user").optString("id", "guest");
  }

  private synchronized void keep(JSONObject s) throws Exception {
    CampusJson.put(
        s,
        "expires_at",
        s.optLong("expires_at", System.currentTimeMillis() / 1000 + s.optLong("expires_in", 3600)));
    CampusSecret.write(context, s.toString());
    session = s;
  }

  private synchronized String token() throws Exception {
    if (!logged()) return anon;
    if (session.optLong("expires_at") < System.currentTimeMillis() / 1000 + 60) {
      try {
        keep(
            (JSONObject)
                request(
                    "/auth/v1/token?grant_type=refresh_token",
                    "POST",
                    CampusJson.obj("refresh_token", session.optString("refresh_token")),
                    anon,
                    null));
      } catch (Failure e) {
        if (e.status == 400 || e.status == 401) {
          CampusSecret.write(context, null);
          session = null;
          throw new Failure(401, "登录已过期，请重新登录");
        }
        throw e;
      }
    }
    return session.optString("access_token", anon);
  }

  JSONObject login(String account, String password) throws Exception {
    account = account.trim().toLowerCase(java.util.Locale.ROOT);
    if (!account.matches("[a-z0-9_]{3,20}"))
      throw new IllegalArgumentException("账号需为3—20位小写字母、数字或下划线");
    JSONObject s =
        (JSONObject)
            request(
                "/auth/v1/token?grant_type=password",
                "POST",
                CampusJson.obj("email", account + "@" + domain, "password", password),
                anon,
                null);
    keep(s);
    return s;
  }

  void register(String account, String password, String name, String role, String gender)
      throws Exception {
    account = account.trim().toLowerCase(java.util.Locale.ROOT);
    if (!account.matches("[a-z0-9_]{3,20}") || password.length() < 8 || name.trim().isEmpty())
      throw new IllegalArgumentException("请填写有效账号、姓名和至少8位密码");
    Object s =
        request(
            "/auth/v1/signup",
            "POST",
            CampusJson.obj(
                "email",
                account + "@" + domain,
                "password",
                password,
                "data",
                CampusJson.obj(
                    "name",
                    name,
                    "role",
                    role.equals("teacher") ? "teacher" : "student",
                    "gender",
                    gender)),
            anon,
            null);
    if (s instanceof JSONObject && ((JSONObject) s).has("access_token")) keep((JSONObject) s);
    else login(account, password);
  }

  void logout() throws Exception {
    try {
      if (logged()) request("/auth/v1/logout?scope=local", "POST", CampusJson.obj(), token(), null);
    } finally {
      CampusSecret.write(context, null);
      session = null;
    }
  }

  Object rpc(String name, JSONObject args) throws Exception {
    return rest("rpc/" + name, "POST", args);
  }

  Object rest(String path) throws Exception {
    return rest(path, "GET", null);
  }

  Object rest(String path, String method, Object body) throws Exception {
    return request("/rest/v1/" + path, method, body, token(), "return=representation");
  }

  private Object request(String path, String method, Object body, String token, String prefer)
      throws Exception {
    HttpURLConnection connection = (HttpURLConnection) new URL(base + path).openConnection();
    connection.setConnectTimeout(15000);
    connection.setReadTimeout(20000);
    connection.setRequestMethod(method);
    connection.setInstanceFollowRedirects(false);
    connection.setRequestProperty("apikey", anon);
    connection.setRequestProperty("Authorization", "Bearer " + token);
    connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
    if (prefer != null) connection.setRequestProperty("Prefer", prefer);
    try {
      if (body != null) {
        connection.setDoOutput(true);
        try (OutputStream out = connection.getOutputStream()) {
          out.write(body.toString().getBytes("UTF-8"));
        }
      }
      int status = connection.getResponseCode();
      InputStream stream = status < 400 ? connection.getInputStream() : connection.getErrorStream();
      String text = stream == null ? "" : read(stream, 16000000);
      Object parsed = null;
      try {
        if (!text.isEmpty()) parsed = new JSONTokener(text).nextValue();
      } catch (Exception ignored) {
      }
      if (status >= 300) {
        JSONObject e = CampusJson.object(parsed);
        String message =
            e.optString(
                "msg",
                e.optString(
                    "error_description", e.optString("message", e.optString("error", "请求失败"))));
        if (status == 503 || status == 502 || status == 504)
          message = "校园云服务暂时不可用（" + status + "），本地记录仍然保留";
        else if (status == 429) message = "请求较多，请稍后重试";
        else if (message.toLowerCase(java.util.Locale.ROOT).contains("invalid login"))
          message = "账号或密码错误";
        else if (status == 403) message = "当前账号没有此操作权限";
        throw new Failure(status, message);
      }
      return parsed;
    } catch (java.net.SocketTimeoutException e) {
      throw new IOException("连接超时，请稍后重试；本地记录已保留");
    } finally {
      connection.disconnect();
    }
  }

  static String read(InputStream stream, int max) throws IOException {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    try (InputStream in = stream) {
      byte[] b = new byte[8192];
      int n;
      while ((n = in.read(b)) != -1) {
        if (out.size() + n > max) throw new IOException("文件或响应过大");
        out.write(b, 0, n);
      }
    }
    return out.toString("UTF-8");
  }
}
