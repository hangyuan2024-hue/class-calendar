// 下载页：点下载时图标跳一下
(() => {
  const icon = document.getElementById("icon");
  document.addEventListener("click", (e) => {
    if (!e.target.closest("[data-get]") || !icon) return;
    icon.classList.remove("hop"); void icon.offsetWidth; icon.classList.add("hop");
  });
})();
