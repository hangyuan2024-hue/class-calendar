/* 捞捞本地整理 v2：不调用大模型，在浏览器里把班级群消息整理成事项，并且会从班委的修改里学习。
 * 拿得准的直接出结果；拿不准的放进 unsure，交给 AI 兜底。
 * 用法：
 *   LaoParse.parse(文本, "2026-10-01", { model }) → { items, unsure, chatter, dupes }
 *   const model = LaoParse.createModel(已保存的学习数据)   // 学习模块，见文件后半部分
 */
(function (root) {
  "use strict";

  // ================= 基础工具 =================
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
  // 全角转半角、统一冒号，方便后面的规则
  function normalize(t) {
    return String(t || "")
      .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/：/g, ":").replace(/[～〜]/g, "~").replace(/ /g, " ");
  }

  // ================= 课程名（左边是群里常见叫法，右边是统一名称） =================
  const COURSES = [
    [/高数|高等数学|微积分/, "高等数学"], [/线代|线性代数/, "线性代数"], [/概率论?|概统|数理统计/, "概率论"],
    [/大英|大学英语|英语(?!角)|四级|六级|听力|口语|单词|批改网/, "大学英语"], [/大物|大学物理|物理/, "大学物理"],
    [/c\+\+/i, "C++"], [/c语言|程序设计基础/i, "C语言"], [/数据结构/, "数据结构"], [/离散/, "离散数学"],
    [/计算机导论|计导/, "计算机导论"], [/python/i, "Python"], [/java(?!script)/i, "Java"], [/网页设计|前端|html/i, "网页设计"],
    [/数据库/, "数据库"], [/操作系统/, "操作系统"], [/计算机网络|计网/, "计算机网络"], [/计算机组成|计组/, "计算机组成原理"],
    [/嵌入式/, "嵌入式系统"], [/单片机/, "单片机"], [/电路|数电|模电/, "电路"], [/人工智能导论/, "人工智能导论"],
    [/思修|思想道德/, "思想道德与法治"], [/马原|马克思/, "马克思主义原理"], [/毛概|毛泽东思想/, "毛概"], [/近代史|纲要/, "中国近现代史纲要"],
    [/形势与政策|形策/, "形势与政策"], [/体育(?!委员|馆|场)|跑操|阳光跑|阳光长跑|长跑|800米|1000米|50米/, "体育"], [/军理|军事理论/, "军事理论"],
    [/心理健康|心理课/, "心理健康"], [/职业生涯|职规/, "职业生涯规划"], [/创新创业基础|创业基础/, "创新创业"], [/大学语文/, "大学语文"],
  ];

  // ================= 类型打分规则 =================
  // [正则, 类型, 分数]。所有命中的分数加起来，分高的类型胜出
  const RULES = [
    // 作业
    [/作业/, "作业", 4], [/习题|练习题|课后题/, "作业", 3], [/实验报告/, "作业", 4], [/报告(?!厅|会)/, "作业", 2], [/论文/, "作业", 3],
    [/作文|读后感|心得|观后感|规划书|周报|总结报告/, "作业", 3], [/ppt|PPT/, "作业", 2], [/展示|汇报(?!表演|演出)|答辩|presentation|pre(?![a-z])/i, "作业", 3], [/课设|课程设计|大作业/, "作业", 3],
    [/背诵|默写|预习|复习|背单词/, "作业", 3], [/网课|刷完|刷课/, "作业", 2], [/(提交|上交|拍照上传)/, "作业", 2], [/编程题|课后题|上机题|PTA|pta|OJ|头歌|educoder|平台作业|实训报告/, "作业", 3],
    [/(?<!不用)交(?!通|流|换|费|钱|材料|表|照片|回执)/, "作业", 1], [/截止|ddl|DDL/, "作业", 1], [/学习通|超星|雨课堂|批改网|慕课/, "作业", 1],
    [/发到.{0,4}邮箱/, "作业", 3], [/实验[一二三四五六七八九十\d]+/, "作业", 2], [/作业本/, "作业", 2],
    [/(学习通|超星|雨课堂).{0,8}完成|完成.{0,10}(学习通|超星|雨课堂)/, "作业", 3],
    // 会议
    [/开会|班会|会议(?!号|室)|例会|座谈|年级大会|组会|党课|团日|支部大会|班委会|碰个?头|约谈|谈话|短会|小会|全体大会|开个会|[一-龥]{0,6}大会(?!操)/, "会议", 5], [/召开/, "会议", 2],
    // 活动
    [/活动(?!中心|室)/, "活动", 2], [/晚会|运动会|开幕式|志愿|社团|招新|面试|参观|讲座|演出|联欢|观影|看电影|团建|聚餐|聚会|评选|投票|分享会|英语角|读书会|拔河|拉练|植树|献血|升旗|彩排|义务|主题日|宣讲|电脑节|文化节|艺术节|科技节|敬老院|春游|秋游|郊游|素拓|拓展/, "活动", 3],
    [/培训/, "活动", 2], [/坐大巴|校车|大巴|包车/, "活动", 2], [/(赛|运动会|比赛).{0,20}加油|加油.{0,10}(赛|运动会)|拉拉队|啦啦队/, "活动", 2],
    [/(比|竞|决|初|复|校|辩论|篮球|足球|排球|羽毛球|乒乓球|歌唱|演讲|知识|技能|选拔|大|联|开|新生)赛|[一-龥A-Za-z]{2,6}杯(?!子)/, "活动", 4], [/报名/, "活动", 3], [/报名.{0,12}截止|截止报名/, "活动", 2], [/(四六级|四级|六级|二级|计算机二级|考试|考研|教资|普通话|补考|重修)报名|计算机二级/, "通知", 4],
    [/答辩会|评议会|述职|评审会|动员会|见面会|交流会|座谈会|小组讨论|研讨|奖学金答辩|评优答辩|竞选/, "会议", 5], [/放映|电影|剧场|音乐会/, "活动", 3],
    [/(报名|资料|材料|班|书|服装|活动|考试)费/, "通知", 8], [/阳光长跑|长跑|跑满|打卡/, "通知", 2], [/答疑|习题课|辅导课/, "通知", 2],
    [/招聘会|双选会|宣讲会|展览|博览会|表演|团体辅导|团辅|沙龙|工作坊|观众|嘉宾/, "活动", 3], [/举办|举行/, "活动", 1], [/青马|党校|团校/, "活动", 2],
    // 通知
    [/通知|公告/, "通知", 3], [/放假|调休|调课|停课|补课|换教室|课表|开课|闭馆|开放|不用交|不交了|返校时间/, "通知", 3],
    [/考试|测验|小测|测试|期中考|期末考|期中测|期末测|考试周|体测|听力考|口语考|上机考|补考|重修|测\d+米|四六级|四级|六级|二级考/, "通知", 3],
    [/答题|安全教育|普查|知识竞答|公示|出结果|结果公布/, "通知", 2], [/退补选|退课|补选|选课|抢课/, "通知", 3], [/不用交|不交了/, "通知", 2],
    [/缴费|交费|缴纳|学费|班费|书费|住宿费|电费|网费|续费|充值|停网|医保|保险|助学金|奖学金|贷款|报销/, "通知", 4],
    [/材料|表格|证件|身份证|学生证|照片|回执|收齐|收缴|统计|名单|上报|签字|盖章|请假条|申请表|申报书|登记|核对|问卷|评教|填写|信息/, "通知", 3],
    [/查寝|宿舍|晨读|跑操|点名|值班|集合|返校|离校|领取|领教材|领书|疫苗|体检|演练|成绩(查询|公布|出了|已出|录入)|选课|教务|宿管|卫生|发群里|停电|停水|检修/, "通知", 2],
    [/停(一次|一节|一周|课)|老师(生病|出差|有事|请假|开会)/, "通知", 3], [/不用去|不用来|不去了|不用上|暂停/, "通知", 4],
    [/检查|复查|抽查|早读|晨读|晚点名|体检|医务室|快递|驿站|领校服|校服|申请书|入党|团员/, "通知", 2],
    [/(调|改|换|挪|移)(到|至|成|为)|推迟|延期|提前到/, "通知", 2], [/在.{2,14}上课|上课$|在.{2,12}上$/, "通知", 2],
    [/报一下|报给|报到|人数|统计一下/, "通知", 2], [/上课|上机|实验课|(课|节).{0,12}在.{0,14}上$|在.{2,14}上课/, "通知", 2],
    [/注意|提醒|务必|全体|请各位|请大家|各位同学|同学们/, "通知", 1],
  ];
  // 课程本身被调整（调课、停课、改教室）一定是通知，不是作业
  const SCHEDULE = /(课|上机|实验|自习).{0,10}((调|改|换|挪|移)(到|至|成|为)|取消|停|改在|在.{2,14}上)|((调|改|换)(到|至)|改在).{0,10}(上课|上|节)$|停课|调课|补课|课表/;
  const UNSURE_WORDS = /待定|另行通知|具体时间|暂定|可能|大概|左右|或者|还是|看情况|或(早上|上午|中午|下午|晚上|明天|后天|周|下周)/;
  const VAGUE_TIME = /下次课|下节课|下次上课|近期|尽快|另行通知|待定|最近/;
  const CHANGE = /(调|改|换|挪|移|推迟|延期|提前|顺延)(到|至|成|为|在)|改在|取消(?=[^。]{0,16}(再|照常|重新|补))/;

  // ================= 闲聊识别 =================
  const CHATTER = /^(收到|收到收到|好的?|好滴|好嘞|好哒|嗯+|哦+|噢+|ok|okk+|OK|欧克|1|111+|6+|\+1|＋1|谢谢.{0,6}|多谢.{0,4}|感谢.{0,6}|辛苦了?.{0,4}|了解|明白|知道了|懂了|行|可以|没问题|在|在的|来了|哈+|哈哈.*|嘿嘿|嘻嘻|呜+|啊+|？+|\?+|!+|！+|。+|晚安.{0,4}|早安.{0,4}|大家晚安|明天见|拜拜|好耶|冲+|加油.{0,4}|太好了|绝了|牛+|厉害|笑死.*|已交|已完成|已提交|交了交了|交了|我也是|同上|等下我|稍等|马上|来啦|到|已读|看群公告|群文件里有)[~!！。.、，,\s]*$/i;
  const MEDIA = /^\[(表情|图片|语音|视频|动画表情|文件|链接|位置|红包|转账|拍一拍|聊天记录)[^\]]*\]$/;
  const SYSTEM = /撤回了一条消息|拍了拍|加入了群聊|退出了群聊|修改群名|邀请.{1,20}加入|开启了|关闭了|设为管理员|群公告已更新/;
  const QUESTION = /(吗|呢|嘛|么)[？?~]*$|[？?]\s*$|^(谁|哪|啥|什么|怎么|为什么|几点|是不是|能不能|要不要|有没有|有人|请问|求)|(在哪|哪个|哪里|是什么|怎么办|还是.{1,8}(呀|啊|吧|呢))|(什么|哪|谁|几|怎么|是不是|有没有|要不要).{0,12}(呀|啊|吧|没|不)[？?~]*$|有人.{0,14}吗/;
  const INVITE = /谁(去|要|来|有|想)|(?<!所)有人(去|要|一起|想|带)|一起(吃|玩|去|打|看|约)|约(饭|球|吗)|开黑|组队(打|玩|开黑)|(打|玩)(王者|游戏|吃鸡|lol)|带饭|拼单|拼车/;
  const EMOTION = /好多|好累|好烦|好难|好远|好冷|好热|累死|烦死|笑死|无语|崩溃|救命|哭了|绝望|太难了|啊{2,}/;
  const HEADER = /^(.{1,30}?)\s+(\d{4}[\/\-年]\d{1,2}[\/\-月]\d{1,2}日?\s*)?(上午|下午|晚上|凌晨|中午)?\d{1,2}:\d{2}(:\d{2})?$/;   // 「张三 10:21」
  const HEADER_QQ = /^(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\s+\d{1,2}:\d{2}(:\d{2})?\s+(.{1,30})$/;                                 // 「2026-10-01 10:21:33 张三(12345)」
  const DATE_LINE = /^(\d{4}[\/\-年]\d{1,2}[\/\-月]\d{1,2}日?|\d{1,2}月\d{1,2}日|昨天|今天|星期[一二三四五六日天])(\s+(上午|下午|晚上)?\d{1,2}:\d{2})?$/;
  const NOT_NAME = /^(通知|注意|提醒|作业|重要|备注|地点|时间|要求|内容|说明|附|ps|PS|tips|补充|更正|紧急|温馨提示|范围|形式|截止|截止时间|提交方式|会议号|主题|[一二三四五六七八九十\d]+)$/;
  const LIST_LINE = /^\s*(\d{1,2}[.、)）](?!\d)|[（(]\d{1,2}[)）]|[一二三四五六七八九十][、.]|[①②③④⑤⑥⑦⑧⑨⑩])/;
  const FIELD_LINE = /^(地点|时间|要求|备注|内容|说明|附|截止|截止时间|提交方式|形式|范围|注意事项|会议号|主题|ps|PS)\s*[:：]/;

  function stripNoise(t) {
    return String(t || "").replace(/\[[^\]]{1,8}\]/g, "").replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "").trim();
  }
  function isChatter(t) {
    const raw = String(t || "").trim(), s = stripNoise(raw).replace(/^@\S+\s*/g, "").trim();
    if (!s) return true;
    if (MEDIA.test(raw) || SYSTEM.test(s)) return true;
    if (CHATTER.test(s)) return true;
    if (/^@\S+(\s*@\S+)*\s*(收到|好的?|ok)?$/i.test(stripNoise(raw))) return true;
    if (/^\d+[.、]\s*\S{1,6}$/.test(s) && !/[交作业会课]/.test(s)) return true;   // 接龙「12. 张三」
    return false;
  }

  // ================= 拆成一条条消息 =================
  // 「高数作业：…」「学院讲座：…」「期中考试时间：…」是标题，不是发送人
  function looksLikeName(n) {
    if (NOT_NAME.test(n) || /\d{1,2}$/.test(n) || /[周天号点午晚]/.test(n)) return false;
    if (/作业|通知|课|考|测验|讲座|会|活动|赛|杯|安排|时间|地点|提醒|要求|报名|放假|事项|任务|公告|说明|注意|实验|实习|招|申报|项目|稿|材料|表|书|费|医保|志愿|社团|竞赛|【|#/.test(n)) return false;
    if (n.length > 6 && !/(班长|学委|委员|辅导员|老师|团支书|书记|助教|课代表|寝室长|部长|主席|班主任)$/.test(n)) return false;
    for (const [re] of COURSES) if (re.test(n)) return false;
    return true;
  }
  function cleanSender(s) { return String(s || "").replace(/【[^】]*】|\[[^\]]*\]/g, "").replace(/[(（<][^)）>]*[)）>]/g, "").trim(); }
  function splitMessages(text) {
    const lines = normalize(text).replace(/\r/g, "").split("\n");
    const msgs = []; let cur = null, sawHeader = false;
    const flush = () => { if (cur && cur.lines.length) msgs.push(cur); cur = null; };
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) { if (!sawHeader) flush(); continue; }
      let h = line.match(HEADER_QQ);
      if (h) { flush(); sawHeader = true; cur = { sender: cleanSender(h[3]), date: h[1].replace(/\//g, "-").replace(/-(\d)(?=-|$)/g, "-0$1"), lines: [] }; continue; }
      h = line.match(HEADER);
      if (h && !/[，。！？,!?]/.test(h[1]) && !/^(今天|明天|后天|周|下周|星期|晚上|下午|上午|中午|早上|今晚|明晚)/.test(h[1]) && !/[\/／]|\d{1,2}[.月]\d{1,2}|ddl|截止|作业|交|前|到|在/i.test(h[1])) {
        flush(); sawHeader = true;
        const dm = h[2] && h[2].match(/(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/);
        cur = { sender: cleanSender(h[1]), date: dm ? `${dm[1]}-${pad(dm[2])}-${pad(dm[3])}` : "", lines: [] }; continue;
      }
      if (DATE_LINE.test(line)) continue;
      let body = line, sender = "";
      const m = line.match(/^([^\s:，。]{1,10})[:]\s*(.+)$/);
      if (m && looksLikeName(m[1])) { sender = cleanSender(m[1]); body = m[2]; }
      if (!sawHeader) {
        // 没有发送人行的复制格式：每一行当作一条消息；「地点：xxx」这类补充说明并到上一条
        if (FIELD_LINE.test(line) && msgs.length) { msgs[msgs.length - 1].lines.push(line); continue; }
        // 一条长通知被分成好几行：上一行以冒号结尾、这一行是编号、或是「另外/最后/以上」这类接着说的话，都并到上一条
        const prev = msgs[msgs.length - 1], prevLast = prev ? prev.lines[prev.lines.length - 1] : "";
        if (prev && (/[:：]\s*$/.test(prevLast) || LIST_LINE.test(line) && (LIST_LINE.test(prevLast) || /[:：]\s*$/.test(prev.lines[0]) || prev.lines.length === 1 && prevLast.length <= 12) ||
            /^(另外|此外|还有|其次|最后|首先|以上|收到请回复|请大家|特此通知|[一-龥]{2,8}(办公室|学院|委员会|部)$)/.test(line) && prev.lines.length > 1)) { prev.lines.push(line); continue; }
        flush(); cur = { sender, date: "", lines: [body] }; flush();
      } else {
        if (!cur) cur = { sender: "", date: "", lines: [] };
        cur.lines.push(body);
      }
    }
    flush();
    return msgs.map((m) => ({ sender: m.sender, date: m.date || "", text: m.lines.join("\n").trim() })).filter((m) => m.text);
  }

  // ================= 日期：找出所有提到的日子 =================
  function nearMonth(mo, base) { const d = (mo - (base.getMonth() + 1) + 12) % 12; return d <= 3 || d >= 10; }
  function yearFor(mo, base) { let y = base.getFullYear(); if (mo < base.getMonth() + 1 - 6) y++; else if (mo > base.getMonth() + 1 + 6) y--; return y; }
  function dateMentions(t, pub) {
    const base = new Date(pub + "T00:00:00");
    const dow = (base.getDay() + 6) % 7 + 1;   // 周一=1
    const out = [];
    const add = (i, len, d, extra) => { if (d && !isNaN(d)) out.push({ i, len, d, key: keyOf(d), ...extra }); };
    let m;
    const scan = (re, fn) => { re.lastIndex = 0; while ((m = re.exec(t))) fn(m); };
    scan(/(\d{4})[年\-\/.](\d{1,2})[月\-\/.](\d{1,2})[日号]?/g, (m) => add(m.index, m[0].length, new Date(+m[1], +m[2] - 1, +m[3]), { kind: "abs" }));
    scan(new RegExp(NUM + "月" + NUM + "[日号]?", "g"), (m) => {
      const mo = cnToNum(m[1]), d = cnToNum(m[2]);
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) add(m.index, m[0].length, new Date(yearFor(mo, base), mo - 1, d), { kind: "abs" });
    });
    scan(/(?<![\d.A-Za-z\-])(\d{1,2})[.\/](\d{1,2})(?![\d.:%\/])/g, (m) => {
      const mo = +m[1], d = +m[2], before = t.slice(Math.max(0, m.index - 3), m.index), after = t.slice(m.index + m[0].length, m.index + m[0].length + 1);
      if (/[题第章节Pp习页]/.test(before) || /[题节章页]/.test(after)) return;          // 「习题3.2」「P4.1」是题号
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && nearMonth(mo, base)) add(m.index, m[0].length, new Date(yearFor(mo, base), mo - 1, d), { kind: "abs" });
    });
    scan(/大后天|后天|明天|明早|明晚|明日|明儿|今天|今晚|今早|今日|当天|今儿|今夜|昨天|前天/g, (m) => {
      const w = m[0], n = /大后天/.test(w) ? 3 : /后天/.test(w) ? 2 : /^明/.test(w) ? 1 : /昨天/.test(w) ? -1 : /前天/.test(w) ? -2 : 0;
      add(m.index, w.length, addDays(base, n), { kind: "rel", past: n < 0 });
    });
    scan(/((?<!一)下下个?|下个?|本|这个?|上个?)?(周|星期|礼拜)([一二三四五六日天1-7])/g, (m) => {
      const w = WD[m[3]], p = m[1] || ""; let diff = w - dow, past = false;
      if (p.startsWith("下下")) diff += 14;
      else if (p.startsWith("下")) diff += 7;
      else if (p.startsWith("上")) { diff -= 7; past = true; }
      else if (!p && diff < 0) diff += 7;              // 只说「周三」且已经过了，指下周三
      add(m.index, m[0].length, addDays(base, diff), { kind: "week", past });
    });
    scan(/(本|这)?周末/g, (m) => add(m.index, m[0].length, addDays(base, Math.max(0, 6 - dow)), { kind: "week" }));
    scan(/(本周|这周)(之?内)/g, (m) => add(m.index, m[0].length, addDays(base, 7 - dow), { kind: "week" }));
    scan(/(本月|这个月)?(月底|月末)/g, (m) => add(m.index, m[0].length, new Date(base.getFullYear(), base.getMonth() + 1, 0), { kind: "rel" }));
    scan(new RegExp("(本月|这个月|下个?月)" + NUM + "[号日]", "g"), (m) => {
      const d = cnToNum(m[2]); if (!(d >= 1 && d <= 31)) return;
      add(m.index, m[0].length, new Date(base.getFullYear(), base.getMonth() + (/下/.test(m[1]) ? 1 : 0), d), { kind: "abs" });
    });
    scan(new RegExp("(?<![月\\d第学会编序])" + NUM + "[号日](?![子期楼栋馆院线])", "g"), (m) => {
      const d = cnToNum(m[1]); if (!(d >= 1 && d <= 31)) return;
      let dt = new Date(base.getFullYear(), base.getMonth(), d);
      if (dt < addDays(base, -3)) dt = new Date(base.getFullYear(), base.getMonth() + 1, d);
      add(m.index, m[0].length, dt, { kind: "day" });
    });
    // 去掉重叠的（长的、先出现的优先）
    out.sort((a, b) => a.i - b.i || b.len - a.len);
    const res = [];
    for (const x of out) { const last = res[res.length - 1]; if (last && x.i < last.i + last.len) continue; res.push(x); }
    // 「补周四的课」「按周四课表」只是引用，不是事情发生的日子
    for (const x of res) {
      const before = t.slice(Math.max(0, x.i - 2), x.i), after = t.slice(x.i + x.len, x.i + x.len + 4);
      if (/(补|按|上)$/.test(before) && /^(的?课|课表)/.test(after)) x.ref = true;
      if (/^的?课表/.test(after)) x.ref = true;
      if (/每$/.test(t.slice(Math.max(0, x.i - 1), x.i))) x.ref = x.every = true;
      if (/(原定|原来|原本|本来|之前说的|原计划)[^，。；]{0,3}$/.test(t.slice(Math.max(0, x.i - 7), x.i))) x.ref = true;   // 「原定周三的取消」
    }
    for (let k = 1; k < res.length; k++) if (res[k - 1].every && res[k].i - (res[k - 1].i + res[k - 1].len) <= 1 && res[k].kind === "week" && !/^[本这下]/.test(t.slice(res[k].i))) res[k].ref = res[k].every = true;
    return res;
  }
  // 挑出「事情发生」的那一天：有「调到/改到」时取后面那个，否则取第一个
  function pickDate(t, ms) {
    const live = ms.filter((x) => !x.past && !x.ref);
    if (!live.length) return null;
    // 「11月2日至11月6日补交材料」这类期限：取后一个日子
    if (live.length >= 2) {
      const a = live[0], b = live[1], between = t.slice(a.i + a.len, b.i);
      if (/^\s*(至|到|-|~|—)\s*$/.test(between) && /交|截止|过期|前|报名|完成|提交/.test(t)) return b;
    }
    const ch = t.match(CHANGE);
    if (ch) { const after = live.find((x) => x.i >= ch.index); if (after) return after; }
    return live[0];
  }
  function findDate(t, pub) { const ms = dateMentions(normalize(t), pub); const p = pickDate(normalize(t), ms); return p ? p.key : ""; }

  // ================= 时间 =================
  const PERIOD = /(凌晨|早上|早晨|清晨|上午|中午|下午|傍晚|晚上|晚自习|今晚|明晚|今早|明早|晚|早|夜里)/g;
  function timeMentions(t) {
    const out = []; let m;
    const re = new RegExp("(\\d{1,2}):(\\d{2})|" + NUM + "\\s?[点时](?![间候期段])(半|一刻|三刻|(\\d{1,2})分?)?|早([一二三四五六七八九十]|\\d{1,2})(?![点时一二三四五六七八九十\\d:])", "g");
    while ((m = re.exec(t))) {
      let h, mi = 0;
      if (m[1] != null) { h = +m[1]; mi = +m[2]; }
      else if (m[3] != null) {
        if (/[第这那每]$/.test(t.slice(Math.max(0, m.index - 1), m.index))) continue;     // 「第3点」不是时间
        h = cnToNum(m[3]); if (m[4] === "半") mi = 30; else if (m[4] === "一刻") mi = 15; else if (m[4] === "三刻") mi = 45; else if (m[5]) mi = +m[5];
      } else { h = cnToNum(m[6]); out.push({ i: m.index, len: m[0].length, h, mi: 0, am: true }); continue; }
      if (isNaN(h) || h > 24 || mi > 59) continue;
      out.push({ i: m.index, len: m[0].length, h, mi });
    }
    return out;
  }
  function resolveTime(t, tm, segStart) {
    let h = tm.h; const mi = tm.mi;
    if (tm.am) return `${pad(h)}:00`;
    // 找离它最近的「上午/下午/晚上」
    const before = t.slice(segStart || 0, tm.i);
    let per = null, m; PERIOD.lastIndex = 0;
    while ((m = PERIOD.exec(before))) per = m[1];
    const pm = per && /下午|傍晚|晚|夜/.test(per), noon = per === "中午", am = per && /凌晨|早|上午/.test(per);
    if ((pm || (per === "晚自习")) && h === 12) return "23:59";                     // 晚上12点 = 当天结束
    if (pm && h < 12) h += 12;
    else if (noon && h < 6) h += 12;
    else if (!per && !am && h >= 1 && h <= 6 && mi % 5 === 0) h += 12;               // 没说上下午的「3点」多半是下午
    if (h === 24) return "23:59";
    return `${pad(h)}:${pad(mi)}`;
  }
  function findTime(t, from) {
    t = normalize(t);
    const ts = timeMentions(t), start = from || 0;
    const tm = ts.find((x) => x.i >= start) || (start ? null : ts[0]);
    if (tm) return resolveTime(t, tm, 0);
    if (/中午/.test(t.slice(start))) return "12:00";
    return "";
  }

  // ================= 地点 =================
  const PLACE_TAIL = "东操|西操|南操|北操|看台|研讨间|研讨室|自习室|剧场|之家|主席台前|主席台|校车站|公交站|车站|社区|小区|博物馆|纪念馆|科技馆|美术馆|医务室|校医院|医院|驿站|快递点|报告厅|会议室|活动中心|事务中心|服务中心|计算中心|实训中心|工训中心|训练中心|中心机房|机房|实验室|教室|办公室|体育馆|体育场|田径场|篮球场|足球场|运动场|操场|广场|礼堂|大厅|门口|楼下|楼前|楼门口|大门|北门|南门|东门|西门|正门|侧门|图书馆|食堂|学工办|学工处|教务处|宿管处|处|办|中心|馆|厅|室|楼";
  const PLACE_RE = new RegExp("(" + PLACE_TAIL + ")", "g");
  const PLACE_EXT = /^([一二三四五六七八九十\d]{1,2}楼|[A-Za-z]?区?\d{2,4}|大厅|门口|报告厅|会议室|多功能厅|演播厅|广场|[一-龥]{1,3}(?:室|厅)|前|下|一楼|二楼|三楼|四楼|东门|西门|南门|北门|机房)/;
  const PLACE_STOP = /[\s,，。；;！!、:：在到于去点半午晚早天日号周期时分和与及或的了是让请把将被找给由从向往跟就也都还又里报]/;
  const NOT_PLACE = /^(教务系统|群文件|学习通|超星|雨课堂|宿舍|寝室|班级群|群里|处理|办理|举办|开办|创办|主办|承办|协办|楼|馆|厅|室|处|办|中心)$/;
  const ONLINE = /(腾讯会议|钉钉|飞书|zoom|Zoom|ZOOM|腾讯课堂|QQ群课堂|线上会议)(\s*(会议)?(号|ID|id)?\s*[:：]?\s*([\d\s-]{6,16}\d))?/;
  function roomCodes(t) {
    const re = /((?:[一-龥]{1,6}(?:楼|馆|中心))?(?:[A-Za-z]\s?(?:栋|座|区)\s?)?(?:\d{1,2}\s?[号#]\s?楼|\d{1,2}\s?栋|[一-龥]{1,6}楼|教\d{1,2}|[A-Za-z]栋|[A-Za-z]座)?\s?[A-Za-z]?区?\s?[-－]?\s?\d{3,4}(?![\d点时:号月日年元人分秒块米题]))/g;
    const out = []; let m;
    while ((m = re.exec(t))) {
      let s = m[1].trim();
      if (!/[楼馆栋座区教中心]|^[A-Za-z]\d{3,4}$/.test(s)) continue;          // 只有数字（如 120 词）不算
      s = s.replace(/^.*(?:在|到|于|去|至|交|送|往|地点|的|和|与|点|半|时)(?=[一-龥A-Za-z\d])/, "");
      out.push({ i: m.index + m[0].indexOf(s), s: s.replace(/\s+/g, ""), score: 6, room: true });
    }
    const re2 = /(?:在|到|于|地点:?|还是在?|改在)\s*((?:[一-龥]{1,5}|\d{1,2}栋|\d{1,2}号?公寓|\d{1,2}#)?[A-Za-z]?\d{3,4})(?![\d点时:号月日年元人分秒块米题])/g;
    while ((m = re2.exec(t))) if (!out.some((x) => x.s.includes(m[1]))) out.push({ i: m.index + m[0].indexOf(m[1]), s: m[1], score: 6, room: true });
    return out;
  }
  function placeCandidates(t, model) {
    const c = [];
    const on = t.match(ONLINE);
    if (on) c.push({ i: on.index, s: on[1] + (on[5] ? " " + on[5].replace(/[\s-]/g, "") : ""), score: 6 });
    c.push(...roomCodes(t));
    let m, lastEnd = 0; PLACE_RE.lastIndex = 0;
    while ((m = PLACE_RE.exec(t))) {
      let end = m.index + m[0].length, st = m.index;
      if (/^(闭|开|休)$/.test(t[m.index - 1] || "") && /^馆/.test(m[0])) continue;
      if (/^(处|办)$/.test(m[0]) && /^(理|法|事|公|学|分)/.test(t[end] || "")) continue;      // 「处理」「办理」「办法」不是地点
      if (/^室$/.test(m[0]) && /^(友|长)/.test(t[end] || "")) continue;
      if (/^室$/.test(m[0]) && /[寝卧浴]$/.test(t[m.index - 1] || "") && !/\d/.test(t.slice(Math.max(0, m.index - 6), m.index))) continue;
      while (st > lastEnd && m.index - st < 10 && !PLACE_STOP.test(t[st - 1])) st--;
      let s = t.slice(st, end), rest = t.slice(end), e;
      while ((e = rest.match(PLACE_EXT))) { s += e[1]; rest = rest.slice(e[1].length); end += e[1].length; }
      s = s.replace(/^(地点|学校|校内|本校)/, (x) => (x === "学校" ? "学校" : "")).replace(/^(各|该|此|每个?)/, "").replace(/^\d+(?![\d号#栋楼座区])/, "");
      const pre = t.slice(Math.max(0, st - 3), st).match(/(\d{1,2}[号#])$/);
      if (pre && /^(宿舍|公寓|教学|实验|实训|学生|综合)?楼|^(宿舍|公寓|教学|实验|实训)/.test(s)) { s = pre[1] + s; st -= pre[1].length; }
      if (s.length < 2 || NOT_PLACE.test(s)) continue;
      s = s.replace(/^(参观|前往|去往|来到|去|到|在)/, "");
      if (/^(课|实验课|实验报告|班|上|下|开|交)/.test(s) || /^[一-龥]{0,2}(举办|办理|处理|主办)$/.test(s) || s.length < 2) continue;
      const lead = t.slice(Math.max(0, st - 3), st);
      const score = (/(在|地点:?|到|于|去|集合于|地址:?)\s*$/.test(lead) ? 3 : 1) + Math.min(s.length, 8) / 4 + (/(楼|馆|中心|厅|场|门|室)$/.test(s) ? 1 : 0)
        + (/^\s*(集合|见|碰头|门口集合|签到)/.test(t.slice(end, end + 4)) ? 2 : 0) - (/(不在|不是|原|以前的?|之前的?)$/.test(t.slice(Math.max(0, st - 3), st)) ? 4 : 0);
      c.push({ i: st, s, score });
      PLACE_RE.lastIndex = end; lastEnd = end;
    }
    return c;
  }
  function findLocation(t, model) {
    t = normalize(t);
    let c = placeCandidates(t, model);
    if (model) {
      // 本班学到的地名：班委改过的地点优先；班委删掉过的「地点」不再认
      const bad = model.notPlaces || [];
      c = c.filter((x) => !bad.includes(x.s));
      for (const p of model.places || []) {
        const i = t.indexOf(p); if (i < 0) continue;
        if (c.some((x) => x.s.length > p.length && x.s.includes(p))) continue;
        c.push({ i, s: p, score: 9 + p.length / 10 });
      }
    }
    if (!c.length) return "";
    // 「学院办公室 3号楼145」：名字和门牌号挨着，就合成一个
    for (const r of c.filter((x) => x.room)) for (const n of c.filter((x) => !x.room && !x.s.includes(r.s) && !r.s.includes(x.s))) {
      const gap = r.i - (n.i + n.s.length);
      if (gap >= 0 && gap <= 1) c.push({ i: n.i, s: `${n.s} ${r.s}`, score: Math.max(n.score, r.score) + 1 });
      const gap2 = n.i - (r.i + r.s.length);
      if (gap2 >= 0 && gap2 <= 1 && /(办公室|会议室|教室|机房|实验室)$/.test(n.s) && n.s.length <= 8) c.push({ i: r.i, s: `${r.s}${n.s}`, score: Math.max(n.score, r.score) + 1 });
    }
    c.sort((a, b) => b.score - a.score || b.s.length - a.s.length);
    return c[0].s.slice(0, 40);
  }
  function findPrepare(t) {
    const m = normalize(t).match(/(?:带上?|携带|准备好?|需带|需要带|自备|记得带)\s*([^，。,；;！!\n]{1,20})/);
    return m ? m[1].replace(/^(好|上)/, "").trim() : "";
  }

  // ================= 类型、科目、标题 =================
  function ruleScores0(t) { const s = { 作业: 0, 会议: 0, 活动: 0, 通知: 0 }; for (const [re, type, w] of RULES) if (re.test(t)) s[type] += w; return s; }
  function ruleScores(t) {
    const s = { 作业: 0, 会议: 0, 活动: 0, 通知: 0 };
    for (const [re, type, w] of RULES) if (re.test(t)) s[type] += w;
    const admin = /缴费|交费|缴纳|学费|班费|书费|电费|医保|助学金|奖学金|材料|表格|证件|照片|回执|名单|请假条|申请表|登记|核对|问卷|评教|信息/.test(t);
    const academic = /作业|习题|论文|实验报告|作文|读后感|课设|规划书/.test(t);
    if (admin && !academic && s.会议 < 5 && s.活动 < 3) s.通知 += 3;
    if (SCHEDULE.test(t)) s.通知 += /作业|习题|实验报告|论文/.test(t) ? 2 : 4;
    if (/报名/.test(t) && /截止/.test(t)) s.作业 -= 1;
    // 只取消不改期的是通知；改到别的时间的，还是原来那件事
    if (/取消(?!资格|评优|成绩|学分|考试资格)/.test(t)) s.通知 += CHANGE.test(t) || s.活动 >= 4 ? 1 : 4;
    if (/^[^:：，。]{0,8}通知[:：]/.test(t) && !/通知[^:：]*通知/.test(t)) s.通知 -= 2;   // 「学生会通知：」只是开头
    if (/作业照常|作业不变|照常交/.test(t)) s.作业 -= 3;
    const tg = t.match(/(改成|改为|换成)(.{0,10})/);
    if (tg) { const x = ruleScores0(tg[2]); for (const k of Object.keys(s)) s[k] += 2 * x[k]; }
    return s;
  }
  function courseOf(t, model) {
    if (model && model.aliases) for (const [a, name] of model.aliases) if (t.includes(a)) return name;
    for (const [re, name] of COURSES) if (re.test(t)) return name;
    return "";
  }
  const TITLE_WORDS = /([一-龥]{0,8}大会|年级大会|主题班会|班委会议|班委会|支部大会|班会|党课|团日活动|组会|例会|开会|[一-龥]{0,6}(?:比赛|竞赛|晚会|运动会|讲座|分享会|招新|面试|培训|演练|彩排|开幕式)(?:报名)?|查寝|体测|晨读|跑操|点名|评教|选课|停课|调课|补课|闭馆|考试|测验|缴费|领教材|领取学生证)/;
  function titleOf(t, type, course, loc) {
    if (course) return course;      // 科目就写课程名，作业页按它分组
    const adm = t.match(/(医保|学费|班费|书费|住宿费|电费|助学金|奖学金|学生证|[一-龥]{0,4}(?:申请表|申报书|统计表|信息表|登记表|材料|回执|名单|照片|请假条|问卷))/);
    if (adm && type === "通知") return adm[1].replace(/^(把|将|的|请|交|填写?)/, "") + (/交|收|提交|上交|缴/.test(t) ? "上交" : /填|登记|完成/.test(t) ? "填写" : /领/.test(t) ? "领取" : "");
    const k = t.match(TITLE_WORDS);
    if (k) return k[1].replace(/^(召开|举办|举行|开展|组织|参加|进行|有)/, "").slice(0, 14);
    let s = t;
    if (loc) s = s.split(loc).join("");
    s = s.replace(/【[^】]*】|^(通知|提醒|注意|重要|紧急|温馨提示)[:：]?|辅导员通知[:：]?/g, "")
      .replace(/(下下|下个?|本|这个?)?(周|星期|礼拜)[一二三四五六日天1-7]|大后天|后天|明天|今天|今晚|明晚|明早|今早|\d{1,2}月\d{1,2}[日号]?|\d{1,2}[.\/]\d{1,2}/g, "")
      .replace(/(上午|下午|晚上|中午|早上|傍晚)?\d{1,2}([:点时]\d{0,2}(半|分)?)?/g, "").replace(/(上午|下午|晚上|中午|早上|傍晚)?[一二两三四五六七八九十]{1,3}[点时](半|一刻|三刻)?/g, "")
      .replace(/^(请|各位|大家|同学们|全体同学)[，,]?/g, "")
      .replace(/[（(]\s*[)）]/g, "").replace(/^[①②③④⑤⑥⑦⑧⑨⑩\d.、\-~—\s]+/, "").replace(/^[，,。:：\s在于到\-~—]+/, "");
    return (s.split(/[，,。；;！!\n]/)[0] || t).trim().slice(0, 12);
  }
  function clean(t) {
    return normalize(t).replace(/@\S+\s?/g, "").replace(/\[[^\]]{1,8}\]/g, "").replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "")
      .replace(/^\s*(\d{1,2}[.、)）](?!\d)|[①②③④⑤⑥⑦⑧⑨⑩]|[-*•·#])\s*/, "").replace(/\s+/g, " ").trim();
  }

  // ================= 一条消息里有好几件事：按日期切开 =================
  function segments(t, pub) {
    const ms = dateMentions(t, pub).filter((x) => !x.past && !x.ref);
    // 挨在一起的日期（「周六周日」「10月8日-10日」「明天周六」）是同一件事
    const groups = [];
    for (const x of ms) {
      const g = groups[groups.length - 1];
      // 「今晚10点开放，开放到明天晚上12点」「11月18日—22日」：前后是一个时间段
      if (g && (x.i - g.end <= 2 || /^[^。；;\n]{0,14}(到|至|截止到?|截至)\s*$/.test(t.slice(g.end, x.i)))) { g.end = x.i + x.len; continue; }
      groups.push({ i: x.i, end: x.i + x.len });
    }
    const keys = new Set(ms.map((x) => x.key));
    if (groups.length < 2 || keys.size < 2) return [{ text: t, start: 0 }];
    // 「明天的班会改到周一」：改期说的是同一件事
    const ch = t.match(CHANGE);
    if (ch && ch.index > groups[0].i && ch.index < groups[groups.length - 1].i && !/[。；;\n]/.test(t.slice(groups[0].i, ch.index))) return [{ text: t, start: 0 }];
    // 先按句号、分号、编号切；切不出两件事再按逗号；最后按空格（随手打字常用空格分句）
    const CUTS = [/[。；;！!\n]|(?=[①②③④⑤⑥⑦⑧⑨⑩])|\s(?=\d[.、)）])/g, /[，,。；;！!\n]|(?=[①②③④⑤⑥⑦⑧⑨⑩])|\s(?=\d[.、)）])/g,
      /[，,。；;！!\n]|(?=[①②③④⑤⑥⑦⑧⑨⑩])|\s(?=\d[.、)）])|\s(?=[一-龥])/g];
    for (const re of CUTS) {
      const parts = []; let last = 0, m; const cuts = [];
      re.lastIndex = 0;
      while ((m = re.exec(t))) { if (!m[0] || /^\s$/.test(m[0])) { if (m.index > 0) cuts.push(m.index + (m[0] ? 1 : 0)); if (!m[0]) re.lastIndex++; } else cuts.push(m.index + 1); }
      cuts.push(t.length);
      let segStart = 0, hasDate = false;
      for (const c of cuts) {
        const clause = [last, c]; last = c;
        const has = groups.some((g) => g.i >= clause[0] && g.i < clause[1]);
        if (has && hasDate) { parts.push({ text: t.slice(segStart, clause[0]).replace(/[，,；;\s]+$/, ""), start: segStart }); segStart = clause[0]; }
        if (has) hasDate = true;
      }
      parts.push({ text: t.slice(segStart), start: segStart });
      // 每段都得像一件事（有类型关键词或时间）
      const ok = parts.filter((p) => {
        if (/^(不|否则|逾期|过期|没|未|如果|若)/.test(p.text.replace(/^[\s，,；;]+/, ""))) return false;      // 「不续费12月1号停网」是后果，不是另一件事
        const sc = ruleScores(p.text.replace(ONLINE, " "));
        return Math.max(...Object.values(sc)) >= 2 || timeMentions(p.text).length > 0 || /交|讲|做|考|开|举行|进行|提交|集合|报名|截止|上课|公示/.test(p.text);
      });
      if (ok.length >= 2) return ok;
    }
    return [{ text: t, start: 0 }];
  }

  // ================= 主函数 =================
  const TYPES4 = ["作业", "会议", "活动", "通知"];
  function decideType(t, model, focus) {
    let s = ruleScores(t);
    if (focus && focus.length < t.length * 0.8) {
      // 长通知：日期所在那句话最重要，其余部分打五折
      const f = ruleScores(focus), rest = ruleScores(t.split(focus).join(" "));
      s = {}; for (const k of TYPES4) s[k] = f[k] + 0.5 * rest[k];
    }
    const rank = () => TYPES4.slice().sort((a, b) => s[b] - s[a] || TYPES4.indexOf(a) - TYPES4.indexOf(b));
    let order = rank(), learned = null;
    if (model && model.neighbor) {
      // 学习的结果只在两种情况下改规则：以前改过几乎一样的消息；或者规则自己也拿不准
      const nb = model.neighbor(t);
      if (nb && TYPES4.includes(nb.label)) {
        const top = s[order[0]], margin = top - s[order[1]];
        if (nb.sim >= 0.6) { s[nb.label] = Math.max(top, 3) + 5; learned = nb; }
        else if (nb.sim >= 0.45 && (margin <= 1 || top < 3)) { s[nb.label] += 4; learned = nb; }
      }
      if (s[order[0]] < 2 && model.nb) {
        const p = model.nb(t);
        if (p && p.top !== "闲聊" && p.p >= 0.7) { s[p.top] += 3; learned = learned || { label: p.top, sim: 0, nb: true }; }
      }
      order = rank();
    }
    return { type: s[order[0]] >= 2 ? order[0] : null, score: s[order[0]], margin: s[order[0]] - s[order[1]], learned };
  }
  function looksLikeChatter(t, hasDate, model) {
    const s = stripNoise(t);
    if (/^(早上好|早安|晚安|中午好|下午好|晚上好|大家好|周末愉快|节日快乐|新年快乐)/.test(s) && Math.max(...Object.values(ruleScores(s))) < 3 && !timeMentions(s).length) return true;
    if (/辛苦大家|辛苦了|恭喜|祝贺|感谢大家|谢谢大家|太棒了/.test(s) && !/请|务必|记得|需要|截止|前交|集合/.test(s) && !timeMentions(s).length) return true;
    // 好几句话：只要有一句是带日期的正经安排，就不是闲聊（「课设题目选好了吗？下周五前把名单报给我」）
    const sents = s.split(/(?<=[。！!？?\n])/).map((x) => x.trim()).filter(Boolean);
    if (sents.length >= 2 && hasDate && sents.some((x) => !QUESTION.test(x) && Math.max(...Object.values(ruleScores(x))) >= 2 && /周|天|日|号|晚|月/.test(x))) return false;
    if (isChatter(s)) return true;
    if (model && model.neighbor) {
      const nb = model.neighbor(s);
      if (nb && nb.sim >= 0.6) return nb.label === "闲聊";       // 以前被纠正过几乎一样的消息
    }
    const announce = /请(?!假|问|教|客)|各位|大家|同学们|全体|通知|注意|提醒|务必|全班|每班|每人|班委|班长|学委|辅导员|老师说|统一|准时/.test(s);
    if (QUESTION.test(s) && !announce) return true;
    if (INVITE.test(s) && !/通知|请(?!假|问|教|客)|各位|全体|务必|班委|辅导员|学院|学校/.test(s) && Math.max(...Object.values(ruleScores(s))) < 3) return true;
    // 接龙名单（「周日聚餐 1. 小明 2. 小红」）
    if (/^#?接龙/.test(s) || (s.match(/(^|\n)\s*\d{1,2}[.、]\s*[一-龥A-Za-z]{1,6}\s*(已交|已完成|收到|\+1)?\s*(?=\n|$)/g) || []).length >= 2) return true;
    if (/^(我|俺)(?!们)/.test(s) && !/通知|提醒|请大家|各位|同学们|全体|统计|收一下|收集|登记|报名|大家/.test(s)) return true;
    if (EMOTION.test(s) && !announce && !hasDate) return true;
    if (EMOTION.test(s) && s.length <= 12) return true;

    return false;
  }

  function parseEvent(seg, whole, pub, model, sender) {
    const t = seg.text;
    const ms = dateMentions(t, pub), pick = pickDate(t, ms);
    const day = pick ? pick.key : "";
    let time = "";
    if (pick) {
      const tms = timeMentions(t), after = tms.find((x) => x.i >= pick.i) || (CHANGE.test(t) ? null : tms[0]);
      if (after) time = resolveTime(t, after, 0);
      else if (/中午/.test(t.slice(pick.i))) time = "12:00";
      if (/晚上?12点|今晚12点|24:00|24点/.test(t) && !time) time = "23:59";
      if (!time && /同一时间|原时间|时间不变|时间照旧/.test(t) && tms.length) time = resolveTime(t, tms[0], 0);
    }
    if (!time && pick && model && model.periodTime) time = model.periodTime(t) || "";
    const loc = findLocation(t, model) || "";
    let typeText = (loc ? t.split(loc).join(" ") : t).replace(/「[^」]{1,30}」|《[^》]{1,40}》|“[^”]{1,30}”/g, " ");
    typeText = typeText.replace(ONLINE, " ");     // 「报告厅」「活动中心」这些地名不参与判断类型
    let focus = null;
    if (pick && typeText.length > 60) {
      const ds = t.substr(pick.i, pick.len);
      focus = typeText.split(/(?<=[。；;！!\n])/).find((p) => p.includes(ds)) || null;
    }
    const dt = decideType(typeText, model, focus);
    const course = courseOf(t, model) || (seg.start ? "" : "") || courseOf(whole, model);
    return { day, time, loc, dt, course, pick, t };
  }

  function parse(text, pubDate, opts) {
    const model = opts && opts.model, force = !!(opts && opts.force);   // force：班委说「这条要记」，不当闲聊
    const pub0 = pubDate || keyOf(new Date());
    const out = { items: [], unsure: [], chatter: [], dupes: 0 };
    const seen = new Set();
    for (const msg of splitMessages(text)) {
      const raw = msg.text, pub = msg.date && /^\d{4}-\d{2}-\d{2}$/.test(msg.date) ? msg.date : pub0;
      const norm = raw.replace(/\s+/g, "");
      if (seen.has(norm)) { out.dupes++; continue; }
      seen.add(norm);
      const t = clean(raw);
      const original = (msg.sender ? msg.sender + ":" : "") + raw;
      // 以前纠正过一模一样的消息：直接照学到的来
      const mem = model && model.recall ? model.recall(t) : null;
      if (mem) {
        if (mem.chatter && !force) { out.chatter.push(raw); continue; }
        for (const it of mem.items || []) out.items.push({ ...it, event_time: shiftDate(it, mem.pub, pub), original, publish_date: pub, need_confirm: !!it.need_confirm, via: "memory", src_text: raw });
        if (mem.items && mem.items.length) continue;
      }
      const ms0 = dateMentions(t, pub), hasDate = ms0.some((x) => !x.past && !x.ref);
      if (!force && looksLikeChatter(t, hasDate, model)) { out.chatter.push(raw); continue; }
      const segs = segments(t, pub);
      const events = segs.map((s) => parseEvent(s, t, pub, model, msg.sender));
      const wholeType = events.length > 1 ? decideType(t.replace(ONLINE, " "), model) : null;
      for (const ev of events) {
        let { day, time, loc, dt, course } = ev;
        const segT = ev.t;
        let type = dt.type;
        if (wholeType && wholeType.type && (!type || dt.score < 2)) type = wholeType.type;     // 分出来的一段太短，看整条消息
        // 没有日期，但说了「下午/晚上」：就是发布当天
        if (!day && /(^|[^明今昨])(上午|下午|晚上|中午|傍晚)|今晚|今早/.test(segT) && timeMentions(segT).length) { day = pub; time = findTime(segT); }
        else if (!day && /下午第|上午第|晚自习/.test(segT)) day = pub;
        if (!type) {
          // 没有类型关键词：有日期 + 时间/地点的，多半是通知；否则当闲聊或交给 AI
          if ((day && (time || loc || course) && segT.length >= 6) || force) type = "通知";
          else if (segT.length <= 15 && !day) { out.chatter.push(raw); continue; }
          else { out.unsure.push({ text: raw, sender: msg.sender, why: "看不出是什么事", guess: day ? mk("通知") : null }); continue; }
        }
        function mk(tp) {
          const summary = segT.length > 80 ? segT.slice(0, 79) + "…" : segT;
          return {
            msg_type: tp, subject: titleOf(segT, tp, course, loc), summary,
            event_time: day ? day + (time ? " " + time : "") : "", location: loc, prepare: findPrepare(segT),
            original, publish_date: pub, need_confirm: !day || UNSURE_WORDS.test(segT),
            confidence: Math.min(1, (dt.score || 0) / 6) * (day ? 1 : 0.5) * (dt.margin >= 2 ? 1 : 0.8),
            src_text: raw, ...(dt.learned ? { via: "learned" } : {}),
          };
        }
        const item = mk(type);
        if (!day && type === "通知" && !force && !/请|务必|需要|记得|必须|尽快|赶紧|抓紧|要求|一定|别忘|不要|禁止|按时|准时|及时|带上|自备|查看|查收|可以.{0,6}查|查询|去|到|交|填|领|报|完成|参加|注意|改成|改到|调到|改为|取消|推迟|提前|暂停/.test(segT)) {
          out.unsure.push({ text: raw, sender: msg.sender, why: "没有日期，可能只是告知", guess: item }); continue;
        }
        if (!day && type !== "通知" && !VAGUE_TIME.test(segT) && !force) { out.unsure.push({ text: events.length > 1 ? segT : raw, sender: msg.sender, why: "没找到具体日期", guess: item }); continue; }
        if (dt.score < 3 && dt.margin < 1 && !(day && (time || loc)) && !dt.learned && !force) { out.unsure.push({ text: raw, sender: msg.sender, why: "类型拿不准", guess: item }); continue; }
        out.items.push(item);
      }
    }
    return out;
  }
  // 记住的事项按发布日期平移（同样的通知下周再发一次，日期跟着走）
  function shiftDate(it, fromPub, toPub) {
    if (!it.event_time || !fromPub || fromPub === toPub) return it.event_time || "";
    const a = new Date(fromPub + "T00:00:00"), b = new Date(toPub + "T00:00:00"), d = new Date(it.event_time.slice(0, 10) + "T00:00:00");
    const nd = addDays(d, Math.round((b - a) / 86400000));
    return keyOf(nd) + it.event_time.slice(10);
  }

  // ================= 学习模块 =================
  // 学的东西（都只在本班、本设备内有效，可以随时清空）：
  //   1. 例子库：班委确认/修改过的消息和它的正确类型（含「这条是闲聊」）。新消息和库里某条几乎一样时照它来；
  //      规则拿不准时参考相似的例子。只靠「相似」而不是死记关键词，所以不会把规则本来对的结果带偏
  //   2. 本班地名、课程叫法、作息（第几节课几点）：班委改过一次就记住
  //   3. 原样记忆：一模一样的消息再出现（比如每周重复的通知），直接按上次改好的结果来，日期跟着平移
  const LABELS = ["作业", "会议", "活动", "通知", "闲聊"];
  function featGrams(t, drop) {
    let s = normalize(t);
    for (const w of drop || []) if (w) s = s.split(w).join(" ");
    // 地点、课程名、日期时间都和「是什么类型」无关，去掉以后再比相似度
    const loc = findLocation(s); if (loc) s = s.split(loc).join(" ");
    for (const [re] of COURSES) s = s.replace(new RegExp(re.source, "gi"), " ");
    for (const m of dateMentions(s, "2026-01-05").sort((x, y) => y.i - x.i)) s = s.slice(0, m.i) + " " + s.slice(m.i + m.len);
    s = s.replace(/(上午|下午|晚上|中午|早上|傍晚|今晚|明晚)?\d{1,2}([:点时]\d{0,2}(半|分)?)?/g, " ").replace(/[一二两三四五六七八九十]+[点时]半?/g, " ")
      .replace(/\d+/g, "0").replace(/[\s，。,.!！？?；;:：、~（）()【】\[\]"'“”‘’@]/g, " ");
    const g = new Set();
    for (const part of s.split(/\s+/)) for (let i = 0; i + 1 < part.length; i++) g.add(part.slice(i, i + 2));
    return g;
  }
  function jaccard(a, b) { if (!a.size || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n); }
  const memKey = (t) => clean(t).replace(/[\s，。,.!！？?；;:：、~]/g, "").toLowerCase();
  const PERIOD_RE = /(第?([一二三四五六七八九十]|1[0-2]|\d)(?:[、,，\-~至到]?([一二三四五六七八九十]|1[0-2]|\d))?节)/;
  function periodKey(t) { const m = normalize(t).match(PERIOD_RE); return m ? cnToNum(m[2]) + (m[3] ? "-" + cnToNum(m[3]) : "") : ""; }
  function ruleLabel(before) {
    if (!before) return null;
    if (before.items && before.items[0]) return before.items[0].msg_type;
    if (before.unsure && before.unsure[0] && before.unsure[0].guess) return before.unsure[0].guess.msg_type;
    if (before.chatter && before.chatter.length) return "闲聊";
    return null;
  }
  function createModel(data) {
    const st = { v: 2, ex: [], places: {}, notPlaces: {}, aliases: {}, periods: {}, memory: {}, log: [] };
    if (data && data.v === 2) Object.assign(st, JSON.parse(JSON.stringify(data)));
    let cache = null;
    const exGrams = () => cache || (cache = st.ex.map((e) => featGrams(e.t, Object.entries(st.aliases).flat().sort((a, b) => b.length - a.length))));
    function addExample(text, label, src, fix) {
      if (!LABELS.includes(label)) return;
      const t = clean(text).slice(0, 200); if (t.length < 2) return;
      const i = st.ex.findIndex((e) => e.t === t);
      if (i >= 0) st.ex.splice(i, 1);
      st.ex.push({ t, l: label, s: src || "user", f: fix ? 1 : 0 });
      if (st.ex.length > 1500) { const j = st.ex.findIndex((e) => e.s === "history"); st.ex.splice(j >= 0 ? j : 0, 1); }
      cache = null;
    }
    const model = {
      get n() { return st.ex.length; },
      get places() { return Object.keys(st.places).sort((a, b) => b.length - a.length); },
      get notPlaces() { return Object.keys(st.notPlaces); },
      get aliases() { return Object.entries(st.aliases).sort((a, b) => b[0].length - a[0].length); },
      // 找最像的例子：返回 { label, sim, text }。相似的例子按相似度投票
      neighbor(text) {
        if (!st.ex.length) return null;
        const drop = Object.entries(st.aliases).flat().sort((a, b) => b.length - a.length);
        const g = featGrams(text, drop); if (g.size < 2) return null;
        const gs = exGrams(), vote = {}; let best = null;
        for (let i = 0; i < gs.length; i++) {
          const sim = jaccard(g, gs[i]); if (sim < 0.35) continue;
          const e = st.ex[i], w = sim * sim * (e.s === "history" ? 0.6 : e.s === "ai" ? 0.8 : 1) * (e.f ? 1.3 : 1);
          vote[e.l] = (vote[e.l] || 0) + w;
          if (!best || sim > best.sim) best = { label: e.l, sim, text: e.t };
        }
        if (!best) return null;
        const label = Object.keys(vote).sort((a, b) => vote[b] - vote[a])[0];
        return { label, sim: label === best.label ? best.sim : Math.min(best.sim, 0.59), text: best.text };
      },
      // 很少的数据也能用的「字频」判断，只在规则完全没头绪时参考
      nb(text) {
        const ex = st.ex.filter((e) => e.l !== "闲聊"); if (ex.length < 30) return null;
        const g = featGrams(text), score = {};
        for (const L of TYPES4) {
          const docs = ex.filter((e) => e.l === L); if (!docs.length) continue;
          const cnt = {}; let tot = 0;
          for (const e of docs) for (const x of featGrams(e.t)) { cnt[x] = (cnt[x] || 0) + 1; tot++; }
          let lp = Math.log(docs.length / ex.length);
          for (const x of g) lp += Math.log(((cnt[x] || 0) + 0.2) / (tot + 0.2 * 3000));
          score[L] = lp;
        }
        const ks = Object.keys(score); if (!ks.length) return null;
        const mx = Math.max(...ks.map((k) => score[k])); let z = 0; for (const k of ks) z += Math.exp(score[k] - mx);
        const top = ks.sort((a, b) => score[b] - score[a])[0];
        return { top, p: 1 / z };
      },
      periodTime(text) { const k = periodKey(text); return k ? st.periods[k] || "" : ""; },
      recall(text) { const r = st.memory[memKey(text)]; return r ? JSON.parse(JSON.stringify(r)) : null; },
      // 从一次整理里学。before = 规则（没学习前）给的结果；items = 班委最后发布的；chatter = 班委说这条是闲聊
      learn({ text, pub, before, items, chatter, source }) {
        const key = memKey(text); if (!key || key.length < 2) return;
        const src = source || "user", rl = ruleLabel(before);
        const rItem = before && ((before.items && before.items[0]) || (before.unsure && before.unsure[0] && before.unsure[0].guess)) || null;
        if (chatter) addExample(text, "闲聊", src, rl && rl !== "闲聊");
        else if (items && items.length === 1) addExample(text, items[0].msg_type, src, rl !== items[0].msg_type);
        const nt = normalize(text);
        for (const it of items || []) {
          const ruleLoc = rItem ? rItem.location || "" : findLocation(text);
          if (it.location !== undefined && it.location !== ruleLoc) {
            if (it.location && it.location.length >= 2 && it.location.length <= 20 && nt.includes(it.location)) st.places[it.location] = (st.places[it.location] || 0) + 1;
            if (!it.location && ruleLoc && (items.length === 1)) st.notPlaces[ruleLoc] = 1;
          }
          const ruleCourse = courseOf(text);
          // 只在和课程有关的消息里学「课程叫法」，免得把「奖学金」之类当成课
          const courseish = it.msg_type === "作业" || /课|作业|实验|实习|实训|考试|测验|上机/.test(text);
          // 规则已经认识这门课时，改科目多半是加了细节（「高数（第三章）」），不当成新叫法
          if (courseish && !ruleCourse && it.subject && it.subject !== (rItem ? rItem.subject : "") && !/作业|通知|会议|活动|班会|考试/.test(it.subject)) {
            const alias = aliasFrom(clean(text), it.subject);
            if (alias) { st.aliases[alias] = it.subject; cache = null; }
          }
          const tm = (it.event_time || "").slice(11, 16), rtm = rItem ? (rItem.event_time || "").slice(11, 16) : "";
          const pk = periodKey(text);
          if (pk && tm && !rtm) st.periods[pk] = tm;
        }
        if (src === "user") {
          st.memory[key] = chatter ? { chatter: true } : { pub, items: (items || []).map(({ msg_type, subject, summary, event_time, location, prepare, need_confirm }) => ({ msg_type, subject, summary, event_time, location, prepare, need_confirm })) };
          const keys = Object.keys(st.memory); if (keys.length > 400) delete st.memory[keys[0]];
        }
        st.log.push({ at: Date.now(), src, chatter: !!chatter, n: (items || []).length, fix: rl && (chatter ? rl !== "闲聊" : items && items[0] && rl !== items[0].msg_type) ? 1 : 0 });
        if (st.log.length > 300) st.log.shift();
      },
      // 只学类型：本班历史事项、AI 的整理结果
      learnExample(text, label, src) { addExample(text, label, src || "history", false); },
      forget(kind, key) { if (st[kind]) { delete st[kind][key]; cache = null; } },
      stats() {
        return { examples: st.ex.length, fixes: st.ex.filter((e) => e.f).length, places: Object.keys(st.places).length, aliases: Object.keys(st.aliases).length,
          periods: Object.keys(st.periods).length, memory: Object.keys(st.memory).length, history: st.ex.filter((e) => e.s === "history").length };
      },
      dump() { return { places: Object.keys(st.places), aliases: { ...st.aliases }, periods: { ...st.periods }, notPlaces: Object.keys(st.notPlaces) }; },
      toJSON() { return st; },
    };
    return model;
  }
  function aliasFrom(text, subject) {
    // 1) 原文里最长的、按顺序都出现在科目名里的一段（「嵌入式」↔「嵌入式系统」，「电工实训」↔「电工电子实训」）
    const isSub = (w) => { let j = 0; for (const ch of subject) if (ch === w[j]) j++; return j === w.length; };
    for (let len = Math.min(text.length, 8); len >= 2; len--)
      for (let i = 0; i + len <= text.length; i++) {
        const w = text.slice(i, i + len);
        if (w[0] === subject[0] && isSub(w) && !/^(作业|实验|报告|课程|考试|通知|实习|实训|课)$/.test(w)) return w;
      }
    // 2) 原文里「XX课/XX作业/XX实验」的 XX（规则已经认出别的课时不猜，免得张冠李戴）
    if (courseOf(text)) return "";
    const m = text.match(/([一-龥A-Za-z+]{2,6}?)(课|作业|实验|实习|考试)/);
    return m && !/^(今天|明天|后天|下周|本周|这周|上午|下午|晚上|期中|期末|课堂|小组|个人|这次|本次|下次|上次|网上|线上|线下|所有|全部)$/.test(m[1]) && !/[的了在到]/.test(m[1]) ? m[1] : "";
  }

  // ================= 给 AI 用的提取说明（本地 AI / 云端 AI） =================
  function extractPrompt(pub) {
    const base = new Date(pub + "T00:00:00"), mon = addDays(base, -((base.getDay() + 6) % 7));
    const wk = (o) => "一二三四五六日".split("").map((c, i) => `${o}${c}=${keyOf(addDays(mon, i + (o === "下周" ? 7 : 0)))}`).join("，");
    return `你是班级群消息整理助手。从用户给的群消息里提取需要记下来的事项，只输出 JSON 数组，不要任何解释。
每个事项字段：msg_type（作业/会议/活动/通知 之一）、subject（科目或标题，12 字以内）、summary（一句话内容）、event_time（"YYYY-MM-DD HH:MM" 或 "YYYY-MM-DD"，不知道就是 ""）、location、prepare（需要带/准备的东西）、original（对应原文）、need_confirm（日期或细节不确定时为 true）。
消息发布日期是 ${pub}。换算日期请查表：${wk("本周")}；${wk("下周")}。「调到/改到」以后面的时间为准；「晚上12点前」写成 23:59。
闲聊、收到、表情、同学提问一律忽略；没有需要记录的事项时输出 []。`;
  }
  function parseJsonItems(s, pub) {
    if (!s) return null;
    const m = String(s).match(/\[[\s\S]*\]/);
    if (!m) return null;
    let arr; try { arr = JSON.parse(m[0]); } catch (e) { return null; }
    if (!Array.isArray(arr)) return null;
    return arr.filter((x) => x && typeof x === "object").map((x) => ({
      msg_type: TYPES4.includes(x.msg_type) ? x.msg_type : "通知",
      subject: String(x.subject || "").slice(0, 60), summary: String(x.summary || "").slice(0, 300),
      event_time: /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(x.event_time || "") ? x.event_time : "",
      location: String(x.location || "").slice(0, 60), prepare: String(x.prepare || "").slice(0, 100),
      original: String(x.original || "").slice(0, 1000), publish_date: pub, need_confirm: !!x.need_confirm || !x.event_time,
    })).filter((x) => x.subject || x.summary);
  }

  const api = { parse, splitMessages, isChatter, findDate, findTime, findLocation, extractPrompt, parseJsonItems, createModel, courseOf, version: 2 };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.LaoParse = api;
})(typeof window !== "undefined" ? window : globalThis);
