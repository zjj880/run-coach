import { Linking, Platform } from 'react-native';

/** 用系统浏览器打开外部页面：桌面端由 Electron 白名单转交 shell.openExternal。 */
export async function openExternal(url: string): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    await Linking.openURL(url);
  } catch {
    // 打开失败时静默，由调用方提示用户手动访问
  }
}

/** 读取剪贴板文本（手机用 expo-clipboard，浏览器用 navigator.clipboard）。 */
export async function readClipboardText(): Promise<string> {
  try {
    if (Platform.OS === 'web') {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
        return (await navigator.clipboard.readText()).trim();
      }
      return '';
    }
    const clipboard = await import('expo-clipboard');
    return (await clipboard.getStringAsync()).trim();
  } catch {
    return '';
  }
}

/** 把文本写进剪贴板，便于「复制链接发到电脑/手机」。 */
export async function writeClipboardText(text: string): Promise<boolean> {
  try {
    if (Platform.OS === 'web') {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      return false;
    }
    const clipboard = await import('expo-clipboard');
    await clipboard.setStringAsync(text);
    return true;
  } catch {
    return false;
  }
}
