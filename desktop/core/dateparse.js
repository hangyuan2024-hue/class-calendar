// 快速记事：从一句话里认出日期、时间、地点，比如「明天下午3点交实验报告 @B302」
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CCParse = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const pad = (n) => String(n).padStart(2, "0");
  const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const CN = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 日: 7, 天: 7 };
  function cnNum(s) {
    if (/^\d+$/.test(s)) return +s;
    if (s === "十") return 10;
    const m = /^([一二两三四五六七八九])?十([一二三四五六七八九])?$/.exec(s);
    if (m) return (m[1] ? CN[m[1]] : 1) * 10 + (m[2] ? CN[m[2]] : 0);
    return s.length === 1 && s in CN ? CN[s] : NaN;
  }
  const NUM = "(\\d{1,2}|[一二两三四五六七八九十]{1,3})";

  function parse(text, now) {
    now = now || new Date();
    let s = " " + String(text || "").trim() + " ", date = null, time = "", location = "";
    const cut = (re, fn) => { const m = re.exec(s); if (!m) return false; const r = fn(m); if (r === false) return false; s = s.slice(0, m.index) + " " + s.slice(m.index + m[0].length); return true; };
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const plus = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return d; };

    // 地点：@后面的词
    cut(/[@＠]\s*([^\s，,。]+)/, (m) => { location = m[1]; });
    // 完整日期
    cut(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})[日号]?/, (m) => { date = new Date(+m[1], +m[2] - 1, +m[3]); });
    if (!date) cut(new RegExp(NUM + "月" + NUM + "[日号]?"), (m) => {
      const mo = cnNum(m[1]), d = cnNum(m[2]); if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return false;
      date = new Date(now.getFullYear(), mo - 1, d); if (date < plus(-30)) date.setFullYear(date.getFullYear() + 1);
    });
    if (!date) cut(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?=\s|$)/, (m) => { date = new Date(now.getFullYear(), +m[1] - 1, +m[2]); if (date < plus(-30)) date.setFullYear(date.getFullYear() + 1); });
    if (!date) cut(/(大后天|后天|明天|明日|今天|今日|今晚|明晚|昨天)/, (m) => {
      const n = { 今天: 0, 今日: 0, 今晚: 0, 明天: 1, 明日: 1, 明晚: 1, 后天: 2, 大后天: 3, 昨天: -1 }[m[1]];
      date = plus(n);
      if (/晚/.test(m[1])) s = s + " 晚上 ";
    });
    if (!date) cut(new RegExp("(下下|下个?|这个?|本)?(?:周|星期|礼拜)([一二三四五六日天1-7])"), (m) => {
      const want = cnNum(m[2]) % 7;                       // 0 = 周日
      const cur = today.getDay();
      let diff = (want - cur + 7) % 7;
      const curMon = (cur + 6) % 7, wantMon = (want + 6) % 7;   // 按周一开头算
      if (m[1] && /下下/.test(m[1])) diff = wantMon - curMon + 14;
      else if (m[1] && /下/.test(m[1])) diff = wantMon - curMon + 7;
      else if (m[1] && /这|本/.test(m[1])) diff = wantMon - curMon;
      else if (diff === 0) diff = 0;                     // 说「周三」又刚好是周三：就是今天
      date = plus(diff);
    });
    if (!date) cut(new RegExp(NUM + "天(?:以)?后"), (m) => { const n = cnNum(m[1]); if (!(n >= 0)) return false; date = plus(n); });

    // 时间
    let period = "";
    cut(/(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|今晚|晚)/, (m) => { period = m[1]; });
    const fix = (h) => {
      if (/下午|傍晚|晚上|今晚|晚/.test(period) && h < 12) return h + 12;
      if (/中午/.test(period) && h < 6) return h + 12;
      return h;
    };
    if (!cut(/(\d{1,2})[:：](\d{2})/, (m) => { const h = +m[1], mi = +m[2]; if (h > 23 || mi > 59) return false; time = pad(fix(h)) + ":" + pad(mi); })) {
      cut(new RegExp(NUM + "[点時时](半|(\\d{1,2}|[一二三四五六七八九十]{1,3})分?|一刻|三刻)?(钟)?"), (m) => {
        let h = cnNum(m[1]); if (!(h >= 0 && h <= 24)) return false;
        let mi = 0;
        if (m[2] === "半") mi = 30; else if (m[2] === "一刻") mi = 15; else if (m[2] === "三刻") mi = 45; else if (m[2]) mi = cnNum(m[3] || m[2].replace("分", ""));
        if (!(mi >= 0 && mi < 60)) mi = 0;
        h = fix(h); if (h === 24) h = 0;
        time = pad(h) + ":" + pad(mi);
      });
    }
    if (!time && period && !date) date = today;
    if (!time && /下午|晚上|今晚|晚/.test(period)) time = "";      // 只说了「晚上」：不猜具体几点
    if (!date && time) { date = today; if (time < pad(now.getHours()) + ":" + pad(now.getMinutes())) date = plus(1); }

    const subject = s.replace(/^[\s，,。:：-]+|[\s，,。:：-]+$/g, "").replace(/\s{2,}/g, " ").replace(/^(要|得|记得|提醒我)\s*/, "").trim();
    return { subject, date: date ? key(date) : "", time, location };
  }
  return { parse };
});
