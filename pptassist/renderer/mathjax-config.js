// MathJax 的设置（要在 tex-svg.js 之前加载）：不自动扫整个页面，只在 AI 助手的回复和公式预览里用
window.MathJax = { tex: { inlineMath: [["$", "$"], ["\\(", "\\)"]], displayMath: [["$$", "$$"], ["\\[", "\\]"]] }, svg: { fontCache: "local" }, startup: { typeset: false } };
