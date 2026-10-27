// 网页版：本机课内服务把思维导图模块挂在 /mindmap/（back/mindmapService.js）。
// 网站上导图的页面在 learn/mindmap/，接口由 learn/sw.js 里的 runtime/mindmap-part.js 提供，这里什么也不挂。
"use strict";
module.exports = { mountMindmap() { return { dispose() {} }; } };
