// 防止本站页面被别的网站嵌进去（点击劫持）：被嵌入时整页隐藏，并尽量跳出到顶层
(function () {
  if (window.top !== window.self) {
    document.documentElement.style.display = "none";
    try { window.top.location.replace(window.self.location.href); } catch (e) { /* 对方禁止跳转时，页面保持隐藏 */ }
    return;
  }

})();
