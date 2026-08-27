import * as vscode from 'vscode';
import { runQuiet } from '../build';
import { Cfg } from '../config';
import { adbCmd, adbShell, rebootDevice, atSend, screenshot, flashStorage } from '../device';

/**
 * QuecPi Control Panel — nRF-Connect-style dashboard (Webview).
 * Sections: Device / Build / Flash / Debug / AI. Cards expand on hover;
 * "card-group" cards expand on click to show sub-function buttons.
 */
export class ControlPanel {
  static current: ControlPanel | undefined;
  private panel: vscode.WebviewPanel;

  static create(extensionUri: vscode.Uri) {
    if (ControlPanel.current) { ControlPanel.current.panel.reveal(vscode.ViewColumn.One); return ControlPanel.current; }
    const panel = vscode.window.createWebviewPanel('quecpiControl', 'QuecPi 控制面板', vscode.ViewColumn.One, {
      enableScripts: true, retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'webview')],
    });
    ControlPanel.current = new ControlPanel(panel, extensionUri);
    panel.onDidDispose(() => { ControlPanel.current = undefined; });
    return ControlPanel.current;
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    const jsUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'webview', 'panel.js'));
    panel.webview.html = this.html(jsUri);
    panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
    this.postStatus();
  }

  private onMessage(msg: any) {
    switch (msg.type) {
      case 'run':
        void vscode.commands.executeCommand(msg.command, ...(msg.args ? [msg.args] : []));
        break;
      case 'openChat': void vscode.commands.executeCommand('quecpi.chat'); break;
      case 'refreshStatus': void this.postStatus(); break;
    }
  }

  private async postStatus() {
    const bsp = Cfg.bspPath();
    const deploy = Cfg.deployDir();
    const info: Record<string, string> = { bsp: bsp || '(未设置)', container: '未知', artifacts: '—', lastBuild: '—' };
    try {
      const ps = await runQuiet('docker', ['ps', '--filter', 'name=quecpi-build', '--format', '{{.Status}}']);
      info.container = ps.trim() ? `● ${ps.trim()}` : '○ 未运行';
    } catch { info.container = 'docker 不可用'; }
    try {
      const fs = await import('fs');
      if (fs.existsSync(deploy)) {
        const files = fs.readdirSync(deploy).filter((f: string) => !f.startsWith('.'));
        info.artifacts = `${files.length} 个产物`;
        const newest = files.map((f: string) => ({ f, t: fs.statSync(`${deploy}/${f}`).mtimeMs }))
          .sort((a: any, b: any) => b.t - a.t)[0];
        if (newest) info.lastBuild = new Date(newest.t).toLocaleString('zh-CN', { hour12: false });
      }
    } catch { /* ignore */ }
    this.panel.webview.postMessage({ type: 'status', payload: info });
  }

  private html(jsUri: vscode.Uri): string {
    const csp = this.panel.webview.cspSource;
    return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src ${csp}; img-src ${csp} data:;">
<style>
:root{--bg:#1a1d23;--panel:#22262e;--card:#2a2f3a;--card-hover:#313845;--border:#3a4150;--accent:#4ec9b0;--accent2:#61afef;--warn:#e5c07b;--fg:#d4d8e0;--dim:#8b93a3;}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:var(--bg);color:var(--fg);font-family:var(--vscode-font-family);padding:12px;font-size:13px;}
h1{font-size:15px;display:flex;align-items:center;gap:8px;margin-bottom:4px;}
h1 .chip-logo{color:var(--accent);}
.sub{color:var(--dim);font-size:11px;margin-bottom:12px;}
.status-row{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;}
.chip{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:3px 10px;font-size:11px;color:var(--dim);}
.chip b{color:var(--fg);font-weight:600;}
.sec{margin-bottom:14px;border:1px solid var(--border);border-radius:10px;background:var(--panel);overflow:hidden;}
.sec-head{display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:pointer;user-select:none;font-weight:600;font-size:13px;}
.sec-head .chev{transition:transform .15s;color:var(--dim);font-size:10px;}
.sec.collapsed .chev{transform:rotate(-90deg);}
.sec.collapsed .sec-body{display:none;}
.sec-head .tag{margin-left:auto;color:var(--dim);font-size:10px;font-weight:400;}
.sec-body{padding:8px 10px 12px;display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px;}
.card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px;cursor:pointer;transition:all .18s ease;overflow:hidden;}
.card:hover{background:var(--card-hover);border-color:var(--accent);transform:translateY(-2px);box-shadow:0 4px 14px rgba(0,0,0,.35);}
.card .icon{font-size:18px;}
.card .title{font-weight:600;font-size:12.5px;margin-top:6px;}
.card .cmd{color:var(--accent2);font-size:10.5px;font-family:var(--vscode-editor-font-family);margin-top:3px;opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.card .desc{color:var(--dim);font-size:11px;margin-top:4px;max-height:0;opacity:0;transition:all .2s ease;overflow:hidden;}
.card:hover .desc{max-height:80px;opacity:1;margin-top:6px;}
.card .run{display:none;margin-top:8px;background:var(--accent);color:#102;border:none;border-radius:5px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;}
.card:hover .run{display:inline-block;}
.card.warn .title{color:var(--warn);}
/* ── 可展开卡片组（accordion）── */
.cg{grid-column:1/-1;background:var(--card);border:1px solid var(--border);border-radius:8px;overflow:hidden;}
.cg-head{display:flex;align-items:center;gap:8px;padding:10px;cursor:pointer;transition:background .15s;}
.cg-head:hover{background:var(--card-hover);}
.cg-head .icon{font-size:18px;}
.cg-head .title{font-weight:600;font-size:12.5px;flex:1;}
.cg-head .desc{color:var(--dim);font-size:10.5px;text-align:right;}
.cg-head .arrow{color:var(--dim);font-size:10px;transition:transform .2s;}
.cg.open .arrow{transform:rotate(180deg);}
.cg-body{display:none;padding:8px 10px 12px;border-top:1px solid var(--border);}
.cg.open .cg-body{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:6px;}
.sc{background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:7px 8px;cursor:pointer;transition:all .15s;}
.sc:hover{background:var(--card-hover);border-color:var(--accent);}
.sc .st{font-weight:600;font-size:11.5px;}
.sc .sd{color:var(--dim);font-size:10px;margin-top:2px;}
.foot{color:var(--dim);font-size:10px;text-align:center;margin-top:10px;}
</style>
</head>
<body>
<h1><span class="chip-logo">🔩</span> QuecPi H1 · 控制面板</h1>
<div class="sub">Qualcomm QCM6490 · Yocto Kirkstone · 构建/烧录/调试/设备 一体化</div>

<div class="status-row" id="statusrow">
  <span class="chip"><b id="st-container">容器: …</b></span>
  <span class="chip"><b id="st-artifacts">产物: …</b></span>
  <span class="chip"><b id="st-last">最近构建: …</b></span>
  <button id="refresh" style="background:var(--panel);border:1px solid var(--border);color:var(--dim);border-radius:14px;padding:2px 10px;font-size:11px;cursor:pointer;">↻ 刷新</button>
</div>

<!-- ═══ 构建 ═══ -->
<div class="sec" id="sec-build">
  <div class="sec-head"><span class="chev">▼</span> 🔨 构建 <span class="tag">Build</span></div>
  <div class="sec-body">
    <div class="card" data-cmd="quecpi.buildconfig">
      <div class="icon">⚙️</div><div class="title">Configure</div>
      <div class="cmd">buildconfig QSM565DWF &lt;rev&gt; STD</div>
      <div class="desc">配置项目版本与定制项，生成宏头并回写 auto.conf。</div>
      <button class="run">运行</button>
    </div>
    <div class="card" data-cmd="quecpi.buildall">
      <div class="icon">🚀</div><div class="title">Build All</div>
      <div class="cmd">bitbake qcom-multimedia-image</div>
      <div class="desc">编译内核/模块/驱动/rootfs 并组装完整镜像，走 sstate 增量。</div>
      <button class="run">运行</button>
    </div>
    <div class="card warn" data-cmd="quecpi.buildClean">
      <div class="icon">🧹</div><div class="title">Clean Build</div>
      <div class="cmd">rm tmp [+sstate] && buildall</div>
      <div class="desc">删除编译中间物后完整重建。弹出清理范围选择与确认。</div>
      <button class="run">运行</button>
    </div>
    <div class="card" data-cmd="quecpi.buildkernel">
      <div class="icon">🧱</div><div class="title">Build Kernel</div>
      <div class="cmd">virtual/kernel → esp-qcom-image</div>
      <div class="desc">单独重建内核并生成 efi.bin。</div>
      <button class="run">运行</button>
    </div>
    <div class="card" data-cmd="quecpi.builddtb">
      <div class="icon">📋</div><div class="title">Build DTB</div>
      <div class="cmd">dtb-qcom-image</div>
      <div class="desc">单独重建设备树分区镜像。</div>
      <button class="run">运行</button>
    </div>
  </div>
</div>

<!-- ═══ 烧录与打包 ═══ -->
<div class="sec" id="sec-flash">
  <div class="sec-head"><span class="chev">▼</span> 💾 烧录与打包 <span class="tag">Flash / Package</span></div>
  <div class="sec-body">
    <div class="cg" id="cg-flash">
      <div class="cg-head"><span class="icon">🔥</span><span class="title">烧录到板</span><span class="desc">EDL / 一键烧录 / 手动 qdl</span><span class="arrow">▼</span></div>
      <div class="cg-body">
        <div class="sc" data-cmd="quecpi.rebootEdl"><div class="st">⚡ 进入 EDL</div><div class="sd">adb reboot edl</div></div>
        <div class="sc" data-cmd="quecpi.flashUfs"><div class="st">💾 一键烧录 UFS</div><div class="sd">flash.sh ufs</div></div>
        <div class="sc" data-cmd="quecpi.flashEmmc"><div class="st">💾 一键烧录 eMMC</div><div class="sd">flash.sh emmc</div></div>
        <div class="sc" data-cmd="quecpi.flash"><div class="st">🔧 手动 QDL</div><div class="sd">检测 EDL → qdl</div></div>
      </div>
    </div>
    <div class="card" data-cmd="quecpi.buildpackage">
      <div class="icon">📦</div><div class="title">制作烧录包</div>
      <div class="cmd">a_key_generation.sh</div>
      <div class="desc">汇总 AP 镜像 + bootbinaries + firehose + 分区表。</div>
      <button class="run">运行</button>
    </div>
    <div class="card" data-cmd="quecpi.flashHelp">
      <div class="icon">🔌</div><div class="title">烧录帮助</div>
      <div class="cmd">QDL / fastboot 参考</div>
      <div class="desc">EDL/firehose 流程、分区布局、cmdline 速查。</div>
      <button class="run">运行</button>
    </div>
  </div>
</div>

<!-- ═══ 设备调试 ═══ -->
<div class="sec" id="sec-debug">
  <div class="sec-head"><span class="chev">▼</span> 🛠 设备调试 <span class="tag">Device Debug</span></div>
  <div class="sec-body">

    <div class="cg" id="cg-log">
      <div class="cg-head"><span class="icon">📄</span><span class="title">系统日志</span><span class="desc">dmesg / journalctl</span><span class="arrow">▼</span></div>
      <div class="cg-body">
        <div class="sc" data-cmd="quecpi.adbCmd" data-args="dmesg | tail -100"><div class="st">📋 dmesg</div><div class="sd">最近 100 行内核日志</div></div>
        <div class="sc" data-cmd="quecpi.adbTerm" data-args="dmesg -w"><div class="st">📡 dmesg 实时</div><div class="sd">dmesg -w 持续跟踪</div></div>
        <div class="sc" data-cmd="quecpi.adbCmd" data-args="journalctl -n 50 --no-pager"><div class="st">📋 journalctl</div><div class="sd">最近 50 条系统日志</div></div>
        <div class="sc" data-cmd="quecpi.adbTerm" data-args="journalctl -f"><div class="st">📡 journalctl 实时</div><div class="sd">journalctl -f 持续跟踪</div></div>
      </div>
    </div>

    <div class="cg" id="cg-adb">
      <div class="cg-head"><span class="icon">📱</span><span class="title">ADB 操作</span><div class="desc" style="color:var(--dim)">shell / 重启 / 进 EDL</div><span class="arrow">▼</span></div>
      <div class="cg-body">
        <div class="sc" data-cmd="quecpi.adbShell"><div class="st">💻 adb shell</div><div class="sd">交互式终端</div></div>
        <div class="sc" data-cmd="quecpi.reboot"><div class="st">🔄 重启设备</div><div class="sd">adb reboot</div></div>
        <div class="sc" data-cmd="quecpi.rebootEdl"><div class="st">⚡ 进 EDL</div><div class="sd">adb reboot edl</div></div>
        <div class="sc" data-cmd="quecpi.adbCmd" data-args="devices"><div class="st">🔍 adb devices</div><div class="sd">列出已连接设备</div></div>
      </div>
    </div>

    <div class="card" data-cmd="quecpi.serialMonitor">
      <div class="icon">📡</div><div class="title">串口监视器</div>
      <div class="cmd">picocom /dev/ttyUSB0 @115200</div>
      <div class="desc">板载调试串口 ttyMSM0，picocom/minicom/screen 自动检测。</div>
      <button class="run">打开</button>
    </div>

    <div class="cg" id="cg-at">
      <div class="cg-head"><span class="icon">🤖</span><span class="title">AT 指令</span><span class="desc">串口 AT 发送</span><span class="arrow">▼</span></div>
      <div class="cg-body">
        <div class="sc" data-cmd="quecpi.atSend"><div class="st">⌨ 输入 AT 发送</div><div class="sd">输入框 → 串口发送</div></div>
        <div class="sc" data-cmd="quecpi.atSend" data-args="AT+QGMR"><div class="st">📋 QGMR</div><div class="sd">查版本信息</div></div>
        <div class="sc" data-cmd="quecpi.atSend" data-args="AT+QMAC?"><div class="st">📋 QMAC</div><div class="sd">查 MAC 地址</div></div>
      </div>
    </div>

    <div class="cg" id="cg-audio">
      <div class="cg-head"><span class="icon">🔊</span><span class="title">音频</span><span class="desc">日志 / agmplay / tinymix</span><span class="arrow">▼</span></div>
      <div class="cg-body">
        <div class="sc" data-cmd="quecpi.adbCmd" data-args="quectel_build/tools/collect_audio_logs.sh"><div class="st">📝 抓音频日志</div><div class="sd">collect_audio_logs.sh</div></div>
        <div class="sc" data-cmd="quecpi.adbCmd" data-args="agmplay --speaker /tmp/test.wav"><div class="st">🔈 Speaker</div><div class="sd">agmplay 扬声器播放</div></div>
        <div class="sc" data-cmd="quecpi.adbCmd" data-args="agmplay --hdmi /tmp/test.wav"><div class="st">📺 HDMI</div><div class="sd">agmplay HDMI 输出</div></div>
        <div class="sc" data-cmd="quecpi.adbCmd" data-args="agmplay --dp /tmp/test.wav"><div class="st">🖥 DP</div><div class="sd">agmplay DP 输出</div></div>
        <div class="sc" data-cmd="quecpi.adbTerm" data-args="tinymix"><div class="st">🎛 tinymix</div><div class="sd">音频通路配置（交互式）</div></div>
      </div>
    </div>

    <div class="cg" id="cg-tools">
      <div class="cg-head"><span class="icon">📸</span><span class="title">工具</span><span class="desc">截图 / 帧率 / GPU / diag</span><span class="arrow">▼</span></div>
      <div class="cg-body">
        <div class="sc" data-cmd="quecpi.screenshot"><div class="st">📸 截图</div><div class="sd">screencap + pull + 打开</div></div>
        <div class="sc" data-cmd="quecpi.adbCmd" data-args="dumpsys SurfaceFlinger | grep -i fps"><div class="st">📊 帧率监测</div><div class="sd">查看当前 FPS</div></div>
        <div class="sc" data-cmd="quecpi.adbCmd" data-args="quectel_build/tools/gpu_stress.sh"><div class="st">🔥 GPU 压测</div><div class="sd">GPU 压力测试</div></div>
        <div class="sc" data-cmd="quecpi.adbTerm" data-args="quectel_build/tools/gpu_monitor.sh 60"><div class="st">📈 GPU 监控</div><div class="sd">60秒 GPU 监控</div></div>
        <div class="sc" data-cmd="quecpi.adbCmd" data-args="quectel_build/tools/smart_adb_qxdm_log --start --mask full-filter-audio.cfg"><div class="st">🎙 diag 启动(音频)</div><div class="sd">diag_mdlog 音频 mask</div></div>
        <div class="sc" data-cmd="quecpi.adbCmd" data-args="quectel_build/tools/smart_adb_qxdm_log --stop"><div class="st">⏹ diag 停止</div><div class="sd">停止并列出日志</div></div>
      </div>
    </div>

  </div>
</div>

<!-- ═══ AI ═══ -->
<div class="sec" id="sec-ai">
  <div class="sec-head"><span class="chev">▼</span> 💬 AI 助手 <span class="tag">CodeBuddy</span></div>
  <div class="sec-body">
    <div class="card" data-openchat="1">
      <div class="icon">🤖</div><div class="title">打开 AI Chat</div>
      <div class="cmd">直连 DeepSeek Harness 会话</div>
      <div class="desc">带上下文/工具/状态的对话面板，可附加当前文件/选区代码。</div>
      <button class="run">打开</button>
    </div>
  </div>
</div>

<div class="foot">QuecPi H1 DevKit · 卡片悬停展开 · 可展开卡片组点击折叠</div>
<script src="${jsUri}"></script>
</body>
</html>`;
  }
}
