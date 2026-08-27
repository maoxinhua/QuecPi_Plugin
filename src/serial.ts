import * as vscode from 'vscode';
import { runQuiet } from './build';
import { Cfg } from './config';

/**
 * Serial monitor: opens an integrated terminal running the best available
 * serial tool on the HOST (WSL) — the board is attached to the host USB.
 */
export async function openSerialMonitor(): Promise<void> {
  const port = Cfg.serialPort();
  const baud = Cfg.serialBaud();

  // pick a tool
  const which = await runQuiet('bash', ['-lc', 'for t in picocom minicom screen socat; do command -v $t && break; done']);
  const tool = which.trim().split('\n')[0] || '';
  if (!tool) {
    const go = await vscode.window.showWarningMessage(
      'QuecPi: no serial tool (picocom/minicom/screen/socat) found on the host. Install one?',
      'apt install picocom',
      'Cancel'
    );
    if (go === 'apt install picocom') {
      const term = vscode.window.createTerminal({ name: 'apt' });
      term.show();
      term.sendText('sudo apt-get install -y picocom');
    }
    return;
  }

  const base = tool.split('/').pop()!;
  let cmdline: string;
  if (base === 'picocom') cmdline = `picocom -b ${baud} ${port}`;
  else if (base === 'minicom') cmdline = `minicom -D ${port} -b ${baud}`;
  else if (base === 'screen') cmdline = `screen ${port} ${baud}`;
  else cmdline = `socat - UNIX-CONNECT:${port},raw,echo=0,b${baud}`; // approx; socat users usually do stty first

  const term = vscode.window.createTerminal({
    name: `QuecPi Serial ${port}`,
    cwd: Cfg.bspPath() || undefined,
  });
  term.show();
  term.sendText(cmdline);
  vscode.window.showInformationMessage(`QuecPi serial: ${cmdline}`);
}

/** Flash / QDL helper — prints the package layout and flash hints. */
export async function showFlashHelp(): Promise<void> {
  const bsp = Cfg.bspPath();
  const rev = Cfg.projectRev();
  const out = vscode.window.createOutputChannel('QuecPi Flash');
  out.clear();
  out.show(true);
  out.appendLine('QuecPi H1 (QCM6490) — flash / QDL quick reference');
  out.appendLine('='.repeat(60));
  out.appendLine('');
  out.appendLine('After buildpackage, the flashable package is in:');
  out.appendLine(`  ${bsp}/quectel_build/${rev}/`);
  out.appendLine('');
  out.appendLine('Expected contents:');
  out.appendLine('  - prog_firehose_Qcm6490_ddr.elf   (EDL/firehose loader)');
  out.appendLine('  - partition/*.xml                (rawprogram/patch tables)');
  out.appendLine('  - bootbinaries/*                 (xbl/hyp/tz/aop/abl...)');
  out.appendLine('  - <AP images>                    (boot/dtbo/system/vendor...)');
  out.appendLine('');
  out.appendLine('Typical flow (Qualcomm QDL / QPM tool on Windows, or):');
  out.appendLine('  1. Hold the board in EDL mode (force-download), connect USB.');
  out.appendLine('  2. Use QPM (Qualcomm Package Manager) or "qfiledownloader" with');
  out.appendLine('     the firehose loader + rawprogram0.xml + patch0.xml.');
  out.appendLine('  3. Or on Linux: python qdl --storage emmc prog_firehose_Qcm6490_ddr.elf');
  out.appendLine('     $(ls partition/*.xml)');
  out.appendLine('');
  out.appendLine('Kernel command line used by the packaged UKI:');
  out.appendLine('  root=/dev/disk/by-partlabel/system rw rootwait console=ttyMSM0,115200n8');
  out.appendLine('  earlycon qcom_geni_serial.con_enabled=1 kernel.sched_pelt_multiplier=4');
  out.appendLine('  mem_sleep_default=s2idle');
  out.appendLine('');
  out.appendLine('Debug console: ttyMSM0 @ 115200 (QuecPi: QuecPi: Serial Monitor command).');
}
