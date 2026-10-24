// 网页版没有 LibreOffice：Word / PPT 在线预览不可用（docx/pptx 的文字仍由浏览器直接读取），接口照旧在，返回「不可用」
function createOfficePreview() {
  return {
    prepare() {},
    convertLegacy: () => Promise.reject(new Error("CONVERTER_UNAVAILABLE")),
    register(app) {
      app.post("/api/office/convert-legacy", (req, res) => res.status(503).json({ code: "CONVERTER_UNAVAILABLE" }));
      app.get("/api/attachments/:name/preview", (req, res) => { res.set("Cache-Control", "no-store"); res.json({ status: "unavailable", code: "CONVERTER_UNAVAILABLE" }); });
      app.get("/api/attachments/:name/preview.pdf", (req, res) => res.sendStatus(404));
    },
  };
}
module.exports = { createOfficePreview, converterPath: () => null, officeName: () => false };
