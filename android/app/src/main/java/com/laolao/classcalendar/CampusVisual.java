package com.laolao.classcalendar;

import android.content.*;
import android.graphics.*;
import android.view.*;

/** Native decorative geometry and a focus ring driven only by the real saved timer. */
final class CampusVisual {
  static final class TodayArt extends View {
    final CampusUi u;
    final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);

    TodayArt(CampusActivity a) {
      super(a);
      u = a.ui;
      setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
    }

    @Override
    protected void onDraw(Canvas c) {
      c.save();
      c.scale(getWidth() / 90f, getHeight() / 100f);
      p.setStyle(Paint.Style.STROKE);
      p.setStrokeWidth(.7f);
      p.setColor(CampusUi.blend(u.theme.heroInk, u.theme.heroEnd, .30f));
      c.drawCircle(48, 50, 39, p);
      c.drawCircle(48, 50, 32, p);
      p.setStyle(Paint.Style.FILL);
      c.save();
      c.rotate(12, 52, 48);
      p.setColor(CampusUi.blend(u.theme.heroInk, u.theme.heroEnd, .18f));
      c.drawRoundRect(27, 17, 76, 79, 9, 9, p);
      c.restore();
      c.save();
      c.rotate(-9, 48, 50);
      p.setColor(CampusUi.blend(u.theme.heroInk, u.theme.heroEnd, .92f));
      c.drawRoundRect(22, 20, 72, 83, 9, 9, p);
      p.setColor(u.theme.heroStart);
      c.drawRoundRect(32, 31, 60, 35, 2, 2, p);
      for (int i = 0; i < 3; i++) {
        p.setColor(CampusUi.blend(u.theme.primary, u.theme.heroInk, .15f));
        c.drawRoundRect(31, 45 + i * 10, 37, 51 + i * 10, 2, 2, p);
        p.setColor(CampusUi.blend(u.theme.heroStart, u.theme.heroInk, .42f));
        c.drawRoundRect(43, 46 + i * 10, i == 2 ? 56 : 62, 49 + i * 10, 1.5f, 1.5f, p);
      }
      c.restore();
      p.setColor(CampusUi.blend(u.theme.primary, u.theme.heroInk, .25f));
      c.drawCircle(74, 69, 12, p);
      p.setColor(u.theme.heroStart);
      p.setStyle(Paint.Style.STROKE);
      p.setStrokeWidth(2);
      p.setStrokeCap(Paint.Cap.ROUND);
      Path check = new Path();
      check.moveTo(69, 69);
      check.lineTo(73, 73);
      check.lineTo(80, 65);
      c.drawPath(check, p);
      p.setStyle(Paint.Style.FILL);
      p.setColor(u.theme.heroMuted);
      c.drawCircle(18, 21, 2, p);
      c.drawCircle(79, 31, 1.5f, p);
      c.drawCircle(15, 70, 1, p);
      c.restore();
    }
  }

  static final class Orbit extends View {
    final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
    final CampusUi u;

    Orbit(CampusActivity a) {
      super(a);
      u = a.ui;
      setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
    }

    @Override
    protected void onDraw(Canvas canvas) {
      canvas.save();
      float s = Math.min(getWidth(), getHeight()) / 100f;
      canvas.translate((getWidth() - 100 * s) / 2, (getHeight() - 100 * s) / 2);
      canvas.scale(s, s);
      p.setStyle(Paint.Style.STROKE);
      p.setStrokeWidth(.8f);
      p.setColor(CampusUi.blend(u.accent, u.theme.heroEnd, .42f));
      canvas.drawCircle(50, 50, 35, p);
      canvas.save();
      canvas.rotate(-32, 50, 50);
      canvas.drawOval(2, 31, 98, 69, p);
      canvas.restore();
      p.setStyle(Paint.Style.FILL);
      p.setShader(
          new RadialGradient(
              40,
              38,
              45,
              new int[] {
                CampusUi.blend(Color.WHITE, u.accent, .72f),
                u.accent,
                CampusUi.blend(u.accent, u.theme.heroEnd, .35f),
                u.theme.heroEnd
              },
              null,
              Shader.TileMode.CLAMP));
      canvas.drawCircle(50, 50, 23, p);
      p.setShader(null);
      canvas.save();
      Path sphere = new Path();
      sphere.addCircle(50, 50, 23, Path.Direction.CW);
      canvas.clipPath(sphere);
      p.setStyle(Paint.Style.STROKE);
      p.setStrokeWidth(.55f);
      p.setColor(CampusUi.blend(u.theme.heroInk, u.accent, .35f));
      canvas.drawOval(40, 27, 60, 73, p);
      canvas.drawOval(28, 40, 72, 59, p);
      canvas.drawLine(27, 50, 73, 50, p);
      canvas.restore();
      p.setStyle(Paint.Style.FILL);
      p.setColor(u.accent);
      canvas.drawCircle(82, 22, 4, p);
      p.setColor(CampusUi.blend(Color.WHITE, u.accent, .4f));
      canvas.drawCircle(14, 74, 3, p);
      p.setColor(u.theme.heroMuted);
      for (float[] point : new float[][] {{9, 18}, {74, 83}, {91, 62}, {46, 4}, {27, 92}})
        canvas.drawCircle(point[0], point[1], 1, p);
      canvas.restore();
    }
  }

  static final class FocusRing extends View {
    final CampusUi u;
    final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
    float progress;

    FocusRing(CampusActivity a, long left, long duration) {
      super(a);
      u = a.ui;
      setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
      update(left, duration);
    }

    void update(long left, long duration) {
      progress = Math.max(0, Math.min(1, 1 - left / (float) Math.max(1, duration)));
      invalidate();
    }

    @Override
    protected void onDraw(Canvas canvas) {
      float radius = Math.min(getWidth(), getHeight()) / 2f - u.dp(16);
      float cx = getWidth() / 2f, cy = getHeight() / 2f;
      p.setStyle(Paint.Style.STROKE);
      p.setStrokeWidth(u.dp(1));
      p.setColor(u.border);
      for (int i = 0; i < 60; i++) {
        double angle = i * Math.PI / 30;
        float inner = radius - u.dp(i % 5 == 0 ? 13 : 10);
        canvas.drawLine(
            cx + (float) Math.cos(angle) * inner,
            cy + (float) Math.sin(angle) * inner,
            cx + (float) Math.cos(angle) * (radius - u.dp(7)),
            cy + (float) Math.sin(angle) * (radius - u.dp(7)),
            p);
      }
      RectF arc = new RectF(cx - radius, cy - radius, cx + radius, cy + radius);
      p.setStrokeWidth(u.dp(5));
      p.setStrokeCap(Paint.Cap.ROUND);
      p.setColor(u.soft);
      canvas.drawArc(arc, 0, 360, false, p);
      p.setColor(u.accent);
      canvas.drawArc(arc, -90, Math.max(.01f, progress * 360), false, p);
      p.setStyle(Paint.Style.FILL);
      double angle = (-90 + progress * 360) * Math.PI / 180;
      canvas.drawCircle(
          cx + (float) Math.cos(angle) * radius, cy + (float) Math.sin(angle) * radius, u.dp(4), p);
    }
  }
}
