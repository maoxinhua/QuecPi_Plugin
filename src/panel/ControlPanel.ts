import * as vscode from 'vscode';
import { runQuiet } from '../build';
import { Cfg } from '../config';
import { t } from '../i18n';

/**
 * QuecPi Control Panel — compact icon-tile dashboard (Webview).
 * Small tiles auto-reflow to fit 1-2 screens; descriptions show as hover
 * tooltips; card-groups expand on click. Supports pop-out to a separate
 * editor column (and VS Code "Move to New Window" for a true OS window).
 */
export class ControlPanel {
  static current: ControlPanel | undefined;
  private static popoutPanel: ControlPanel | undefined;
  private panel: vscode.WebviewPanel;
  private readonly isPopout: boolean;

  static create(extensionUri: vscode.Uri) {
    if (ControlPanel.current) { ControlPanel.current.panel.reveal(vscode.ViewColumn.One); return ControlPanel.current; }
    const panel = vscode.window.createWebviewPanel('quecpiControl', 'QuecPi Panel', vscode.ViewColumn.One, {
      enableScripts: true, retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'webview')],
    });
    ControlPanel.current = new ControlPanel(panel, extensionUri, false);
    panel.onDidDispose(() => { ControlPanel.current = undefined; });
    return ControlPanel.current;
  }

  static popout(extensionUri: vscode.Uri) {
    const panel = vscode.window.createWebviewPanel('quecpiControlPop', 'QuecPi Panel (Detached)', vscode.ViewColumn.Beside, {
      enableScripts: true, retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'webview')],
    });
    ControlPanel.popoutPanel = new ControlPanel(panel, extensionUri, true);
    panel.onDidDispose(() => { ControlPanel.popoutPanel = undefined; });
    return ControlPanel.popoutPanel;
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, isPopout: boolean) {
    this.panel = panel;
    this.isPopout = isPopout;
    const jsUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'webview', 'panel.js'));
    panel.webview.html = this.html(jsUri);
    panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg, extensionUri));
    this.postStatus();
  }

  private onMessage(msg: any, extensionUri: vscode.Uri) {
    switch (msg.type) {
      case 'run':
        void vscode.commands.executeCommand(msg.command, ...(msg.args ? [msg.args] : []));
        break;
      case 'openChat': void vscode.commands.executeCommand('quecpi.chat'); break;
      case 'refreshStatus': void this.postStatus(); break;
      case 'popout': void ControlPanel.popout(extensionUri); break;
    }
  }

  private async postStatus() {
    const bsp = Cfg.bspPath();
    const deploy = Cfg.deployDir();
    const info: Record<string, string> = { container: 'unknown', artifacts: '-', lastBuild: '-' };
    try {
      const ps = await runQuiet('docker', ['ps', '--filter', 'name=quecpi-build', '--format', '{{.Status}}']);
      info.container = ps.trim() ? `up: ${ps.trim()}` : 'down';
    } catch { info.container = 'n/a'; }
    try {
      const fs = await import('fs');
      if (fs.existsSync(deploy)) {
        const files = fs.readdirSync(deploy).filter((f: string) => !f.startsWith('.'));
        info.artifacts = `${files.length} files`;
        const newest = files.map((f: string) => ({ f, t: fs.statSync(`${deploy}/${f}`).mtimeMs }))
          .sort((a: any, b: any) => b.t - a.t)[0];
        if (newest) info.lastBuild = new Date(newest.t).toLocaleString('en-US', { hour12: false });
      }
    } catch { /* ignore */ }
    this.panel.webview.postMessage({ type: 'status', payload: info });
  }

  private html(jsUri: vscode.Uri): string {
    const csp = this.panel.webview.cspSource;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src ${csp}; img-src ${csp} data:;">
<style>
:root{--bg:#1a1d23;--panel:#22262e;--card:#2a2f3a;--card-hover:#313845;--border:#3a4150;--accent:#4ec9b0;--accent2:#61afef;--warn:#e5c07b;--fg:#d4d8e0;--dim:#8b93a3;}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:var(--bg);color:var(--fg);font-family:var(--vscode-font-family);padding:8px;font-size:12px;}
h1{font-size:14px;display:flex;align-items:center;gap:6px;margin-bottom:2px;}
h1 .logo{color:var(--accent);}
.sub{color:var(--dim);font-size:10px;margin-bottom:8px;}
.bar{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-bottom:8px;}
.bar .chip{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:2px 8px;font-size:10px;color:var(--dim);}
.bar .chip b{color:var(--fg);}
.bar .btn{background:var(--panel);border:1px solid var(--border);color:var(--dim);border-radius:10px;padding:2px 8px;font-size:10px;cursor:pointer;}
.bar .btn:hover{color:var(--accent);border-color:var(--accent);}
.sec{margin-bottom:8px;border:1px solid var(--border);border-radius:8px;background:var(--panel);overflow:hidden;}
.sec-h{display:flex;align-items:center;gap:6px;padding:6px 8px;cursor:pointer;user-select:none;font-weight:600;font-size:11px;}
.sec-h .chev{transition:transform .15s;color:var(--dim);font-size:9px;}
.sec.collapsed .chev{transform:rotate(-90deg);}
.sec.collapsed .sec-b{display:none;}
.sec-h .tag{margin-left:auto;color:var(--dim);font-size:9px;}
.sec-b{padding:6px;display:grid;grid-template-columns:repeat(auto-fill,minmax(68px,1fr));gap:5px;}
/* compact tile */
.tile{background:var(--card);border:1px solid var(--border);border-radius:6px;padding:6px 4px;cursor:pointer;transition:all .15s;text-align:center;position:relative;}
.tile:hover{background:var(--card-hover);border-color:var(--accent);transform:translateY(-1px);}
.tile .ic{font-size:14px;line-height:1;}
.tile .lb{font-weight:600;font-size:9.5px;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.tile.warn .lb{color:var(--warn);}
/* expandable group */
.cg{grid-column:1/-1;background:var(--card);border:1px solid var(--border);border-radius:6px;overflow:hidden;}
.cg-h{display:flex;align-items:center;gap:6px;padding:6px 8px;cursor:pointer;transition:background .12s;}
.cg-h:hover{background:var(--card-hover);}
.cg-h .ic{font-size:14px;}
.cg-h .lb{font-weight:600;font-size:10px;flex:1;}
.cg-h .hint{color:var(--dim);font-size:9px;text-align:right;}
.cg-h .arrow{color:var(--dim);font-size:9px;transition:transform .2s;}
.cg.open .arrow{transform:rotate(180deg);}
.cg-b{display:none;padding:5px;border-top:1px solid var(--border);}
.cg.open .cg-b{display:grid;grid-template-columns:repeat(auto-fill,minmax(58px,1fr));gap:4px;}
.sub{background:var(--bg);border:1px solid var(--border);border-radius:5px;padding:5px 3px;cursor:pointer;transition:all .12s;text-align:center;}
.sub:hover{background:var(--card-hover);border-color:var(--accent);}
.sub .sl{font-weight:600;font-size:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.foot{color:var(--dim);font-size:9px;text-align:center;margin-top:6px;}
</style>
</head>
<body>
<h1><span class="logo">QC</span> t('panel.title')</h1>
<div class="sub">t('panel.sub')</div>

<div class="bar" id="bar">
  <span class="chip">t('panel.docker') <b id="st-container">...</b></span>
  <span class="chip">t('panel.artifacts') <b id="st-artifacts">...</b></span>
  <span class="chip">t('panel.last') <b id="st-last">...</b></span>
  <button class="btn" id="refresh">t('panel.refresh')</button>
  <button class="btn" id="popout" title="Open in a separate column, then use VS Code Move-to-New-Window for an OS window">t('panel.popout')</button>
</div>

<!-- BUILD -->
<div class="sec" id="sec-build">
  <div class="sec-h"><span class="chev">v</span> t('sec.build') <span class="tag">Yocto</span></div>
  <div class="sec-b">
    <div class="tile" data-cmd="quecpi.buildconfig" title="source build.sh + buildconfig QSM565DWF rev STD"><div class="ic">gear</div><div class="lb">t('bld.configure')</div></div>
    <div class="tile" data-cmd="quecpi.buildall" title="bitbake qcom-multimedia-image (full image, sstate incremental)"><div class="ic">rocket</div><div class="lb">t('bld.buildall')</div></div>
    <div class="tile warn" data-cmd="quecpi.buildClean" title="rm tmp [+sstate] && rebuild from scratch"><div class="ic">broom</div><div class="lb">t('bld.clean')</div></div>
    <div class="tile" data-cmd="quecpi.buildkernel" title="virtual/kernel -> esp-qcom-image, copy efi.bin"><div class="ic">bricks</div><div class="lb">t('bld.kernel')</div></div>
    <div class="tile" data-cmd="quecpi.builddtb" title="dtb-qcom-image, copy dtb.bin"><div class="ic">clipboard</div><div class="lb">t('bld.dtb')</div></div>
  </div>
</div>

<!-- FLASH -->
<div class="sec" id="sec-flash">
  <div class="sec-h"><span class="chev">v</span> t('sec.flash') <span class="tag">t('dbg.edl') / t('flash.package')</span></div>
  <div class="sec-b">
    <div class="cg" id="cg-flash">
      <div class="cg-h"><span class="ic">fire</span><span class="lb">t('flash.title')</span><span class="hint">t('flash.hint')</span><span class="arrow">v</span></div>
      <div class="cg-b">
        <div class="sub" data-cmd="quecpi.rebootEdl" title="adb reboot edl - enter ${t('dbg.edl')} mode"><div class="sl">t('flash.edl')</div></div>
        <div class="sub" data-cmd="quecpi.flashUfs" title="flash.sh ufs - one-click flash UFS"><div class="sl">t('flash.ufs')</div></div>
        <div class="sub" data-cmd="quecpi.flashEmmc" title="flash.sh emmc - one-click flash eMMC"><div class="sl">t('flash.emmc')</div></div>
        <div class="sub" data-cmd="quecpi.flash" title="Detect ${t('dbg.edl')} device, run qdl with firehose"><div class="sl">t('flash.qdl')</div></div>
      </div>
    </div>
    <div class="tile" data-cmd="quecpi.buildpackage" title="a_key_generation.sh - assemble flashable package"><div class="ic">package</div><div class="lb">t('flash.package')</div></div>
    <div class="tile" data-cmd="quecpi.flashHelp" title="QDL / firehose / partition reference"><div class="ic">plug</div><div class="lb">t('flash.help')</div></div>
  </div>
</div>

<!-- DEVICE DEBUG -->
<div class="sec" id="sec-debug">
  <div class="sec-h"><span class="chev">v</span> t('sec.debug') <span class="tag">adb / AT / t('dbg.audio')</span></div>
  <div class="sec-b">

    <div class="cg" id="cg-log">
      <div class="cg-h"><span class="ic">page</span><span class="lb">t('dbg.log')</span><span class="hint">t('dbg.log') + ' / ' + t('dbg.journal')</span><span class="arrow">v</span></div>
      <div class="cg-b">
        <div class="sub" data-cmd="quecpi.adbCmd" data-args="t('dbg.dmesg') | tail -100" title="Last 100 kernel log lines"><div class="sl">t('dbg.dmesg')</div></div>
        <div class="sub" data-cmd="quecpi.adbTerm" data-args="t('dbg.dmesg') -w" title="Follow kernel log in realtime"><div class="sl">t('dbg.dmesg') -w</div></div>
        <div class="sub" data-cmd="quecpi.adbCmd" data-args="t('dbg.journal') -n 50 --no-pager" title="Last 50 systemd log entries"><div class="sl">t('dbg.journal')</div></div>
        <div class="sub" data-cmd="quecpi.adbTerm" data-args="t('dbg.journal') -f" title="Follow journal in realtime"><div class="sl">t('dbg.journF')</div></div>
      </div>
    </div>

    <div class="cg" id="cg-adb">
      <div class="cg-h"><span class="ic">phone</span><span class="lb">t('dbg.adb')</span><span class="hint">t('dbg.shell') + ' / reboot / ' + t('dbg.edl')</span><span class="arrow">v</span></div>
      <div class="cg-b">
        <div class="sub" data-cmd="quecpi.adbShell" title="Interactive ${t('dbg.shell')} terminal"><div class="sl">t('dbg.shell')</div></div>
        <div class="sub" data-cmd="quecpi.reboot" title="adb reboot"><div class="sl">t('dbg.reboot')</div></div>
        <div class="sub" data-cmd="quecpi.rebootEdl" title="adb reboot edl"><div class="sl">t('dbg.edl')</div></div>
        <div class="sub" data-cmd="quecpi.adbCmd" data-args="t('dbg.devices')" title="List connected adb ${t('dbg.devices')}"><div class="sl">t('dbg.devices')</div></div>
      </div>
    </div>

    <div class="tile" data-cmd="quecpi.serialMonitor" title="picocom /dev/ttyUSB0 @115200 - board console"><div class="ic">antenna</div><div class="lb">t('dbg.serial')</div></div>

    <div class="cg" id="cg-at">
      <div class="cg-h"><span class="ic">robot</span><span class="lb">t('dbg.at')</span><span class="hint">t('dbg.at') + ' send'</span><span class="arrow">v</span></div>
      <div class="cg-b">
        <div class="sub" data-cmd="quecpi.atSend" title="Input AT command and send via serial"><div class="sl">t('dbg.atSend')</div></div>
        <div class="sub" data-cmd="quecpi.atSend" data-args="AT+t('dbg.atQgmr')" title="Query version info"><div class="sl">t('dbg.atQgmr')</div></div>
        <div class="sub" data-cmd="quecpi.atSend" data-args="AT+t('dbg.atQmac')?" title="Query MAC address"><div class="sl">t('dbg.atQmac')</div></div>
      </div>
    </div>

    <div class="cg" id="cg-audio">
      <div class="cg-h"><span class="ic">speaker</span><span class="lb">t('dbg.audio')</span><span class="hint">t('dbg.collect') + ' / agmplay / ' + t('dbg.t('dbg.tinymix')')</span><span class="arrow">v</span></div>
      <div class="cg-b">
        <div class="sub" data-cmd="quecpi.adbCmd" data-args="quectel_build/tools/collect_audio_logs.sh" title="Collect audio debug logs"><div class="sl">t('dbg.collect')</div></div>
        <div class="sub" data-cmd="quecpi.adbCmd" data-args="agmplay --speaker /tmp/test.wav" title="agmplay to speaker"><div class="sl">t('dbg.speaker')</div></div>
        <div class="sub" data-cmd="quecpi.adbCmd" data-args="agmplay --hdmi /tmp/test.wav" title="agmplay to ${t('dbg.hdmi')}"><div class="sl">t('dbg.hdmi')</div></div>
        <div class="sub" data-cmd="quecpi.adbCmd" data-args="agmplay --dp /tmp/test.wav" title="agmplay to ${t('dbg.dp')}"><div class="sl">t('dbg.dp')</div></div>
        <div class="sub" data-cmd="quecpi.adbTerm" data-args="t('dbg.tinymix')" title="Interactive audio mixer"><div class="sl">t('dbg.tinymix')</div></div>
      </div>
    </div>

    <div class="cg" id="cg-tools">
      <div class="cg-h"><span class="ic">camera</span><span class="lb">t('dbg.tools')</span><span class="hint">t('dbg.screenshot') + ' / t('dbg.fps') / GPU / diag'</span><span class="arrow">v</span></div>
      <div class="cg-b">
        <div class="sub" data-cmd="quecpi.screenshot" title="screencap + pull + open"><div class="sl">t('dbg.screenshot')</div></div>
        <div class="sub" data-cmd="quecpi.adbCmd" data-args="dumpsys SurfaceFlinger | grep -i fps" title="Check current ${t('dbg.fps')}"><div class="sl">t('dbg.fps')</div></div>
        <div class="sub" data-cmd="quecpi.adbCmd" data-args="quectel_build/tools/gpu_stress.sh" title="GPU stress test"><div class="sl">t('dbg.gpuStress')</div></div>
        <div class="sub" data-cmd="quecpi.adbTerm" data-args="quectel_build/tools/gpu_monitor.sh 60" title="60s GPU monitor"><div class="sl">t('dbg.gpuMon')</div></div>
        <div class="sub" data-cmd="quecpi.adbCmd" data-args="quectel_build/tools/smart_adb_qxdm_log --start --mask full-filter-audio.cfg" title="Start diag_mdlog with audio mask"><div class="sl">t('dbg.diagStart')</div></div>
        <div class="sub" data-cmd="quecpi.adbCmd" data-args="quectel_build/tools/smart_adb_qxdm_log --stop" title="Stop diag and list logs"><div class="sl">t('dbg.diagStop')</div></div>
      </div>
    </div>

  </div>
</div>

<!-- AI -->
<div class="sec" id="sec-ai">
  <div class="sec-h"><span class="chev">v</span> t('sec.ai') <span class="tag">CodeBuddy</span></div>
  <div class="sec-b">
    <div class="tile" data-openchat="1" title="Chat panel with DeepSeek Harness session context + file/code attachment"><div class="ic">robot</div><div class="lb">t('ai.chat')</div></div>
  </div>
</div>

<div class="foot">t('panel.foot')</div>
<script src="${jsUri}"></script>
</body>
</html>`;
  }
}
