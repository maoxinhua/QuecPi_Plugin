/* eslint-disable */
// QuecPi H1 DevKit — chat webview script (loaded as a separate file, CSP-safe)
const vscode = acquireVsCodeApi();
const msgs = document.getElementById('msgs');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');
const stopBtn = document.getElementById('stop');
const statusBar = document.getElementById('status');
const presetSel = document.getElementById('preset');
const modelSel = document.getElementById('model');
const connectSel = document.getElementById('connectmode');
const sessionSel = document.getElementById('session');
const ctxchips = document.getElementById('ctxchips');

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// tiny markdown: fenced code + inline code + bold
function md(text) {
  const parts = String(text).split(/```/);
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      out += '<pre><code>' + esc(parts[i]) + '</code></pre>';
    } else {
      out += esc(parts[i])
        .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');
    }
  }
  return out;
}

function addMsg(role, html) {
  const d = document.createElement('div');
  d.className = 'msg ' + role;
  d.innerHTML = html;
  msgs.appendChild(d);
  msgs.scrollTop = msgs.scrollHeight;
  return d;
}

let assistantEl = null;
let pendingContexts = []; // {label, content}

function populateSelects(p) {
  presetSel.innerHTML = '';
  for (const pr of p.presets) {
    const o = document.createElement('option');
    o.value = pr.id;
    o.textContent = pr.label + (pr.isDefault ? '（默认）' : '') + (pr.broken ? ' ⚠' : '');
    if (pr.broken) o.disabled = true;
    presetSel.appendChild(o);
  }
  presetSel.value = p.currentPreset;

  modelSel.innerHTML = '';
  for (const mo of p.models) {
    const o = document.createElement('option');
    o.value = mo;
    o.textContent = mo;
    modelSel.appendChild(o);
  }
  modelSel.value = p.currentModel;

  sessionSel.innerHTML = '';
  for (const s of p.sessions || []) {
    const o = document.createElement('option');
    o.value = s.id;
    o.textContent = s.label;
    sessionSel.appendChild(o);
  }
  if (p.currentSession) sessionSel.value = p.currentSession;
  connectSel.value = p.connectMode || 'harness';
  toggleMode(p.connectMode || 'harness');
}

function toggleMode(mode) {
  // in harness mode the Agent/模型 selects are irrelevant (harness drives them)
  presetSel.disabled = mode === 'harness';
  modelSel.disabled = mode === 'harness';
  sessionSel.disabled = mode !== 'harness';
}

function addChip(ctx) {
  const chip = document.createElement('span');
  chip.className = 'chip';
  const label = document.createElement('span');
  label.textContent = ctx.label;
  const x = document.createElement('button');
  x.textContent = '×';
  x.title = '移除上下文';
  x.onclick = () => {
    const i = pendingContexts.findIndex((c) => c.label === ctx.label && c.content === ctx.content);
    if (i >= 0) pendingContexts.splice(i, 1);
    chip.remove();
  };
  chip.appendChild(label);
  chip.appendChild(x);
  ctxchips.appendChild(chip);
  pendingContexts.push(ctx);
}

window.addEventListener('message', (e) => {
  const m = e.data;
  switch (m.type) {
    case 'init': {
      populateSelects(m.payload);
      break;
    }
    case 'history': {
      msgs.innerHTML = '';
      for (const msg of m.payload) {
        addMsg(
          msg.role === 'user' ? 'user' : 'assistant',
          '<span class="role-tag">' + (msg.role === 'user' ? '你' : 'QuecPi') + '</span>' + md(msg.content)
        );
      }
      break;
    }
    case 'status': {
      statusBar.textContent = m.payload;
      statusBar.style.display = '';
      break;
    }
    case 'toast': {
      addMsg('err', '⚠ ' + esc(m.payload));
      break;
    }
    case 'appendContext': {
      addChip(m.payload);
      break;
    }
    case 'assistantStart': {
      assistantEl = addMsg('assistant', '<span class="role-tag">QuecPi</span>');
      sendBtn.disabled = true;
      stopBtn.style.display = 'inline-block';
      break;
    }
    case 'assistantDelta': {
      if (assistantEl) { assistantEl.innerHTML += esc(m.payload); msgs.scrollTop = msgs.scrollHeight; }
      break;
    }
    case 'tool': {
      if (assistantEl) {
        assistantEl.innerHTML += '<div class="tool-line">🔧 <b>' + esc(m.payload.name) + '</b>' +
          (m.payload.args ? ' <code>' + esc(m.payload.args) + '</code>' : '') + '</div>';
        msgs.scrollTop = msgs.scrollHeight;
      }
      break;
    }
    case 'assistantDone': {
      assistantEl = null; sendBtn.disabled = false; stopBtn.style.display = 'none';
      break;
    }
    case 'assistantError': {
      addMsg('err', '⚠ ' + esc(m.payload)); sendBtn.disabled = false; stopBtn.style.display = 'none';
      break;
    }
  }
});

document.getElementById('ctxSel').onclick = () => vscode.postMessage({ type: 'grabContext', mode: 'selection' });
document.getElementById('ctxFile').onclick = () => vscode.postMessage({ type: 'grabContext', mode: 'file' });
document.getElementById('clear').onclick = () => vscode.postMessage({ type: 'clear' });
sendBtn.onclick = () => send();
stopBtn.onclick = () => vscode.postMessage({ type: 'stop' });
presetSel.onchange = () => vscode.postMessage({ type: 'setPreset', id: presetSel.value });
modelSel.onchange = () => vscode.postMessage({ type: 'setModel', id: modelSel.value });
connectSel.onchange = () => {
  const mode = connectSel.value;
  toggleMode(mode);
  vscode.postMessage({ type: 'setConnectMode', mode });
};
sessionSel.onchange = () => vscode.postMessage({ type: 'setSession', id: sessionSel.value });
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});

function send() {
  const text = input.value.trim();
  if (!text && pendingContexts.length === 0) { return; }
  const contexts = pendingContexts.map((c) => c.content);
  pendingContexts = [];
  ctxchips.innerHTML = '';
  vscode.postMessage({
    type: 'send',
    text,
    contexts,
    mode: connectSel.value,
    sessionId: sessionSel.value,
  });
  input.value = '';
}
