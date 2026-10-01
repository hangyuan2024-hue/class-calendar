/* 捞捞本地规则整理：不调用大模型，在浏览器里把班级群消息整理成事项。
 * 拿得准的直接出结果；拿不准的放进 unsure，交给 AI 兜底。
 * 用法：LaoParse.parse(文本, "2026-10-01") → { items, unsure, chatter, dupes }
 */
(function (root) {
  "use strict";

  const pad = (n) => String(n).padStart(2, "0");
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const WD = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7 };
  const CN_NUM = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  function cnToNum(s) {
    if (/^\d+$/.test(s)) return +s;
    if (s === "十") return 10;
    if (s.length === 2 && s[0] === "十") return 10 + CN_NUM[s[1]];
    if (s.length === 2 && s[1] === "十") return CN_NUM[s[0]] * 10;
    if (s.length === 3 && s[1] === "十") return CN_NUM[s[0]] * 10 + CN_NUM[s[2]];
    return CN_NUM[s] ?? NaN;
  }
  const NUM = "(\\d{1,2}|[一二两三四五六七八九十]{1,3})";

  // ---------- 课程名（左边是群里常见叫法，右边是统一名称） ----------
  const COURSES = [
    [/高数|高等数学|微积分/, "高等数学"], [/线代|线性代数/, "线性代数"], [/概率论?|概统|数理统计/, "概率论"],
    [/大英|大学英语|英语|四级|六级|单词/, "大学英语"], [/大物|大学物理|物理/, "大学物理"],
    [/c\+\+|C\+\+/, "C++"], [/c语言|C语言|程序设计/i, "C语言"], [/数据结构/, "数据结构"], [/离散/, "离散数学"],
    [/计算机导论|计导/, "计算机导论"], [/python/i, "Python"], [/java(?!script)/i, "Java"], [/网页|前端|html/i, "网页设计"],
    [/数据库/, "数据库"], [/操作系统/, "操作系统"], [/计算机网络|计网/, "计算机网络"], [/电路|数电|模电/, "电路"],
    [/思修|思想道德/, "思想道德与法治"], [/马原|马克思/, "马克思主义原理"], [/毛概|毛泽东思想/, "毛概"], [/近代史|纲要/, "中国近现代史纲要"],
    [/形势与政策|形策/, "形势与政策"], [/体育|体测|跑操|阳光跑/, "体育"], [/军理|军事理论/, "军事理论"], [/心理健康|心理课/, "心理健康"],
    [/职业生涯|职规/, "职业生涯规划"], [/创新创业|创业基础/, "创新创业"], [/大学语文|语文/, "大学语文"],
  ];

  // ---------- 分类关键词（顺序即优先级） ----------
  const TYPES = [
    ["作业", /作业|习题|练习|实验报告|报告|论文|ppt|PPT|提交|上交|交到|交给|截止|ddl|DDL|打卡|学习通|超星|雨课堂|背诵|预习|复习|小组展示|读后感|心得/],
    ["会议", /开会|班会|会议|例会|座谈|年级大会|团日|组会|集合开会/],
    ["活动", /活动|比赛|竞赛|报名|运动会|志愿|晚会|社团|参观|讲座|演出|联欢|招新|观影|评选|投票/],
    ["通知", /通知|放假|调课|停课|补课|换教室|考试|体测|缴费|交费|领取|领书|注意|请各位|请大家|全体|务必|提醒|安排|返校|离校|查寝|宿舍|核酸|疫苗|补考|成绩|选课|评教/],
  ];
  const UNSURE_WORDS = /待定|另行通知|具体时间|暂定|可能|大概|左右|或者|还是|看情况/;

  // ---------- 闲聊过滤 ----------
  const CHATTER = /^(收到|收到收到|好的?|好滴|好嘞|好哒|嗯+|哦+|噢+|ok|okk+|OK|欧克|1|111+|\+1|＋1|谢谢.{0,6}|多谢.{0,4}|感谢.{0,6}|辛苦了?.{0,4}|了解|明白|知道了|懂了|行|可以|没问题|在|在的|来了|哈+|哈哈.*|嘿嘿|嘻嘻|呜+|啊+|？+|\?+|!+|！+|。+)[~～!！。.、，,\s]*$/i;
  const MEDIA = /^\[(表情|图片|语音|视频|动画表情|文件|链接|位置|红包|转账|拍一拍)[^\]]*\]$/;
  const HEADER = /^(.{1,24}?)\s+(\d{4}[\/\-年]\d{1,2}[\/\-月]\d{1,2}日?\s*)?(上午|下午|晚上|凌晨|中午)?\d{1,2}:\d{2}(:\d{2})?$/;   // 「张三 10:21」这类发送人行
  const DATE_LINE = /^(\d{4}[\/\-年]\d{1,2}[\/\-月]\d{1,2}日?|\d{1,2}月\d{1,2}日|昨天|今天|星期[一二三四五六日天])(\s+(上午|下午|晚上)?\d{1,2}:\d{2})?$/;
  const NOT_NAME = /^(通知|注意|提醒|作业|重要|备注|地点|时间|要求|内容|说明|附|ps|PS|tips|补充|更正|紧急|温馨提示)$/;

  function isChatter(t) {
    const s = t.replace(/\[[^\]]{1,6}\]/g, "").replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}️]/gu, "").trim();
    if (!s) return true;
    if (MEDIA.test(t.trim())) return true;
    if (CHATTER.test(s)) return true;
    if (/^@\S+\s*(收到|好的?|ok)?$/i.test(s)) return true;
    if (/^\d+[.、]\s*\S{1,6}$/.test(s) && !/[交作业会]/.test(s)) return true;   // 接龙「12. 张三」
    return false;
  }

  // ---------- 拆成一条条消息 ----------
  function splitMessages(text) {
    const lines = String(text || "").replace(/\r/g, "").split("\n");
    const msgs = []; let cur = null;
    const flush = () => { if (cur && cur.lines.length) msgs.push(cur); cur = null; };
    let sawHeader = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) { if (!sawHeader) flush(); continue; }
      const h = line.match(HEADER);
      if (h && !/[，。！？,]/.test(h[1])) { flush(); sawHeader = true; cur = { sender: h[1].trim(), lines: [] }; continue; }
      if (DATE_LINE.test(line)) continue;
      if (!cur) cur = { sender: "", lines: [] };
      let body = line, sender = "";
      const m = line.match(/^([^\s：:，。]{1,10})[：:]\s*(.+)$/);
      if (m && !NOT_NAME.test(m[1]) && !/\d{1,2}$/.test(m[1])) { sender = m[1]; body = m[2]; }
      if (!sawHeader) {
        // 没有发送人行的复制格式：每一行当作一条消息
        flush(); cur = { sender, lines: [body] }; flush();
      } else cur.lines.push(body);
    }
    flush();
    return msgs.map((m) => ({ sender: m.sender, text: m.lines.join("\n").trim() })).filter((m) => m.text);
  }

  // ---------- 日期 ----------
  function findDate(t, pub) {
    const base = new Date(pub + "T00:00:00");
    const dow = (base.getDay() + 6) % 7 + 1;   // 周一=1
    let m;
    if ((m = t.match(/(\d{4})[年\-\/.](\d{1,2})[月\-\/.](\d{1,2})/))) return keyOf(new Date(+m[1], +m[2] - 1, +m[3]));
    if ((m = t.match(new RegExp(NUM + "月" + NUM + "[日号]?")))) {
      const mo = cnToNum(m[1]), d = cnToNum(m[2]);
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        let y = base.getFullYear(); if (mo < base.getMonth() + 1 - 6) y++;
        return keyOf(new Date(y, mo - 1, d));
      }
    }
    if ((m = t.match(/(?<![\d.])(\d{1,2})[.\/](\d{1,2})(?![\d.:%])/))) {
      const mo = +m[1], d = +m[2];
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) { let y = base.getFullYear(); if (mo < base.getMonth() + 1 - 6) y++; return keyOf(new Date(y, mo - 1, d)); }
    }
    if (/大后天/.test(t)) return keyOf(addDays(base, 3));
    if (/后天/.test(t)) return keyOf(addDays(base, 2));
    if (/明天|明早|明晚|明日|明儿/.test(t)) return keyOf(addDays(base, 1));
    if (/今天|今晚|今早|今日|今天下午|今天中午|当天|今儿/.test(t)) return keyOf(base);
    if ((m = t.match(/(下下|下个?|本|这个?|这)?(周|星期|礼拜)([一二三四五六日天1-7])/))) {
      const w = WD[m[3]]; let diff = w - dow;
      if (m[1] && m[1].startsWith("下下")) diff += 14;
      else if (m[1] && m[1].startsWith("下")) diff += 7;
      else if (!m[1] && diff < 0) diff += 7;          // 只说「周三」且已经过了，指下周三
      return keyOf(addDays(base, diff));
    }
    if ((m = t.match(new RegExp("(?<![月\\d])" + NUM + "[号日](?![子期])")))) {
      const d = cnToNum(m[1]);
      if (d >= 1 && d <= 31) { let dt = new Date(base.getFullYear(), base.getMonth(), d); if (dt < addDays(base, -3)) dt = new Date(base.getFullYear(), base.getMonth() + 1, d); return keyOf(dt); }
    }
    if (/周末/.test(t)) return keyOf(addDays(base, 6 - dow >= 0 ? 6 - dow : 6));
    return "";
  }

  // ---------- 时间 ----------
  function findTime(t) {
    let m = t.match(/(\d{1,2})[:：](\d{2})/);
    let h = null, mi = 0;
    if (m) { h = +m[1]; mi = +m[2]; }
    else if ((m = t.match(new RegExp(NUM + "[点时](半|一刻|三刻|(\\d{1,2})分?)?")))) {
      h = cnToNum(m[1]);
      if (m[2] === "半") mi = 30; else if (m[2] === "一刻") mi = 15; else if (m[2] === "三刻") mi = 45; else if (m[3]) mi = +m[3];
    } else if (/中午/.test(t)) { h = 12; }
    if (h == null || isNaN(h) || h > 24 || mi > 59) return "";
    const before = m ? t.slice(0, m.index) : t;
    if (/(下午|晚上|晚|傍晚|今晚|明晚)\s*$/.test(before.slice(-4)) || (/(下午|晚上|晚自习|傍晚|今晚|明晚)/.test(before) && h < 12)) { if (h < 12) h += 12; }
    else if (/中午/.test(before.slice(-4)) && h < 6) h += 12;
    if (h === 24) { h = 23; mi = 59; }
    return `${pad(h)}:${pad(mi)}`;
  }

  function findLocation(t) {
    let m = t.match(/(?:在|地点[:：]?\s*|到|于)\s*([一-龥A-Za-z0-9]{1,10}?(?:楼|馆|厅|室|教室|操场|中心|广场|礼堂|机房|实验室)[A-Za-z]?[\-\d]{0,5})/);
    if (m) return m[1];
    m = t.match(/(?<![A-Za-z\d])([A-Za-z]\d{3,4}|[A-Za-z]区\d{3,4}|\d{1,2}[号#]楼\d{3,4})(?![\d])/);
    if (m) return m[1];
    m = t.match(/([一-龥]{2,6}(?:楼|馆|报告厅|礼堂|操场|体育场|机房))/);
    return m ? m[1] : "";
  }
  function findPrepare(t) {
    const m = t.match(/(?:带上?|携带|准备好?|需带|需要带|自备)\s*([^，。,；;！!\n]{1,20})/);
    return m ? m[1].replace(/^(好|上)/, "").trim() : "";
  }

  function subjectOf(t, type) {
    for (const [re, name] of COURSES) if (re.test(t)) return name;
    if (type === "会议") { const m = t.match(/(班会|年级大会|团日活动|[一-龥]{2,6}会议|例会)/); if (m) return m[1]; }
    if (type === "活动") { const m = t.match(/([一-龥A-Za-z0-9]{0,8}?(?:比赛|竞赛|运动会|晚会|讲座|活动|招新|志愿者?)(?:报名)?)/); if (m) return m[1]; }
    if (type === "通知") { const m = t.match(/(放假|调课|停课|补课|体测|考试|缴费|选课|评教|查寝|返校)/); if (m) return m[1] + "通知"; }
    return "";
  }

  function clean(t) {
    return t.replace(/@\S+\s?/g, "").replace(/\[[^\]]{1,8}\]/g, "").replace(/[【】]/g, "").replace(/\s+/g, " ").trim();
  }

  // ---------- 主函数 ----------
  function parse(text, pubDate) {
    const pub = pubDate || keyOf(new Date());
    const out = { items: [], unsure: [], chatter: [], dupes: 0 };
    const seen = new Set();
    for (const msg of splitMessages(text)) {
      const raw = msg.text;
      const norm = raw.replace(/\s+/g, "");
      if (seen.has(norm)) { out.dupes++; continue; }
      seen.add(norm);
      if (isChatter(raw)) { out.chatter.push(raw); continue; }
      const t = clean(raw);
      // 报名、比赛这类即使带「截止」也是活动
      const type = /报名|比赛|竞赛|运动会|晚会|志愿者?招募/.test(t) ? "活动" : (TYPES.find(([, re]) => re.test(t)) || [null])[0];
      const day = findDate(t, pub), time = day ? findTime(t) : "";
      // 同学提问（「…吗？」）不是通知
      if (/(吗|呢|嘛|么)[？?]*$|[？?]$/.test(t) && !day) { out.chatter.push(raw); continue; }
      if (!type) {
        // 没有任何关键词：短句当闲聊，长句或带日期的交给 AI 判断
        if (t.length <= 12 && !day) out.chatter.push(raw); else out.unsure.push({ text: raw, sender: msg.sender, why: "看不出是什么事" });
        continue;
      }
      const subject = subjectOf(t, type);
      const lines = t.split(/[。；;！!\n]/).filter(Boolean);
      const multi = lines.filter((l) => TYPES.some(([, re]) => re.test(l)) && findDate(l, pub)).length >= 2;
      if (multi) { out.unsure.push({ text: raw, sender: msg.sender, why: "一条里有好几件事" }); continue; }
      const needConfirm = !day || UNSURE_WORDS.test(t);
      const item = {
        msg_type: type,
        subject: subject || t.replace(/^(通知|提醒|注意|重要)[:：]?/, "").slice(0, 12),
        summary: t.length > 80 ? t.slice(0, 79) + "…" : t,
        event_time: day ? day + (time ? " " + time : "") : "",
        location: findLocation(t),
        prepare: findPrepare(t),
        original: (msg.sender ? msg.sender + "：" : "") + raw,
        publish_date: pub,
        need_confirm: needConfirm,
      };
      // 作业/会议/活动 没有日期 → 拿不准，交给 AI；通知没日期也能直接发
      if (!day && type !== "通知") { out.unsure.push({ text: raw, sender: msg.sender, why: "没找到具体日期", guess: item }); continue; }
      out.items.push(item);
    }
    return out;
  }

  // 本地 AI / 云端 AI 都用的提取说明（让模型只回 JSON）
  function extractPrompt(pub) {
    const base = new Date(pub + "T00:00:00"), mon = addDays(base, -((base.getDay() + 6) % 7));
    const wk = (o) => "一二三四五六日".split("").map((c, i) => `${o}${c}=${keyOf(addDays(mon, i + (o === "下周" ? 7 : 0)))}`).join("，");
    return `你是班级群消息整理助手。从用户给的群消息里提取需要记下来的事项，只输出 JSON 数组，不要任何解释。
每个事项字段：msg_type（作业/会议/活动/通知 之一）、subject（科目或标题，12 字以内）、summary（一句话内容）、event_time（"YYYY-MM-DD HH:MM" 或 "YYYY-MM-DD"，不知道就是 ""）、location、prepare（需要带/准备的东西）、original（对应原文）、need_confirm（日期或细节不确定时为 true）。
消息发布日期是 ${pub}。换算日期请查表：${wk("本周")}；${wk("下周")}。
闲聊、收到、表情一律忽略；没有需要记录的事项时输出 []。`;
  }
  function parseJsonItems(s, pub) {
    if (!s) return null;
    const m = String(s).match(/\[[\s\S]*\]/);
    if (!m) return null;
    let arr; try { arr = JSON.parse(m[0]); } catch (e) { return null; }
    if (!Array.isArray(arr)) return null;
    const types = ["作业", "会议", "活动", "通知"];
    return arr.filter((x) => x && typeof x === "object").map((x) => ({
      msg_type: types.includes(x.msg_type) ? x.msg_type : "通知",
      subject: String(x.subject || "").slice(0, 60), summary: String(x.summary || "").slice(0, 300),
      event_time: /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(x.event_time || "") ? x.event_time : "",
      location: String(x.location || "").slice(0, 60), prepare: String(x.prepare || "").slice(0, 100),
      original: String(x.original || "").slice(0, 1000), publish_date: pub, need_confirm: !!x.need_confirm || !x.event_time,
    })).filter((x) => x.subject || x.summary);
  }

  const api = { parse, splitMessages, isChatter, findDate, findTime, findLocation, extractPrompt, parseJsonItems };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.LaoParse = api;
})(typeof window !== "undefined" ? window : globalThis);
