import * as vscode from 'vscode';
import { runQuiet } from '../build';
import { Cfg } from '../config';

/**
 * QuecPi Control Panel — an nRF-Connect-style dashboard (Webview).
 * Sections: Device / Build / Flash / Debug / AI. Buttons are cards that
 * expand on hover; clicking runs the underlying extension command.
 */
export class ControlPanel {
  static current: ControlPanel | undefined;

  private panel: vscode.WebviewPanel;

  static create(extensionUri: vscode.Uri) {
    if (ControlPanel.current) {
      ControlPanel.current.panel.reveal(vscode.ViewColumn.One);
      return ControlPanel.current;
    }
    const panel = vscode.window.createWebviewPanel('quecpiControl', 'QuecPi 控制面板', vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'webview')],
    });
    ControlPanel.current = new ControlPanel(panel, extensionUri);
    panel.onDidDispose(() => {
      ControlPanel.current = undefined;
    });
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
        void vscode.commands.executeCommand(msg.command);
        break;
      case 'openChat':
        void vscode.commands.executeCommand('quecpi.chat');
        break;
      case 'refreshStatus':
        void this.postStatus();
        break;
    }
  }

  private async postStatus() {
    const bsp = Cfg.bspPath();
    const buildDir = `${bsp}/build-qcom-wayland`;
    const deploy = Cfg.deployDir();
    const info: Record<string, string> = {
      bsp: bsp || '(未设置)',
      buildDir: buildDir,
      container: '未知',
      artifacts: '—',
      lastBuild: '—',
    };

    try {
      const ps = await runQuiet('docker', ['ps', '--filter', 'name=quecpi-build', '--format', '{{.Status}}']);
      info.container = ps.trim() ? `● ${ps.trim()}` : '○ 未运行';
    } catch {
      info.container = 'docker 不可用';
    }

    try {
      const fs = await import('fs');
      if (fs.existsSync(deploy)) {
        const files = fs.readdirSync(deploy).filter((f) => !f.startsWith('.'));
        info.artifacts = `${files.length} 个产物`;
        const newest = fs
          .readdirSync(deploy)
          .map((f) => ({ f, t: fs.statSync(`${deploy}/${f}`).mtimeMs }))
          .sort((a, b) => b.t - a.t)[0];
        if (newest) info.lastBuild = new Date(newest.t).toLocaleString('zh-CN', { hour12: false });
      }
    } catch {
      /* ignore */
    }
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
:root{
  --bg:#1a1d23; --panel:#22262e; --card:#2a2f3a; --card-hover:#313845;
  --border:#3a4150; --accent:#4ec9b0; --accent2:#61afef; --warn:#e5c07b;
  --fg:#d4d8e0; --dim:#8b93a3;
}
*{box-sizing:border-box; margin:0; padding:0;}
body{background:var(--bg); color:var(--fg); font-family:var(--vscode-font-family); padding:12px; font-size:13px;}
h1{font-size:15px; display:flex; align-items:center; gap:8px; margin-bottom:4px;}
h1 .chip-logo{color:var(--accent);}
.sub{color:var(--dim); font-size:11px; margin-bottom:12px;}
.status-row{display:flex; gap:6px; flex-wrap:wrap; margin-bottom:14px;}
.chip{background:var(--panel); border:1px solid var(--border); border-radius:14px; padding:3px 10px; font-size:11px; color:var(--dim);}
.chip b{color:var(--fg); font-weight:600;}
.chip .dot{color:var(--accent);}
.sec{margin-bottom:14px; border:1px solid var(--border); border-radius:10px; background:var(--panel); overflow:hidden;}
.sec-head{display:flex; align-items:center; gap:8px; padding:10px 12px; cursor:pointer; user-select:none; font-weight:600; font-size:13px;}
.sec-head .chev{transition:transform .15s; color:var(--dim); font-size:10px;}
.sec.collapsed .chev{transform:rotate(-90deg);}
.sec.collapsed .sec-body{display:none;}
.sec-head .tag{margin-left:auto; color:var(--dim); font-size:10px; font-weight:400;}
.sec-body{padding:8px 10px 12px; display:grid; grid-template-columns:repeat(auto-fill,minmax(210px,1fr)); gap:8px;}
.card{background:var(--card); border:1px solid var(--border); border-radius:8px; padding:10px; cursor:pointer; transition:all .18s ease; position:relative; overflow:hidden;}
.card:hover{background:var(--card-hover); border-color:var(--accent); transform:translateY(-2px); box-shadow:0 4px 14px rgba(0,0,0,.35);}
.card .icon{font-size:18px;}
.card .title{font-weight:600; font-size:12.5px; margin-top:6px;}
.card .cmd{color:var(--accent2); font-size:10.5px; font-family:var(--vscode-editor-font-family); margin-top:3px; opacity:.75; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.card .desc{color:var(--dim); font-size:11px; margin-top:4px; max-height:0; opacity:0; transition:all .2s ease; overflow:hidden;}
.card:hover .desc{max-height:80px; opacity:1; margin-top:6px;}
.card .run{display:none; margin-top:8px; background:var(--accent); color:#102; border:none; border-radius:5px; padding:4px 10px; font-size:11px; font-weight:700; cursor:pointer;}
.card:hover .run{display:inline-block;}
.card .run:hover{filter:brightness(1.1);}
.card.warn .title{color:var(--warn);}
.card.soon{opacity:.55; cursor:default;}
.card.soon:hover{transform:none; border-color:var(--border); box-shadow:none;}
.foot{color:var(--dim); font-size:10px; text-align:center; margin-top:10px;}
</style>
</head>
<body>
<h1><span class="chip-logo">🔩</span> QuecPi H1 · 控制面板</h1>
<div class="sub">Qualcomm QCM6490 · Yocto Kirkstone · 构建/烧录/调试 一体化</div>

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
      <div class="icon">⚙️</div><div class="title">Configure (buildconfig)</div>
      <div class="cmd">buildconfig QSM565DWF &lt;rev&gt; STD</div>
      <div class="desc">配置项目版本与定制项（标准/调试/安全启动），生成宏头并回写 auto.conf。</div>
      <button class="run">运行</button>
    </div>
    <div class="card" data-cmd="quecpi.buildall">
      <div class="icon">🚀</div><div class="title">Build All（完整镜像）</div>
      <div class="cmd">bitbake qcom-multimedia-image</div>
      <div class="desc">编译内核/模块/驱动/rootfs 并组装完整镜像（含 ostree/OTA/ESP 分区）。耗时较长，走 sstate 增量。</div>
      <button class="run">运行</button>
    </div>
    <div class="card" data-cmd="quecpi.buildClean">
      <div class="icon">🧹</div><div class="title">Clean Build（从头重建）</div>
      <div class="cmd">rm tmp [+sstate] && buildall</div>
      <div class="desc">删除编译中间物（可选连同 sstate 缓存）后完整重建。会弹出清理范围选择与确认。</div>
      <button class="run">运行</button>
    </div>
    <div class="card" data-cmd="quecpi.buildkernel">
      <div class="icon">🧱</div><div class="title">Build Kernel</div>
      <div class="cmd">virtual/kernel → esp-qcom-image</div>
      <div class="desc">单独重建内核并生成 efi.bin（拷贝到 quectel_build/output/efi.bin）。</div>
      <button class="run">运行</button>
    </div>
    <div class="card" data-cmd="quecpi.builddtb">
      <div class="icon">📋</div><div class="title">Build DTB</div>
      <div class="cmd">dtb-qcom-image</div>
      <div class="desc">单独重建设备树分区镜像（qcs6490-idp-pi.dtb 等），拷贝 dtb.bin。</div>
      <button class="run">运行</button>
    </div>
  </div>
</div>

<!-- ═══ 烧录与打包 ═══ -->
<div class="sec" id="sec-flash">
  <div class="sec-head"><span class="chev">▼</span> 💾 烧录与打包 <span class="tag">Flash / Package</span></div>
  <div class="sec-body">
    <div class="card" data-cmd="quecpi.flash">
      <div class="icon">🔥</div><div class="title">烧录到板 (Flash)</div>
      <div class="cmd">QDL · 检测 EDL → firehose 烧录</div>
      <div class="desc">检测板子 EDL 设备 → 用烧录包（prog_firehose + rawprogram/patch）执行真正烧录，覆盖板上系统。</div>
      <button class="run">烧录</button>
    </div>
    <div class="card" data-cmd="quecpi.buildpackage">
      <div class="icon">📦</div><div class="title">制作烧录包 (buildpackage)</div>
      <div class="cmd">a_key_generation.sh</div>
      <div class="desc">汇总 AP 镜像 + bootbinaries + firehose + 分区表，输出到 quectel_build/&lt;版本号&gt;/ 的完整可烧录包。</div>
      <button class="run">运行</button>
    </div>
    <div class="card" data-cmd="quecpi.flashHelp">
      <div class="icon">🔌</div><div class="title">烧录帮助 (QDL/fastboot)</div>
      <div class="cmd">firehose · 分区表 · 命令参考</div>
      <div class="desc">查看 EDL/firehose 烧录流程、分区布局与内核 cmdline 速查。</div>
      <button class="run">运行</button>
    </div>
  </div>
</div>

<!-- ═══ 调试 ═══ -->
<div class="sec" id="sec-debug">
  <div class="sec-head"><span class="chev">▼</span> 🛠 调试 <span class="tag">Debug</span></div>
  <div class="sec-body">
    <div class="card" data-cmd="quecpi.serialMonitor">
      <div class="icon">📡</div><div class="title">串口监视器 (Serial)</div>
      <div class="cmd">picocom /dev/ttyUSB0 @115200</div>
      <div class="desc">打开板载调试串口（ttyMSM0, 115200），支持 picocom/minicom/screen 自动检测。</div>
      <button class="run">打开</button>
    </div>
    <div class="card soon" data-cmd="">
      <div class="icon">🤖</div><div class="title">ADB Console（预留）</div>
      <div class="cmd">adb shell</div>
      <div class="desc">后续版本：内嵌 ADB 控制台，直接操作板端 Linux 环境。</div>
    </div>
    <div class="card soon" data-cmd="">
      <div class="icon">🔧</div><div class="title">硬件接口（预留）</div>
      <div class="cmd">GPIO / I2C / SPI / PCIe</div>
      <div class="desc">后续版本：端口与硬件外设状态查看。</div>
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
      <div class="desc">带我的上下文/工具/状态的对话面板，可附加当前文件/选区代码。</div>
      <button class="run">打开</button>
    </div>
  </div>
</div>

<div class="foot">QuecPi H1 DevKit · 构建在 Docker 容器 quecpi-build 内执行</div>
<script src="${jsUri}"></script>
</body>
</html>`;
  }
}
