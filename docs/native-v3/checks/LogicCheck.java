package com.laolao.classcalendar;
public class LogicCheck {
 private static void check(boolean v,String msg){if(!v)throw new AssertionError(msg);}
 public static void main(String[] args){String base="https://hangyuan2024-hue.github.io/class-calendar/";
  for(String s:new String[]{base,base+"index.html?guest=1#plan",base.substring(0,base.length()-1),"https://HANGYUAN2024-HUE.github.io:443/class-calendar/login.html"})check(SiteNavigation.isInternal(base,s),"internal "+s);
  for(String s:new String[]{"https://hangyuan2024-hue.github.io.evil.test/class-calendar/","https://hangyuan2024-hue.github.io/class-calendar-other/","https://hangyuan2024-hue.github.io/class-calendar/../another/","https://hangyuan2024-hue.github.io/class-calendar/%2e%2e/another/","https://user@hangyuan2024-hue.github.io/class-calendar/","https://hangyuan2024-hue.github.io:444/class-calendar/","http://hangyuan2024-hue.github.io/class-calendar/","intent://app"})check(!SiteNavigation.isInternal(base,s),"external "+s);
  check(DateMath.plus("2024-02-28",1).equals("2024-02-29"),"leap year");check(DateMath.plus("2026-12-31",1).equals("2027-01-01"),"year boundary");
  for(String s:new String[]{"2026-02-29","2026-13-01","2026-01-32","2026-1-2"}){try{DateMath.parse(s);throw new AssertionError("bad date accepted");}catch(IllegalArgumentException expected){}}
  for(String s:new String[]{"24:00","08:60","8:00"}){try{DateMath.time(s);throw new AssertionError("bad time accepted");}catch(IllegalArgumentException expected){}}
  System.out.println("PASS12site boundaries + leap/year/date/time validations");
 }
}
