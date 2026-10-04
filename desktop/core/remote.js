// 界面能调哪些服务器接口（白名单）。登录令牌只在主进程里，界面只能通过这里发请求，
// 不在名单上的一律拒绝；服务器函数里面还会再检查身份和班级权限。
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const RPC = new Set([
  // 班级、分组、事项
  "my_classes", "class_ctx", "class_items_get", "class_groups_get", "class_item_history", "class_item_save", "class_item_delete",
  "class_group_save", "class_group_delete", "class_group_join", "class_group_leave", "class_group_member_set", "class_set_members_can_edit",
  "class_roster", "class_people", "class_lookup", "join_class", "create_class", "review_member", "set_member", "regenerate_class_code",
  "transfer_class", "set_class_identity", "class_features_get", "class_set_feature", "feature_state",
  // 班级墙
  "wall_post", "wall_post_group", "wall_edit", "wall_delete", "wall_pin", "wall_moderate", "wall_report", "wall_my_reports", "wall_report_list",
  "wall_comments_get", "wall_comment_add", "wall_comment_delete",
  // 成长、排行榜
  "growth_log", "growth_board", "growth_sync_done", "rank_set_pref",
  // 个人资料、账号
  "user_page", "profile_update", "account_security", "pw_change", "pw_reset_by_staff",
  "mail_my", "mail_bind_start", "mail_bind_confirm", "mail_test", "mail_unbind", "mail_set_prefs", "mail_tick",
  // 功能介绍、感谢名单
  "intro_get", "intro_save", "intro_editors_list", "intro_editor_set", "intro_history_list", "intro_history_get", "credit_list", "credit_save", "credit_delete",
  // 整理群消息
  "publish_parsed_items", "parse_feedback_list", "parse_feedback_add", "parse_feedback_clear", "ingest_class_messages", "ingest_job_status",
  // 课程表
  "courses_get", "courses_sync", "course_ocr_start", "course_ocr_status", "course_learn_get", "course_learn_submit", "course_ocr_sample_add",
  // 日历订阅、工具
  "ics_my_feed", "ics_put", "plugin_changelog",
]);

// 直接读表（只读，只认这几种写法）
const GET = [
  new RegExp(`^wall_posts\\?select=[a-z_,]+&class_id=eq\\.${UUID}&order=created_at\\.desc&limit=\\d{1,3}$`),
  /^plugins\?select=[a-z_,]+&order=created_at\.asc$/,
  /^plugins\?select=code,app_html,version&id=eq\.[\w-]{1,60}$/,
  /^plugin_drafts\?select=[a-z_,]+&status=eq\.testing$/,
  /^plugin_drafts\?select=code,app_html&plugin_id=eq\.[\w-]{1,60}$/,
  new RegExp(`^classes\\?select=[a-z_,]+&teacher_id=eq\\.${UUID}$`),
];
// 删除：退出班级 / 老师把人移出班级（数据库的权限规则会再检查）
const DEL = [new RegExp(`^class_members\\?class_id=eq\\.${UUID}&user_id=eq\\.${UUID}$`)];

function checkRpc(fn) { if (!RPC.has(fn)) throw new Error("不支持的操作：" + fn); }
function checkGet(p) { if (!GET.some((re) => re.test(String(p)))) throw new Error("不支持的读取：" + String(p).split("?")[0]); }
function checkDel(p) { if (!DEL.some((re) => re.test(String(p)))) throw new Error("不支持的删除"); }

module.exports = { RPC, GET, DEL, checkRpc, checkGet, checkDel };
