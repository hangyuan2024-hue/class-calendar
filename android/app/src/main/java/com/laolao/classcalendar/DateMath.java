package com.laolao.classcalendar;

import java.text.*;
import java.util.*;

/** Strict ISO dates, UTC day arithmetic and local today; available on Android24. */
final class DateMath {
  private static SimpleDateFormat fmt() {
    SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
    f.setTimeZone(TimeZone.getTimeZone("UTC"));
    f.setLenient(false);
    return f;
  }

  static String today() {
    return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
  }

  static Date parse(String s) {
    if (s == null || !s.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}"))
      throw new IllegalArgumentException("日期格式应为年-月-日");
    try {
      return fmt().parse(s);
    } catch (Exception e) {
      throw new IllegalArgumentException("日期不存在");
    }
  }

  static long days(String s) {
    return (parse(s).getTime() - parse(today()).getTime()) / 86400000L;
  }

  static String plus(String s, int n) {
    Calendar c = Calendar.getInstance(TimeZone.getTimeZone("UTC"), Locale.US);
    c.setTime(parse(s));
    c.add(Calendar.DAY_OF_MONTH, n);
    return fmt().format(c.getTime());
  }

  static int[] parts(String s) {
    parse(s);
    String[] a = s.split("-");
    return new int[] {Integer.parseInt(a[0]), Integer.parseInt(a[1]), Integer.parseInt(a[2])};
  }

  static String date(int y, int m, int d) {
    String s = String.format(Locale.US, "%04d-%02d-%02d", y, m, d);
    parse(s);
    return s;
  }

  static int[] time(String s) {
    if (s == null || !s.matches("[0-9]{2}:[0-9]{2}"))
      throw new IllegalArgumentException("时间格式应为时:分");
    String[] a = s.split(":");
    int h = Integer.parseInt(a[0]), m = Integer.parseInt(a[1]);
    if (h > 23 || m > 59) throw new IllegalArgumentException("时间无效");
    return new int[] {h, m};
  }
}
