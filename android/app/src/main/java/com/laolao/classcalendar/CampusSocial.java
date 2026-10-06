package com.laolao.classcalendar;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.net.*;
import java.util.*;
import java.util.regex.*;
import org.json.*;

/** Native wall, comments, member profiles and campus query/message processing. */
final class CampusSocial {
  static boolean handles(String p) {
    return Arrays.asList("wall", "people", "user", "ask", "parse-review").contains(p);
  }

  static void render(CampusActivity a, String p) {
    switch (p) {
      case "wall":
        wall(a);
        break;
      case "people":
        people(a);
        break;
      case "user":
        user(a);
        break;
      case "ask":
        ask(a);
        break;
      case "parse-review":
        review(a);
        break;
    }
  }

  static boolean moderator(CampusActivity a) {
    return a.teacher() || a.monitor() || a.staff();
  }

  static void loadWall(CampusActivity a) {
    if (!a.needClass()) return;
    String cid = a.cid();
    a.background(
        "刷新班级墙",
        () -> {
          Object posts =
              a.api.rest(
                  "wall_posts?select=id,class_id,group_id,author_id,author_name,author_role,title,body,is_notice,pinned_at,hidden,report_count,reviewed,created_at,edited_at&class_id=eq."
                      + CampusJson.enc(cid)
                      + "&order=created_at.desc&limit=300");
          Object comments = a.api.rpc("wall_comments_get", CampusJson.obj("cid", cid));
          Object reported = a.api.rpc("wall_my_reports", CampusJson.obj("cid", cid));
          return CampusJson.obj("posts", posts, "comments", comments, "reported", reported);
        },
        r -> {
          if (!a.cid().equals(cid)) return;
          JSONObject data = CampusJson.object(r);
          a.store.set("cache_wall", data.opt("posts"));
          a.store.set("cache_comments", data.opt("comments"));
          a.store.set("cache_my_reports", data.opt("reported"));
          a.store.set("cache_wall_class", cid);
          a.build();
        });
  }

  static void wall(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "班级墙", "一条通知，一段讨论，都有同学回应。");
    if (!a.api.logged() || a.cid().isEmpty()) {
      u.empty(a.content, "先连接你的班级", "登录并加入班级后，查看通知与交流。 ");
      a.content.addView(u.button("登录与班级管理", () -> a.open("class"), true));
      return;
    }
    u.actionRow(
        a.content,
        new String[] {"＋ 发布消息", "刷新消息"},
        new Runnable[] {() -> post(a, null), () -> loadWall(a)});
    String channel = a.store.string("native_wall_channel", "全部"),
        query = a.store.string("native_wall_query", "");
    u.actionRow(
        a.content,
        new String[] {channel + " ▾", "搜索消息"},
        new Runnable[] {
          () -> {
            List<String> names = new ArrayList<>(Arrays.asList("全部", "通知", "全班"));
            for (JSONObject g : CampusJson.rows(a.store.list("cache_groups")))
              names.add(g.optString("name"));
            u.choose(
                "消息范围",
                names.toArray(new String[0]),
                i -> {
                  a.store.set("native_wall_channel", names.get(i));
                  a.build();
                });
          },
          () ->
              u.form(
                  "搜索班级墙",
                  CampusJson.obj("query", query),
                  v -> {
                    a.store.set("native_wall_query", v.optString("query"));
                    a.build();
                  },
                  CampusUi.optional("query", "关键词（留空清除）"))
        });
    if (moderator(a))
      a.content.addView(
          u.button(
              "举报审核",
              () ->
                  a.rpc(
                      "wall_report_list",
                      CampusJson.obj("cid", a.cid()),
                      r -> CampusManage.records(a, "举报记录", r)),
              false));
    List<JSONObject> posts = CampusJson.rows(a.store.list("cache_wall"));
    posts.sort(
        (x, y) -> {
          boolean p = !x.isNull("pinned_at") && !x.optString("pinned_at").isEmpty(),
              q = !y.isNull("pinned_at") && !y.optString("pinned_at").isEmpty();
          return p == q
              ? y.optString("created_at").compareTo(x.optString("created_at"))
              : p ? -1 : 1;
        });
    int count = 0;
    for (JSONObject x : posts) {
      if (x.optBoolean("hidden") && !moderator(a) && !x.optString("author_id").equals(a.api.uid()))
        continue;
      if (!query.isEmpty()
          && !(x.optString("title") + x.optString("body") + x.optString("author_name"))
              .contains(query)) continue;
      if (channel.equals("通知") && !x.optBoolean("is_notice")) continue;
      if (channel.equals("全班") && !x.isNull("group_id") && !x.optString("group_id").isEmpty())
        continue;
      if (!Arrays.asList("全部", "通知", "全班").contains(channel)) {
        boolean match = false;
        for (JSONObject g : CampusJson.rows(a.store.list("cache_groups")))
          if (g.optString("name").equals(channel)
              && g.optString("id").equals(x.optString("group_id"))) match = true;
        if (!match) continue;
      }
      count++;
      LinearLayout c = u.card(a.content);
      TextView author =
          u.text(
              x.optString("author_name")
                  + " · "
                  + CampusActivity.roleName(x.optString("author_role")),
              12,
              u.accent,
              true);
      author.setOnClickListener(v -> loadUser(a, x.optString("author_id")));
      c.addView(author);
      u.gap(c, 10);
      if (x.optBoolean("is_notice")) c.addView(u.pill("班级通知"));
      if (x.optBoolean("hidden")) c.addView(u.pill("已隐藏"));
      if (!x.optString("title").isEmpty()) {
        u.gap(c, 9);
        c.addView(u.text(x.optString("title"), 18, u.ink, true));
      }
      u.gap(c, 7);
      c.addView(u.text(x.optString("body"), 14, u.ink, false));
      u.gap(c, 9);
      c.addView(
          u.text(
              x.optString("created_at")
                  .replace('T', ' ')
                  .substring(0, Math.min(16, x.optString("created_at").length())),
              11,
              u.muted,
              false));
      u.gap(c, 14);
      u.actionRow(
          c,
          new String[] {"评论 / 回复", "更多操作"},
          new Runnable[] {() -> comments(a, x), () -> postMore(a, x)});
    }
    if (count == 0) u.empty(a.content, "还没有可见消息", "点击刷新读取原来的班级墙，或发布第一条消息。");
  }

  static void post(CampusActivity a, JSONObject x) {
    if (!a.needClass()) return;
    JSONObject init =
        x == null ? CampusJson.obj("group", "全班", "is_notice", false) : CampusJson.copy(x);
    List<String> names = new ArrayList<>();
    names.add("全班");
    List<JSONObject> groups = CampusJson.rows(a.store.list("cache_groups"));
    for (JSONObject g : groups)
      if (g.optBoolean("mine") || moderator(a)) names.add(g.optString("name"));
    a.ui.form(
        x == null ? "发布班级消息" : "编辑班级消息",
        init,
        v -> {
          if (v.optString("body").length() > 4000) throw new IllegalArgumentException("正文最多4000字");
          JSONObject args =
              CampusJson.obj("p_title", v.optString("title"), "p_body", v.optString("body"));
          a.store.set("draft_wall_post", v);
          String rpc = x == null ? "wall_post" : "wall_edit";
          if (x == null) {
            CampusJson.put(args, "cid", a.cid());
            CampusJson.put(args, "p_notice", v.optBoolean("is_notice") && moderator(a));
            for (JSONObject g : groups)
              if (g.optString("name").equals(v.optString("group"))) {
                CampusJson.put(args, "gid", CampusJson.numericId(g.optString("id")));
                rpc = "wall_post_group";
              }
          } else CampusJson.put(args, "pid", CampusJson.numericId(x.optString("id")));
          a.rpc(
              rpc,
              args,
              r -> {
                a.store.set("draft_wall_post", new JSONObject());
                loadWall(a);
              });
        },
        CampusUi.optional("title", "标题"),
        CampusUi.f("body", "正文", "multiline"),
        CampusUi.choice("group", "发送范围", names.toArray(new String[0])),
        CampusUi.f("is_notice", "作为班级通知（老师 / 班委）", "boolean"));
  }

  static void postMore(CampusActivity a, JSONObject x) {
    List<String> opts = new ArrayList<>(Arrays.asList("查看作者主页", "举报消息"));
    boolean own = x.optString("author_id").equals(a.api.uid());
    if (own) opts.add("编辑消息");
    if (own || moderator(a)) opts.add("删除消息");
    if (moderator(a)) {
      opts.add(x.isNull("pinned_at") || x.optString("pinned_at").isEmpty() ? "置顶消息" : "取消置顶");
      opts.add(x.optBoolean("hidden") ? "恢复显示" : "隐藏消息");
      opts.add("驳回举报");
    }
    a.ui.choose(
        "消息操作",
        opts.toArray(new String[0]),
        i -> {
          String op = opts.get(i);
          Object pid = CampusJson.numericId(x.optString("id"));
          switch (op) {
            case "查看作者主页":
              loadUser(a, x.optString("author_id"));
              break;
            case "举报消息":
              a.ui.form(
                  "举报原因",
                  new JSONObject(),
                  v ->
                      a.rpc(
                          "wall_report",
                          CampusJson.obj("pid", pid, "p_reason", v.optString("reason")),
                          r -> a.toast("举报已提交")),
                  CampusUi.f("reason", "原因", "multiline"));
              break;
            case "编辑消息":
              post(a, x);
              break;
            case "删除消息":
              a.ui.confirm(
                  "删除消息？",
                  "这条消息及相关交流将不再可见。",
                  () -> a.rpc("wall_delete", CampusJson.obj("pid", pid), r -> loadWall(a)));
              break;
            case "置顶消息":
            case "取消置顶":
              a.rpc(
                  "wall_pin",
                  CampusJson.obj("pid", pid, "on_top", op.equals("置顶消息")),
                  r -> loadWall(a));
              break;
            default:
              a.rpc(
                  "wall_moderate",
                  CampusJson.obj(
                      "pid",
                      pid,
                      "action",
                      op.equals("恢复显示") ? "unhide" : op.equals("驳回举报") ? "dismiss" : "hide"),
                  r -> loadWall(a));
          }
        });
  }

  static void comments(CampusActivity a, JSONObject post) {
    List<JSONObject> cs = new ArrayList<>();
    for (JSONObject c : CampusJson.rows(a.store.list("cache_comments")))
      if (c.optString("post_id").equals(post.optString("id"))) cs.add(c);
    List<String> options = new ArrayList<>();
    for (JSONObject c : cs)
      options.add(
          c.optString("author_name")
              + (c.optString("reply_name").isEmpty() ? "" : " 回复 " + c.optString("reply_name"))
              + "："
              + c.optString("body"));
    options.add("＋ 写评论");
    a.ui.choose(
        "评论 · " + post.optString("title", "消息"),
        options.toArray(new String[0]),
        i -> {
          if (i == cs.size()) {
            comment(a, post, null);
            return;
          }
          JSONObject c = cs.get(i);
          List<String> ops = new ArrayList<>(Arrays.asList("回复", "作者主页"));
          if (c.optString("author_id").equals(a.api.uid())
              || post.optString("author_id").equals(a.api.uid())
              || moderator(a)) ops.add("删除评论");
          a.ui.choose(
              c.optString("body"),
              ops.toArray(new String[0]),
              j -> {
                if (j == 0) comment(a, post, c.optString("author_name"));
                else if (j == 1) loadUser(a, c.optString("author_id"));
                else
                  a.ui.confirm(
                      "删除评论？",
                      c.optString("body"),
                      () ->
                          a.rpc(
                              "wall_comment_delete",
                              CampusJson.obj("cmid", CampusJson.numericId(c.optString("id"))),
                              r -> loadWall(a)));
              });
        });
  }

  static void comment(CampusActivity a, JSONObject p, String reply) {
    a.ui.form(
        reply == null ? "写评论" : "回复 " + reply,
        new JSONObject(),
        v -> {
          String body = v.optString("body");
          if (body.length() > 500) throw new IllegalArgumentException("评论最多500字");
          a.rpc(
              "wall_comment_add",
              CampusJson.obj(
                  "pid",
                  CampusJson.numericId(p.optString("id")),
                  "p_body",
                  body,
                  "p_reply",
                  CampusJson.nullable(reply == null ? "" : reply)),
              r -> loadWall(a));
        },
        CampusUi.f("body", "评论内容", "multiline"));
  }

  static void people(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "班级成员", "从一张名片，认识一起学习的人。");
    if (!a.api.logged() || a.cid().isEmpty()) {
      a.content.addView(u.button("登录并加入班级", () -> a.open("class"), true));
      return;
    }
    u.actionRow(
        a.content,
        new String[] {"刷新成员", "搜索成员"},
        new Runnable[] {
          () -> {
            String cid = a.cid();
            a.rpc(
                "class_people",
                CampusJson.obj("cid", cid),
                r -> {
                  if (!cid.equals(a.cid())) return;
                  a.store.set("cache_people", r);
                  a.build();
                });
          },
          () ->
              u.form(
                  "搜索成员",
                  CampusJson.obj("query", a.store.string("native_people_query", "")),
                  v -> {
                    a.store.set("native_people_query", v.optString("query"));
                    a.build();
                  },
                  CampusUi.optional("query", "姓名或简介"))
        });
    JSONObject data = a.store.object("cache_people");
    String q = a.store.string("native_people_query", "");
    List<JSONObject> rows = CampusJson.rows(data.opt("people"));
    for (JSONObject p : rows) {
      if (!q.isEmpty() && !(p.optString("name") + p.optString("bio")).contains(q)) continue;
      LinearLayout c = u.card(a.content);
      c.addView(u.pill(CampusActivity.roleName(p.optString("role"))));
      u.gap(c, 10);
      c.addView(u.text(p.optString("name"), 20, u.ink, true));
      u.gap(c, 8);
      c.addView(u.text(p.optString("bio", "同学的校园主页"), 13, u.muted, false));
      c.setOnClickListener(v -> loadUser(a, p.optString("id")));
    }
    if (rows.isEmpty()) u.empty(a.content, "成员列表尚未读取", "点击刷新，按网站权限显示可见的成员。");
    if (data.has("full") && !data.optBoolean("full"))
      a.content.addView(u.text("当前权限只显示部分成员。老师可在成员管理中开放名单权限。", 12, u.muted, false));
  }

  static void editProfile(CampusActivity a) {
    if (!a.requireLogin()) return;
    JSONObject init = CampusJson.copy(a.me);
    CampusJson.put(
        init,
        "genderLabel",
        a.me.optString("gender").equals("m")
            ? "男"
            : a.me.optString("gender").equals("f") ? "女" : "保密");
    a.ui.form(
        "编辑校园主页",
        init,
        v -> {
          String cover = v.optString("cover");
          if (v.optString("bio").length() > 60) throw new IllegalArgumentException("个人简介最多60字");
          JSONObject args =
              CampusJson.obj(
                  "p_gender",
                  v.optString("genderLabel").equals("男")
                      ? "m"
                      : v.optString("genderLabel").equals("女") ? "f" : "x",
                  "p_bio",
                  v.optString("bio"));
          if (!cover.isEmpty()) CampusJson.put(args, "p_cover", cover);
          a.rpc(
              "profile_update",
              args,
              r -> {
                JSONObject data = CampusJson.object(r);
                for (String key : CampusJson.keys(data)) CampusJson.put(a.me, key, data.opt(key));
                a.store.set("cache_me", a.me);
                if (a.page.equals("user")) loadUser(a, a.api.uid());
                else a.build();
              });
        },
        CampusUi.choice("genderLabel", "性别显示", "保密", "男", "女"),
        new CampusUi.Field("bio", "个人简介", "multiline", false),
        CampusUi.choice(
            "cover", "主页封面", "sky", "sakura", "ocean", "sunset", "forest", "galaxy", "peach",
            "mono"));
  }

  static void loadUser(CampusActivity a, String uid) {
    if (uid.isEmpty()) return;
    a.rpc(
        "user_page",
        CampusJson.obj("uid", uid, "cid", CampusJson.nullable(a.cid())),
        r -> {
          a.store.set("cache_user_page", r);
          a.open("user");
        });
  }

  static void user(CampusActivity a) {
    CampusUi u = a.ui;
    JSONObject data = a.store.object("cache_user_page"), p = data.optJSONObject("profile");
    if (p == null) p = data.optJSONObject("user");
    if (p == null) p = data;
    final JSONObject person = p;
    u.title(
        a.content,
        p.optString("name", p.optString("display_name", "校园主页")),
        p.optString("bio", "记录、交流、成长。"));
    LinearLayout c = u.card(a.content);
    String cover = p.optString("cover", p.optString("gender").equals("f") ? "sakura" : "sky");
    String[] colors;
    switch (cover) {
      case "sakura":
        colors = new String[] {"#FFD1DC", "#FF5F8F"};
        break;
      case "ocean":
        colors = new String[] {"#5EE7DF", "#1D4FB8"};
        break;
      case "sunset":
        colors = new String[] {"#FFD27A", "#E8487A"};
        break;
      case "forest":
        colors = new String[] {"#C6F1A8", "#1F8A6E"};
        break;
      case "galaxy":
        colors = new String[] {"#A18CFF", "#1D1660"};
        break;
      case "peach":
        colors = new String[] {"#FFE3C2", "#FF7A8A"};
        break;
      case "mono":
        colors = new String[] {"#F3F5F9", "#D9DEE8"};
        break;
      default:
        colors = new String[] {"#7CC8FF", "#6A5CFF"};
    }
    TextView banner =
        u.text(
            p.optString("name", "校园主页"),
            26,
            cover.equals("mono") ? u.ink : android.graphics.Color.WHITE,
            true);
    banner.setPadding(u.dp(20), u.dp(28), u.dp(20), u.dp(28));
    android.graphics.drawable.GradientDrawable gradient =
        new android.graphics.drawable.GradientDrawable(
            android.graphics.drawable.GradientDrawable.Orientation.TL_BR,
            new int[] {CampusUi.color(colors[0]), CampusUi.color(colors[1])});
    gradient.setCornerRadius(u.dp(16));
    banner.setBackground(gradient);
    c.addView(banner);
    u.gap(c, 14);
    String role = data.optString("class_role", p.optString("role"));
    c.addView(u.text(CampusActivity.roleName(role), 16, u.accent, true));
    u.gap(c, 10);
    c.addView(
        u.text(data.optString("class_name", a.currentClass.optString("name")), 13, u.muted, false));
    if (!p.optString("account").isEmpty())
      c.addView(u.text("@" + p.optString("account"), 12, u.muted, false));
    if (!p.optString("joined").isEmpty())
      c.addView(
          u.text("加入于 " + CampusCourses.limit(p.optString("joined"), 10), 12, u.muted, false));
    if (data.optBoolean("me")) {
      u.gap(c, 12);
      c.addView(u.button("编辑资料与封面", () -> editProfile(a), false));
    }
    a.content.addView(u.button("刷新主页", () -> loadUser(a, person.optString("id")), false));
    if (!role.equals("teacher")) {
      boolean show = data.optBoolean("show_points");
      LinearLayout stats = u.card(a.content);
      u.metric(
          stats, "本周成长值", data.isNull("week_points") ? "—" : data.optString("week_points", "—"));
      u.metric(
          stats, "累计成长值", data.isNull("total_points") ? "—" : data.optString("total_points", "—"));
      u.metric(stats, "连续活跃天", show ? String.valueOf(data.optInt("streak")) : "—");
      u.metric(
          stats, "发言与评论", String.valueOf(data.optInt("post_count") + data.optInt("comment_count")));
      if (show) {
        u.section(a.content, "最近16周的成长足迹");
        LinearLayout growth = u.card(a.content);
        growth.addView(
            u.text(
                "完成 "
                    + data.optInt("done")
                    + " 件事 · 打卡 "
                    + data.optInt("habits")
                    + " 次 · 专注 "
                    + data.optInt("pomos")
                    + " 个番茄",
                12,
                u.muted,
                false));
        JSONObject days = data.optJSONObject("days");
        if (days != null) {
          u.gap(growth, 14);
          growth.addView(
              new CampusLearn.Heat(a, days, 16), new LinearLayout.LayoutParams(-1, u.dp(105)));
        }
      } else u.empty(a.content, "成长记录未公开", "本人和有权限的老师可以查看。");
    }
    u.section(a.content, "班级墙 · " + data.optInt("post_count") + " 条发言");
    List<JSONObject> posts = CampusJson.rows(data.opt("posts"));
    for (JSONObject post : posts) {
      LinearLayout card = u.card(a.content);
      if (post.optBoolean("is_notice")) card.addView(u.pill("班级通知"));
      if (!post.optString("title").isEmpty())
        card.addView(u.text(post.optString("title"), 17, u.ink, true));
      u.gap(card, 7);
      card.addView(u.text(post.optString("body"), 14, u.ink, false));
      u.gap(card, 10);
      card.addView(
          u.text(
              CampusCourses.limit(post.optString("created_at").replace('T', ' '), 16)
                  + " · "
                  + post.optInt("comments")
                  + " 条评论",
              11,
              u.muted,
              false));
      u.gap(card, 12);
      card.addView(
          u.button(
              "查看评论与回复",
              () ->
                  a.rpc(
                      "wall_comments_get",
                      CampusJson.obj("cid", CampusJson.nullable(a.cid())),
                      r -> {
                        a.store.set("cache_comments", r);
                        comments(a, post);
                      }),
              false));
    }
    if (posts.isEmpty()) u.empty(a.content, "还没有发言", "在班级墙分享第一条消息。");
    if (data.optBoolean("can_reset")) {
      final JSONObject user = p;
      a.content.addView(
          u.button(
              "为此成员重置密码",
              () ->
                  u.confirm(
                      "重置成员密码？",
                      "服务器将返回临时密码，请通过合适方式交给成员。",
                      () ->
                          a.rpc(
                              "pw_reset_by_staff",
                              CampusJson.obj("uid", user.optString("id")),
                              r -> CampusManage.message(a, "临时密码", String.valueOf(r)))),
              false));
    }
  }

  static void ask(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "捞捞助手", "查询你的安排，也可以整理班群中的重要消息。");
    u.section(a.content, "从校园数据中找答案");
    u.actionRow(
        a.content,
        new String[] {"今天的课程", "待完成的作业"},
        new Runnable[] {() -> answer(a, "今天课程"), () -> answer(a, "待完成作业")});
    u.actionRow(
        a.content,
        new String[] {"接下来的安排", "我的成长"},
        new Runnable[] {() -> answer(a, "接下来"), () -> answer(a, "成长")});
    a.content.addView(
        u.button(
            "输入我的问题",
            () ->
                u.form(
                    "问捞捞",
                    new JSONObject(),
                    v -> answer(a, v.optString("question")),
                    CampusUi.f("question", "问题", "multiline")),
            true));
    u.gap(a.content, 10);
    a.content.addView(u.button("连接我自己的 AI 服务", () -> aiSettings(a), false));
    u.section(a.content, "班群消息整理");
    a.content.addView(u.button("粘贴消息，核对后再保存", () -> pasteImport(a), false));
    if (a.can("can_ingest") && !a.cid().isEmpty()) {
      u.gap(a.content, 10);
      a.content.addView(
          u.button(
              "云端 AI 直接整理到班级",
              () ->
                  u.form(
                      "云端整理班群消息",
                      CampusJson.obj("date", DateMath.today()),
                      v -> {
                        a.ui.confirm(
                            "交给云端整理并发布？",
                            "消息将发送至原网站的整理服务，成功后直接加入班级事项。",
                            () ->
                                a.rpc(
                                    "ingest_class_messages",
                                    CampusJson.obj(
                                        "cid",
                                        a.cid(),
                                        "msg",
                                        v.optString("text"),
                                        "pub_date",
                                        v.optString("date")),
                                    r -> {
                                      String jid = CampusJson.object(r).optString("job_id");
                                      a.store.set("native_ingest_job", jid);
                                      pollIngest(a, jid);
                                    }));
                      },
                      CampusUi.f("text", "班群消息", "multiline"),
                      CampusUi.f("date", "发布日期", "date")),
              false));
      u.gap(a.content, 10);
      a.content.addView(u.button("纠正与学习记录", () -> feedback(a), false));
    }
    String jid = a.store.string("native_ingest_job", "");
    if (!jid.isEmpty()) {
      u.gap(a.content, 10);
      a.content.addView(u.button("查看上次整理任务", () -> pollIngest(a, jid), false));
    }
  }

  /** One native message-import flow shared by the calendar, guide and assistant. */
  static void pasteImport(CampusActivity a) {
    pasteImport(a, true);
  }

  private static void pasteImport(CampusActivity a, boolean readClipboard) {
    JSONObject initial = CampusJson.copy(a.store.object("draft_ingest"));
    if (initial.optString("date").isEmpty()) CampusJson.put(initial, "date", DateMath.today());
    // Clipboard access happens only after an explicit import tap. Reviewing/editing retains drafts.
    if (readClipboard) {
      ClipboardManager clipboard = (ClipboardManager) a.getSystemService(Context.CLIPBOARD_SERVICE);
      if (clipboard != null && clipboard.hasPrimaryClip()) {
        ClipData clip = clipboard.getPrimaryClip();
        CharSequence text =
            clip != null && clip.getItemCount() > 0 ? clip.getItemAt(0).getText() : null;
        if (text != null && !text.toString().trim().isEmpty()) {
          String pasted = text.toString();
          if (!pasted.equals(initial.optString("text")))
            CampusJson.put(initial, "date", DateMath.today());
          CampusJson.put(initial, "text", pasted);
        }
      }
    }
    a.ui.formAction(
        "粘贴导入班群消息",
        "整理并核对",
        initial,
        v -> {
          DateMath.parse(v.optString("date"));
          JSONArray parsed = parse(a, v.optString("text"), v.optString("date"));
          if (parsed.length() == 0) throw new IllegalArgumentException("请粘贴至少一条班群消息");
          a.store.set("draft_ingest", v);
          a.store.set("draft_parsed", parsed);
          a.open("parse-review");
        },
        CampusUi.f("text", "班群消息（每条独立一行，可直接粘贴）", "multiline"),
        CampusUi.f("date", "消息发布日期（用来判断今天、明天）", "date"));
  }

  static void answer(CampusActivity a, String q) {
    StringBuilder b = new StringBuilder();
    String day = q.contains("明天") ? DateMath.plus(DateMath.today(), 1) : DateMath.today();
    if (q.contains("课")) {
      for (JSONObject x : CampusCourses.onDay(a.store, day))
        b.append(x.optString("t0"))
            .append(" ")
            .append(x.optString("name"))
            .append(" · ")
            .append(x.optString("location"))
            .append('\n');
      if (b.length() == 0) b.append(day).append(" 没有记录的课程。请确认课表周次和学期设置。");
    } else if (q.contains("成长") || q.contains("打卡"))
      b.append("已完成事项 ")
          .append(a.store.object("done_log_v1").length())
          .append(" 项，今天习惯打卡 ")
          .append(CampusLearn.habitToday(a.store))
          .append(" 次。");
    else if (q.contains("作业") || q.contains("安排") || q.contains("接下来") || q.contains("待办")) {
      List<JSONObject> rows = a.items();
      rows.sort(Comparator.comparing(x -> x.optString("event_time", "9999")));
      for (JSONObject x : rows)
        if (!a.done(x)
            && !CampusSchool.hidden(a, x)
            && (!q.contains("作业") || x.optString("msg_type").equals("作业")))
          b.append("• ")
              .append(x.optString("subject"))
              .append(" · ")
              .append(x.optString("event_time", "时间待确认"))
              .append('\n');
      if (b.length() == 0) b.append("目前没有待完成的相关事项。");
    } else if (!a.store.object("native_ai_config").optString("url").isEmpty()) {
      remoteAnswer(a, q);
      return;
    } else b.append("我可以查询今天或明天的课程、待完成作业、接下来安排和成长情况。更开放的问题可以连接你自己的 AI 服务。");
    CampusManage.message(a, "捞捞 · " + day, b.toString());
  }

  static void aiSettings(CampusActivity a) {
    a.ui.form(
        "我的 AI 服务",
        a.store.object("native_ai_config"),
        v -> {
          URI uri = new URI(v.optString("url"));
          String host = uri.getHost();
          boolean local =
              host != null
                  && (host.equals("localhost")
                      || host.equals("127.0.0.1")
                      || host.matches("10\\.\\d+\\.\\d+\\.\\d+")
                      || host.matches("192\\.168\\.\\d+\\.\\d+")
                      || host.matches("172\\.(1[6-9]|2\\d|3[01])\\.\\d+\\.\\d+"));
          if (!"https".equals(uri.getScheme()) && !("http".equals(uri.getScheme()) && local))
            throw new IllegalArgumentException("填写HTTPS地址，或你局域网中的HTTP服务地址");
          if (uri.getUserInfo() != null || uri.getFragment() != null)
            throw new IllegalArgumentException("地址中不能含账号密码或片段");
          a.store.set("native_ai_config", v);
          a.toast("设置已保存，下一次开放问题会发送至该服务");
        },
        CampusUi.f("url", "OpenAI兼容服务地址（含/v1）"),
        CampusUi.f("model", "模型名称"));
  }

  static void remoteAnswer(CampusActivity a, String q) {
    JSONObject cfg = a.store.object("native_ai_config");
    a.ui.confirm(
        "发送问题给我的 AI？",
        "会附带今天课程与待办摘要，发送至你设置的服务。",
        () ->
            a.background(
                "等待 AI 回复",
                () -> {
                  StringBuilder context = new StringBuilder("你是校园学习助手。只依据给出的校园数据回答相关安排，不编造。\n");
                  for (JSONObject x : a.items())
                    if (!a.done(x))
                      context
                          .append(x.optString("subject"))
                          .append(' ')
                          .append(x.optString("event_time"))
                          .append('\n');
                  for (JSONObject x : CampusCourses.onDay(a.store, DateMath.today()))
                    context
                        .append(x.optString("name"))
                        .append(' ')
                        .append(x.optString("t0"))
                        .append('\n');
                  URL url =
                      new URL(cfg.optString("url").replaceAll("/+$", "") + "/chat/completions");
                  HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                  conn.setInstanceFollowRedirects(false);
                  conn.setConnectTimeout(15000);
                  conn.setReadTimeout(45000);
                  conn.setRequestMethod("POST");
                  conn.setDoOutput(true);
                  conn.setRequestProperty("Content-Type", "application/json");
                  byte[] raw =
                      CampusJson.obj(
                              "model",
                              cfg.optString("model"),
                              "stream",
                              false,
                              "messages",
                              new JSONArray()
                                  .put(
                                      CampusJson.obj(
                                          "role", "system", "content", context.toString()))
                                  .put(CampusJson.obj("role", "user", "content", q)))
                          .toString()
                          .getBytes("UTF-8");
                  try {
                    try (OutputStream out = conn.getOutputStream()) {
                      out.write(raw);
                    }
                    if (conn.getResponseCode() != 200)
                      throw new IOException("AI服务返回HTTP " + conn.getResponseCode());
                    JSONObject response =
                        new JSONObject(CampusApi.read(conn.getInputStream(), 1000000));
                    JSONObject msg =
                        response.getJSONArray("choices").getJSONObject(0).getJSONObject("message");
                    return msg.optString("content");
                  } finally {
                    conn.disconnect();
                  }
                },
                r -> CampusManage.message(a, "我的 AI 回复", String.valueOf(r))));
  }

  static JSONArray parse(CampusActivity a, String text, String pub) {
    JSONArray out = new JSONArray();
    Set<String> seen = new HashSet<>();
    for (String raw : text.split("\n+")) {
      String line = raw.trim();
      if (line.isEmpty() || !seen.add(line)) continue;
      String type =
          line.matches(".*(作业|提交|习题|练习|截止).* ".trim())
              ? "作业"
              : line.matches(".*(考试|测验).* ".trim())
                  ? "考试"
                  : line.matches(".*(比赛|讲座|活动|报名).* ".trim()) ? "活动" : "通知";
      String date = "";
      if (line.contains("明天")) date = DateMath.plus(pub, 1);
      else if (line.contains("后天")) date = DateMath.plus(pub, 2);
      else if (line.contains("今天") || line.contains("今晚")) date = pub;
      Matcher d = Pattern.compile("(20\\d{2})[-/年](\\d{1,2})[-/月](\\d{1,2})日?").matcher(line);
      if (d.find())
        try {
          date =
              DateMath.date(
                  Integer.parseInt(d.group(1)),
                  Integer.parseInt(d.group(2)),
                  Integer.parseInt(d.group(3)));
        } catch (Exception ignored) {
        }
      else {
        d = Pattern.compile("(\\d{1,2})月(\\d{1,2})日?").matcher(line);
        if (d.find())
          try {
            date =
                DateMath.date(
                    Integer.parseInt(pub.substring(0, 4)),
                    Integer.parseInt(d.group(1)),
                    Integer.parseInt(d.group(2)));
          } catch (Exception ignored) {
          }
      }
      String time = "";
      Matcher t = Pattern.compile("(?<!\\d)([01]?\\d|2[0-3])[:：]([0-5]\\d)").matcher(line);
      if (t.find())
        time =
            String.format(
                Locale.ROOT,
                "%02d:%02d",
                Integer.parseInt(t.group(1)),
                Integer.parseInt(t.group(2)));
      String loc = "";
      Matcher l = Pattern.compile("(?:地点|教室|在)[:：\\s]*([\\p{L}\\d-]{2,16})").matcher(line);
      if (l.find()) loc = l.group(1);
      String title = line.substring(0, Math.min(24, line.length()));
      out.put(
          CampusJson.obj(
              "id",
              CampusJson.id(),
              "on",
              true,
              "msg_type",
              type,
              "subject",
              title,
              "summary",
              line,
              "event_time",
              date + (time.isEmpty() || date.isEmpty() ? "" : " " + time),
              "location",
              loc,
              "prepare",
              "",
              "original",
              line,
              "publish_date",
              pub,
              "need_confirm",
              date.isEmpty()));
    }
    return out;
  }

  static void review(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "核对整理结果", "本地按日期和关键词整理，请检查类型、时间与地点。");
    JSONArray rows = a.store.list("draft_parsed");
    for (int i = 0; i < rows.length(); i++) {
      final int n = i;
      JSONObject x = rows.optJSONObject(i);
      if (x == null) continue;
      LinearLayout c = u.card(a.content);
      CheckBox select = new CheckBox(u.dialog());
      select.setText(x.optString("subject"));
      select.setTextColor(u.ink);
      select.setChecked(x.optBoolean("on", true));
      select.setOnCheckedChangeListener(
          (b, on) -> {
            CampusJson.put(x, "on", on);
            try {
              rows.put(n, x);
              a.store.set("draft_parsed", rows);
            } catch (Exception e) {
              a.error(e);
            }
          });
      c.addView(select);
      c.addView(
          u.text(
              x.optString("msg_type")
                  + " · "
                  + (x.optString("event_time").isEmpty() ? "时间待确认" : x.optString("event_time"))
                  + " · "
                  + x.optString("location"),
              12,
              u.muted,
              false));
      u.gap(c, 9);
      c.addView(u.text(x.optString("summary"), 12, u.muted, false));
      u.gap(c, 12);
      c.addView(
          u.button(
              "编辑结果",
              () -> {
                JSONObject init = CampusJson.copy(x);
                String at = x.optString("event_time");
                CampusJson.put(init, "date", CampusJson.date(at));
                CampusJson.put(init, "time", at.length() >= 16 ? at.substring(11, 16) : "");
                u.form(
                    "编辑整理结果",
                    init,
                    v -> {
                      String date = v.optString("date"), time = v.optString("time");
                      CampusJson.put(
                          v,
                          "event_time",
                          date + (time.isEmpty() || date.isEmpty() ? "" : " " + time));
                      CampusJson.put(v, "need_confirm", date.isEmpty());
                      v.remove("date");
                      v.remove("time");
                      rows.put(n, v);
                      a.store.set("draft_parsed", rows);
                      a.build();
                    },
                    CampusUi.choice("msg_type", "类型", "作业", "考试", "活动", "通知", "其他"),
                    CampusUi.f("subject", "标题"),
                    CampusUi.f("summary", "摘要", "multiline"),
                    new CampusUi.Field("date", "日期", "date", false),
                    new CampusUi.Field("time", "时间", "time", false),
                    CampusUi.optional("location", "地点"),
                    CampusUi.optional("prepare", "需要准备"));
              },
              false));
    }
  }

  static View reviewToolbar(CampusActivity a) {
    CampusUi u = a.ui;
    LinearLayout row = u.row();
    row.setPadding(u.dp(16), u.dp(5), u.dp(16), u.dp(9));
    row.setBackgroundColor(u.bg);
    TextView save =
        u.button("保存到我的事项", () -> publishLocal(a, a.store.list("draft_parsed"), false), true);
    save.setPadding(u.dp(8), u.dp(12), u.dp(8), u.dp(12));
    LinearLayout.LayoutParams saveSpace = new LinearLayout.LayoutParams(0, -2, 1.3f);
    saveSpace.rightMargin = u.dp(8);
    row.addView(save, saveSpace);
    TextView edit = u.button("编辑消息", () -> pasteImport(a, false), false);
    edit.setPadding(u.dp(6), u.dp(12), u.dp(6), u.dp(12));
    edit.setContentDescription("返回编辑原消息，保留草稿");
    LinearLayout.LayoutParams editSpace = new LinearLayout.LayoutParams(0, -2, 1);
    editSpace.rightMargin = u.dp(6);
    row.addView(edit, editSpace);
    TextView more = u.text("⋯", 25, u.ink, true);
    more.setGravity(Gravity.CENTER);
    more.setMinHeight(u.dp(48));
    more.setContentDescription("审核更多操作，选择与班级发布");
    u.touch(more, u.surface, 14, u.border);
    more.setOnClickListener(v -> reviewMore(a));
    row.addView(more, new LinearLayout.LayoutParams(u.dp(48), -1));
    return row;
  }

  static void reviewMore(CampusActivity a) {
    List<String> labels = new ArrayList<>(Arrays.asList("全部选择", "取消全选"));
    if (a.can("can_ingest") && !a.cid().isEmpty()) labels.add("发布到班级");
    a.ui.choose(
        "审核更多操作",
        labels.toArray(new String[0]),
        i -> {
          JSONArray rows = a.store.list("draft_parsed");
          if (i == 2) a.ui.confirm("发布到班级？", "选中的事项会对班级成员可见。", () -> publishLocal(a, rows, true));
          else {
            for (JSONObject x : CampusJson.rows(rows)) CampusJson.put(x, "on", i == 0);
            a.store.set("draft_parsed", rows);
            a.build();
          }
        });
  }

  static void publishLocal(CampusActivity a, JSONArray rows, boolean cloud) {
    JSONArray chosen = new JSONArray();
    for (JSONObject x : CampusJson.rows(rows))
      if (x.optBoolean("on", true)) {
        JSONObject copy = CampusJson.copy(x);
        copy.remove("on");
        copy.remove("id");
        chosen.put(copy);
      }
    if (chosen.length() == 0) {
      a.toast("请至少选择一条事项");
      return;
    }
    if (cloud)
      a.rpc(
          "publish_parsed_items",
          CampusJson.obj("cid", a.cid(), "items", chosen),
          r -> {
            JSONArray fb = new JSONArray();
            JSONObject draft = a.store.object("draft_ingest");
            fb.put(
                CampusJson.obj(
                    "text",
                    draft.optString("text"),
                    "pub",
                    draft.optString("date"),
                    "chatter",
                    false,
                    "source",
                    "user",
                    "items",
                    chosen));
            a.rpc("parse_feedback_add", CampusJson.obj("cid", a.cid(), "rows", fb), v -> {});
            a.store.set("draft_parsed", new JSONArray());
            selectImportedDay(a, chosen);
            a.toast("已发布 " + chosen.length() + " 条班级事项");
            a.open("calendar");
            CampusSchool.reloadItems(a);
          });
    else {
      JSONArray personal = a.store.list("personal_events_v1");
      for (JSONObject x : CampusJson.rows(chosen))
        personal.put(
            CampusJson.obj(
                "id",
                CampusJson.id(),
                "subject",
                x.optString("subject"),
                "event_time",
                x.optString("event_time"),
                "location",
                x.optString("location"),
                "note",
                x.optString("msg_type") + "：" + x.optString("summary"),
                "done",
                false));
      a.store.set("personal_events_v1", personal);
      a.store.set("draft_parsed", new JSONArray());
      selectImportedDay(a, chosen);
      a.toast("已保存 " + chosen.length() + " 条个人事项");
      a.open("calendar");
      a.syncSoon();
    }
  }

  static void selectImportedDay(CampusActivity a, JSONArray rows) {
    String first = "";
    for (JSONObject x : CampusJson.rows(rows)) {
      String date = CampusJson.date(x.optString("event_time"));
      if (date.equals(a.selectedDay)) return;
      if (first.isEmpty() && !date.isEmpty()) first = date;
    }
    if (!first.isEmpty()) a.selectedDay = first;
  }

  static void pollIngest(CampusActivity a, String jid) {
    a.rpc(
        "ingest_job_status",
        CampusJson.obj("jid", jid),
        r -> {
          JSONObject job = CampusJson.object(r);
          if (job.optString("status").equals("done")) {
            a.store.set("native_ingest_job", "");
            a.toast("整理完成，新增 " + job.optInt("added") + " 条事项");
            CampusSchool.reloadItems(a);
          } else if (job.optString("status").equals("failed"))
            a.toast(job.optString("message", "整理失败"));
          else a.ui.confirm("云端仍在整理", "稍后继续查看任务状态？", () -> pollIngest(a, jid));
        });
  }

  static void feedback(CampusActivity a) {
    a.ui.choose(
        "消息整理学习记录",
        new String[] {"查看纠正记录", "清空纠正记录"},
        i -> {
          if (i == 0)
            a.rpc(
                "parse_feedback_list",
                CampusJson.obj("cid", a.cid()),
                r -> CampusManage.records(a, "纠正记录", r));
          else
            a.ui.confirm(
                "清空纠正记录？",
                "本班整理器将不再使用这些历史纠正。",
                () ->
                    a.rpc(
                        "parse_feedback_clear",
                        CampusJson.obj("cid", a.cid()),
                        r -> a.toast("纠正记录已清空")));
        });
  }
}
