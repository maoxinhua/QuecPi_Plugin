import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { Cfg } from './config';

/**
 * Host-side device debug commands (adb-based). The board connects via USB to
 * the HOST (not the build container), so these run on the host directly.
 * A generic `adbCmd` covers dmesg/journalctl/audio/GPU etc.; specific
 * commands handle interactive/confirmable actions.
 */

/** Run `adb shell <cmd>` on host, stream output to the channel. */
export async function adbCmd(channel: vscode.OutputChannel, subCmd: string): Promise<void> {
  channel.show(true);
  channel.appendLine(`\n$ adb shell ${subCmd}\n`);
  return new Promise((resolve) => {
    const proc = spawn('adb', ['shell', ...subCmd.split(' ')], { cwd: Cfg.bspPath() || undefined });
    const onData = (d: Buffer) => channel.append(d.toString());
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (e) => {
      channel.appendLine(`\n[错误] adb 不可用: ${e.message}\n请确认 adb 已安装且板子已连接。`);
      resolve();
    });
    proc.on('close', (code) => {
      channel.appendLine(`\n[exit ${code}]`);
      resolve();
    });
  });
}

/** Open an interactive `adb shell` in a VS Code terminal. */
export async function adbShell(): Promise<void> {
  const term = vscode.window.createTerminal({ name: 'QuecPi ADB Shell', cwd: Cfg.bspPath() || undefined });
  term.show();
  term.sendText('adb shell');
}

/** Open a terminal running `adb shell <cmd>` (for follow/interactive commands). */
export async function adbTerm(cmd: string): Promise<void> {
  const term = vscode.window.createTerminal({ name: `QuecPi ${cmd.slice(0, 20)}`, cwd: Cfg.bspPath() || undefined });
  term.show();
  term.sendText(`adb shell ${cmd}`);
}

/** Reboot the device (or into EDL). */
export async function rebootDevice(edl = false): Promise<void> {
  const action = edl ? '重启进 EDL 模式' : '重启设备';
  const confirm = await vscode.window.showWarningMessage(
    `确认${action}？`, { modal: true }, '确认');
  if (confirm !== '确认') return;
  const cmd = edl ? 'reboot edl' : 'reboot';
  const term = vscode.window.createTerminal({ name: `QuecPi ${action}`, cwd: Cfg.bspPath() || undefined });
  term.show();
  term.sendText(`adb shell ${cmd}`);
}

/** Send an AT command via serial port (input dialog, optional pre-fill). */
export async function atSend(channel: vscode.OutputChannel, preFill?: string): Promise<void> {
  const cmd = await vscode.window.showInputBox({
    prompt: '输入 AT 指令（如 AT+QMAC?）',
    placeHolder: 'AT+QGMR',
    ...(preFill ? { value: preFill } : {}),
  });
  if (!cmd) return;
  const port = Cfg.serialPort();
  channel.show(true);
  channel.appendLine(`\n[AT 发送] ${cmd} → ${port}\n`);
  // Use a terminal for interactive serial (picocom sends, user types AT)
  const term = vscode.window.createTerminal({ name: `QuecPi AT`, cwd: Cfg.bspPath() || undefined });
  term.show();
  term.sendText(`echo -n '${cmd}\r' > ${port} && timeout 2 cat ${port}`);
}

/** Screenshot: adb screencap + pull + open. */
export async function screenshot(channel: vscode.OutputChannel): Promise<void> {
  channel.show(true);
  channel.appendLine('\n[截图] adb screencap → pull → 打开\n');
  const localPath = `/tmp/quecpi-screen-$(date +%s).png`;
  const proc = spawn('bash', ['-lc',
    `adb shell screencap -p /sdcard/screen.png && adb pull /sdcard/screen.png ${localPath} && echo "PULLED:${localPath}"`],
    { cwd: Cfg.bspPath() || undefined });
  const onData = (d: Buffer) => channel.append(d.toString());
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  proc.on('close', async (code) => {
    if (code === 0) {
      // Try to open the screenshot
      const uri = vscode.Uri.file(localPath.replace('PULLED:', ''));
      await vscode.commands.executeCommand('vscode.open', uri);
    }
    channel.appendLine(`\n[exit ${code}]`);
  });
}

/** Flash via the BSP's flash.sh (UFS or eMMC). */
export async function flashStorage(channel: vscode.OutputChannel, storage: 'ufs' | 'emmc'): Promise<void> {
  const bsp = Cfg.bspPath();
  const flashScript = `${bsp}/quectel_build/tools/flash.sh`;
  const confirm = await vscode.window.showWarningMessage(
    `确认一键烧录 ${storage.toUpperCase()}？将覆盖板上系统！`, { modal: true }, '确认烧录');
  if (confirm !== '确认烧录') return;
  channel.show(true);
  channel.appendLine(`\n$ ${flashScript} ${storage}\n`);
  return new Promise((resolve) => {
    const proc = spawn('bash', ['-lc', `cd ${bsp} && ./quectel_build/tools/flash.sh ${storage}`]);
    const onData = (d: Buffer) => channel.append(d.toString());
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (e) => {
      channel.appendLine(`\n[错误] ${e.message}\nflash.sh 可能不存在，请确认 quectel_build/tools/flash.sh`);
      resolve();
    });
    proc.on('close', (code) => {
      channel.appendLine(`\n[exit ${code}]`);
      resolve();
    });
  });
}
