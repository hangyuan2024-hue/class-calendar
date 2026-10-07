package com.laolao.classcalendar;

import android.app.*;
import android.content.*;
import android.content.res.ColorStateList;
import android.graphics.*;
import android.graphics.drawable.*;
import android.text.*;
import android.view.*;
import android.widget.*;
import java.util.*;
import org.json.*;

/** Shared native design system. Screens contain Android views and platform dialogs. */
public final class CampusUi {
  final CampusActivity a;
  final CampusTheme theme;
  final int bg, surface, ink, muted, accent, border, soft;
  final boolean dark;

  CampusUi(CampusActivity a, boolean dark) {
    this.a = a;
    JSONObject saved = a.store.object("ui_palette_v1");
    theme =
        CampusTheme.resolve(
            a.store.string("ui_skin_v1", "fresh"),
            saved.optString("id", "mint"),
            saved.optString("p", null),
            (a.getResources().getConfiguration().uiMode & 48) == 32,
            a.page.equals("meta"));
    this.dark = theme.dark;
    bg = theme.bg;
    surface = theme.surface;
    ink = theme.ink;
    muted = readableAccent(theme.muted, bg);
    accent = readableAccent(theme.primary, surface);
    border = blend(ink, surface, this.dark ? .14f : .09f);
    soft = blend(accent, surface, this.dark ? .13f : .065f);
  }

  static int color(String s) {
    return Color.parseColor(s);
  }

  static int blend(int foreground, int background, float amount) {
    return Color.rgb(
        Math.round(Color.red(foreground) * amount + Color.red(background) * (1 - amount)),
        Math.round(Color.green(foreground) * amount + Color.green(background) * (1 - amount)),
        Math.round(Color.blue(foreground) * amount + Color.blue(background) * (1 - amount)));
  }

  static double luminance(int colour) {
    double[] channels = {
      Color.red(colour) / 255., Color.green(colour) / 255., Color.blue(colour) / 255.
    };
    for (int i = 0; i < 3; i++)
      channels[i] =
          channels[i] <= .04045 ? channels[i] / 12.92 : Math.pow((channels[i] + .055) / 1.055, 2.4);
    return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
  }

  static double contrast(int x, int y) {
    double a = luminance(x), b = luminance(y);
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  }

  static int readableAccent(int colour, int background) {
    int towards = luminance(background) > .5 ? Color.BLACK : Color.WHITE;
    for (int i = 0; i < 24 && contrast(colour, background) < 4.5; i++)
      colour = blend(towards, colour, .1f);
    return colour;
  }

  int onAccent() {
    return contrast(Color.WHITE, accent) >= contrast(0xff08101e, accent) ? Color.WHITE : 0xff08101e;
  }

  int tone(String route) {
    int c =
        route.matches("ledger|farm|growth|places|quiet")
            ? 0xff168578
            : route.matches("countdown|wrongbook|recordings|reminders")
                ? 0xffbc6541
                : route.matches("diary|oracle|privacy|words|cards|review") ? 0xff8b59b2 : accent;
    return readableAccent(c, surface);
  }

  int dp(float f) {
    return Math.round(f * a.getResources().getDisplayMetrics().density);
  }

  Context dialog() {
    String id = theme.preset.id;
    String name =
        "CampusDialog"
            + Character.toUpperCase(id.charAt(0))
            + id.substring(1)
            + (dark ? "Night" : "");
    int style = a.getResources().getIdentifier(name, "style", a.getPackageName());
    return new ContextThemeWrapper(
        a,
        style != 0
            ? style
            : dark
                ? android.R.style.Theme_Material_Dialog_Alert
                : android.R.style.Theme_Material_Light_Dialog_Alert);
  }

  void showDialog(AlertDialog dlg) {
    if (ComposeEntry.active(a)) {
      ComposeEntry.dialog(a, dlg);
      return;
    }
    dlg.show();
    if (dlg.getWindow() != null) dlg.getWindow().setBackgroundDrawable(shape(surface, 24, 0));
    for (int id :
        new int[] {
          AlertDialog.BUTTON_POSITIVE, AlertDialog.BUTTON_NEGATIVE, AlertDialog.BUTTON_NEUTRAL
        }) {
      android.widget.Button button = dlg.getButton(id);
      if (button != null) {
        button.setTextColor(accent);
        button.setAllCaps(false);
        button.setMinHeight(dp(48));
      }
    }
  }

  GradientDrawable shape(int c, int r, int stroke) {
    GradientDrawable d = new GradientDrawable();
    d.setColor(c);
    d.setCornerRadius(dp(r));
    if (stroke != 0) d.setStroke(dp(1), stroke);
    return d;
  }

  void touch(View v, int c, int r, int stroke) {
    v.setBackground(
        new RippleDrawable(
            ColorStateList.valueOf((accent & 0xffffff) | 0x22000000), shape(c, r, stroke), null));
    v.setClickable(true);
    v.setFocusable(true);
  }

  LinearLayout column() {
    LinearLayout l = new LinearLayout(a);
    l.setOrientation(LinearLayout.VERTICAL);
    return l;
  }

  LinearLayout row() {
    LinearLayout l = new LinearLayout(a);
    l.setGravity(Gravity.CENTER_VERTICAL);
    return l;
  }

  void gap(LinearLayout l, int n) {
    l.addView(new View(a), new LinearLayout.LayoutParams(1, dp(n)));
  }

  TextView text(String s, int size, int c, boolean bold) {
    TextView t = new TextView(a);
    t.setText(s);
    t.setTextSize(size);
    t.setTextColor(c);
    t.setIncludeFontPadding(false);
    t.setLineSpacing(dp(size >= 20 ? 3 : 2), 1);
    t.setBreakStrategy(android.text.Layout.BREAK_STRATEGY_SIMPLE);
    t.setTypeface(Typeface.create("sans-serif", bold ? Typeface.BOLD : Typeface.NORMAL));
    return t;
  }

  TextView button(String s, Runnable r, boolean primary) {
    TextView t = text(s, 14, primary ? onAccent() : ink, true);
    t.setGravity(Gravity.CENTER);
    t.setPadding(dp(16), dp(12), dp(16), dp(12));
    t.setMinHeight(dp(48));
    touch(t, primary ? accent : soft, 14, 0);
    t.setOnClickListener(v -> r.run());
    return t;
  }

  LinearLayout card(LinearLayout parent) {
    LinearLayout l = column();
    l.setPadding(dp(18), dp(18), dp(18), dp(18));
    l.setBackground(shape(surface, 20, blend(ink, surface, .055f)));
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
    p.bottomMargin = dp(12);
    parent.addView(l, p);
    return l;
  }

  void title(LinearLayout parent, String title, String note) {
    parent.addView(text(title, 27, ink, true));
    if (note != null && !note.isEmpty()) {
      gap(parent, 7);
      parent.addView(text(note, 13, muted, false));
    }
    gap(parent, 20);
  }

  void section(LinearLayout parent, String name) {
    TextView t = text(name, 17, ink, true);
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
    p.setMargins(0, dp(14), 0, dp(12));
    parent.addView(t, p);
  }

  void empty(LinearLayout parent, String title, String note) {
    LinearLayout p = card(parent);
    p.setBackground(shape(blend(accent, bg, dark ? .10f : .035f), 18, border));
    p.setElevation(0);
    p.addView(text(title, 15, ink, true));
    gap(p, 8);
    p.addView(text(note, 13, muted, false));
  }

  TextView pill(String s) {
    TextView t = text(s, 11, readableAccent(accent, soft), true);
    t.setPadding(dp(9), dp(6), dp(9), dp(6));
    t.setBackground(shape(soft, 7, 0));
    t.setLayoutParams(new LinearLayout.LayoutParams(-2, -2));
    return t;
  }

  void metric(LinearLayout parent, String label, String value) {
    LinearLayout line = row();
    line.setPadding(0, dp(8), 0, dp(8));
    line.addView(text(label, 13, muted, false), new LinearLayout.LayoutParams(0, -2, 1));
    line.addView(text(value, 20, ink, true));
    parent.addView(line);
  }

  void actionRow(LinearLayout parent, String[] labels, Runnable[] actions) {
    boolean stacked = a.getResources().getConfiguration().fontScale > 1.25f && labels.length > 2;
    if (stacked) {
      for (int i = 0; i < labels.length; i++) {
        parent.addView(button(labels[i], actions[i], false), new LinearLayout.LayoutParams(-1, -2));
        gap(parent, 8);
      }
      return;
    }
    LinearLayout r = row();
    for (int i = 0; i < labels.length; i++) {
      boolean primary =
          i == 0
              && (labels[i].startsWith("＋ ")
                  || labels[i].startsWith("开始")
                  || labels[i].equals("暂停"));
      TextView b = button(labels[i], actions[i], primary);
      LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, -2, 1);
      if (i + 1 < labels.length) p.rightMargin = dp(7);
      r.addView(b, p);
    }
    parent.addView(r);
    gap(parent, 12);
  }

  void tileGrid(LinearLayout parent, String[][] tiles) {
    int n =
        a.getResources().getConfiguration().fontScale > 1.25f
            ? 1
            : a.getResources().getConfiguration().screenWidthDp >= 600 ? 3 : 2;
    for (int i = 0; i < tiles.length; i += n) {
      LinearLayout r = row();
      r.setGravity(Gravity.TOP);
      for (int j = i; j < Math.min(i + n, tiles.length); j++) {
        String[] x = tiles[j];
        LinearLayout cell = column();
        cell.setPadding(dp(16), dp(16), dp(16), dp(16));
        int tint = tone(x[0]);
        touch(cell, blend(tint, surface, dark ? .10f : .045f), 20, blend(tint, surface, .09f));
        cell.setMinimumHeight(dp(126));
        LinearLayout top = row();
        top.addView(badge(x[0]), new LinearLayout.LayoutParams(dp(32), dp(32)));
        TextView arrow = text("›", 19, muted, false);
        arrow.setGravity(Gravity.RIGHT);
        top.addView(arrow, new LinearLayout.LayoutParams(0, -2, 1));
        cell.addView(top);
        gap(cell, 11);
        cell.addView(text(x[1], 15, ink, true));
        gap(cell, 6);
        TextView description = text(x[2], 11, muted, false);
        cell.addView(description);
        cell.setContentDescription(x[1] + "，" + x[2]);
        cell.setOnClickListener(v -> a.open(x[0]));
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, -1, 1);
        p.bottomMargin = dp(10);
        if (j % n + 1 < n) p.rightMargin = dp(10);
        r.addView(cell, p);
      }
      while (r.getChildCount() < n) {
        LinearLayout.LayoutParams space = new LinearLayout.LayoutParams(0, 1, 1);
        if (r.getChildCount() + 1 < n) space.rightMargin = dp(10);
        r.addView(new View(a), space);
      }
      parent.addView(r);
    }
  }

  FrameLayout badge(String route) {
    FrameLayout box = new FrameLayout(a);
    int colour = tone(route);
    box.setBackground(shape(blend(colour, surface, dark ? .18f : .08f), 12, 0));
    FrameLayout.LayoutParams p = new FrameLayout.LayoutParams(dp(23), dp(23), Gravity.CENTER);
    box.addView(new Icon(a, route, colour), p);
    return box;
  }

  void dock(LinearLayout parent, String[][] items) {
    LinearLayout panel = column();
    parent.addView(panel, new LinearLayout.LayoutParams(-1, -2));
    panel.setPadding(0, dp(2), 0, dp(8));
    int columns =
        a.getResources().getConfiguration().fontScale > 1.25f
            ? 2
            : a.getResources().getConfiguration().screenWidthDp >= 600 ? 6 : 4;
    for (int start = 0; start < items.length; start += columns) {
      LinearLayout row = row();
      row.setGravity(Gravity.TOP);
      int count = Math.min(columns, items.length - start);
      for (int i = start; i < start + count; i++) {
        String[] item = items[i];
        LinearLayout cell = column();
        cell.setGravity(Gravity.CENTER);
        cell.setPadding(dp(4), dp(8), dp(4), dp(8));
        cell.setMinimumHeight(dp(72));
        touch(cell, Color.TRANSPARENT, 14, 0);
        cell.addView(badge(item[0]), new LinearLayout.LayoutParams(dp(42), dp(42)));
        gap(cell, 9);
        TextView name = text(item[1], 12, ink, true);
        name.setGravity(Gravity.CENTER);
        cell.addView(name);
        cell.setContentDescription(item[1]);
        cell.setOnClickListener(v -> a.open(item[0]));
        row.addView(cell, new LinearLayout.LayoutParams(0, -2, 1));
      }
      panel.addView(row);
    }
  }

  void featurePair(LinearLayout parent, String[][] items) {
    boolean stacked = a.getResources().getConfiguration().fontScale > 1.25f;
    LinearLayout row = stacked ? column() : row();
    row.setGravity(Gravity.TOP);
    for (int i = 0; i < items.length; i++) {
      String[] item = items[i];
      boolean space = item[0].equals("meta");
      LinearLayout tile = column();
      tile.setPadding(dp(16), dp(15), dp(16), dp(15));
      int colour = space ? theme.heroStart : soft;
      touch(tile, colour, 20, 0);
      LinearLayout top = row();
      top.addView(
          text(item[1], 12, space ? theme.heroMuted : muted, false),
          new LinearLayout.LayoutParams(0, -2, 1));
      top.addView(
          new Icon(a, item[0], space ? theme.heroInk : accent),
          new LinearLayout.LayoutParams(dp(20), dp(20)));
      tile.addView(top);
      gap(tile, 12);
      tile.addView(text(item[2], 26, space ? theme.heroInk : ink, true));
      gap(tile, 7);
      tile.addView(text(item[3], 11, space ? theme.heroMuted : muted, false));
      tile.setContentDescription(item[1] + "，" + item[2] + "，" + item[3]);
      tile.setOnClickListener(v -> a.open(item[0]));
      LinearLayout.LayoutParams lp =
          new LinearLayout.LayoutParams(stacked ? -1 : 0, stacked ? -2 : -1, stacked ? 0 : 1);
      if (i > 0) {
        if (stacked) lp.topMargin = dp(12);
        else lp.leftMargin = dp(12);
      }
      row.addView(tile, lp);
    }
    parent.addView(row);
    gap(parent, 14);
  }

  void sectionLink(LinearLayout parent, String title, String label, Runnable action) {
    LinearLayout line = row();
    line.addView(text(title, 17, ink, true), new LinearLayout.LayoutParams(0, -2, 1));
    TextView more = button(label + " ›", action, false);
    touch(more, Color.TRANSPARENT, 12, 0);
    more.setTextColor(accent);
    more.setTextSize(12);
    line.addView(more);
    parent.addView(line);
    gap(parent, 10);
  }

  void toolRows(LinearLayout parent, String[][] items) {
    LinearLayout group = card(parent);
    group.setPadding(dp(6), dp(3), dp(6), dp(3));
    for (int index = 0; index < items.length; index++) {
      String[] x = items[index];
      LinearLayout line = row();
      line.setPadding(dp(12), dp(14), dp(12), dp(14));
      line.setMinimumHeight(dp(72));
      touch(line, surface, 15, 0);
      line.addView(badge(x[0]), new LinearLayout.LayoutParams(dp(37), dp(37)));
      LinearLayout copy = column();
      copy.addView(text(x[1], 14, ink, true));
      gap(copy, 5);
      copy.addView(text(x[2], 12, muted, false));
      LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, -2, 1);
      p.setMargins(dp(13), 0, dp(8), 0);
      line.addView(copy, p);
      line.addView(text("›", 24, muted, false));
      line.setContentDescription(x[1] + "，" + x[2]);
      line.setOnClickListener(v -> a.open(x[0]));
      LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
      group.addView(line, lp);
      if (index + 1 < items.length) {
        View divider = new View(a);
        divider.setBackgroundColor(blend(ink, surface, .07f));
        LinearLayout.LayoutParams dividerSpace = new LinearLayout.LayoutParams(-1, dp(1));
        dividerSpace.leftMargin = dp(62);
        dividerSpace.rightMargin = dp(12);
        group.addView(divider, dividerSpace);
      }
    }
  }

  void confirm(String title, String message, Runnable yes) {
    if (ComposeEntry.active(a)) {
      ComposeEntry.confirm(a, title, message, yes);
      return;
    }
    showDialog(
        new AlertDialog.Builder(dialog())
            .setTitle(title)
            .setMessage(message)
            .setNegativeButton("取消", null)
            .setPositiveButton("确定", (d, w) -> yes.run())
            .create());
  }

  void choose(String title, String[] options, java.util.function.IntConsumer callback) {
    if (ComposeEntry.active(a)) {
      ComposeEntry.choose(a, title, options, callback);
      return;
    }
    showDialog(
        new AlertDialog.Builder(dialog())
            .setTitle(title)
            .setItems(options, (d, w) -> callback.accept(w))
            .setNegativeButton("取消", null)
            .create());
  }

  public static class Field {
    final String key, label, kind;
    final boolean required;
    final String[] choices;

    Field(String key, String label, String kind, boolean required, String... choices) {
      this.key = key;
      this.label = label;
      this.kind = kind;
      this.required = required;
      this.choices = choices;
    }
  }

  public interface Save {
    void save(JSONObject fields) throws Exception;
  }

  static Field f(String key, String label) {
    return new Field(key, label, "text", true);
  }

  static Field optional(String key, String label) {
    return new Field(key, label, "text", false);
  }

  static Field f(String key, String label, String kind) {
    return new Field(key, label, kind, true);
  }

  static Field choice(String key, String label, String... options) {
    return new Field(key, label, "choice", true, options);
  }

  void form(String title, JSONObject initial, Save save, Field... fields) {
    formAction(title, "保存", initial, save, fields);
  }

  void formAction(
      String title, String actionLabel, JSONObject initial, Save save, Field... fields) {
    if (ComposeEntry.active(a)) {
      ComposeEntry.form(a, title, actionLabel, initial, save, fields);
      return;
    }
    LinearLayout body = column();
    body.setPadding(dp(22), dp(6), dp(22), dp(12));
    body.setBackgroundColor(surface);
    Map<String, View> views = new LinkedHashMap<>();
    for (Field f : fields) {
      if (!f.kind.equals("boolean")) {
        LinearLayout label = row();
        label.addView(text(f.label, 13, ink, true), new LinearLayout.LayoutParams(0, -2, 1));
        label.addView(text(f.required ? "必填" : "选填", 11, muted, false));
        body.addView(label);
        gap(body, 8);
      }
      View control;
      if (f.kind.equals("boolean")) {
        CheckBox b = new CheckBox(dialog());
        b.setText(f.label);
        b.setTextColor(ink);
        b.setTextSize(14);
        b.setPadding(dp(10), dp(8), dp(12), dp(8));
        b.setMinHeight(dp(52));
        b.setBackground(shape(soft, 12, 0));
        b.setButtonTintList(ColorStateList.valueOf(accent));
        b.setChecked(initial.optBoolean(f.key));
        control = b;
      } else if (f.kind.equals("choice")) {
        Spinner b = new Spinner(dialog());
        ArrayAdapter<String> adapter =
            new ArrayAdapter<String>(
                dialog(), android.R.layout.simple_spinner_dropdown_item, f.choices) {
              @Override
              public View getView(int position, View reuse, ViewGroup parent) {
                TextView t = text(getItem(position) + "  ▾", 15, ink, false);
                t.setPadding(dp(14), dp(16), dp(14), dp(16));
                return t;
              }

              @Override
              public View getDropDownView(int position, View reuse, ViewGroup parent) {
                TextView t = text(getItem(position), 15, ink, false);
                t.setPadding(dp(18), dp(16), dp(18), dp(16));
                t.setBackgroundColor(surface);
                return t;
              }
            };
        b.setAdapter(adapter);
        b.setBackground(shape(soft, 12, border));
        for (int j = 0; j < f.choices.length; j++)
          if (f.choices[j].equals(initial.optString(f.key))) b.setSelection(j);
        control = b;
      } else {
        EditText b = new EditText(dialog());
        b.setTextColor(ink);
        b.setTextSize(16);
        b.setMinHeight(dp(52));
        b.setPadding(dp(14), dp(14), dp(14), dp(14));
        b.setHintTextColor(muted);
        b.setBackgroundTintList(null);
        b.setBackground(shape(soft, 12, border));
        b.setOnFocusChangeListener(
            (v, focus) ->
                b.setBackground(shape(focus ? surface : soft, 12, focus ? accent : border)));
        b.setHint(
            f.kind.equals("date") ? "选择日期" : f.kind.equals("time") ? "选择时间" : "请输入" + f.label);
        b.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_NEXT);
        b.setFilters(
            new InputFilter[] {
              new InputFilter.LengthFilter(f.kind.equals("multiline") ? 20000 : 1000)
            });
        int type =
            f.kind.equals("password")
                ? InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD
                : f.kind.equals("number")
                    ? InputType.TYPE_CLASS_NUMBER
                    : f.kind.equals("decimal")
                        ? InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL
                        : InputType.TYPE_CLASS_TEXT
                            | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
                            | (f.kind.equals("multiline")
                                ? InputType.TYPE_TEXT_FLAG_MULTI_LINE
                                : 0);
        b.setInputType(type);
        if (f.kind.equals("multiline")) {
          b.setMinLines(3);
          b.setGravity(Gravity.TOP | Gravity.START);
        } else b.setSingleLine(true);
        b.setText(initial.optString(f.key, ""));
        if (f.kind.equals("date")) {
          b.setFocusable(false);
          b.setClickable(true);
          b.setContentDescription(f.label + "，点击选择日期");
          b.setOnClickListener(
              v -> {
                String value = b.getText().toString();
                int[] d = DateMath.parts(value.isEmpty() ? DateMath.today() : value);
                showDialog(
                    new DatePickerDialog(
                        dialog(),
                        R.style.CampusDatePickerWindow,
                        (p, y, m, day) -> b.setText(DateMath.date(y, m + 1, day)),
                        d[0],
                        d[1] - 1,
                        d[2]));
              });
        }
        if (f.kind.equals("time")) {
          b.setFocusable(false);
          b.setClickable(true);
          b.setContentDescription(f.label + "，点击选择时间");
          b.setOnClickListener(
              v -> {
                String value = b.getText().toString();
                int[] t = DateMath.time(value.isEmpty() ? "08:00" : value);
                showDialog(
                    new TimePickerDialog(
                        dialog(),
                        (p, h, m) -> b.setText(String.format(Locale.ROOT, "%02d:%02d", h, m)),
                        t[0],
                        t[1],
                        true));
              });
        }
        control = b;
      }
      body.addView(control, new LinearLayout.LayoutParams(-1, -2));
      gap(body, 18);
      views.put(f.key, control);
    }
    TextView error = text("", 12, readableAccent(0xffbb3c4b, surface), false);
    error.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
    error.setVisibility(View.GONE);
    ScrollView scroll =
        new ScrollView(dialog()) {
          @Override
          protected void onMeasure(int width, int height) {
            int cap = Math.round(a.getResources().getDisplayMetrics().heightPixels * .58f);
            int bound =
                MeasureSpec.getMode(height) == MeasureSpec.UNSPECIFIED
                    ? cap
                    : Math.min(cap, MeasureSpec.getSize(height));
            super.onMeasure(width, MeasureSpec.makeMeasureSpec(bound, MeasureSpec.AT_MOST));
          }
        };
    scroll.setClipToPadding(false);
    scroll.addView(body);
    LinearLayout heading = column();
    heading.setPadding(dp(22), dp(24), dp(22), dp(18));
    heading.addView(text(title, 20, ink, true));
    gap(heading, 8);
    heading.addView(text("必填内容记完整，其他细节可以稍后补充。", 12, muted, false));
    LinearLayout.LayoutParams errorSpace = new LinearLayout.LayoutParams(-1, -2);
    errorSpace.topMargin = dp(8);
    heading.addView(error, errorSpace);
    AlertDialog dlg =
        new AlertDialog.Builder(dialog())
            .setCustomTitle(heading)
            .setView(scroll)
            .setNegativeButton("取消", null)
            .setPositiveButton(actionLabel, null)
            .create();
    dlg.setOnShowListener(
        v -> {
          for (int id : new int[] {AlertDialog.BUTTON_NEGATIVE, AlertDialog.BUTTON_POSITIVE}) {
            android.widget.Button b = dlg.getButton(id);
            b.setAllCaps(false);
            b.setTextSize(14);
            b.setTextColor(id == AlertDialog.BUTTON_POSITIVE ? onAccent() : muted);
            b.setMinHeight(dp(48));
            b.setBackground(shape(id == AlertDialog.BUTTON_POSITIVE ? accent : surface, 12, 0));
            b.setPadding(dp(20), dp(10), dp(20), dp(10));
          }
          Window window = dlg.getWindow();
          if (window != null) {
            window.setBackgroundDrawable(shape(surface, 24, 0));
            window.setDimAmount(.4f);
            window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
            window.setGravity(
                a.getResources().getConfiguration().screenWidthDp >= 600
                    ? Gravity.CENTER
                    : Gravity.BOTTOM);
            window.setLayout(
                Math.min(a.getResources().getDisplayMetrics().widthPixels - dp(16), dp(580)), -2);
          }
          dlg.getButton(AlertDialog.BUTTON_POSITIVE)
              .setOnClickListener(
                  b -> {
                    try {
                      JSONObject out = CampusJson.copy(initial);
                      for (Field f : fields) {
                        View view = views.get(f.key);
                        Object value;
                        if (view instanceof CheckBox) value = ((CheckBox) view).isChecked();
                        else if (view instanceof Spinner)
                          value = ((Spinner) view).getSelectedItem().toString();
                        else {
                          String s = ((EditText) view).getText().toString().trim();
                          if (f.required && s.isEmpty()) {
                            view.requestFocus();
                            view.setBackground(
                                shape(surface, 12, readableAccent(0xffbb3c4b, surface)));
                            view.setContentDescription(f.label + "，请填写此项");
                            throw new IllegalArgumentException("请填写：" + f.label);
                          }
                          if (!s.isEmpty() && f.kind.equals("date")) DateMath.parse(s);
                          if (!s.isEmpty() && f.kind.equals("time")) DateMath.time(s);
                          value =
                              f.kind.equals("number") && !s.isEmpty()
                                  ? Integer.valueOf(s)
                                  : f.kind.equals("decimal") && !s.isEmpty()
                                      ? Double.valueOf(s)
                                      : s;
                        }
                        CampusJson.put(out, f.key, value);
                      }
                      save.save(out);
                      dlg.dismiss();
                    } catch (Exception ex) {
                      error.setText(ex.getMessage() == null ? "输入格式不正确" : ex.getMessage());
                      error.setVisibility(View.VISIBLE);
                      error.announceForAccessibility(error.getText());
                    }
                  });
        });
    dlg.show();
  }

  /** Small stroke icons drawn by Android Canvas; no icon fonts or web assets. */
  static final class Icon extends View {
    final String type;
    final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);

    Icon(Context c, String type, int color) {
      super(c);
      this.type = type;
      p.setColor(color);
      p.setStyle(Paint.Style.STROKE);
      p.setStrokeWidth(1.8f);
      p.setStrokeCap(Paint.Cap.ROUND);
      p.setStrokeJoin(Paint.Join.ROUND);
      setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
    }

    protected void onDraw(Canvas canvas) {
      canvas.save();
      canvas.scale(getWidth() / 24f, getHeight() / 24f);
      if (type.equals("menu")) {
        canvas.drawLine(4, 6, 20, 6, p);
        canvas.drawLine(4, 12, 20, 12, p);
        canvas.drawLine(4, 18, 16, 18, p);
      } else if (type.equals("plus")) {
        canvas.drawLine(12, 5, 12, 19, p);
        canvas.drawLine(5, 12, 19, 12, p);
      } else if (type.equals("back")) {
        canvas.drawLine(15, 5, 8, 12, p);
        canvas.drawLine(8, 12, 15, 19, p);
      } else if (type.equals("brand")) {
        canvas.drawRoundRect(4, 4, 20, 20, 5, 5, p);
        canvas.drawLine(8, 9, 8, 16, p);
        canvas.drawLine(8, 16, 13, 16, p);
        canvas.drawCircle(16, 8, 2, p);
        canvas.drawLine(15, 14, 17, 12, p);
      } else if (type.equals("search")) {
        canvas.drawCircle(10, 10, 6, p);
        canvas.drawLine(15, 15, 21, 21, p);
      } else if (type.equals("growth") || type.equals("rank") || type.equals("report")) {
        canvas.drawLine(4, 20, 4, 12, p);
        canvas.drawLine(10, 20, 10, 8, p);
        canvas.drawLine(16, 20, 16, 4, p);
        canvas.drawLine(3, 22, 22, 22, p);
        canvas.drawLine(3, 7, 13, 2, p);
        canvas.drawLine(13, 2, 13, 5, p);
      } else if (type.equals("farm")) {
        canvas.drawArc(5, 9, 22, 24, 180, 170, false, p);
        canvas.drawLine(12, 15, 12, 7, p);
        canvas.drawOval(3, 3, 12, 9, p);
        canvas.drawOval(12, 1, 21, 7, p);
      } else if (type.equals("time-master")) {
        canvas.drawCircle(12, 13, 8, p);
        canvas.drawLine(12, 8, 12, 13, p);
        canvas.drawLine(12, 13, 7, 13, p);
        canvas.drawLine(6, 2, 18, 2, p);
      } else if (type.equals("homework") || type.equals("checklist")) {
        canvas.drawRoundRect(4, 3, 20, 22, 2, 2, p);
        canvas.drawRoundRect(8, 1, 16, 5, 1, 1, p);
        canvas.drawLine(8, 12, 10, 14, p);
        canvas.drawLine(10, 14, 16, 9, p);
        canvas.drawLine(8, 18, 16, 18, p);
      } else if (type.equals("home")) {
        Path q = new Path();
        q.moveTo(3, 10);
        q.lineTo(12, 3);
        q.lineTo(21, 10);
        q.moveTo(6, 9);
        q.lineTo(6, 21);
        q.lineTo(18, 21);
        q.lineTo(18, 9);
        canvas.drawPath(q, p);
      } else if (type.contains("course") || type.equals("calendar")) {
        canvas.drawRoundRect(3, 5, 21, 21, 3, 3, p);
        canvas.drawLine(3, 10, 21, 10, p);
        canvas.drawLine(8, 3, 8, 7, p);
        canvas.drawLine(16, 3, 16, 7, p);
      } else if (type.equals("class") || type.equals("people")) {
        canvas.drawCircle(8, 8, 3, p);
        canvas.drawCircle(17, 9, 2.5f, p);
        canvas.drawArc(2, 13, 14, 24, 190, 160, false, p);
        canvas.drawArc(13, 14, 23, 23, 190, 160, false, p);
      } else if (type.equals("me")) {
        canvas.drawCircle(12, 7, 4, p);
        canvas.drawArc(3, 13, 21, 27, 180, 180, false, p);
      } else if (type.equals("tools") || type.equals("phone")) {
        for (int x = 3; x < 18; x += 11)
          for (int y = 3; y < 18; y += 11) canvas.drawRoundRect(x, y, x + 7, y + 7, 2, 2, p);
      } else if (type.equals("appearance")) {
        Path palette = new Path();
        palette.moveTo(21, 12);
        palette.cubicTo(24, 1, 7, -2, 3, 8);
        palette.cubicTo(-1, 17, 8, 24, 14, 21);
        palette.cubicTo(17, 19, 12, 16, 15, 14);
        palette.cubicTo(17, 12, 19, 15, 21, 12);
        canvas.drawPath(palette, p);
        for (float[] point : new float[][] {{7, 8}, {12, 5}, {17, 7}})
          canvas.drawCircle(point[0], point[1], 1, p);
      } else if (type.equals("widget")) {
        canvas.drawRoundRect(2, 3, 22, 21, 3, 3, p);
        canvas.drawLine(2, 9, 22, 9, p);
        canvas.drawLine(13, 9, 13, 21, p);
        canvas.drawLine(6, 13, 9, 13, p);
        canvas.drawLine(6, 17, 9, 17, p);
        canvas.drawCircle(17.5f, 15, 1.6f, p);
      } else if (type.equals("reminders")) {
        Path q = new Path();
        q.moveTo(4, 18);
        q.lineTo(6, 15);
        q.lineTo(6, 9);
        q.cubicTo(6, 1, 18, 1, 18, 9);
        q.lineTo(18, 15);
        q.lineTo(20, 18);
        q.close();
        canvas.drawPath(q, p);
        canvas.drawArc(9, 17, 15, 23, 0, 180, false, p);
      } else if (type.equals("inbox")) {
        Path q = new Path();
        q.moveTo(3, 12);
        q.lineTo(3, 21);
        q.lineTo(21, 21);
        q.lineTo(21, 12);
        q.lineTo(16, 12);
        q.lineTo(14, 16);
        q.lineTo(10, 16);
        q.lineTo(8, 12);
        q.close();
        canvas.drawPath(q, p);
        canvas.drawLine(12, 2, 12, 10, p);
        canvas.drawLine(9, 7, 12, 10, p);
        canvas.drawLine(12, 10, 15, 7, p);
      } else if (type.equals("voice")) {
        canvas.drawRoundRect(9, 2, 15, 15, 3, 3, p);
        canvas.drawArc(5, 6, 19, 19, 0, 180, false, p);
        canvas.drawLine(12, 19, 12, 22, p);
        canvas.drawLine(8, 22, 16, 22, p);
      } else if (type.equals("recordings")) {
        int[] heights = {4, 10, 17, 10, 5};
        for (int i = 0; i < heights.length; i++)
          canvas.drawLine(4 + i * 4, 12 - heights[i] / 2f, 4 + i * 4, 12 + heights[i] / 2f, p);
      } else if (type.equals("privacy") || type.equals("security")) {
        Path q = new Path();
        q.moveTo(12, 2);
        q.lineTo(21, 6);
        q.lineTo(20, 14);
        q.cubicTo(19, 18, 15, 21, 12, 23);
        q.cubicTo(9, 21, 5, 18, 4, 14);
        q.lineTo(3, 6);
        q.close();
        canvas.drawPath(q, p);
        canvas.drawRoundRect(8, 10, 16, 16, 1, 1, p);
        canvas.drawArc(9, 6, 15, 12, 180, 180, false, p);
      } else if (type.equals("quiet")) {
        Path q = new Path();
        q.moveTo(16, 3);
        q.cubicTo(2, -1, -1, 18, 10, 21);
        q.cubicTo(16, 23, 22, 18, 22, 13);
        q.cubicTo(12, 18, 8, 8, 16, 3);
        q.close();
        canvas.drawPath(q, p);
      } else if (type.equals("places")) {
        Path q = new Path();
        q.moveTo(12, 22);
        q.cubicTo(8, 17, 4, 13, 4, 9);
        q.cubicTo(4, -1, 20, -1, 20, 9);
        q.cubicTo(20, 13, 16, 17, 12, 22);
        canvas.drawPath(q, p);
        canvas.drawCircle(12, 9, 3, p);
      } else if (type.equals("scanner")) {
        Path q = new Path();
        q.moveTo(2, 7);
        q.lineTo(2, 2);
        q.lineTo(7, 2);
        q.moveTo(17, 2);
        q.lineTo(22, 2);
        q.lineTo(22, 7);
        q.moveTo(22, 17);
        q.lineTo(22, 22);
        q.lineTo(17, 22);
        q.moveTo(7, 22);
        q.lineTo(2, 22);
        q.lineTo(2, 17);
        canvas.drawPath(q, p);
        canvas.drawRoundRect(6, 5, 18, 19, 1, 1, p);
        canvas.drawLine(1, 12, 23, 12, p);
      } else if (type.equals("contacts")) {
        Path q = new Path();
        q.moveTo(4, 3);
        q.lineTo(8, 2);
        q.lineTo(11, 7);
        q.lineTo(8, 10);
        q.cubicTo(9, 13, 11, 15, 14, 16);
        q.lineTo(17, 13);
        q.lineTo(22, 16);
        q.lineTo(21, 20);
        q.cubicTo(19, 26, 0, 8, 4, 3);
        q.close();
        canvas.drawPath(q, p);
      } else if (type.equals("ledger")) {
        canvas.drawRoundRect(2, 5, 22, 21, 3, 3, p);
        canvas.drawRoundRect(14, 10, 23, 17, 2, 2, p);
        canvas.drawCircle(17, 13.5f, .8f, p);
        canvas.drawLine(5, 5, 17, 2, p);
      } else if (type.equals("words") || type.equals("cards") || type.equals("review")) {
        canvas.drawRoundRect(3, 3, 20, 20, 2, 2, p);
        canvas.drawLine(7, 3, 7, 20, p);
        canvas.drawLine(11, 8, 16, 8, p);
        canvas.drawLine(11, 12, 16, 12, p);
        canvas.drawLine(8, 23, 23, 23, p);
        canvas.drawLine(23, 8, 23, 23, p);
      } else if (type.equals("draw")) {
        canvas.drawRoundRect(3, 3, 21, 21, 4, 4, p);
        for (int x : new int[] {8, 16})
          for (int y : new int[] {8, 16}) canvas.drawCircle(x, y, 1, p);
        canvas.drawCircle(12, 12, 1, p);
      } else if (type.equals("meta") || type.equals("oracle")) {
        canvas.drawCircle(12, 12, 6, p);
        canvas.save();
        canvas.rotate(-25, 12, 12);
        canvas.drawOval(1, 7, 23, 17, p);
        canvas.restore();
        canvas.drawCircle(20, 3, 1, p);
      } else if (type.contains("focus") || type.contains("pomo") || type.contains("countdown")) {
        canvas.drawCircle(12, 13, 8, p);
        canvas.drawLine(12, 8, 12, 13, p);
        canvas.drawLine(12, 13, 16, 15, p);
        canvas.drawLine(9, 2, 15, 2, p);
      } else if (type.contains("diary") || type.contains("wrong") || type.equals("plan")) {
        canvas.drawRoundRect(5, 3, 20, 21, 2, 2, p);
        canvas.drawLine(3, 3, 3, 21, p);
        canvas.drawLine(9, 8, 16, 8, p);
        canvas.drawLine(9, 12, 16, 12, p);
        canvas.drawLine(9, 16, 13, 16, p);
      } else if (type.equals("wall") || type.equals("ask")) {
        canvas.drawRoundRect(3, 4, 21, 18, 3, 3, p);
        canvas.drawLine(8, 18, 6, 22, p);
        canvas.drawLine(6, 22, 13, 18, p);
        canvas.drawLine(7, 9, 17, 9, p);
        canvas.drawLine(7, 13, 13, 13, p);
      } else {
        canvas.drawRoundRect(3, 3, 21, 21, 5, 5, p);
        canvas.drawLine(8, 12, 11, 15, p);
        canvas.drawLine(11, 15, 17, 8, p);
      }
      canvas.restore();
    }
  }
}
