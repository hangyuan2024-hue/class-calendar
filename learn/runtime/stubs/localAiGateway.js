// 网页版：课内的 AI 由本机的 Python 服务（127.0.0.1:3002）提供，网站上还没部署，先统一回「暂不可用」
const express = require("express");
const PATHS = new Set(["/test", "/classify", "/answer-draft", "/review-suggestion", "/review-mode-advice",
  "/material-draft", "/review-feedback", "/outline-polish", "/assessment-chart"]);
function createLocalAiGateway() {
  const router = express.Router();
  router.use((req, res, next) => {
    if (req.method === "GET" && req.path === "/platform-status") { res.set("Cache-Control", "no-store"); return res.json({ available: false }); }
    if (req.method !== "POST" || !PATHS.has(req.path)) return next();
    res.set("Cache-Control", "no-store");
    return res.status(503).json({ error: "LOCAL_AI_UNAVAILABLE" });
  });
  return router;
}
module.exports = { createLocalAiGateway };
