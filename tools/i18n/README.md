# 英文界面词典（i18n）

网站的英文界面由 `i18n.js`（运行时）+ `i18n-en.js`（词典，自动生成）组成。这个文件夹是生成词典用的源文件，网站运行时不会用到。

- `all.json`：从网页代码里提取出来的中文界面文字（第 N 条 = 编号 N）
- `e00.txt` … `eNN.txt`：译文，每行 `编号<Tab>英文`；`{0}` `{1}` 是会被替换的部分（数字、名字等），要原样保留
- `ext.js`：提取脚本（`npm i acorn acorn-walk` 后：`OUT=new.json node ext.js ../../app.js ...`）
- `build.py`：把 all.json + e*.txt 生成 `../../i18n-en.js`（在这个文件夹里运行 `python3 build.py`）

改译文：找到对应编号改 e*.txt，再运行 build.py。新增界面文字：用 ext.js 提取、追加到 all.json 末尾，再在新的 eNN.txt 里写译文。
欢迎各高校的同学帮忙改进翻译 🙌
