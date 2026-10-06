package com.laolao.classcalendar;

import android.content.res.ColorStateList;
import android.graphics.*;
import android.view.*;
import android.widget.*;
import org.json.*;

/** Native palette gallery; tapping a preview applies the complete palette immediately. */
final class CampusSkins {
  static void apply(CampusActivity a, CampusTheme.Preset p) {
    try {
      a.store.batch(
          CampusJson.obj(
              "ui_skin_v1",
              p.dark ? "cyber" : "fresh",
              "ui_palette_v1",
              CampusJson.obj("id", p.id, "p", CampusTheme.hex(p.primary))));
      a.build();
      a.syncSoon();
    } catch (Exception e) {
      a.error(e);
    }
  }

  static void render(CampusActivity a) {
    CampusUi u = a.ui;
    u.title(a.content, "给校园，换一种心情。", "八套完整配色，点选即可应用。设置按账号保留。");
    LinearLayout current = u.card(a.content);
    current.setPadding(u.dp(16), u.dp(15), u.dp(16), u.dp(15));
    LinearLayout heading = u.row();
    heading.addView(u.badge("appearance"), new LinearLayout.LayoutParams(u.dp(38), u.dp(38)));
    LinearLayout copy = u.column();
    copy.addView(u.text("正在使用 · " + u.theme.preset.name, 15, u.ink, true));
    u.gap(copy, 5);
    copy.addView(
        u.text(
            a.store.string("ui_skin_v1", "fresh").equals("auto")
                ? "随手机自动切换深浅色"
                : u.theme.preset.note,
            12,
            u.muted,
            false));
    LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(0, -2, 1);
    cp.leftMargin = u.dp(12);
    heading.addView(copy, cp);
    current.addView(heading);
    u.section(a.content, "选择你的颜色");
    boolean automatic = a.store.string("ui_skin_v1", "fresh").equals("auto");
    int columns =
        a.getResources().getConfiguration().fontScale > 1.25f
            ? 1
            : a.getResources().getConfiguration().screenWidthDp >= 600 ? 4 : 2;
    for (int start = 0; start < CampusTheme.PRESETS.length; start += columns) {
      LinearLayout row = u.row();
      row.setGravity(Gravity.TOP);
      for (int j = start; j < Math.min(start + columns, CampusTheme.PRESETS.length); j++) {
        CampusTheme.Preset p = CampusTheme.PRESETS[j];
        boolean selected = !automatic && p.id.equals(u.theme.preset.id);
        LinearLayout tile = u.column();
        tile.setPadding(u.dp(6), u.dp(6), u.dp(6), u.dp(13));
        u.touch(tile, u.surface, 20, selected ? u.accent : 0);
        tile.setSelected(selected);
        tile.addView(
            new Preview(a, CampusTheme.preview(p)), new LinearLayout.LayoutParams(-1, u.dp(108)));
        LinearLayout label = u.row();
        label.setPadding(u.dp(8), u.dp(12), u.dp(8), 0);
        label.addView(u.text(p.name, 14, u.ink, true), new LinearLayout.LayoutParams(0, -2, 1));
        TextView state = u.text(selected ? "✓" : "", 15, u.accent, true);
        state.setGravity(Gravity.CENTER);
        label.addView(state, new LinearLayout.LayoutParams(u.dp(22), -2));
        tile.addView(label);
        TextView note =
            u.text(
                p.dark ? "深色 · " + p.note.split(" · ")[0] : "浅色 · " + p.note.split(" · ")[0],
                11,
                u.muted,
                false);
        note.setPadding(u.dp(8), u.dp(5), u.dp(8), 0);
        tile.addView(note);
        tile.setContentDescription(
            "应用" + p.name + "皮肤，" + (p.dark ? "深色" : "浅色") + (selected ? "，已选中" : ""));
        tile.setOnClickListener(v -> apply(a, p));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, -2, 1);
        lp.bottomMargin = u.dp(12);
        if (j > start) lp.leftMargin = u.dp(12);
        row.addView(tile, lp);
      }
      a.content.addView(row);
    }
    LinearLayout mode = u.card(a.content);
    mode.setPadding(u.dp(16), u.dp(6), u.dp(16), u.dp(6));
    Switch system = new Switch(u.dialog());
    system.setText("跟随手机深浅色");
    system.setTextSize(14);
    system.setTextColor(u.ink);
    system.setPadding(0, u.dp(12), 0, u.dp(12));
    system.setMinHeight(u.dp(52));
    system.setThumbTintList(
        new ColorStateList(
            new int[][] {new int[] {android.R.attr.state_checked}, new int[] {}},
            new int[] {u.accent, u.muted}));
    system.setChecked(automatic);
    system.setOnCheckedChangeListener(
        (v, on) -> {
          CampusTheme.Preset chosen = u.theme.preset;
          JSONObject updates = new JSONObject();
          if (on && chosen.dark) {
            chosen = CampusTheme.PRESETS[0];
            CampusJson.put(
                updates,
                "ui_palette_v1",
                CampusJson.obj("id", chosen.id, "p", CampusTheme.hex(chosen.primary)));
          }
          CampusJson.put(updates, "ui_skin_v1", on ? "auto" : chosen.dark ? "cyber" : "fresh");
          try {
            a.store.batch(updates);
            a.build();
            a.syncSoon();
          } catch (Exception e) {
            a.error(e);
            a.build();
          }
        });
    mode.addView(system);
    TextView explain = u.text("元宇宙保持深色星系，并随所选皮肤变换星光颜色。", 12, u.muted, false);
    LinearLayout.LayoutParams ep = new LinearLayout.LayoutParams(-1, -2);
    ep.setMargins(0, 0, 0, u.dp(12));
    mode.addView(explain, ep);
  }

  /** Abstract native colour preview; no sample user statistics or fabricated records. */
  static final class Preview extends View {
    final CampusTheme t;
    final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);

    Preview(CampusActivity a, CampusTheme t) {
      super(a);
      this.t = t;
      setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
    }

    void rect(Canvas c, float l, float top, float r, float b, float radius, int colour) {
      p.setColor(colour);
      c.drawRoundRect(l, top, r, b, radius, radius, p);
    }

    @Override
    protected void onDraw(Canvas c) {
      c.save();
      c.scale(getWidth() / 160f, getHeight() / 108f);
      rect(c, 0, 0, 160, 108, 15, t.bg);
      rect(c, 12, 11, 22, 21, 4, t.primary);
      rect(c, 28, 12, 61, 15, 1.5f, t.ink);
      rect(c, 28, 18, 49, 20, 1, t.muted);
      rect(c, 138, 11, 148, 21, 5, CampusTheme.mix(t.primary, t.surface, .15f));
      p.setShader(
          new LinearGradient(12, 28, 148, 68, t.heroStart, t.heroEnd, Shader.TileMode.CLAMP));
      c.drawRoundRect(12, 28, 148, 68, 9, 9, p);
      p.setShader(null);
      rect(c, 22, 38, 70, 42, 2, t.heroInk);
      rect(c, 22, 47, 57, 50, 1.5f, t.heroMuted);
      rect(c, 22, 56, 49, 60, 2, CampusTheme.mix(t.primary, t.heroInk, .2f));
      p.setStyle(Paint.Style.STROKE);
      p.setStrokeWidth(1);
      p.setColor(t.heroMuted);
      c.drawCircle(125, 48, 11, p);
      c.drawOval(111, 43, 139, 53, p);
      p.setStyle(Paint.Style.FILL);
      for (int i = 0; i < 3; i++) {
        rect(c, 12 + i * 46, 76, 54 + i * 46, 94, 6, t.surface);
        rect(c, 18 + i * 46, 82, 24 + i * 46, 88, 2, t.primary);
        rect(c, 29 + i * 46, 83, 46 + i * 46, 86, 1.5f, t.muted);
      }
      c.restore();
    }
  }
}
