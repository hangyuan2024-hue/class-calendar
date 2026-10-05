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
final class CampusUi {
  final CampusActivity a;
  final int bg, surface, ink, muted, accent, border, soft;
  final boolean dark;

  CampusUi(CampusActivity a, boolean dark) {
    this.a = a;
    this.dark = dark;
    bg = color(dark ? "#08101E" : "#F4F6F9");
    surface = color(dark ? "#111F34" : "#FFFFFF");
    ink = color(dark ? "#EAF3FF" : "#15243C");
    muted = color(dark ? "#A7B7CF" : "#718095");
    String chosen = a.store.object("ui_palette_v1").optString("p", dark ? "#66E5EB" : "#5264E8");
    accent = color(chosen.matches("#[0-9a-fA-F]{6}") ? chosen : dark ? "#66E5EB" : "#5264E8");
    border = color(dark ? "#263953" : "#E6EAF0");
    soft = color(dark ? "#1B3047" : "#EDF0FF");
  }

  static int color(String s) {
    return Color.parseColor(s);
  }

  int dp(float f) {
    return Math.round(f * a.getResources().getDisplayMetrics().density);
  }

  Context dialog() {
    return new ContextThemeWrapper(
        a,
        dark
            ? android.R.style.Theme_Material_Dialog_Alert
            : android.R.style.Theme_Material_Light_Dialog_Alert);
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
    t.setLineSpacing(dp(3), 1);
    t.setBreakStrategy(android.text.Layout.BREAK_STRATEGY_SIMPLE);
    if (bold) t.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    return t;
  }

  TextView button(String s, Runnable r, boolean primary) {
    TextView t = text(s, 14, primary ? (dark ? bg : Color.WHITE) : ink, true);
    t.setGravity(Gravity.CENTER);
    t.setPadding(dp(13), dp(10), dp(13), dp(10));
    t.setMinHeight(dp(48));
    touch(t, primary ? accent : surface, 13, primary ? 0 : border);
    t.setOnClickListener(v -> r.run());
    return t;
  }

  LinearLayout card(LinearLayout parent) {
    LinearLayout l = column();
    l.setPadding(dp(18), dp(19), dp(18), dp(19));
    l.setBackground(shape(surface, 20, border));
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
    p.bottomMargin = dp(14);
    parent.addView(l, p);
    return l;
  }

  void title(LinearLayout parent, String title, String note) {
    parent.addView(text(title, 28, ink, true));
    gap(parent, 7);
    parent.addView(text(note, 12, muted, false));
    gap(parent, 23);
  }

  void section(LinearLayout parent, String name) {
    TextView t = text(name, 18, ink, true);
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
    p.setMargins(0, dp(8), 0, dp(14));
    parent.addView(t, p);
  }

  void empty(LinearLayout parent, String title, String note) {
    LinearLayout p = card(parent);
    p.addView(text(title, 16, ink, true));
    gap(p, 8);
    p.addView(text(note, 13, muted, false));
  }

  TextView pill(String s) {
    TextView t = text(s, 10, accent, true);
    t.setPadding(dp(8), dp(4), dp(8), dp(4));
    t.setBackground(shape(soft, 8, 0));
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
    LinearLayout r = row();
    for (int i = 0; i < labels.length; i++) {
      TextView b = button(labels[i], actions[i], false);
      LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, -2, 1);
      if (i + 1 < labels.length) p.rightMargin = dp(7);
      r.addView(b, p);
    }
    parent.addView(r);
    gap(parent, 12);
  }

  void tileGrid(LinearLayout parent, String[][] tiles) {
    int n = a.getResources().getConfiguration().screenWidthDp >= 600 ? 3 : 2;
    for (int i = 0; i < tiles.length; i += n) {
      LinearLayout r = row();
      r.setGravity(Gravity.TOP);
      for (int j = i; j < Math.min(i + n, tiles.length); j++) {
        String[] x = tiles[j];
        LinearLayout cell = column();
        cell.setPadding(dp(16), dp(17), dp(16), dp(17));
        touch(cell, surface, 17, border);
        cell.setMinimumHeight(dp(131));
        Icon icon = new Icon(a, x[0], accent);
        cell.addView(icon, new LinearLayout.LayoutParams(dp(29), dp(29)));
        gap(cell, 13);
        cell.addView(text(x[1], 15, ink, true));
        gap(cell, 5);
        cell.addView(text(x[2], 11, muted, false));
        cell.setContentDescription(x[1] + "，" + x[2]);
        cell.setOnClickListener(v -> a.open(x[0]));
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, -2, 1);
        p.bottomMargin = dp(10);
        if (j % n + 1 < n) p.rightMargin = dp(10);
        r.addView(cell, p);
      }
      if (r.getChildCount() < n) r.addView(new View(a), new LinearLayout.LayoutParams(0, 1, 1));
      parent.addView(r);
    }
  }

  void confirm(String title, String message, Runnable yes) {
    new AlertDialog.Builder(dialog())
        .setTitle(title)
        .setMessage(message)
        .setNegativeButton("取消", null)
        .setPositiveButton("确定", (d, w) -> yes.run())
        .show();
  }

  void choose(String title, String[] options, java.util.function.IntConsumer callback) {
    new AlertDialog.Builder(dialog())
        .setTitle(title)
        .setItems(options, (d, w) -> callback.accept(w))
        .setNegativeButton("取消", null)
        .show();
  }

  static class Field {
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

  interface Save {
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
    LinearLayout body = column();
    body.setPadding(dp(23), dp(16), dp(23), dp(16));
    body.setBackgroundColor(surface);
    Map<String, View> views = new LinkedHashMap<>();
    for (Field f : fields) {
      body.addView(text(f.label, 12, muted, true));
      gap(body, 5);
      View control;
      if (f.kind.equals("boolean")) {
        CheckBox b = new CheckBox(dialog());
        b.setText(f.label);
        b.setTextColor(ink);
        b.setButtonTintList(ColorStateList.valueOf(accent));
        b.setChecked(initial.optBoolean(f.key));
        control = b;
      } else if (f.kind.equals("choice")) {
        Spinner b = new Spinner(dialog());
        ArrayAdapter<String> adapter =
            new ArrayAdapter<>(dialog(), android.R.layout.simple_spinner_dropdown_item, f.choices);
        b.setAdapter(adapter);
        for (int j = 0; j < f.choices.length; j++)
          if (f.choices[j].equals(initial.optString(f.key))) b.setSelection(j);
        control = b;
      } else {
        EditText b = new EditText(dialog());
        b.setTextColor(ink);
        b.setTextSize(16);
        b.setMinHeight(dp(48));
        b.setBackgroundTintList(ColorStateList.valueOf(accent));
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
        if (f.kind.equals("multiline")) b.setMinLines(3);
        else b.setSingleLine(true);
        b.setText(initial.optString(f.key, ""));
        if (f.kind.equals("date")) {
          b.setFocusable(false);
          b.setOnClickListener(
              v -> {
                String value = b.getText().toString();
                int[] d = DateMath.parts(value.isEmpty() ? DateMath.today() : value);
                new DatePickerDialog(
                        dialog(),
                        (p, y, m, day) -> b.setText(DateMath.date(y, m + 1, day)),
                        d[0],
                        d[1] - 1,
                        d[2])
                    .show();
              });
        }
        if (f.kind.equals("time")) {
          b.setFocusable(false);
          b.setOnClickListener(
              v -> {
                String value = b.getText().toString();
                int[] t = DateMath.time(value.isEmpty() ? "08:00" : value);
                new TimePickerDialog(
                        dialog(),
                        (p, h, m) -> b.setText(String.format(Locale.ROOT, "%02d:%02d", h, m)),
                        t[0],
                        t[1],
                        true)
                    .show();
              });
        }
        control = b;
      }
      body.addView(control, new LinearLayout.LayoutParams(-1, -2));
      gap(body, 14);
      views.put(f.key, control);
    }
    TextView error = text("", 12, Color.rgb(218, 76, 88), false);
    body.addView(error);
    ScrollView scroll = new ScrollView(dialog());
    scroll.addView(body);
    AlertDialog dlg =
        new AlertDialog.Builder(dialog())
            .setTitle(title)
            .setView(scroll)
            .setNegativeButton("取消", null)
            .setPositiveButton("保存", null)
            .create();
    dlg.setOnShowListener(
        v ->
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
                            if (f.required && s.isEmpty())
                              throw new IllegalArgumentException("请填写：" + f.label);
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
                      }
                    }));
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
      if (type.equals("home")) {
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
