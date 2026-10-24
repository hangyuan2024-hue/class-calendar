// 网页版：图片识别走页面里的「云端识别」（site-bridge.js），后端这条备用路线不可用
async function recognize() { throw Object.assign(new Error("网站版请在页面里使用图片识别（需要登录）"), { status: 503, code: "OCR_UNAVAILABLE" }); }
module.exports = { recognize };
