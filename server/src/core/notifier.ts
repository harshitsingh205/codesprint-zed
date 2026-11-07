import { spawn } from 'node:child_process';
import { Notifier } from './timerService';

/**
 * Best-effort native desktop notification. Zed extensions cannot show
 * notifications themselves, so the server does it with the OS tooling that is
 * already present. Text is passed through arguments or environment variables,
 * never through a shell, so it cannot be interpreted as a command.
 */
export class DesktopNotifier implements Notifier {
  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  notify(title: string, body: string): void {
    try {
      const [command, args, env] = this.buildCommand(title, body);
      const child = spawn(command, args, {
        stdio: 'ignore',
        windowsHide: true,
        detached: false,
        env: { ...process.env, ...env },
      });
      child.on('error', () => undefined); // missing tool: stay silent, the tools still report completion
      child.unref();
    } catch {
      /* notifications must never crash the server */
    }
  }

  buildCommand(title: string, body: string): [string, string[], Record<string, string>] {
    switch (this.platform) {
      case 'darwin': {
        const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        return ['osascript', ['-e', `display notification "${esc(body)}" with title "${esc(title)}"`], {}];
      }
      case 'win32': {
        const script =
          'Add-Type -AssemblyName System.Windows.Forms;' +
          '$n = New-Object System.Windows.Forms.NotifyIcon;' +
          '$n.Icon = [System.Drawing.SystemIcons]::Information;' +
          '$n.Visible = $true;' +
          '$n.ShowBalloonTip(8000, $env:CS_TITLE, $env:CS_BODY, [System.Windows.Forms.ToolTipIcon]::None);' +
          'Start-Sleep -Seconds 9; $n.Dispose()';
        return ['powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { CS_TITLE: title, CS_BODY: body }];
      }
      default:
        return ['notify-send', ['--app-name=CodeSprint', '--', title, body], {}];
    }
  }
}

export class NullNotifier implements Notifier {
  notify(): void {
    /* intentionally empty */
  }
}
