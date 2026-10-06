package com.laolao.classcalendar;

import java.util.Locale;

/** Complete palettes, shared by real pages and the native skin previews. */
final class CampusTheme {
  static final class Preset {
    final String id, name, note;
    final boolean dark;
    final int bg, surface, ink, muted, primary, heroStart, heroEnd, nightAccent;

    Preset(
        String id,
        String name,
        String note,
        boolean dark,
        String bg,
        String surface,
        String ink,
        String muted,
        String primary,
        String heroStart,
        String heroEnd,
        String nightAccent) {
      this.id = id;
      this.name = name;
      this.note = note;
      this.dark = dark;
      this.bg = rgb(bg);
      this.surface = rgb(surface);
      this.ink = rgb(ink);
      this.muted = rgb(muted);
      this.primary = rgb(primary);
      this.heroStart = rgb(heroStart);
      this.heroEnd = rgb(heroEnd);
      this.nightAccent = rgb(nightAccent);
    }
  }

  static final Preset[] PRESETS = {
    new Preset(
        "mint",
        "薄荷雾",
        "雾白绿意 · 轻松有序",
        false,
        "#F5F7F4",
        "#FFFFFF",
        "#202C27",
        "#617168",
        "#356752",
        "#20362D",
        "#355C48",
        "#B5E1C7"),
    new Preset(
        "moon",
        "月光白",
        "纸感留白 · 安静专注",
        false,
        "#F7F6F3",
        "#FFFFFF",
        "#292D34",
        "#6B6D73",
        "#4B586C",
        "#292F3B",
        "#4C5668",
        "#BBCBEB"),
    new Preset(
        "sky",
        "晴空蓝",
        "清透蓝调 · 安心日常",
        false,
        "#F3F6FD",
        "#FFFFFF",
        "#1E2D4B",
        "#606E87",
        "#3E5EBB",
        "#1E3159",
        "#3E5694",
        "#A6BFFF"),
    new Preset(
        "forest",
        "森野绿",
        "温柔绿意 · 专注呼吸",
        false,
        "#F0F6F2",
        "#FFFFFF",
        "#213B35",
        "#5C756B",
        "#267661",
        "#153F37",
        "#326C57",
        "#8BE0BE"),
    new Preset(
        "sakura",
        "樱花粉",
        "柔和玫瑰 · 记录心情",
        false,
        "#FCF3F6",
        "#FFFCFD",
        "#4B2B39",
        "#806775",
        "#AA4265",
        "#562A3C",
        "#984765",
        "#F3AAC9"),
    new Preset(
        "apricot",
        "暖杏橙",
        "奶油暖色 · 松弛生活",
        false,
        "#FCF5EC",
        "#FFFDFA",
        "#453226",
        "#7D6C5D",
        "#97552F",
        "#543728",
        "#885736",
        "#F3C796"),
    new Preset(
        "lavender",
        "鸢尾紫",
        "轻盈紫调 · 灵感时刻",
        false,
        "#F6F3FC",
        "#FEFDFF",
        "#342A4D",
        "#736885",
        "#7050AE",
        "#372652",
        "#65468D",
        "#C8ADF5"),
    new Preset(
        "ocean",
        "海盐青",
        "清凉青色 · 自在校园",
        false,
        "#EFF7F8",
        "#FCFFFF",
        "#213C44",
        "#59727D",
        "#157286",
        "#163D4A",
        "#2D6678",
        "#86E2EF"),
    new Preset(
        "cyber",
        "深海赛博",
        "青色星光 · 深夜学习",
        true,
        "#08131D",
        "#112534",
        "#ECF7FC",
        "#A7BAC9",
        "#73E3D0",
        "#12333C",
        "#17394E",
        "#73E3D0"),
    new Preset(
        "graphite",
        "曜石黑",
        "暖金点缀 · 克制纯粹",
        true,
        "#12151B",
        "#20252E",
        "#F3F0E9",
        "#B8B5AE",
        "#E1C891",
        "#252B36",
        "#484239",
        "#E1C891")
  };

  final Preset preset;
  final boolean dark, metaverse;
  final int bg, surface, ink, muted, primary, heroStart, heroEnd, heroInk, heroMuted;

  private CampusTheme(Preset p, boolean dark, boolean meta, String custom) {
    preset = p;
    this.dark = dark;
    metaverse = meta;
    boolean convert = dark && !p.dark;
    bg = convert ? rgb("#0A1420") : p.bg;
    surface = convert ? rgb("#142739") : p.surface;
    ink = convert ? rgb("#EDF5FC") : p.ink;
    muted = convert ? rgb("#AFBECE") : p.muted;
    int picked = custom != null && custom.matches("#[0-9a-fA-F]{6}") ? rgb(custom) : p.primary;
    primary =
        convert ? picked != p.primary ? mix(0xffffffff, picked, .55f) : p.nightAccent : picked;
    heroStart = convert ? mix(p.nightAccent, rgb("#0F2031"), .10f) : p.heroStart;
    heroEnd = convert ? mix(p.nightAccent, rgb("#14273D"), .20f) : p.heroEnd;
    heroInk = rgb("#FFFFFF");
    heroMuted = mix(heroInk, heroEnd, .85f);
  }

  static Preset preset(String id) {
    for (Preset p : PRESETS) if (p.id.equals(id)) return p;
    return PRESETS[0];
  }

  static CampusTheme resolve(
      String skin, String id, String custom, boolean systemNight, boolean meta) {
    Preset p = preset(id);
    if ("cyber".equals(skin) && !p.dark) p = preset("cyber");
    if ("cute".equals(skin) && (id == null || id.isEmpty())) p = preset("sakura");
    boolean dark = p.dark;
    if ("auto".equals(skin)) {
      if (p.dark) p = preset("sky");
      dark = systemNight;
    }
    if (meta) dark = true;
    return new CampusTheme(p, dark, meta, custom);
  }

  static CampusTheme preview(Preset p) {
    return new CampusTheme(p, p.dark, false, null);
  }

  static int rgb(String hex) {
    return (int) (0xff000000L | Long.parseLong(hex.substring(1), 16));
  }

  static String hex(int colour) {
    return String.format(Locale.ROOT, "#%06X", colour & 0xffffff);
  }

  static int mix(int front, int back, float amount) {
    int r = Math.round(((front >> 16) & 255) * amount + ((back >> 16) & 255) * (1 - amount));
    int g = Math.round(((front >> 8) & 255) * amount + ((back >> 8) & 255) * (1 - amount));
    int b = Math.round((front & 255) * amount + (back & 255) * (1 - amount));
    return 0xff000000 | r << 16 | g << 8 | b;
  }
}
