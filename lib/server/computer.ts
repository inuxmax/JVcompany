// Điều khiển máy tính: chụp màn hình, chuột, bàn phím, mở ứng dụng/URL (Windows, macOS, Linux).
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { IS_MAC, IS_WIN, runProcess, which } from './platform';
import { LocalizedError } from './http';
import { m } from '../i18n';

interface ScreenGeometry {
  left: number;
  top: number;
  /** Hệ số đổi từ tọa độ ảnh chụp sang tọa độ màn hình thật. */
  factor: number;
  width: number;
  height: number;
}

const g = globalThis as unknown as { __vpScreen?: ScreenGeometry };
const MAX_WIDTH = 1280;

const PS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'];

const PS_NATIVE = `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type @"
using System;using System.Runtime.InteropServices;
public class JvNative{
[DllImport("user32.dll")]public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);
[DllImport("user32.dll")]public static extern void mouse_event(uint f,uint dx,uint dy,uint d,UIntPtr e);
}
"@
[JvNative]::SetProcessDPIAware() | Out-Null
`;

async function ps(script: string, env: Record<string, string> = {}) {
  const r = await runProcess('powershell.exe', [...PS, script], { env, timeoutMs: 30_000, raw: true });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout || r.error || 'PowerShell lỗi').trim().slice(0, 800));
  return r.stdout.trim();
}

async function osa(args: string[]) {
  const r = await runProcess('osascript', args, { timeoutMs: 30_000, raw: true });
  if (r.code !== 0) throw new Error((r.stderr || r.error || 'osascript lỗi').trim().slice(0, 800));
  return r.stdout.trim();
}

/** Phiên Wayland trên Linux: xdotool không điều khiển được chuột/bàn phím. */
function isWayland(): boolean {
  return !IS_WIN && !IS_MAC && (process.env.XDG_SESSION_TYPE === 'wayland' || Boolean(process.env.WAYLAND_DISPLAY));
}

/** macOS: kiểm tra trước quyền hệ thống (không có quyền thì công cụ vẫn "thành công" nhưng ảnh trống / click không tác dụng). */
async function macPermission(kind: 'screen' | 'accessibility'): Promise<void> {
  const js =
    kind === 'screen'
      ? 'ObjC.import("CoreGraphics"); $.CGPreflightScreenCaptureAccess()'
      : 'ObjC.import("ApplicationServices"); $.AXIsProcessTrusted()';
  const r = await runProcess('osascript', ['-l', 'JavaScript', '-e', js], { timeoutMs: 10_000, raw: true });
  // Không kiểm tra được (macOS cũ…) → bỏ qua, để công cụ tự báo lỗi
  if (r.code !== 0 || !/^(true|false)$/.test(r.stdout.trim())) return;
  if (r.stdout.trim() === 'true') return;
  throw new Error(
    kind === 'screen'
      ? 'macOS chưa cấp quyền Ghi màn hình (Screen Recording) cho ứng dụng chạy JVCompany (Terminal / Electron). Bật trong Cài đặt hệ thống → Quyền riêng tư & bảo mật → Ghi màn hình, rồi khởi động lại ứng dụng.'
      : 'macOS chưa cấp quyền Trợ năng (Accessibility) cho ứng dụng chạy JVCompany – không điều khiển được chuột/bàn phím. Bật trong Cài đặt hệ thống → Quyền riêng tư & bảo mật → Trợ năng.',
  );
}

/** Kích thước ảnh PNG đọc từ đầu tệp (byte 16–23) – không cần ImageMagick. */
function pngSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

async function xdotool(args: string[]) {
  if (isWayland()) throw new Error('Máy đang dùng phiên Wayland – xdotool không điều khiển được chuột/bàn phím. Đăng nhập phiên X11 (Xorg) để agent điều khiển máy tính.');
  if (!which('xdotool')) throw new Error('Cần cài xdotool (sudo apt install xdotool) để điều khiển chuột/bàn phím trên Linux.');
  const r = await runProcess('xdotool', args, { timeoutMs: 30_000, raw: true });
  if (r.code !== 0) throw new Error((r.stderr || r.error || 'xdotool lỗi').trim().slice(0, 800));
  return r.stdout.trim();
}

export interface Screenshot {
  base64: string;
  width: number;
  height: number;
  note: string;
}

export async function screenshot(): Promise<Screenshot> {
  const file = path.join(os.tmpdir(), `jv-shot-${Date.now()}.png`);
  try {
    if (IS_WIN) {
      const out = await ps(
        `${PS_NATIVE}
$b=[System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height
$gr=[System.Drawing.Graphics]::FromImage($bmp)
$gr.CopyFromScreen($b.Left,$b.Top,0,0,$bmp.Size)
$scale=[Math]::Min(1.0,${MAX_WIDTH}/$b.Width)
$w=[int]($b.Width*$scale);$h=[int]($b.Height*$scale)
$o=New-Object System.Drawing.Bitmap $w,$h
$g2=[System.Drawing.Graphics]::FromImage($o)
$g2.InterpolationMode='HighQualityBicubic'
$g2.DrawImage($bmp,0,0,$w,$h)
$o.Save($env:JV_OUT,[System.Drawing.Imaging.ImageFormat]::Png)
Write-Output "$($b.Left),$($b.Top),$($b.Width),$($b.Height),$w,$h"`,
        { JV_OUT: file },
      );
      const [left, top, W, , w, h] = out.split(/\r?\n/).pop()!.split(',').map(Number);
      g.__vpScreen = { left, top, factor: W / w, width: w, height: h };
    } else if (IS_MAC) {
      await macPermission('screen');
      const r = await runProcess('screencapture', ['-x', '-t', 'png', file], { timeoutMs: 20_000, raw: true });
      if (r.code !== 0) throw new Error(r.stderr || 'screencapture lỗi (cần cấp quyền Screen Recording)');
      await runProcess('sips', ['-Z', String(MAX_WIDTH), file], { timeoutMs: 20_000, raw: true });
      const dims = await runProcess('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { raw: true });
      const w = Number(/pixelWidth: (\d+)/.exec(dims.stdout)?.[1] ?? MAX_WIDTH);
      const h = Number(/pixelHeight: (\d+)/.exec(dims.stdout)?.[1] ?? 800);
      const bounds = await osa(['-e', 'tell application "Finder" to get bounds of window of desktop']).catch(() => '');
      const pts = bounds.split(',').map((s) => Number(s.trim()));
      const W = pts.length === 4 ? pts[2] - pts[0] : w;
      g.__vpScreen = { left: 0, top: 0, factor: W / w, width: w, height: h };
    } else {
      const x11: [string, string[]][] = [
        ['gnome-screenshot', ['-f', file]],
        ['scrot', ['-o', file]],
        ['import', ['-window', 'root', file]],
        ['grim', [file]],
      ];
      // Wayland: scrot / import chụp ra ảnh đen → ưu tiên grim, gnome-screenshot
      const tools = isWayland() ? x11.filter(([t]) => t === 'grim' || t === 'gnome-screenshot').sort((a) => (a[0] === 'grim' ? -1 : 1)) : x11;
      const tool = tools.find(([t]) => which(t));
      if (!tool) throw new Error(isWayland() ? 'Phiên Wayland: cần cài grim (hoặc gnome-screenshot) để chụp màn hình.' : 'Cần cài gnome-screenshot, scrot, ImageMagick (import) hoặc grim để chụp màn hình.');
      const r = await runProcess(tool[0], tool[1], { timeoutMs: 20_000, raw: true });
      if (r.code !== 0) throw new Error(r.stderr || 'Chụp màn hình lỗi');
      if (which('convert')) await runProcess('convert', [file, '-resize', `${MAX_WIDTH}x>`, file], { raw: true });
      // Kích thước ảnh sau khi thu nhỏ (đọc từ PNG) và kích thước màn hình thật (trước khi thu nhỏ)
      const shot = pngSize(await fs.readFile(file));
      const w = shot?.w ?? MAX_WIDTH;
      const h = shot?.h ?? 800;
      let W = w;
      if (which('xdpyinfo') && !isWayland()) {
        const info = await runProcess('xdpyinfo', [], { raw: true });
        W = Number(/dimensions:\s+(\d+)x/.exec(info.stdout)?.[1] ?? w);
      }
      g.__vpScreen = { left: 0, top: 0, factor: W / w, width: w, height: h };
    }
    const buf = await fs.readFile(file);
    const geo = g.__vpScreen!;
    return {
      base64: buf.toString('base64'),
      width: geo.width,
      height: geo.height,
      note: `Ảnh màn hình ${geo.width}x${geo.height}px. Dùng đúng tọa độ trên ảnh này khi click.`,
    };
  } finally {
    fs.unlink(file).catch(() => {});
  }
}

function toScreen(x: number, y: number): [number, number] {
  const geo = g.__vpScreen ?? { left: 0, top: 0, factor: 1, width: 0, height: 0 };
  return [Math.round(geo.left + x * geo.factor), Math.round(geo.top + y * geo.factor)];
}

export async function mouseClick(x: number, y: number, button: 'left' | 'right' | 'middle' = 'left', double = false) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Tọa độ không hợp lệ');
  const [sx, sy] = toScreen(x, y);
  if (IS_WIN) {
    const flags = { left: [0x02, 0x04], right: [0x08, 0x10], middle: [0x20, 0x40] }[button];
    const once = `[JvNative]::mouse_event(${flags[0]},0,0,0,[UIntPtr]::Zero);[JvNative]::mouse_event(${flags[1]},0,0,0,[UIntPtr]::Zero);`;
    await ps(`${PS_NATIVE}[JvNative]::SetCursorPos(${sx},${sy})|Out-Null;Start-Sleep -Milliseconds 60;${once}${double ? `Start-Sleep -Milliseconds 80;${once}` : ''}`);
  } else if (IS_MAC) {
    await macPermission('accessibility');
    const [downEv, upEv, btn] =
      button === 'right'
        ? ['kCGEventRightMouseDown', 'kCGEventRightMouseUp', 'kCGMouseButtonRight']
        : button === 'middle'
          ? ['kCGEventOtherMouseDown', 'kCGEventOtherMouseUp', 'kCGMouseButtonCenter']
          : ['kCGEventLeftMouseDown', 'kCGEventLeftMouseUp', 'kCGMouseButtonLeft'];
    const js = `ObjC.import('CoreGraphics');function run(a){const p={x:+a[0],y:+a[1]};const n=+a[2];for(let i=0;i<n;i++){const d=$.CGEventCreateMouseEvent(null,$.${downEv},p,$.${btn});const u=$.CGEventCreateMouseEvent(null,$.${upEv},p,$.${btn});if(i>0){$.CGEventSetIntegerValueField(d,$.kCGMouseEventClickState,2);$.CGEventSetIntegerValueField(u,$.kCGMouseEventClickState,2);}$.CGEventPost($.kCGHIDEventTap,d);$.CGEventPost($.kCGHIDEventTap,u);}}`;
    await osa(['-l', 'JavaScript', '-e', js, String(sx), String(sy), double ? '2' : '1']);
  } else {
    const b = { left: '1', middle: '2', right: '3' }[button];
    await xdotool(['mousemove', String(sx), String(sy), 'click', ...(double ? ['--repeat', '2'] : []), b]);
  }
  return `Đã ${double ? 'double-' : ''}click ${button} tại (${x}, ${y}).`;
}

function sendKeysEscape(text: string): string {
  return text.replace(/[+^%~(){}[\]]/g, (c) => `{${c}}`).replace(/\r?\n/g, '{ENTER}').replace(/\t/g, '{TAB}');
}

export async function typeText(text: string) {
  if (IS_WIN) {
    await ps(`Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.SendKeys]::SendWait($env:JV_TEXT)`, {
      JV_TEXT: sendKeysEscape(text),
    });
  } else if (IS_MAC) {
    await macPermission('accessibility');
    await osa(['-e', 'on run argv', '-e', 'tell application "System Events" to keystroke (item 1 of argv)', '-e', 'end run', text]);
  } else {
    await xdotool(['type', '--delay', '12', '--', text]);
  }
  return `Đã gõ ${text.length} ký tự.`;
}

const WIN_KEYS: Record<string, string> = {
  enter: '{ENTER}', return: '{ENTER}', tab: '{TAB}', esc: '{ESC}', escape: '{ESC}', backspace: '{BACKSPACE}',
  delete: '{DELETE}', del: '{DELETE}', up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}', home: '{HOME}',
  end: '{END}', pageup: '{PGUP}', pagedown: '{PGDN}', space: ' ', insert: '{INSERT}',
};
const MAC_KEYCODES: Record<string, number> = {
  enter: 36, return: 36, tab: 48, esc: 53, escape: 53, backspace: 51, delete: 117, up: 126, down: 125, left: 123,
  right: 124, home: 115, end: 119, pageup: 116, pagedown: 121, space: 49,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111,
};

/** Nhấn tổ hợp phím, ví dụ "ctrl+s", "alt+tab", "enter", "cmd+shift+4". */
export async function pressKeys(combo: string) {
  const parts = combo.toLowerCase().split('+').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) throw new Error('Thiếu phím');
  const key = parts.pop()!;
  const mods = parts;
  if (IS_WIN) {
    const modMap: Record<string, string> = { ctrl: '^', control: '^', shift: '+', alt: '%' };
    if (mods.some((m) => !(m in modMap))) throw new Error('Windows chỉ hỗ trợ ctrl/shift/alt làm phím bổ trợ.');
    let k = WIN_KEYS[key] ?? (/^f\d{1,2}$/.test(key) ? `{${key.toUpperCase()}}` : key.length === 1 ? sendKeysEscape(key) : null);
    if (!k) throw new Error(`Phím không hỗ trợ: ${key}`);
    if (mods.length && k.length === 1) k = k.toLowerCase();
    await ps(`Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.SendKeys]::SendWait($env:JV_KEYS)`, {
      JV_KEYS: mods.map((m) => modMap[m]).join('') + k,
    });
  } else if (IS_MAC) {
    await macPermission('accessibility');
    const modMap: Record<string, string> = { cmd: 'command down', command: 'command down', ctrl: 'control down', control: 'control down', shift: 'shift down', alt: 'option down', option: 'option down' };
    const using = mods.map((m) => modMap[m]).filter(Boolean);
    const usingClause = using.length ? ` using {${using.join(', ')}}` : '';
    const action = key in MAC_KEYCODES ? `key code ${MAC_KEYCODES[key]}` : `keystroke (item 1 of argv)`;
    await osa(['-e', 'on run argv', '-e', `tell application "System Events" to ${action}${usingClause}`, '-e', 'end run', key]);
  } else {
    const map: Record<string, string> = { enter: 'Return', return: 'Return', esc: 'Escape', escape: 'Escape', backspace: 'BackSpace', delete: 'Delete', pageup: 'Prior', pagedown: 'Next', space: 'space', up: 'Up', down: 'Down', left: 'Left', right: 'Right', home: 'Home', end: 'End', tab: 'Tab' };
    const modMap: Record<string, string> = { cmd: 'super', win: 'super', super: 'super', ctrl: 'ctrl', control: 'ctrl', shift: 'shift', alt: 'alt' };
    const k = map[key] ?? key;
    await xdotool(['key', [...mods.map((m) => modMap[m] ?? m), k].join('+')]);
  }
  return `Đã nhấn ${combo}.`;
}

/** Mở URL, tệp, thư mục hoặc ứng dụng bằng trình mặc định của hệ điều hành. */
export async function openTarget(target: string) {
  if (!target.trim()) throw new LocalizedError(m('Thiếu đích cần mở'));
  if (IS_WIN) {
    await ps('Start-Process -FilePath $env:JV_TARGET', { JV_TARGET: target });
  } else if (IS_MAC) {
    const isApp = !/^[a-z]+:\/\//i.test(target) && !target.includes('/') && !target.includes('.');
    const r = await runProcess('open', isApp ? ['-a', target] : [target], { timeoutMs: 20_000, raw: true });
    if (r.code !== 0) throw new Error(r.stderr || m('Không mở được'));
  } else {
    const r = await runProcess(which('xdg-open') ? 'xdg-open' : 'gio', which('xdg-open') ? [target] : ['open', target], {
      timeoutMs: 20_000,
      raw: true,
    });
    if (r.code !== 0) throw new Error(r.stderr || m('Không mở được'));
  }
  return `Đã mở: ${target}`;
}
