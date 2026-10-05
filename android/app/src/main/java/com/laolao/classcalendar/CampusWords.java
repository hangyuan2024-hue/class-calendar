package com.laolao.classcalendar;

import android.content.*;
import android.speech.tts.TextToSpeech;
import android.widget.*;
import java.util.*;
import java.util.zip.GZIPInputStream;
import org.json.*;

/** Offline native version of Word Buddy, using the website's actual seven vocabulary books. */
final class CampusWords {
  static JSONObject dict;
  static final WeakHashMap<CampusActivity, TextToSpeech> speakers = new WeakHashMap<>();

  static void render(CampusActivity a) {
    if (dict == null) {
      a.ui.title(a.content, "单词搭子", "正在载入本机词库…");
      a.background(
          "载入七本词书",
          () -> {
            try (GZIPInputStream in =
                new GZIPInputStream(a.getResources().openRawResource(R.raw.campus_words))) {
              dict = new JSONObject(CampusApi.read(in, 28000000));
            }
            return null;
          },
          r -> {
            if (a.page.equals("words")) a.build();
          });
      return;
    }
    CampusUi u = a.ui;
    String book = a.store.string("native_word_book", "CET4"),
        mode = a.store.string("native_word_mode", "首页");
    u.title(a.content, "单词搭子", bookName(book) + " · " + bookWords(book).length() + "词 · 本机离线词库");
    u.actionRow(
        a.content,
        new String[] {"选择词书", mode + " ▾"},
        new Runnable[] {
          () -> {
            List<JSONObject> books = CampusJson.rows(dict.opt("books"));
            u.choose(
                "选择词书",
                books.stream()
                    .map(
                        x ->
                            x.optString("name")
                                + " · "
                                + bookWords(x.optString("id")).length()
                                + "词")
                    .toArray(String[]::new),
                i -> {
                  a.store.set("native_word_book", books.get(i).optString("id"));
                  a.store.set("native_word_mode", "首页");
                  a.store.set("native_word_page", 0);
                  a.build();
                });
          },
          () ->
              u.choose(
                  "单词学习",
                  new String[] {"首页", "词书清单", "新词学习", "到期复习", "测试", "错词本", "我的收藏"},
                  i -> {
                    a.store.set(
                        "native_word_mode",
                        new String[] {"首页", "词书清单", "新词学习", "到期复习", "测试", "错词本", "我的收藏"}[i]);
                    a.store.set("native_word_page", 0);
                    a.build();
                  })
        });
    if (mode.equals("首页")) {
      home(a, book);
      return;
    }
    if (mode.equals("新词学习") || mode.equals("到期复习")) {
      learn(a, book, mode.equals("到期复习"));
      return;
    }
    if (mode.equals("测试")) {
      quiz(a, book);
      return;
    }
    list(a, book, mode);
  }

  static JSONArray bookWords(String id) {
    return CampusJson.arr(dict.optJSONObject("bookWords").opt(id));
  }

  static String bookName(String id) {
    for (JSONObject b : CampusJson.rows(dict.opt("books")))
      if (b.optString("id").equals(id)) return b.optString("name");
    return id;
  }

  static JSONObject word(String id) {
    return dict.optJSONObject("words").optJSONObject(id);
  }

  static boolean due(JSONObject p) {
    return p != null
        && !p.optString("s").equals("mastered")
        && p.optLong("due") <= System.currentTimeMillis();
  }

  static void home(CampusActivity a, String book) {
    CampusUi u = a.ui;
    JSONObject progress = a.store.object("native_word_progress"),
        mission = a.store.object("native_word_days").optJSONObject(DateMath.today());
    if (mission == null) mission = new JSONObject();
    int due = 0, mastered = 0;
    for (String id : CampusJson.keys(progress)) {
      JSONObject p = progress.optJSONObject(id);
      if (due(p)) due++;
      if (p != null && p.optString("s").equals("mastered")) mastered++;
    }
    LinearLayout c = u.card(a.content);
    c.addView(u.pill("今日词汇任务"));
    u.gap(c, 12);
    c.addView(
        u.text(
            "新词 " + mission.optInt("new") + " / " + a.store.number("native_word_goal", 20),
            25,
            u.ink,
            true));
    u.gap(c, 9);
    c.addView(
        u.text(
            "到期 " + due + "词 · 累计学过 " + progress.length() + "词 · 掌握 " + mastered + "词",
            13,
            u.muted,
            false));
    u.gap(c, 18);
    u.actionRow(
        c,
        new String[] {"开始学习", "到期复习"},
        new Runnable[] {() -> mode(a, "新词学习"), () -> mode(a, "到期复习")});
    u.actionRow(
        a.content,
        new String[] {"查单词", "每天学习量"},
        new Runnable[] {
          () ->
              u.form(
                  "离线查词",
                  new JSONObject(),
                  v -> {
                    String q = v.optString("query").toLowerCase(Locale.ROOT);
                    JSONObject exact = word(q);
                    if (exact != null) {
                      detail(a, q, false);
                      return;
                    }
                    List<String> hits = new ArrayList<>();
                    for (String id : CampusJson.keys(dict.optJSONObject("words")))
                      if (id.contains(q) || word(id).optString("cn").contains(q)) {
                        hits.add(id);
                        if (hits.size() == 60) break;
                      }
                    u.choose(
                        "查词结果", hits.toArray(new String[0]), i -> detail(a, hits.get(i), false));
                  },
                  CampusUi.f("query", "英文单词或中文意思")),
          () ->
              u.form(
                  "每日新词目标",
                  CampusJson.obj("goal", a.store.number("native_word_goal", 20)),
                  v -> {
                    int n = v.optInt("goal");
                    if (n < 1 || n > 200) throw new IllegalArgumentException("每日目标为1—200词");
                    a.store.set("native_word_goal", n);
                    a.build();
                  },
                  CampusUi.f("goal", "新词数量", "number"))
        });
    u.section(a.content, "学习节奏");
    u.empty(a.content, "翻卡、发音、回想、再复习", "每词保留音标、中英释义、例句、词组和记忆提示（原词库提供时）。反馈会安排下一次复习，答错的词自动进入错词本。");
    a.content.addView(u.button("开始一次词汇测试", () -> mode(a, "测试"), false));
  }

  static void mode(CampusActivity a, String s) {
    a.store.set("native_word_mode", s);
    a.build();
  }

  static void list(CampusActivity a, String book, String mode) {
    CampusUi u = a.ui;
    JSONObject progress = a.store.object("native_word_progress"),
        favs = a.store.object("native_word_favorites");
    List<String> rows = new ArrayList<>();
    String filter = a.store.string("native_word_filter", "全部");
    JSONArray ids = bookWords(book);
    for (int i = 0; i < ids.length(); i++) {
      String id = ids.optString(i);
      JSONObject p = progress.optJSONObject(id);
      if (mode.equals("错词本") && (p == null || !p.optBoolean("weak"))) continue;
      if (mode.equals("我的收藏") && !favs.has(id)) continue;
      if (mode.equals("词书清单")) {
        if (filter.equals("未学习") && p != null) continue;
        if (filter.equals("已学习") && p == null) continue;
        if (filter.equals("已掌握") && (p == null || !p.optString("s").equals("mastered"))) continue;
      }
      rows.add(id);
    }
    if (mode.equals("词书清单"))
      a.content.addView(
          u.button(
              "筛选：" + filter,
              () ->
                  u.choose(
                      "筛选词汇",
                      new String[] {"全部", "未学习", "已学习", "已掌握"},
                      i -> {
                        a.store.set(
                            "native_word_filter", new String[] {"全部", "未学习", "已学习", "已掌握"}[i]);
                        a.store.set("native_word_page", 0);
                        a.build();
                      }),
              false));
    int page =
        Math.max(
            0,
            Math.min(a.store.number("native_word_page", 0), Math.max(0, (rows.size() - 1) / 30)));
    u.section(a.content, "共 " + rows.size() + " 词 · 第 " + (page + 1) + " 页");
    for (String id :
        rows.subList(Math.min(rows.size(), page * 30), Math.min(rows.size(), (page + 1) * 30))) {
      JSONObject w = word(id);
      LinearLayout c = u.card(a.content);
      c.addView(u.text(id + "  /" + w.optString("uk") + "/", 17, u.ink, true));
      String meaning = w.optString("cn");
      c.addView(u.text(meaning.substring(0, Math.min(90, meaning.length())), 12, u.muted, false));
      c.setOnClickListener(v -> detail(a, id, false));
    }
    u.actionRow(
        a.content,
        new String[] {"上一页", "下一页"},
        new Runnable[] {
          () -> {
            a.store.set("native_word_page", Math.max(0, page - 1));
            a.build();
          },
          () -> {
            a.store.set(
                "native_word_page", Math.min(page + 1, Math.max(0, (rows.size() - 1) / 30)));
            a.build();
          }
        });
    if (rows.isEmpty()) u.empty(a.content, "这里暂时没有单词", "学习、答题或收藏后会自动积累。");
  }

  static void learn(CampusActivity a, String book, boolean review) {
    JSONObject progress = a.store.object("native_word_progress");
    List<String> ids = new ArrayList<>();
    for (int i = 0; i < bookWords(book).length(); i++) {
      String id = bookWords(book).optString(i);
      JSONObject p = progress.optJSONObject(id);
      if (review ? due(p) : p == null) ids.add(id);
    }
    if (review) ids.sort(Comparator.comparingLong(id -> progress.optJSONObject(id).optLong("due")));
    if (ids.isEmpty()) {
      a.ui.empty(a.content, review ? "本词书没有到期复习" : "这本词书已全部开始学习", "可以换本词书，或查看错词与已学习清单。");
      return;
    }
    JSONObject today = a.store.object("native_word_days").optJSONObject(DateMath.today());
    if (!review && today != null && today.optInt("new") >= a.store.number("native_word_goal", 20)) {
      a.ui.empty(a.content, "今天的新词目标完成了", "先复习旧词，或调整每日目标继续学。");
      a.content.addView(a.ui.button("返回学习首页", () -> mode(a, "首页"), true));
      return;
    }
    String id = ids.get(0);
    LinearLayout c = a.ui.card(a.content);
    c.addView(a.ui.pill(review ? "到期复习" : "新词学习"));
    a.ui.gap(c, 25);
    c.addView(a.ui.text(id, 34, a.ui.ink, true));
    a.ui.gap(c, 10);
    c.addView(a.ui.text("/" + word(id).optString("uk") + "/", 16, a.ui.muted, false));
    a.ui.gap(c, 25);
    a.ui.actionRow(
        c,
        new String[] {"发音", "翻面与反馈"},
        new Runnable[] {() -> speak(a, id), () -> detail(a, id, true)});
    a.ui.empty(a.content, "先在心里回想一下", "翻面会显示释义、例句和原词库中的拓展信息。");
  }

  static String full(JSONObject w) {
    StringBuilder b =
        new StringBuilder(w.optString("word"))
            .append("\n音标 / ")
            .append(w.optString("uk"))
            .append(" /\n\n")
            .append(w.optString("cn"))
            .append("\n\n")
            .append(w.optString("en"));
    for (JSONObject src : CampusJson.rows(w.opt("sources"))) {
      b.append("\n\n——词书拓展——\n");
      for (JSONObject sense : CampusJson.rows(src.opt("senses")))
        b.append(sense.optString("pos"))
            .append(". ")
            .append(sense.optString("cn"))
            .append('\n')
            .append(sense.optString("en"))
            .append('\n');
      for (String key : new String[] {"examples", "phrases", "rels"}) {
        JSONArray list = CampusJson.arr(src.opt(key));
        if (list.length() > 0)
          b.append("\n")
              .append(key.equals("examples") ? "例句" : key.equals("phrases") ? "词组" : "关联词")
              .append("：\n");
        for (int i = 0; i < list.length(); i++) {
          JSONArray row = list.optJSONArray(i);
          if (row == null) continue;
          for (int j = key.equals("rels") ? 1 : 0; j < row.length(); j++)
            b.append(row.optString(j)).append(j + 1 < row.length() ? " · " : "\n");
        }
      }
      if (!src.optString("rem").isEmpty()) b.append("\n记忆提示：").append(src.optString("rem"));
    }
    return b.toString();
  }

  static void detail(CampusActivity a, String id, boolean feedback) {
    JSONObject w = word(id);
    if (w == null) return;
    String[] options =
        feedback
            ? new String[] {"忘记了 · 10分钟后", "有点难 · 明天", "记住了 · 延长间隔", "发音 / 收藏"}
            : new String[] {"发音", "收藏 / 取消收藏", "加入复习", "移出错词本"};
    CampusManage.message(
        a,
        id,
        full(w),
        options,
        i -> {
          if (feedback && i < 3) {
            feedback(a, id, i);
            a.build();
          } else if (feedback)
            a.ui.choose(
                id,
                new String[] {"英语发音", "收藏 / 取消收藏"},
                j -> {
                  if (j == 0) speak(a, id);
                  else favorite(a, id);
                });
          else if (i == 0) speak(a, id);
          else if (i == 1) favorite(a, id);
          else if (i == 2) {
            JSONObject p = a.store.object("native_word_progress").optJSONObject(id);
            if (p == null) p = new JSONObject();
            CampusJson.put(p, "due", System.currentTimeMillis());
            CampusJson.put(p, "s", "learning");
            a.store.entry("native_word_progress", id, p);
            a.toast("已加入复习");
          } else {
            JSONObject p = a.store.object("native_word_progress").optJSONObject(id);
            if (p != null) {
              CampusJson.put(p, "weak", false);
              a.store.entry("native_word_progress", id, p);
              a.build();
            }
          }
        });
  }

  static void favorite(CampusActivity a, String id) {
    JSONObject all = a.store.object("native_word_favorites");
    if (all.has(id)) all.remove(id);
    else CampusJson.put(all, id, System.currentTimeMillis());
    a.store.set("native_word_favorites", all);
    a.toast(all.has(id) ? "已收藏" : "已取消收藏");
  }

  static void feedback(CampusActivity a, String id, int result) {
    JSONObject all = a.store.object("native_word_progress"), p = all.optJSONObject(id);
    boolean fresh = p == null;
    if (p == null) p = CampusJson.obj("step", 0, "seen", 0, "right", 0, "wrong", 0);
    int step = p.optInt("step");
    CampusJson.put(p, "seen", p.optInt("seen") + 1);
    CampusJson.put(p, "last", System.currentTimeMillis());
    int[] intervals = {1, 2, 4, 7, 15, 30};
    if (result == 0) {
      CampusJson.put(p, "step", 0);
      CampusJson.put(p, "weak", true);
      CampusJson.put(p, "wrong", p.optInt("wrong") + 1);
      CampusJson.put(p, "due", System.currentTimeMillis() + 600000);
      CampusJson.put(p, "s", "learning");
    } else {
      CampusJson.put(
          p,
          "due",
          System.currentTimeMillis()
              + (result == 1 ? 1 : intervals[Math.min(5, step)]) * 86400000L);
      if (result == 2) {
        CampusJson.put(p, "step", step + 1);
        CampusJson.put(p, "right", p.optInt("right") + 1);
      }
      CampusJson.put(p, "s", p.optInt("step") >= 6 ? "mastered" : "learning");
      if (p.optString("s").equals("mastered")) CampusJson.put(p, "weak", false);
    }
    CampusJson.put(all, id, p);
    JSONObject days = a.store.object("native_word_days"),
        today = days.optJSONObject(DateMath.today());
    if (today == null) today = new JSONObject();
    String key = fresh ? "new" : "review";
    CampusJson.put(today, key, today.optInt(key) + 1);
    CampusJson.put(days, DateMath.today(), today);
    a.store.batch(CampusJson.obj("native_word_progress", all, "native_word_days", days));
  }

  static void quiz(CampusActivity a, String book) {
    CampusUi u = a.ui;
    JSONArray ids = bookWords(book);
    if (ids.length() < 4) return;
    JSONObject state = a.store.object("native_word_quiz");
    if (!state.optString("book").equals(book) || state.optString("word").isEmpty()) {
      Random rnd = new java.security.SecureRandom();
      String id = ids.optString(rnd.nextInt(ids.length()));
      Set<String> selected = new LinkedHashSet<>();
      selected.add(id);
      while (selected.size() < 4) selected.add(ids.optString(rnd.nextInt(ids.length())));
      List<String> choices = new ArrayList<>(selected);
      Collections.shuffle(choices, rnd);
      state =
          CampusJson.obj(
              "book",
              book,
              "word",
              id,
              "choices",
              new JSONArray(choices),
              "correct",
              a.store.number("native_word_quiz_correct", 0),
              "answered",
              a.store.number("native_word_quiz_count", 0));
      a.store.set("native_word_quiz", state);
    }
    final JSONObject quiz = state;
    LinearLayout c = u.card(a.content);
    c.addView(
        u.pill(
            "已答 "
                + a.store.number("native_word_quiz_count", 0)
                + "题 · 正确 "
                + a.store.number("native_word_quiz_correct", 0)
                + "题"));
    u.gap(c, 20);
    c.addView(u.text(state.optString("word"), 33, u.ink, true));
    u.gap(c, 22);
    for (int i = 0; i < CampusJson.arr(state.opt("choices")).length(); i++) {
      String choice = CampusJson.arr(state.opt("choices")).optString(i);
      String meaning = word(choice).optString("cn");
      c.addView(
          u.button(
              meaning.substring(0, Math.min(130, meaning.length())),
              () -> {
                if (!a.store
                    .object("native_word_quiz")
                    .optString("word")
                    .equals(quiz.optString("word"))) return;
                boolean right = choice.equals(quiz.optString("word"));
                a.store.set(
                    "native_word_quiz_count", a.store.number("native_word_quiz_count", 0) + 1);
                if (right)
                  a.store.set(
                      "native_word_quiz_correct",
                      a.store.number("native_word_quiz_correct", 0) + 1);
                feedback(a, quiz.optString("word"), right ? 2 : 0);
                a.store.set("native_word_quiz", new JSONObject());
                CampusManage.message(
                    a,
                    right ? "回答正确" : "再记一次",
                    full(word(quiz.optString("word"))),
                    new String[] {"下一题"},
                    j -> a.build());
              },
              false));
      u.gap(c, 9);
    }
  }

  static void speak(CampusActivity a, String word) {
    TextToSpeech t = speakers.get(a);
    if (t != null) {
      t.speak(word, TextToSpeech.QUEUE_FLUSH, null, "campus-word");
      return;
    }
    final TextToSpeech[] holder = new TextToSpeech[1];
    holder[0] =
        new TextToSpeech(
            a,
            status -> {
              if (status == TextToSpeech.SUCCESS) {
                int lang = holder[0].setLanguage(Locale.UK);
                if (lang < 0) a.toast("请在系统文字转语音设置安装英语语音");
                else holder[0].speak(word, TextToSpeech.QUEUE_FLUSH, null, "campus-word");
              } else a.toast("设备语音引擎不可用");
            });
    speakers.put(a, holder[0]);
  }

  static void release(CampusActivity a) {
    TextToSpeech t = speakers.remove(a);
    if (t != null) t.shutdown();
  }
}
