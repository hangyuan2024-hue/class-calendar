package com.laolao.classcalendar;

import android.graphics.*;
import android.text.TextUtils;
import android.view.*;
import android.widget.*;
import java.util.*;
import org.json.*;

/** Subject covers are an alternate entrance to the existing wrong-answer records. */
final class CampusBookshelf {
  static void render(CampusActivity a) {
    CampusUi u = a.ui;
    Map<String, int[]> books = new TreeMap<>();
    for (JSONObject note : CampusJson.rows(a.store.list("native_wrong"))) {
      String subject = note.optString("subject");
      int[] counts = books.computeIfAbsent(subject, ignored -> new int[2]);
      counts[0]++;
      if (note.optBoolean("mastered")) counts[1]++;
    }
    if (books.isEmpty()) return;
    u.section(a.content, "我的学科书架");
    int columns =
        a.getResources().getConfiguration().fontScale > 1.25f
            ? 1
            : a.getResources().getConfiguration().screenWidthDp >= 600 ? 3 : 2;
    LinearLayout line = null;
    int index = 0;
    for (Map.Entry<String, int[]> entry : books.entrySet()) {
      if (index % columns == 0) {
        line = u.row();
        line.setGravity(Gravity.TOP);
        a.content.addView(line);
      }
      String subject = entry.getKey(), label = subject.isEmpty() ? "未分类" : subject;
      int colour =
          new int[] {u.accent, 0xff8c5a3d, 0xff725b9c, 0xff357b82, 0xff465f89}
              [(subject.hashCode() & 0x7fffffff) % 5];
      colour = CampusUi.readableAccent(colour, Color.WHITE);
      LinearLayout tile = u.column();
      tile.setPadding(u.dp(11), u.dp(11), u.dp(11), u.dp(13));
      u.touch(tile, u.surface, 18, u.border);
      FrameLayout cover = new FrameLayout(a);
      cover.addView(new Cover(a, colour), new FrameLayout.LayoutParams(-1, -1));
      LinearLayout lettering = u.column();
      lettering.setPadding(u.dp(21), u.dp(19), u.dp(15), u.dp(14));
      TextView name = u.text(label, 17, Color.WHITE, true);
      name.setMaxLines(2);
      name.setEllipsize(TextUtils.TruncateAt.END);
      lettering.addView(name);
      u.gap(lettering, 7);
      lettering.addView(u.text("错题记录本", 10, CampusUi.blend(Color.WHITE, colour, .82f), false));
      cover.addView(lettering, new FrameLayout.LayoutParams(-1, -2));
      tile.addView(
          cover,
          new LinearLayout.LayoutParams(
              -1, u.dp(a.getResources().getConfiguration().fontScale > 1.25f ? 142 : 121)));
      u.gap(tile, 10);
      tile.addView(
          u.text(
              entry.getValue()[0] + " 道错题 · " + entry.getValue()[1] + " 道已掌握", 10, u.muted, false));
      tile.setContentDescription("打开" + label + "错题本，" + entry.getValue()[0] + "道错题");
      tile.setOnClickListener(
          v -> {
            a.store.set("native_wrong_subject", subject);
            a.scroll.scrollTo(0, 0);
            a.build();
          });
      LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, -2, 1);
      lp.bottomMargin = u.dp(12);
      if (index % columns != 0) lp.leftMargin = u.dp(12);
      line.addView(tile, lp);
      index++;
    }
    if (line != null)
      while (line.getChildCount() < columns) {
        LinearLayout.LayoutParams space = new LinearLayout.LayoutParams(0, 1, 1);
        space.leftMargin = u.dp(12);
        line.addView(new View(a), space);
      }
    u.section(a.content, "全部错题");
  }

  static final class Cover extends View {
    final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
    final CampusUi u;
    final int colour;

    Cover(CampusActivity a, int colour) {
      super(a);
      u = a.ui;
      this.colour = colour;
      setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
    }

    @Override
    protected void onDraw(Canvas c) {
      float w = getWidth(), h = getHeight(), d = u.dp(1);
      p.setColor(CampusUi.blend(colour, u.surface, .13f));
      c.drawRoundRect(6 * d, 4 * d, w, h, 9 * d, 9 * d, p);
      p.setColor(0xffefeee8);
      c.drawRoundRect(8 * d, 4 * d, w - 3 * d, h - 3 * d, 7 * d, 7 * d, p);
      p.setColor(0xffdcdad2);
      c.drawRect(w - 10 * d, 9 * d, w - 4 * d, h - 7 * d, p);
      p.setShader(
          new LinearGradient(
              0,
              0,
              w,
              h,
              colour,
              CampusUi.blend(Color.BLACK, colour, .10f),
              Shader.TileMode.CLAMP));
      c.drawRoundRect(0, 0, w - 8 * d, h - 7 * d, 7 * d, 7 * d, p);
      p.setShader(null);
      p.setColor(CampusUi.blend(Color.BLACK, colour, .10f));
      c.drawRect(8 * d, 0, 11 * d, h - 7 * d, p);
      p.setColor(CampusUi.blend(Color.WHITE, colour, .18f));
      c.drawRect(12 * d, 2 * d, 13 * d, h - 9 * d, p);
      p.setStyle(Paint.Style.STROKE);
      p.setStrokeWidth(d);
      p.setColor(CampusUi.blend(Color.WHITE, colour, .30f));
      c.drawCircle(w - 32 * d, h - 29 * d, 10 * d, p);
      c.drawLine(w - 37 * d, h - 29 * d, w - 33 * d, h - 25 * d, p);
      c.drawLine(w - 33 * d, h - 25 * d, w - 26 * d, h - 33 * d, p);
      p.setStyle(Paint.Style.FILL);
    }
  }
}
