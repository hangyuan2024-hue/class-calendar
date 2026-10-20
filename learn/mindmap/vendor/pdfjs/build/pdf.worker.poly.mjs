// PDF 后台线程入口：先补上旧浏览器缺的功能（js/pdf-polyfill.js），再加载 PDF.js 自己的 worker
import "../../../js/pdf-polyfill.js";
import "./pdf.worker.mjs";
