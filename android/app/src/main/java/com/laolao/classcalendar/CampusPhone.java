package com.laolao.classcalendar;

import android.Manifest;
import android.app.*;
import android.appwidget.AppWidgetManager;
import android.content.*;
import android.database.Cursor;
import android.graphics.*;
import android.graphics.pdf.PdfDocument;
import android.hardware.biometrics.BiometricPrompt;
import android.location.*;
import android.media.*;
import android.net.Uri;
import android.os.*;
import android.provider.*;
import android.speech.RecognizerIntent;
import android.util.Base64;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.util.*;
import java.util.function.Consumer;
import org.json.*;

/** Ten genuine phone capabilities using Android APIs, without Google Play dependencies. */
final class CampusPhone {
  static final WeakHashMap<CampusActivity, State> states = new WeakHashMap<>();

  static final class State {
    Consumer<String> photo;
    String camera, jsonKind;
    byte[] exported;
    LocationListener location;
    android.os.CancellationSignal biometric;
    Runnable biometricSuccess;
    boolean refreshing;
    String owner;
  }

  static State state(CampusActivity a) {
    State s = states.get(a);
    if (s == null) {
      s = new State();
      states.put(a, s);
    }
    return s;
  }

  static boolean handles(String p) {
    return Arrays.asList(
            "phone",
            "widget",
            "reminders",
            "inbox",
            "voice",
            "recordings",
            "privacy",
            "quiet",
            "places",
            "scanner",
            "contacts")
        .contains(p);
  }

  static void render(CampusActivity a, String p) {
    switch (p) {
      case "phone":
        hub(a);
        break;
      case "widget":
        widget(a);
        break;
      case "reminders":
        reminders(a);
        break;
      case "inbox":
        inbox(a);
        break;
      case "voice":
        voice(a);
        break;
      case "recordings":
        recordings(a);
        break;
      case "privacy":
        privacy(a);
        break;
      case "quiet":
        quiet(a);
        break;
      case "places":
        places(a);
        break;
      case "scanner":
        scanner(a);
        break;
      case "contacts":
        contacts(a);
        break;
    }
  }

  static void hub(CampusActivity a) {
    a.ui.title(a.content, "手机助手", "把手机的能力，变成每天用得上的便利。");
    a.ui.tileGrid(
        a.content,
        new String[][] {
          {"widget", "桌面学习卡片", "不用打开App，先看今日安排"},
          {"reminders", "系统提醒中心", "课程、作业与自定义提醒"},
          {"inbox", "跨应用收件箱", "从其他App收下文字与图片"},
          {"voice", "语音速记", "说一句，生成待办草稿"},
          {"recordings", "课堂录音", "后台录制、命名与分享"},
          {"privacy", "日记设备验证", "指纹、面容或设备密码"},
          {"quiet", "上课自动勿扰", "按课表安静，结束后恢复"},
          {"places", "校园位置书签", "保存地点，查看距离与导航"},
          {"scanner", "资料扫描成PDF", "拍照、裁边、多页与导出"},
          {"contacts", "校园快捷联系", "挑选联系人，一键准备拨号"}
        });
  }

  static void widget(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "桌面学习卡片", "课程与待办，抬手就能看到。");
    LinearLayout c = u.card(a.content);
    c.setBackground(u.shape(u.soft, 23, 0));
    c.addView(u.pill("今日校园"));
    u.gap(c, 14);
    List<JSONObject> courses = CampusCourses.onDay(a.store, DateMath.today());
    c.addView(
        u.text(
            courses.isEmpty()
                ? "今天没有记录课程"
                : courses.get(0).optString("t0") + "  " + courses.get(0).optString("name"),
            22,
            u.ink,
            true));
    u.gap(c, 9);
    c.addView(
        u.text(
            a.items().stream().filter(x -> !a.done(x)).count() + " 项待完成 · " + DateMath.today(),
            13,
            u.muted,
            false));
    u.gap(c, 18);
    c.addView(
        u.button(
            "添加到手机桌面",
            () -> {
              AppWidgetManager manager = AppWidgetManager.getInstance(a);
              if (Build.VERSION.SDK_INT >= 26 && manager.isRequestPinAppWidgetSupported()) {
                manager.requestPinAppWidget(new ComponentName(a, CampusWidget.class), null, null);
                a.toast("请在桌面提示中确认添加");
              } else message(a, "添加桌面卡片", "长按手机桌面空白处 → 小组件 / 服务卡片 → 找到「捞捞校园」→ 拖到桌面。");
            },
            true));
    u.gap(a.content, 14);
    a.content.addView(
        u.button(
            "立即更新桌面卡片",
            () -> {
              CampusWidget.updateAll(a);
              a.toast("桌面卡片已更新");
            },
            false));
  }

  static void refresh(CampusActivity a) {
    State st = state(a);
    if (st.refreshing) return;
    st.refreshing = true;
    try {
      CampusPlanner.settle(a, a.store);
      CampusWidget.updateAll(a);
      scheduleReminders(a, a.store);
      CampusDndReceiver.scheduleNext(a, a.store);
    } catch (Exception e) {
      a.store.set("native_device_error", e.getMessage());
    } finally {
      st.refreshing = false;
    }
  }

  static void reminders(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "系统提醒中心", "离开App后，交给安卓通知提醒你。");
    boolean allowed =
        Build.VERSION.SDK_INT < 33
            || a.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                == android.content.pm.PackageManager.PERMISSION_GRANTED;
    u.actionRow(
        a.content,
        new String[] {allowed ? "通知设置" : "开启通知权限", "＋ 自定义提醒"},
        new Runnable[] {
          () -> {
            if (!allowed) a.request(Manifest.permission.POST_NOTIFICATIONS, () -> a.build());
            else
              try {
                a.startActivity(
                    new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, a.getPackageName()));
              } catch (Exception e) {
                a.error(e);
              }
          },
          () -> reminderForm(a, null)
        });
    JSONObject cfg = a.store.object("native_reminder_config");
    u.actionRow(
        a.content,
        new String[] {"自动提醒规则", "发送测试提醒"},
        new Runnable[] {
          () ->
              u.form(
                  "自动提醒规则",
                  CampusJson.obj(
                      "courses",
                      cfg.optBoolean("courses", true),
                      "tasks",
                      cfg.optBoolean("tasks", true),
                      "minutes",
                      cfg.optInt("minutes", 10)),
                  v -> {
                    int n = v.optInt("minutes");
                    if (n < 0 || n > 1440) throw new IllegalArgumentException("提前分钟为0—1440");
                    a.store.set("native_reminder_config", v);
                    refresh(a);
                    a.build();
                  },
                  CampusUi.f("courses", "课前提醒", "boolean"),
                  CampusUi.f("tasks", "事项与作业提醒", "boolean"),
                  CampusUi.f("minutes", "提前多少分钟", "number")),
          () -> Reminders.show(a, 900, "捞捞提醒已就绪", "这是一条手机系统通知。", "home")
        });
    u.section(a.content, "自定义提醒");
    for (JSONObject x : CampusJson.rows(a.store.list("native_reminders"))) {
      LinearLayout c = u.card(a.content);
      c.addView(u.text(x.optString("title"), 17, u.ink, true));
      c.addView(u.text(x.optString("date") + " " + x.optString("time"), 13, u.muted, false));
      u.gap(c, 11);
      u.actionRow(
          c,
          new String[] {"编辑", "删除"},
          new Runnable[] {
            () -> reminderForm(a, CampusJson.obj("_reminder", x)),
            () ->
                u.confirm(
                    "删除提醒？",
                    x.optString("title"),
                    () -> {
                      a.store.replace("native_reminders", x.optString("id"), null);
                      refresh(a);
                      a.build();
                    })
          });
    }
    u.section(a.content, "后台运行提示");
    u.empty(
        a.content,
        "通知交给系统，省电策略由手机控制",
        "提醒使用省电闹钟，深度休眠时可能延迟。华为手机可在「设置 → 应用启动管理」中允许本App后台运行；专注完成仍会在下次打开时结算。");
    a.content.addView(
        u.button(
            "打开应用电池设置",
            () -> {
              try {
                a.startActivity(
                    new Intent(
                        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.parse("package:" + a.getPackageName())));
              } catch (Exception e) {
                a.error(e);
              }
            },
            false));
  }

  static void reminderForm(CampusActivity a, JSONObject item) {
    JSONObject x =
        item != null && item.optJSONObject("_reminder") != null
            ? item.optJSONObject("_reminder")
            : CampusJson.obj(
                "id",
                CampusJson.id(),
                "date",
                DateMath.today(),
                "time",
                "18:00",
                "title",
                item == null ? "" : item.optString("subject"),
                "note",
                item == null ? "" : item.optString("summary"));
    if (item != null && item.has("event_time")) {
      String at = item.optString("event_time");
      String day = CampusJson.date(at);
      if (!day.isEmpty()) CampusJson.put(x, "date", day);
      if (at.length() >= 16) CampusJson.put(x, "time", at.substring(11, 16));
    }
    a.ui.form(
        "手机提醒",
        x,
        v -> {
          if (CampusJson.at(v.optString("date"), v.optString("time")) <= System.currentTimeMillis())
            throw new IllegalArgumentException("提醒时间要晚于现在");
          a.store.replace("native_reminders", v.optString("id"), v);
          refresh(a);
          a.build();
          if (Build.VERSION.SDK_INT >= 33)
            a.request(Manifest.permission.POST_NOTIFICATIONS, () -> {});
        },
        CampusUi.f("title", "提醒内容"),
        CampusUi.f("date", "提醒日期", "date"),
        CampusUi.f("time", "提醒时间", "time"),
        CampusUi.optional("note", "说明"));
  }

  static void scheduleReminders(Context c, CampusStore s) {
    JSONArray rows = new JSONArray();
    JSONObject cfg = s.object("native_reminder_config");
    long advance = cfg.optInt("minutes", 10) * 60000L;
    String today = DateMath.today();
    for (JSONObject x : CampusJson.rows(s.list("native_reminders")))
      try {
        rows.put(
            CampusJson.obj(
                "id",
                "custom-" + s.owner + "-" + x.optString("id"),
                "title",
                x.optString("title"),
                "body",
                x.optString("note"),
                "at",
                CampusJson.at(x.optString("date"), x.optString("time")),
                "go",
                "reminders"));
      } catch (Exception ignored) {
      }
    if (cfg.optBoolean("courses", true))
      for (int i = 0; i < 14; i++) {
        String day = DateMath.plus(today, i);
        for (JSONObject x : CampusCourses.onDay(s, day))
          rows.put(
              CampusJson.obj(
                  "id",
                  "course-" + s.owner + x.optString("id") + day,
                  "title",
                  "快上课了 · " + x.optString("name"),
                  "body",
                  x.optString("t0") + " · " + x.optString("location"),
                  "at",
                  CampusJson.at(day, x.optString("t0")) - advance,
                  "go",
                  "courses"));
      }
    if (cfg.optBoolean("tasks", true)) {
      List<JSONObject> events = CampusJson.rows(s.list("personal_events_v1"));
      for (JSONObject x : events)
        if (!x.optBoolean("done")) addReminder(rows, s, x, advance, "calendar");
      JSONObject marks = s.object("personal_marks_v1");
      for (JSONObject x : CampusJson.rows(s.list("cache_items"))) {
        JSONObject m = marks.optJSONObject("c" + x.optString("id"));
        if (m == null || (!m.optBoolean("done") && !m.optBoolean("hidden")))
          addReminder(rows, s, x, advance, "homework");
      }
    }
    List<JSONObject> sorted = CampusJson.rows(rows);
    sorted.sort(Comparator.comparingLong(x -> x.optLong("at")));
    Reminders.replaceAll(c, new JSONArray(sorted).toString());
  }

  static void addReminder(JSONArray rows, CampusStore s, JSONObject x, long advance, String go) {
    String at = x.optString("event_time"), day = CampusJson.date(at);
    if (day.isEmpty()) return;
    try {
      rows.put(
          CampusJson.obj(
              "id",
              "task-" + s.owner + x.optString("id"),
              "title",
              x.optString("subject"),
              "body",
              at + " · " + x.optString("location"),
              "at",
              CampusJson.at(day, at.length() >= 16 ? at.substring(11, 16) : "09:00") - advance,
              "go",
              go));
    } catch (Exception ignored) {
    }
  }

  static File media(Context c, String owner) {
    if (!owner.matches("[A-Za-z0-9_-]{1,80}")) throw new IllegalArgumentException("账号存储标识无效");
    File root = new File(c.getFilesDir(), "campus-media/" + owner);
    if (!root.exists() && !root.mkdirs()) throw new IllegalStateException("无法创建文件目录");
    return root;
  }

  static boolean validId(String id) {
    return id != null && id.matches("[A-Za-z0-9_-]{1,90}\\.(jpg|m4a|pdf)");
  }

  static File file(CampusActivity a, String id) {
    if (!validId(id)) throw new IllegalArgumentException("附件编号无效");
    return new File(media(a, a.store.owner), id);
  }

  static byte[] bytes(File f, int max) throws IOException {
    try (InputStream in = new FileInputStream(f)) {
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      byte[] buf = new byte[8192];
      int n;
      while ((n = in.read(buf)) != -1) {
        if (out.size() + n > max) throw new IOException("文件过大，请选择较小文件");
        out.write(buf, 0, n);
      }
      return out.toByteArray();
    }
  }

  static void image(CampusActivity a, LinearLayout parent, String id) {
    if (id == null || id.isEmpty() || !validId(id)) return;
    try {
      BitmapFactory.Options bounds = new BitmapFactory.Options();
      bounds.inJustDecodeBounds = true;
      BitmapFactory.decodeFile(file(a, id).getPath(), bounds);
      if (bounds.outWidth < 1) return;
      BitmapFactory.Options opts = new BitmapFactory.Options();
      opts.inSampleSize = Math.max(1, Math.max(bounds.outWidth, bounds.outHeight) / 900);
      Bitmap bitmap = BitmapFactory.decodeFile(file(a, id).getPath(), opts);
      ImageView view = new ImageView(a);
      view.setImageBitmap(bitmap);
      view.setScaleType(ImageView.ScaleType.CENTER_CROP);
      view.setContentDescription("记录中的照片");
      LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, a.ui.dp(185));
      p.topMargin = a.ui.dp(13);
      p.bottomMargin = a.ui.dp(10);
      parent.addView(view, p);
      view.setOnClickListener(
          v -> {
            ImageView large = new ImageView(a);
            large.setImageBitmap(bitmap);
            large.setAdjustViewBounds(true);
            new AlertDialog.Builder(a.ui.dialog())
                .setView(large)
                .setPositiveButton("关闭", null)
                .show();
          });
    } catch (Exception ignored) {
      parent.addView(a.ui.text("这张照片尚未恢复到本机", 12, a.ui.muted, false));
    }
  }

  static void photo(CampusActivity a, Consumer<String> result) {
    State s = state(a);
    s.photo = result;
    s.owner = a.store.owner;
    a.ui.choose(
        "添加照片",
        new String[] {"使用相机拍照", "从相册 / 文件选择"},
        i -> {
          try {
            if (i == 0) {
              File root = new File(a.getCacheDir(), "shared");
              root.mkdirs();
              File f = new File(root, "camera-" + CampusJson.id() + ".jpg");
              s.camera = f.getName();
              Uri uri = FilesProvider.uriFor(f);
              Intent intent =
                  new Intent(MediaStore.ACTION_IMAGE_CAPTURE)
                      .putExtra(MediaStore.EXTRA_OUTPUT, uri)
                      .addFlags(
                          Intent.FLAG_GRANT_READ_URI_PERMISSION
                              | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
              intent.setClipData(ClipData.newRawUri("照片", uri));
              a.startActivityForResult(intent, 5101);
            } else
              a.startActivityForResult(
                  new Intent(Intent.ACTION_OPEN_DOCUMENT)
                      .setType("image/*")
                      .addCategory(Intent.CATEGORY_OPENABLE),
                  5102);
          } catch (ActivityNotFoundException e) {
            s.photo = null;
            a.toast(i == 0 ? "没有可用相机，请从相册选择" : "没有可用文件选择器");
          }
        });
  }

  static String savePhoto(CampusActivity a, InputStream source) throws Exception {
    File temp = new File(a.getCacheDir(), "photo-input-" + CampusJson.id());
    try {
      try (InputStream in = source;
          OutputStream out = new FileOutputStream(temp)) {
        byte[] buf = new byte[8192];
        int total = 0, n;
        while ((n = in.read(buf)) != -1) {
          total += n;
          if (total > 20000000) throw new IOException("图片超过20MB");
          out.write(buf, 0, n);
        }
      }
      BitmapFactory.Options b = new BitmapFactory.Options();
      b.inJustDecodeBounds = true;
      BitmapFactory.decodeFile(temp.getPath(), b);
      if (b.outWidth <= 0 || b.outHeight <= 0 || b.outWidth > 40000 || b.outHeight > 40000)
        throw new IOException("不是有效图片");
      BitmapFactory.Options opt = new BitmapFactory.Options();
      int sample = 1;
      while (Math.max(b.outWidth, b.outHeight) / sample > 2200) sample *= 2;
      opt.inSampleSize = sample;
      Bitmap bitmap = BitmapFactory.decodeFile(temp.getPath(), opt);
      if (bitmap == null) throw new IOException("图片读取失败");
      try {
        ExifInterface exif = new ExifInterface(temp.getPath());
        int orientation =
            exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
        Matrix m = new Matrix();
        switch (orientation) {
          case 2:
            m.setScale(-1, 1);
            break;
          case 3:
            m.setRotate(180);
            break;
          case 4:
            m.setScale(1, -1);
            break;
          case 5:
            m.setRotate(90);
            m.postScale(-1, 1);
            break;
          case 6:
            m.setRotate(90);
            break;
          case 7:
            m.setRotate(270);
            m.postScale(-1, 1);
            break;
          case 8:
            m.setRotate(270);
            break;
        }
        if (!m.isIdentity()) {
          Bitmap fixed =
              Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), m, true);
          if (fixed != bitmap) bitmap.recycle();
          bitmap = fixed;
        }
      } catch (IOException ignored) {
      }
      String id = CampusJson.id() + ".jpg";
      try (OutputStream out = new FileOutputStream(file(a, id))) {
        bitmap.compress(Bitmap.CompressFormat.JPEG, 84, out);
      }
      bitmap.recycle();
      return id;
    } finally {
      temp.delete();
    }
  }

  static void json(CampusActivity a, String kind) {
    State s = state(a);
    s.jsonKind = kind;
    s.owner = a.store.owner;
    if (kind.startsWith("plugin-")) a.store.set("draft_review_id", "");
    a.startActivityForResult(
        new Intent(Intent.ACTION_OPEN_DOCUMENT)
            .setType(kind.startsWith("plugin-") ? "*/*" : "application/json")
            .addCategory(Intent.CATEGORY_OPENABLE),
        5103);
  }

  static void receive(CampusActivity a, Intent i) {
    String text = i.getStringExtra(Intent.EXTRA_TEXT),
        title = i.getStringExtra(Intent.EXTRA_SUBJECT);
    JSONObject x =
        CampusJson.obj(
            "id",
            CampusJson.id(),
            "title",
            title == null ? "分享收件" : title,
            "text",
            text == null ? "" : text.substring(0, Math.min(50000, text.length())),
            "at",
            System.currentTimeMillis(),
            "date",
            DateMath.today());
    Uri uri = i.getParcelableExtra(Intent.EXTRA_STREAM);
    if (uri != null && "content".equals(uri.getScheme()))
      try {
        CampusJson.put(x, "photo", savePhoto(a, a.getContentResolver().openInputStream(uri)));
      } catch (Exception e) {
        a.toast("图片未导入：" + e.getMessage());
      }
    if (!x.optString("text").isEmpty() || x.has("photo")) a.store.add("native_inbox", x);
  }

  static void inbox(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "跨应用收件箱", "在其他App点「分享」，选择捞捞校园即可收下。");
    a.content.addView(
        u.button(
            "＋ 手动保存文字",
            () ->
                u.form(
                    "保存收件",
                    new JSONObject(),
                    v -> {
                      CampusJson.put(v, "id", CampusJson.id());
                      CampusJson.put(v, "date", DateMath.today());
                      a.store.add("native_inbox", v);
                      a.build();
                    },
                    CampusUi.f("title", "标题"),
                    CampusUi.f("text", "内容", "multiline")),
            false));
    List<JSONObject> rows = CampusJson.rows(a.store.list("native_inbox"));
    Collections.reverse(rows);
    for (JSONObject x : rows) {
      LinearLayout c = u.card(a.content);
      c.addView(u.text(x.optString("title"), 17, u.ink, true));
      u.gap(c, 8);
      c.addView(u.text(x.optString("text"), 13, u.muted, false));
      image(a, c, x.optString("photo"));
      u.gap(c, 13);
      u.actionRow(
          c,
          new String[] {"转为学习记录", "删除收件"},
          new Runnable[] {
            () ->
                u.choose(
                    "转为哪种记录",
                    new String[] {"个人事项", "错题记录", "班群整理"},
                    i -> {
                      if (i == 0)
                        CampusSchool.personalForm(
                            a,
                            CampusJson.obj(
                                "id",
                                CampusJson.id(),
                                "subject",
                                x.optString("title"),
                                "event_time",
                                DateMath.today(),
                                "note",
                                x.optString("text")));
                      else if (i == 1)
                        CampusLearn.wrongForm(
                            a,
                            CampusJson.obj(
                                "id",
                                CampusJson.id(),
                                "title",
                                x.optString("title"),
                                "question",
                                x.optString("text"),
                                "subject",
                                "未分类",
                                "date",
                                DateMath.today(),
                                "due",
                                DateMath.today()),
                            x.optString("photo"));
                      else {
                        a.store.set(
                            "draft_ingest",
                            CampusJson.obj("text", x.optString("text"), "date", DateMath.today()));
                        a.open("ask");
                      }
                    }),
            () ->
                u.confirm(
                    "删除收件？",
                    x.optString("title"),
                    () -> {
                      a.store.replace("native_inbox", x.optString("id"), null);
                      a.build();
                    })
          });
    }
    if (rows.isEmpty()) u.empty(a.content, "还没有收到分享", "可以收下老师发的文字、笔记图片和学习材料照片。");
  }

  static void voice(CampusActivity a) {
    a.ui.title(a.content, "语音速记", "先说下来，再核对文字与日期。");
    a.content.addView(
        a.ui.button(
            "开始说一句",
            () -> {
              try {
                Intent i =
                    new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                        .putExtra(
                            RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                            RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                        .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "zh-CN")
                        .putExtra(RecognizerIntent.EXTRA_PROMPT, "说出要记录的事情");
                state(a).owner = a.store.owner;
                a.startActivityForResult(i, 5104);
              } catch (ActivityNotFoundException e) {
                a.toast("这台手机没有启用系统语音识别服务，可以手动输入");
              }
            },
            true));
    a.ui.gap(a.content, 15);
    a.content.addView(a.ui.button("手动速记", () -> CampusSchool.personalForm(a, null), false));
    a.ui.empty(a.content, "文字由系统语音服务识别", "识别完成后会打开原生事项表单，由你确认后保存。系统语音服务是否联网由手机设置决定。");
  }

  static void recordings(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "课堂录音", "录制、标记与回听，用声音留下课堂重点。");
    LectureService.reconcile(a);
    android.content.SharedPreferences live = a.getSharedPreferences("campus_recorder", 0);
    boolean running = live.getBoolean("running", false);
    if (running) {
      LinearLayout c = u.card(a.content);
      c.addView(u.pill("录音正在进行"));
      u.gap(c, 11);
      c.addView(u.text(live.getString("title", "课堂录音"), 20, u.ink, true));
      u.gap(c, 9);
      c.addView(
          u.text(
              "已录 "
                  + CampusPlanner.duration(
                      System.currentTimeMillis()
                          - live.getLong("started", System.currentTimeMillis())),
              13,
              u.muted,
              false));
      u.gap(c, 15);
      c.addView(
          u.button(
              "结束并保存录音",
              () -> {
                a.startService(new Intent(a, LectureService.class).setAction("stop"));
                a.handler.postDelayed(() -> a.build(), 400);
              },
              true));
    } else
      a.content.addView(
          u.button(
              "开始课堂录音",
              () ->
                  u.form(
                      "录音名称",
                      CampusJson.obj("title", "课堂录音 " + DateMath.today()),
                      v ->
                          a.request(
                              Manifest.permission.RECORD_AUDIO,
                              () -> {
                                Intent i =
                                    new Intent(a, LectureService.class)
                                        .setAction("start")
                                        .putExtra("owner", a.store.owner)
                                        .putExtra("title", v.optString("title"));
                                if (Build.VERSION.SDK_INT >= 26) a.startForegroundService(i);
                                else a.startService(i);
                                a.handler.postDelayed(() -> a.build(), 800);
                              }),
                      CampusUi.f("title", "课程 / 录音标题")),
              true));
    String error = live.getString("error", "");
    if (!error.isEmpty()) a.content.addView(u.text(error, 12, u.muted, false));
    u.section(a.content, "已保存录音");
    List<JSONObject> rows = CampusJson.rows(a.store.list("native_recordings"));
    Collections.reverse(rows);
    for (JSONObject x : rows) {
      LinearLayout c = u.card(a.content);
      c.addView(u.text(x.optString("title"), 18, u.ink, true));
      c.addView(
          u.text(
              x.optString("date") + " · " + CampusPlanner.duration(x.optLong("duration")),
              12,
              u.muted,
              false));
      u.gap(c, 12);
      u.actionRow(
          c,
          new String[] {"回听 / 分享", "笔记 / 删除"},
          new Runnable[] {
            () ->
                u.choose(
                    "录音",
                    new String[] {"播放", "分享录音"},
                    i -> {
                      if (i == 0) play(a, x.optString("file"));
                      else shareFile(a, file(a, x.optString("file")), "audio/mp4");
                    }),
            () ->
                u.choose(
                    "录音操作",
                    new String[] {"编辑名称与笔记", "删除录音"},
                    i -> {
                      if (i == 0)
                        u.form(
                            "录音笔记",
                            x,
                            v -> {
                              a.store.replace("native_recordings", v.optString("id"), v);
                              a.build();
                            },
                            CampusUi.f("title", "名称"),
                            new CampusUi.Field("note", "重点笔记", "multiline", false));
                      else
                        u.confirm(
                            "删除录音？",
                            x.optString("title"),
                            () -> {
                              file(a, x.optString("file")).delete();
                              a.store.replace("native_recordings", x.optString("id"), null);
                              a.build();
                            });
                    })
          });
    }
    u.empty(a.content, "按需申请麦克风权限", "录音时会显示持续通知，离开页面继续录制。单次最多30分钟或12MB，避免长时间占用存储。");
  }

  static void play(CampusActivity a, String id) {
    try {
      MediaPlayer player = new MediaPlayer();
      player.setDataSource(file(a, id).getPath());
      player.prepare();
      player.start();
      AlertDialog dialog =
          new AlertDialog.Builder(a.ui.dialog())
              .setTitle("正在回听录音")
              .setMessage("关闭此窗口会停止播放。")
              .setPositiveButton("暂停 / 继续", null)
              .setNegativeButton("停止", (d, w) -> {})
              .setOnDismissListener(
                  d -> {
                    try {
                      player.stop();
                    } catch (Exception ignored) {
                    }
                    player.release();
                  })
              .create();
      dialog.setOnShowListener(
          d ->
              dialog
                  .getButton(AlertDialog.BUTTON_POSITIVE)
                  .setOnClickListener(
                      v -> {
                        if (player.isPlaying()) {
                          player.pause();
                          dialog.getButton(AlertDialog.BUTTON_POSITIVE).setText("继续播放");
                        } else {
                          player.start();
                          dialog.getButton(AlertDialog.BUTTON_POSITIVE).setText("暂停播放");
                        }
                      }));
      dialog.show();
    } catch (Exception e) {
      a.error(e);
    }
  }

  static void privacy(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "日记设备验证", "用这台手机的指纹、面容或锁屏密码打开日记。");
    KeyguardManager kg = (KeyguardManager) a.getSystemService(Context.KEYGUARD_SERVICE);
    u.empty(
        a.content,
        kg.isDeviceSecure() ? "设备已设置锁屏保护" : "请先设置手机锁屏保护",
        "此功能控制日记访问。照片与日记保存在App私有目录，完整备份由你选择导出的位置。");
    u.actionRow(
        a.content,
        new String[] {a.store.bool("native_diary_lock", false) ? "关闭日记验证" : "开启日记验证", "验证并打开日记"},
        new Runnable[] {
          () -> {
            if (!kg.isDeviceSecure()) {
              a.startActivity(new Intent(Settings.ACTION_SECURITY_SETTINGS));
              return;
            }
            if (a.store.bool("native_diary_lock", false))
              unlock(
                  a,
                  () -> {
                    a.store.set("native_diary_lock", false);
                    a.build();
                  });
            else {
              a.store.set("native_diary_lock", true);
              a.build();
            }
          },
          () -> unlock(a)
        });
  }

  static void unlock(CampusActivity a) {
    unlock(
        a,
        () -> {
          a.unlocked = true;
          a.open("diary");
        });
  }

  static void unlock(CampusActivity a, Runnable success) {
    KeyguardManager kg = (KeyguardManager) a.getSystemService(Context.KEYGUARD_SERVICE);
    if (!kg.isDeviceSecure()) {
      a.toast("请先为手机设置锁屏密码");
      return;
    }
    State s = state(a);
    s.owner = a.store.owner;
    s.biometricSuccess = success;
    if (Build.VERSION.SDK_INT >= 28) {
      s.biometric = new android.os.CancellationSignal();
      new BiometricPrompt.Builder(a)
          .setTitle("打开我的日记")
          .setSubtitle("使用手机设备验证")
          .setNegativeButton("使用设备密码", a.getMainExecutor(), (d, w) -> credential(a))
          .build()
          .authenticate(
              s.biometric,
              a.getMainExecutor(),
              new BiometricPrompt.AuthenticationCallback() {
                public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                  Runnable done = s.owner.equals(a.store.owner) ? s.biometricSuccess : null;
                  s.biometricSuccess = null;
                  if (done != null) done.run();
                }

                public void onAuthenticationError(int code, CharSequence reason) {
                  if (code == BiometricPrompt.BIOMETRIC_ERROR_NO_BIOMETRICS
                      || code == BiometricPrompt.BIOMETRIC_ERROR_HW_NOT_PRESENT
                      || code == BiometricPrompt.BIOMETRIC_ERROR_HW_UNAVAILABLE) credential(a);
                  else if (code != BiometricPrompt.BIOMETRIC_ERROR_USER_CANCELED
                      && code != BiometricPrompt.BIOMETRIC_ERROR_CANCELED)
                    a.toast(reason.toString());
                }
              });
    } else credential(a);
  }

  static void credential(CampusActivity a) {
    Intent i =
        ((KeyguardManager) a.getSystemService(Context.KEYGUARD_SERVICE))
            .createConfirmDeviceCredentialIntent("捞捞日记", "验证设备锁屏密码后继续");
    if (i != null) a.startActivityForResult(i, 5107);
    else a.toast("设备未提供锁屏验证");
  }

  static void cancelBiometric() {
    /* Platform prompt manages cancellation; retaining the callback allows credential fallback. */
  }

  static void quiet(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "上课自动勿扰", "按真实课表切换安静模式，下课后恢复原状态。");
    NotificationManager nm = a.getSystemService(NotificationManager.class);
    boolean access = nm.isNotificationPolicyAccessGranted();
    u.empty(
        a.content,
        access ? "已获得勿扰访问权限" : "先授予系统勿扰访问权限",
        "只在你开启自动勿扰后，按已保存课程的上课时间调整系统。若你手动改变模式，App不会覆盖你的新选择。");
    u.actionRow(
        a.content,
        new String[] {"打开勿扰权限设置", a.store.bool("native_quiet", false) ? "关闭自动勿扰" : "开启自动勿扰"},
        new Runnable[] {
          () -> a.startActivity(new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)),
          () -> {
            if (!access) {
              a.toast("请先在系统设置中授予权限");
              return;
            }
            boolean on = !a.store.bool("native_quiet", false);
            a.store.set("native_quiet", on);
            if (on) CampusDndReceiver.scheduleNext(a, a.store);
            else CampusDndReceiver.restoreFilter(a);
            a.build();
          }
        });
    u.gap(a.content, 14);
    a.content.addView(
        u.button(
            "重新按课表安排勿扰",
            () -> {
              CampusDndReceiver.scheduleNext(a, a.store);
              a.toast("已按当前课表更新");
            },
            false));
  }

  static void places(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "校园位置书签", "存下教室、操场与常去的地方。");
    u.actionRow(
        a.content,
        new String[] {"保存当前位置", "手动添加地点"},
        new Runnable[] {() -> locate(a), () -> placeForm(a, null)});
    JSONObject here = a.store.object("native_location");
    for (JSONObject x : CampusJson.rows(a.store.list("native_places"))) {
      LinearLayout c = u.card(a.content);
      c.addView(u.text(x.optString("name"), 18, u.ink, true));
      u.gap(c, 7);
      String distance = "";
      if (here.has("lat")) {
        float[] d = new float[1];
        Location.distanceBetween(
            here.optDouble("lat"),
            here.optDouble("lon"),
            x.optDouble("lat"),
            x.optDouble("lon"),
            d);
        distance = " · 距上次定位 " + Math.round(d[0]) + "米";
      }
      c.addView(u.text(x.optString("note") + distance, 12, u.muted, false));
      u.gap(c, 13);
      u.actionRow(
          c,
          new String[] {"在地图中导航", "编辑 / 删除"},
          new Runnable[] {
            () -> {
              Uri geo =
                  Uri.parse(
                      "geo:"
                          + x.optDouble("lat")
                          + ","
                          + x.optDouble("lon")
                          + "?q="
                          + x.optDouble("lat")
                          + ","
                          + x.optDouble("lon")
                          + "("
                          + Uri.encode(x.optString("name"))
                          + ")");
              try {
                a.startActivity(new Intent(Intent.ACTION_VIEW, geo));
              } catch (ActivityNotFoundException e) {
                a.toast("没有可用的地图App，可复制地点坐标");
                CampusManage.copy(a, "坐标", x.optDouble("lat") + "," + x.optDouble("lon"));
              }
            },
            () ->
                u.choose(
                    "地点操作",
                    new String[] {"编辑", "删除"},
                    i -> {
                      if (i == 0) placeForm(a, x);
                      else
                        u.confirm(
                            "删除地点？",
                            x.optString("name"),
                            () -> {
                              a.store.replace("native_places", x.optString("id"), null);
                              a.build();
                            });
                    })
          });
    }
    if (a.store.list("native_places").length() == 0)
      u.empty(a.content, "把常去的地方存下来", "坐标只保存在当前账号的本机空间，不持续跟踪位置。");
  }

  static void locate(CampusActivity a) {
    a.request(
        Manifest.permission.ACCESS_FINE_LOCATION,
        () -> {
          LocationManager manager = (LocationManager) a.getSystemService(Context.LOCATION_SERVICE);
          try {
            List<String> providers = manager.getProviders(true);
            boolean precise =
                a.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                    == android.content.pm.PackageManager.PERMISSION_GRANTED;
            Location best = null;
            for (String provider : providers) {
              if (!precise && provider.equals(LocationManager.GPS_PROVIDER)) continue;
              Location last = manager.getLastKnownLocation(provider);
              if (last != null && (best == null || last.getTime() > best.getTime())) best = last;
            }
            if (best != null && System.currentTimeMillis() - best.getTime() < 120000) {
              locationFound(a, best);
              return;
            }
            String provider =
                precise && providers.contains(LocationManager.GPS_PROVIDER)
                    ? LocationManager.GPS_PROVIDER
                    : providers.contains(LocationManager.NETWORK_PROVIDER)
                        ? LocationManager.NETWORK_PROVIDER
                        : null;
            if (provider == null) {
              a.toast("请在系统设置开启定位");
              a.startActivity(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS));
              return;
            }
            State st = state(a);
            st.owner = a.store.owner;
            if (st.location != null) manager.removeUpdates(st.location);
            LocationListener listener =
                new LocationListener() {
                  public void onLocationChanged(Location l) {
                    manager.removeUpdates(this);
                    st.location = null;
                    if (st.owner.equals(a.store.owner)) locationFound(a, l);
                  }

                  public void onStatusChanged(String p, int s, Bundle e) {}

                  public void onProviderEnabled(String p) {}

                  public void onProviderDisabled(String p) {}
                };
            st.location = listener;
            manager.requestLocationUpdates(provider, 0, 0, listener);
            a.toast("正在定位，请稍候…");
            a.handler.postDelayed(
                () -> {
                  if (st.location == listener) {
                    manager.removeUpdates(listener);
                    st.location = null;
                    a.toast("暂时无法定位，可手动输入地点坐标");
                  }
                },
                20000);
          } catch (Exception e) {
            a.error(e);
          }
        });
  }

  static void locationFound(CampusActivity a, Location l) {
    JSONObject here =
        CampusJson.obj(
            "lat",
            l.getLatitude(),
            "lon",
            l.getLongitude(),
            "accuracy",
            l.getAccuracy(),
            "at",
            l.getTime());
    a.store.set("native_location", here);
    placeForm(
        a, CampusJson.obj("id", CampusJson.id(), "lat", l.getLatitude(), "lon", l.getLongitude()));
  }

  static void placeForm(CampusActivity a, JSONObject x) {
    a.ui.form(
        "校园地点",
        x == null ? CampusJson.obj("id", CampusJson.id()) : x,
        v -> {
          double lat = Double.parseDouble(v.optString("lat")),
              lon = Double.parseDouble(v.optString("lon"));
          if (!Double.isFinite(lat)
              || !Double.isFinite(lon)
              || Math.abs(lat) > 90
              || Math.abs(lon) > 180) throw new IllegalArgumentException("坐标范围无效");
          CampusJson.put(v, "lat", lat);
          CampusJson.put(v, "lon", lon);
          a.store.replace("native_places", v.optString("id"), v);
          a.build();
        },
        CampusUi.f("name", "地点名称"),
        CampusUi.f("lat", "纬度（支持负数）"),
        CampusUi.f("lon", "经度（支持负数）"),
        CampusUi.optional("note", "地点提示"));
  }

  static void scanner(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "资料扫描成 PDF", "多张照片，整理成一份可以分享的学习材料。");
    u.actionRow(
        a.content,
        new String[] {"＋ 拍照 / 加页", "生成 PDF"},
        new Runnable[] {
          () ->
              photo(
                  a,
                  id -> {
                    JSONArray rows = a.store.list("native_scan_pages");
                    rows.put(id);
                    a.store.set("native_scan_pages", rows);
                    a.build();
                  }),
          () ->
              u.form(
                  "导出扫描材料",
                  CampusJson.obj("name", "学习材料-" + DateMath.today()),
                  v -> pdf(a, v.optString("name")),
                  CampusUi.f("name", "文件名称"))
        });
    JSONArray pages = a.store.list("native_scan_pages");
    for (int i = 0; i < pages.length(); i++) {
      final int at = i;
      String id = pages.optString(i);
      LinearLayout c = u.card(a.content);
      c.addView(u.text("第 " + (i + 1) + " 页", 16, u.ink, true));
      image(a, c, id);
      u.actionRow(
          c,
          new String[] {"裁边 / 旋转", "移除 / 上移"},
          new Runnable[] {
            () -> crop(a, id, at),
            () ->
                u.choose(
                    "页面顺序",
                    new String[] {"移除", "上移"},
                    j -> {
                      if (j == 0) pages.remove(at);
                      else if (at > 0)
                        try {
                          Object before = pages.opt(at - 1);
                          pages.put(at - 1, id);
                          pages.put(at, before);
                        } catch (Exception e) {
                          a.error(e);
                        }
                      a.store.set("native_scan_pages", pages);
                      a.build();
                    })
          });
    }
    if (pages.length() == 0)
      u.empty(a.content, "添加第一张资料照片", "支持旋转、按百分比裁边、灰度处理与多页PDF。此工具不会假装已识别出文字。");
  }

  static void crop(CampusActivity a, String id, int index) {
    a.ui.form(
        "裁边与旋转",
        CampusJson.obj(
            "left", 0, "top", 0, "right", 100, "bottom", 100, "rotate", "不旋转", "gray", false),
        v -> {
          int left = v.optInt("left"),
              top = v.optInt("top"),
              right = v.optInt("right"),
              bottom = v.optInt("bottom");
          if (left < 0 || top < 0 || right > 100 || bottom > 100 || right <= left || bottom <= top)
            throw new IllegalArgumentException("裁边范围需在0—100之间，右侧与底部大于左侧与顶部");
          Bitmap bitmap = BitmapFactory.decodeFile(file(a, id).getPath());
          if (bitmap == null) throw new IOException("图片无法读取");
          int x = bitmap.getWidth() * left / 100,
              y = bitmap.getHeight() * top / 100,
              w = Math.max(1, bitmap.getWidth() * (right - left) / 100),
              h = Math.max(1, bitmap.getHeight() * (bottom - top) / 100);
          Matrix m = new Matrix();
          m.setRotate(
              v.optString("rotate").equals("顺时针90°")
                  ? 90
                  : v.optString("rotate").equals("180°") ? 180 : 0);
          Bitmap cropped =
              Bitmap.createBitmap(
                  bitmap,
                  x,
                  y,
                  Math.min(w, bitmap.getWidth() - x),
                  Math.min(h, bitmap.getHeight() - y),
                  m,
                  true);
          if (v.optBoolean("gray")) {
            Bitmap gray =
                Bitmap.createBitmap(
                    cropped.getWidth(), cropped.getHeight(), Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(gray);
            ColorMatrix cm = new ColorMatrix();
            cm.setSaturation(0);
            Paint p = new Paint();
            p.setColorFilter(new ColorMatrixColorFilter(cm));
            canvas.drawBitmap(cropped, 0, 0, p);
            if (cropped != bitmap) cropped.recycle();
            cropped = gray;
          }
          String out = CampusJson.id() + ".jpg";
          try (OutputStream stream = new FileOutputStream(file(a, out))) {
            cropped.compress(Bitmap.CompressFormat.JPEG, 88, stream);
          }
          if (cropped != bitmap) cropped.recycle();
          bitmap.recycle();
          JSONArray pages = a.store.list("native_scan_pages");
          pages.put(index, out);
          a.store.set("native_scan_pages", pages);
          a.build();
        },
        CampusUi.f("left", "左边界 %", "number"),
        CampusUi.f("top", "上边界 %", "number"),
        CampusUi.f("right", "右边界 %", "number"),
        CampusUi.f("bottom", "下边界 %", "number"),
        CampusUi.choice("rotate", "旋转", "不旋转", "顺时针90°", "180°"),
        CampusUi.f("gray", "转为灰度", "boolean"));
  }

  static void pdf(CampusActivity a, String name) {
    JSONArray pages = a.store.list("native_scan_pages");
    if (pages.length() == 0) {
      a.toast("请先添加资料照片");
      return;
    }
    a.background(
        "生成 PDF",
        () -> {
          PdfDocument doc = new PdfDocument();
          try {
            for (int i = 0; i < pages.length(); i++) {
              Bitmap bitmap = BitmapFactory.decodeFile(file(a, pages.optString(i)).getPath());
              if (bitmap == null) throw new IOException("第" + (i + 1) + "页照片缺失");
              PdfDocument.Page page =
                  doc.startPage(new PdfDocument.PageInfo.Builder(595, 842, i + 1).create());
              float scale = Math.min(555f / bitmap.getWidth(), 802f / bitmap.getHeight());
              float w = bitmap.getWidth() * scale, h = bitmap.getHeight() * scale;
              page.getCanvas()
                  .drawBitmap(
                      bitmap,
                      null,
                      new RectF((595 - w) / 2, (842 - h) / 2, (595 + w) / 2, (842 + h) / 2),
                      new Paint(3));
              doc.finishPage(page);
              bitmap.recycle();
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            doc.writeTo(out);
            return out.toByteArray();
          } finally {
            doc.close();
          }
        },
        r ->
            exportBytes(
                a, name.replaceAll("[\\/:*?\"<>|]", "_") + ".pdf", (byte[]) r, "application/pdf"));
  }

  static void contacts(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "校园快捷联系", "班委、同学与常用服务，按需准备拨号。");
    u.actionRow(
        a.content,
        new String[] {"从通讯录挑选", "手动添加"},
        new Runnable[] {
          () -> {
            try {
              state(a).owner = a.store.owner;
              a.startActivityForResult(
                  new Intent(
                      Intent.ACTION_PICK, ContactsContract.CommonDataKinds.Phone.CONTENT_URI),
                  5105);
            } catch (Exception e) {
              a.error(e);
            }
          },
          () -> contactForm(a, null)
        });
    for (JSONObject x : CampusJson.rows(a.store.list("native_contacts"))) {
      LinearLayout c = u.card(a.content);
      c.addView(u.text(x.optString("name"), 18, u.ink, true));
      c.addView(u.text(x.optString("number") + " · " + x.optString("note"), 13, u.muted, false));
      u.gap(c, 13);
      u.actionRow(
          c,
          new String[] {"准备拨号", "编辑 / 删除"},
          new Runnable[] {
            () -> {
              try {
                a.startActivity(
                    new Intent(
                        Intent.ACTION_DIAL, Uri.fromParts("tel", x.optString("number"), null)));
              } catch (Exception e) {
                a.error(e);
              }
            },
            () ->
                u.choose(
                    "联系人操作",
                    new String[] {"编辑", "删除"},
                    i -> {
                      if (i == 0) contactForm(a, x);
                      else
                        a.ui.confirm(
                            "删除快捷联系？",
                            x.optString("name"),
                            () -> {
                              a.store.replace("native_contacts", x.optString("id"), null);
                              a.build();
                            });
                    })
          });
    }
    if (a.store.list("native_contacts").length() == 0)
      u.empty(a.content, "挑选你需要的联系人", "只读取你在系统选择器中选中的号码，不申请整本通讯录权限。");
  }

  static void contactForm(CampusActivity a, JSONObject x) {
    a.ui.form(
        "快捷联系",
        x == null ? CampusJson.obj("id", CampusJson.id()) : x,
        v -> {
          if (!v.optString("number").matches("[+0-9 ()-]{3,30}"))
            throw new IllegalArgumentException("电话号码格式无效");
          a.store.replace("native_contacts", v.optString("id"), v);
          a.build();
        },
        CampusUi.f("name", "联系人 / 服务名称"),
        CampusUi.f("number", "电话号码"),
        CampusUi.optional("note", "联系提示"));
  }

  static void exportBytes(CampusActivity a, String name, byte[] data, String mime) {
    State s = state(a);
    s.exported = data;
    s.owner = a.store.owner;
    a.startActivityForResult(
        new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .setType(mime)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .putExtra(Intent.EXTRA_TITLE, name),
        5108);
  }

  static void shareText(CampusActivity a, String text) {
    a.startActivity(
        Intent.createChooser(
            new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text),
            "分享学习记录"));
  }

  static void shareFile(CampusActivity a, File f, String type) {
    try {
      File shared = new File(a.getCacheDir(), "shared");
      shared.mkdirs();
      File copy = new File(shared, f.getName());
      try (InputStream in = new FileInputStream(f);
          OutputStream out = new FileOutputStream(copy)) {
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
      }
      Uri uri = FilesProvider.uriFor(copy);
      Intent send =
          new Intent(Intent.ACTION_SEND)
              .setType(type)
              .putExtra(Intent.EXTRA_STREAM, uri)
              .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
      send.setClipData(ClipData.newRawUri("学习附件", uri));
      a.startActivity(Intent.createChooser(send, "分享附件"));
    } catch (Exception e) {
      a.error(e);
    }
  }

  static void exportBackup(CampusActivity a) {
    a.background(
        "整理完整备份",
        () -> {
          JSONObject backup = a.store.backup(), files = new JSONObject();
          File[] all = media(a, a.store.owner).listFiles();
          Set<String> referenced = new HashSet<>();
          mediaReferences(backup.opt("data"), referenced);
          int total = 0;
          for (File f : all == null ? new File[0] : all) {
            if (!validId(f.getName()) || !referenced.contains(f.getName())) continue;
            byte[] data = bytes(f, 12000000);
            total += data.length;
            if (total > 18000000) throw new IOException("附件合计超过18MB，请先分别分享录音或资料；也可导出学习数据备份");
            CampusJson.put(files, f.getName(), Base64.encodeToString(data, Base64.NO_WRAP));
          }
          CampusJson.put(backup, "files", files);
          String raw = backup.toString();
          if (raw.getBytes("UTF-8").length > 32000000)
            throw new IOException("完整备份超过32MB，请导出学习数据备份，并分别分享录音或资料");
          return raw;
        },
        r ->
            a.export(
                "捞捞校园-完整备份-" + DateMath.today() + ".json", String.valueOf(r), "application/json"));
  }

  static void restoreBackup(CampusActivity a, String raw) throws Exception {
    JSONObject data = new JSONObject(raw), files = data.optJSONObject("files");
    List<File> made = new ArrayList<>();
    try {
      int total = 0;
      if (files != null)
        for (String id : CampusJson.keys(files)) {
          if (!validId(id)) throw new IOException("备份附件路径无效");
          byte[] bytes = Base64.decode(files.getString(id), Base64.DEFAULT);
          total += bytes.length;
          if (bytes.length > 12000000 || total > 18000000) throw new IOException("备份附件过大");
          File target = file(a, id);
          if (target.exists()) {
            if (!Arrays.equals(bytes(target, 12000000), bytes))
              throw new IOException("附件编号冲突，现有文件未覆盖");
            continue;
          }
          made.add(target);
          try (OutputStream out = new FileOutputStream(target)) {
            out.write(bytes);
          }
        }
      a.store.restore(raw);
    } catch (Exception e) {
      for (File f : made) f.delete();
      throw e;
    }
  }

  static void mediaReferences(Object value, Set<String> out) {
    if (value instanceof JSONObject)
      for (String key : CampusJson.keys((JSONObject) value))
        mediaReferences(((JSONObject) value).opt(key), out);
    else if (value instanceof JSONArray) {
      JSONArray rows = (JSONArray) value;
      for (int i = 0; i < rows.length(); i++) mediaReferences(rows.opt(i), out);
    } else if (value instanceof String && validId((String) value)) out.add((String) value);
  }

  static boolean result(CampusActivity a, int code, int result, Intent data) {
    if (code < 5101 || code > 5108) return false;
    State s = state(a);
    if (s.owner != null && !s.owner.equals(a.store.owner)) {
      a.toast("账号已切换，请重新选择操作");
      return true;
    }
    if (result != Activity.RESULT_OK) {
      s.photo = null;
      return true;
    }
    try {
      if (code == 5101 || code == 5102) {
        InputStream in;
        if (code == 5101) {
          if (s.camera == null) throw new IOException("拍照状态已结束，请重新拍摄");
          in = new FileInputStream(new File(new File(a.getCacheDir(), "shared"), s.camera));
        } else {
          if (data == null || data.getData() == null) return true;
          in = a.getContentResolver().openInputStream(data.getData());
        }
        String id = savePhoto(a, in);
        Consumer<String> callback = s.photo;
        s.photo = null;
        if (callback != null) callback.accept(id);
        else a.toast("照片已保存，请重新打开要编辑的记录");
      } else if (code == 5103) {
        if (data == null || data.getData() == null) return true;
        String raw =
            CampusApi.read(a.getContentResolver().openInputStream(data.getData()), 4000000);
        String kind = s.jsonKind == null ? "" : s.jsonKind;
        if (kind.equals("courses")) CampusCourses.importJson(a, raw);
        else if (kind.equals("legacy")) importLegacy(a, raw);
        else if (kind.startsWith("plugin-")) {
          JSONObject files = a.store.object("draft_plugin_files");
          CampusJson.put(files, kind.equals("plugin-js") ? "code" : "app_html", raw);
          a.store.set("draft_plugin_files", files);
          a.open("draft-code");
        }
      } else if (code == 5104) {
        ArrayList<String> values =
            data == null ? null : data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        if (values != null && !values.isEmpty())
          CampusSchool.personalForm(
              a,
              CampusJson.obj(
                  "id",
                  CampusJson.id(),
                  "subject",
                  values.get(0),
                  "event_time",
                  DateMath.today(),
                  "note",
                  "语音速记"));
      } else if (code == 5105) {
        if (data == null || data.getData() == null) return true;
        try (Cursor cursor =
            a.getContentResolver()
                .query(
                    data.getData(),
                    new String[] {
                      ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                      ContactsContract.CommonDataKinds.Phone.NUMBER
                    },
                    null,
                    null,
                    null)) {
          if (cursor != null && cursor.moveToFirst())
            contactForm(
                a,
                CampusJson.obj(
                    "id",
                    CampusJson.id(),
                    "name",
                    cursor.getString(0),
                    "number",
                    cursor.getString(1)));
        }
      } else if (code == 5107) {
        Runnable callback = s.biometricSuccess;
        s.biometricSuccess = null;
        if (callback != null) callback.run();
      } else if (code == 5108) {
        if (data == null || data.getData() == null || s.exported == null)
          throw new IOException("导出任务已结束，请重新导出");
        try (OutputStream out = a.getContentResolver().openOutputStream(data.getData())) {
          out.write(s.exported);
        }
        s.exported = null;
        a.toast("文件已导出");
      }
    } catch (Exception e) {
      a.error(e);
    }
    return true;
  }

  static void importLegacy(CampusActivity a, String raw) throws Exception {
    JSONObject d = NativeData.backup(raw);
    a.ui.confirm(
        "迁移上一版工具记录？",
        "将把可识别的记录加入当前账号，不删除旧版资料。",
        () -> {
          for (JSONObject x : CampusJson.rows(d.opt("items"))) {
            String type = x.optString("type"), id = x.optString("id");
            if (type.equals("task"))
              a.store.replace(
                  "personal_events_v1",
                  id,
                  CampusJson.obj(
                      "id",
                      id,
                      "subject",
                      x.optString("title"),
                      "event_time",
                      x.optString("date"),
                      "note",
                      x.optString("note"),
                      "location",
                      "",
                      "done",
                      x.optBoolean("done")));
            else if (type.equals("exam"))
              a.store.replace(
                  "native_exams",
                  id,
                  CampusJson.obj(
                      "id",
                      id,
                      "title",
                      x.optString("title"),
                      "date",
                      x.optString("date"),
                      "time",
                      "09:00",
                      "note",
                      x.optString("note"),
                      "goals",
                      new JSONArray()));
            else if (type.equals("card"))
              a.store.replace(
                  "native_cards",
                  id,
                  CampusJson.obj(
                      "id",
                      id,
                      "question",
                      x.optString("title"),
                      "answer",
                      x.optString("answer"),
                      "level",
                      x.optInt("level"),
                      "due",
                      x.optString("date", DateMath.today())));
            else if (type.equals("expense"))
              a.store.replace(
                  "native_ledger",
                  id,
                  CampusJson.obj(
                      "id",
                      id,
                      "title",
                      x.optString("title"),
                      "date",
                      x.optString("date"),
                      "kind",
                      "支出",
                      "category",
                      x.optString("note", "其他"),
                      "cents",
                      Math.round(x.optDouble("amount") * 100)));
            else if (type.equals("pack")) a.store.replace("native_pack", id, x);
            else if (type.equals("diary"))
              a.store.entry(
                  "native_diary",
                  x.optString("date"),
                  CampusJson.obj(
                      "date",
                      x.optString("date"),
                      "text",
                      x.optString("note"),
                      "mood",
                      x.optString("title"),
                      "photos",
                      new JSONArray()));
          }
          a.toast("旧版学习记录已迁移");
          a.build();
        });
  }

  static void message(CampusActivity a, String title, String text) {
    CampusManage.message(a, title, text);
  }

  static void release(CampusActivity a) {
    State s = states.remove(a);
    if (s == null) return;
    if (s.location != null)
      try {
        ((LocationManager) a.getSystemService(Context.LOCATION_SERVICE)).removeUpdates(s.location);
      } catch (Exception ignored) {
      }
    if (s.biometric != null) s.biometric.cancel();
    s.biometricSuccess = null;
  }
}
