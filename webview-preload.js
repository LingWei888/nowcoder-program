const { ipcRenderer } = require('electron');

function sendOpenNewTab(url) {
  if (!url) return;
  console.log('[webview-preload] sendOpenNewTab:', url);
  ipcRenderer.sendToHost('open-new-tab', url);
}

window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('click', (event) => {
    const anchor = event.target.closest('a[target="_blank"]');
    if (!anchor || !anchor.href) return;
    console.log('[webview-preload] 捕获 target=_blank 链接点击:', anchor.href);
    event.preventDefault();
    sendOpenNewTab(anchor.href);
  }, true);
});

const originalOpen = window.open.bind(window);
window.open = function(url, target, features) {
  console.log('[webview-preload] window.open called, url:', url, 'target:', target, 'features:', features);
  if (target === '_blank' || !target) {
    sendOpenNewTab(url);
    return null;
  }
  return originalOpen(url, target, features);
};

console.log('[webview-preload] 已注入 window.open 拦截器');
