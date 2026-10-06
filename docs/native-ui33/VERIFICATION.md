# 原生设计焕新版验证记录

测试在一次性 Android 9 / API 28 AOSP 模拟器中进行。测试用的课程、事项、习惯和错题保存到真实本地存储，再通过实际原生按钮操作；不会把测试记录装入交付 APK。

本次结果：75 项数据逻辑检查、60 项界面与换肤检查、70 项页面和操作回归检查、4 项深色表单检查全部通过。十套预设的主要正文对比度检查也通过。37 张实际界面截图与各组报告一并保存。

## 本次检查范围

| 范围 | 检查内容 | 报告 |
| --- | --- | --- |
| 构建与签名 | 全部 Java 源码编译、Android 资源链接、DEX 生成、APK 对齐、v2/v3 签名验证 | `reports/build-verification.json` |
| 核心数据逻辑 | 日期与周次、单双周课程、整数分记账、账号隔离、本地保存、同步合并、备份验证等 | `reports/core-checks.json` |
| 新布局与皮肤 | 实际记录数量、顶部滚动背景、48dp 头部触控目标、五个导航、成长打卡、按学科筛选、工具搜索焦点、十套皮肤保存、重启保留、系统深浅色 | `reports/ui33-report.json` |
| 小屏与大字体 | 320dp 宽、150% 字体，以及 800dp 平板；首页、工具、成长、错题、个人页和原生日期选择器 | `reports/ui33-report.json` |
| 深色表单 | 跟随系统深色模式的记账表单、原生日期选择与取消后的数据保留 | `reports/night-dialog.json` |
| 原有页面与操作 | 原生页面打开检查；事项完成、考试创建、课程录入、记账、错题、日记保存、专注计时和离线单词学习等 | `reports/native-regression.json` |
| 配色正文可读性 | 十套预设的主要正文颜色在背景与卡片上的对比度 | `reports/palette-contrast.json` |

安装更新时会比较更新前后的本地存储。换肤验证会比较学习记录，确认切换皮肤没有改变课程、事项、错题和习惯等业务数据。

## 查看真实界面

`screenshots` 目录内是安装包在模拟器中的截图，包括今日工作台、日程、课程表、成长、工具箱、错题书架、皮肤选择与个人页。截图中的课程和错题是用于展示和验证的测试记录。

小屏和平板截图来自模拟分辨率，外围黑边是模拟器显示区域。正常手机截图展示完整的原生应用界面。

## 复现界面检查

开发者可以在一次性预览模拟器上使用 Python `adb-shell`、Pillow 和 ADB TCP 端口 5555：

```bash
python docs/native-ui33/checks/ui33_checks.py --phase all --output /tmp/campus-ui33
python docs/native-ui33/checks/native_regression.py --phase screens --output /tmp/campus-regression
python docs/native-ui33/checks/native_regression.py --phase forms --output /tmp/campus-regression
```

检查脚本确认连接的是模拟器，并在结束后恢复原测试数据。它们不适用于个人手机。

## 验证边界

此次已验证本地原生界面、常用操作、配色和数据保留。未使用真实华为手机或登录生产账号进行测试，因此不将华为系统行为、云端班级同步或生产签名安装列为已通过。本次可直接安装的交付包是原生体验版；正式版由现有 GitHub Actions 使用原签名构建。
