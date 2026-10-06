# 全新设计多彩版的实际验证

体验 APK：`3.2.9-preview`，版本号 `9`，包名 `com.laolao.classcalendar.preview`。环境为 Android 9 / API 28 AOSP 模拟器、JDK 17 和 Android SDK 34。

原生界面及八套皮肤保存在 `7a7a43f`，紧凑屏幕修正保存在 `74b9bc7`，皮肤偏好的一次保存保存在 `6a405ea`。日期弹窗的独立宽度规则保存在 `9f8dc0c`，交付 APK 对应该提交。本轮未上传远端 GitHub；体验签名沿用前一份原生体验版，原正式签名文件保持原样。

## 完成的检查

| 检查 | 实际结果 |
| --- | --- |
| 资源、Java、DEX、APK 对齐和签名 | 编译通过，v2 / v3 签名验证通过，实际安装成功 |
| 更新之前的原生体验版 | 同包名、同体验签名；安装前后本地记录一致 |
| 业务数据逻辑 | 75 项通过：日期、金额、课表、账号隔离、同步、备份、经验值等 |
| 界面专项 | 34 项通过，使用最终交付 APK |
| 八套皮肤专项 | 30 项通过：原生点选、实际背景像素、导航、持久化、数据保留和系统模式 |
| 页面入口与表单回归 | 46 个页面入口；与表单、词库、小屏和运行检查合并为 68 个去重检查项 |
| 实际表单和持久化 | 20 项表单及共同运行检查：事项、考试、记账、课程、错题、习惯、日记、专注、单词、抽签 |
| 原生日期弹窗 | 四套配色实际打开 DatePicker；另有 8 项最终 APK 与日期宽度检查通过 |
| 系统深浅色 | 实际打开设置开关，白天 → 夜间 → 白天，背景与导航正常变化 |
| 换肤数据保留 | 八套依次切换后，业务记录与切换前一致；最后一套重启后仍保留 |
| 320dp 小屏 / 150% 字体 | 导航、手机工具完整标题、课程添加、表单取消 / 保存、日期选择双按钮和元宇宙主操作可达 |
| 360dp 手机 / 平板 | 首页主操作、工具和导航可见；平板限制内容宽度 |
| 顶部栏 | 滚动前后顶部像素一致，保持不透明；底部导航仍可见 |
| 工具分类 | 普通手机宽度下六个分类均完整可见，触控宽度至少 48dp |
| 搜索和返回 | 34 个实际工具；11 项手机分类；查询、清空、无结果、输入焦点及返回条件保留 |
| 原生表单 / 键盘 | 系统输入法实际弹出，保存区域可达；无效表单保留并显示字段错误 |
| 周课表 | 有保存课程的网格实际显示；横向滑动呈现不同日期，文字不整体缩小 |
| 元宇宙 | 独立深色表面，随皮肤变化星光；离开后恢复用户的浅色主题 |
| 原生实现 | 应用源码无 WebView / Custom Tabs / loadUrl；界面树使用 Android 原生控件 |
| 运行日志 | 本轮设备检查未发现 FATAL EXCEPTION |

八套预设中，已列出的正文、辅助文字、主色文字及渐变文字对比值均不低于 4.5:1，最低记录为 4.551:1。它是配色参数检查，不是对全部系统控件、读屏顺序或整个应用的无障碍认证。

## 实际截图

所有截图来自安装后的 APK，部分页面包含本机测试记录。八套皮肤预览采用同一个工作台的八次真实截图。

| 页面 | 截图 |
| --- | --- |
| 今日工作台 | [native-home.png](screenshots/native-home.png) |
| 工具箱 | [native-tools.png](screenshots/native-tools.png) |
| 捞捞元宇宙 | [native-metaverse.png](screenshots/native-metaverse.png) |
| 手机助手 | [native-phone.png](screenshots/native-phone.png) |
| 换肤画廊 | [native-skins.png](screenshots/native-skins.png) |
| 八套皮肤实际首页 | [native-colours.png](screenshots/native-colours.png) |
| 个人中心 | [native-profile.png](screenshots/native-profile.png) |
| 专注计时 | [native-focus.png](screenshots/native-focus.png) |
| 带课程的周课表 | [native-course-week.png](screenshots/native-course-week.png) |
| 小屏与大字体 | [native-small-large-font.png](screenshots/native-small-large-font.png) |
| 实际系统键盘下的表单 | [native-form-keyboard.png](screenshots/native-form-keyboard.png) |
| 平板工具箱 | [native-tablet-tools.png](screenshots/native-tablet-tools.png) |

小屏和横屏截图可能带有模拟器物理画布的黑边。测试临时使用超长中文课程名，并在结束后恢复原记录；临时数据和完整偏好快照不进入交付压缩包。

## 复核与范围

结果见 `checks/results` 中的 build、install、core、ui、skin、picker、device 报告和 `palette-tokens.json`。界面脚本为 `checks/ui_checks.py`，皮肤脚本为 `checks/skin_checks.py`，日期宽度脚本为 `checks/picker_checks.py`，入口和表单脚本为 `../native-v4/checks/device_checks.py`。脚本仅用于可丢弃模拟器，不能用于个人手机。

```sh
python docs/native-v4/checks/device_checks.py --phase forms --output /tmp/campus-device
python docs/native-ui/checks/skin_checks.py --output /tmp/campus-skins
python docs/native-ui/checks/ui_checks.py --output /tmp/campus-ui
python docs/native-v4/checks/device_checks.py --phase screens --output /tmp/campus-device
```

系统开关的自动化定位兼容原生 Switch 附带的开 / 关状态文字。本次表单测试使用唯一的 `UI32` 测试名称，避免旧记录造成误判。课程冲突步骤最初使用了错误的测试按钮名称，纠正为实际的“确定”后，从课程步骤继续验证；专注检查通过原生结束操作处理上一轮保留的休息阶段；单词检查通过原生菜单回到首页，兼容之前保存的学习模式。随后继续验证。报告仅记入实际完成的检查。读取界面树时使用当前压缩层级重试，不沿用旧 XML。平板切换回手机分辨率时，模拟器 System UI 曾出现响应异常；恢复系统界面后从 360dp 阶段继续，先前完成的检查保留，应用运行日志未发现崩溃。

上一轮通知、录音、扫描 PDF、附件备份和恢复等系统交互见 [V4 验证记录](../native-v4/VERIFICATION.md)。这些模块的业务实现沿用，没有把上一轮 85 项计入本轮界面和皮肤专项。

本次没有华为实机或真实账号，尚未验证华为后台通知、相机、指纹、语音、实际定位，以及真实学生 / 老师 / 管理员云端权限、云端 OCR / AI 和邮箱。正式签名覆盖更新与 GitHub Actions 完整构建需在你的仓库执行。模拟器验证不能推导为所有手机都已经验收。
