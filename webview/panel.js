/* eslint-disable */
// QuecPi Control Panel webview script
const vscode = acquireVsCodeApi();

// section collapse/expand
document.querySelectorAll('.sec-head').forEach((head) => {
  head.addEventListener('click', () => {
    head.parentElement.classList.toggle('collapsed');
  });
});

// status refresh
document.getElementById('refresh').addEventListener('click', () => {
  vscode.postMessage({ type: 'refreshStatus' });
});

// run buttons + card clicks
document.querySelectorAll('.card[data-cmd]').forEach((card) => {
  card.addEventListener('click', (e) => {
    if (e.target.classList.contains('run') || e.target.tagName === 'BUTTON') {
      e.stopPropagation();
    }
    const cmd = card.getAttribute('data-cmd');
    if (cmd) vscode.postMessage({ type: 'run', command: cmd });
  });
});
document.querySelectorAll('.card[data-openchat]').forEach((card) => {
  card.addEventListener('click', () => vscode.postMessage({ type: 'openChat' }));
});

// status updates from extension
window.addEventListener('message', (e) => {
  const m = e.data;
  if (m.type !== 'status') return;
  const p = m.payload || {};
  if (p.container) document.getElementById('st-container').textContent = '容器: ' + p.container;
  if (p.artifacts) document.getElementById('st-artifacts').textContent = '产物: ' + p.artifacts;
  if (p.lastBuild) document.getElementById('st-last').textContent = '最近构建: ' + p.lastBuild;
});
