# 5.3.39 验收报告

版本：5.3.39-preview（versionCode 39）

## 本次改动
1. 今日时间轴可收起/展开（Web + Android）
   - 收起后显示汇总行：总项数、待完成数、下一事项，点击可展开
   - Android 端折叠状态用 rememberSaveable 保持，翻页/重启不丢失
2. 班级相关页面与贡献名单自动刷新（Android）
   - 触发时机：打开页面、切回 App、停留期间每 60 秒
   - 静默执行，不弹"正在处理"提示；手动刷新按钮保留
   - 修复：repeatOnLifecycle 缺 lifecycle-runtime-ktx 依赖导致编译失败，
     改为循环内检查 currentState.isAtLeast(RESUMED)

## 已验证
- Android 单元测试：72 项，0 失败
- 编译：BUILD SUCCESSFUL
- APK v2 签名：通过；zipalign 4 字节对齐：通过
- Web 端时间轴收起/展开：浏览器测试通过（收起后清单隐藏、展开后 12 项全部恢复、窄屏无溢出）

## 未验证（需要真机）
- 真机安装与启动
- 真实账号双端同步
- 国产手机（小米/华为/OPPO/vivo 等）通知与后台限制
- 自动刷新在真机上的实际表现
