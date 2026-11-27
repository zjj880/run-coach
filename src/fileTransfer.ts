import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { bundleFilename } from './dataBundle';

/** 跨平台文件收放：网页/电脑用下载与文件选择，手机用分享面板与文件选择。 */

export async function shareBundleText(text: string): Promise<'shared' | 'downloaded'> {
  const name = bundleFilename();
  if (Platform.OS === 'web') {
    const blob = new Blob([text], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return 'downloaded';
  }
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(text);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType: 'application/octet-stream', dialogTitle: '发送数据包' });
    return 'shared';
  }
  throw new Error('这台设备不支持分享文件，可以改用局域网同步。');
}

export async function pickBundleText(): Promise<{ text: string; name: string } | undefined> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/octet-stream', 'application/json', 'text/plain'],
    copyToCacheDirectory: true,
    base64: false,
  });
  if (result.canceled) return undefined;
  const asset = result.assets[0];
  if (!asset) return undefined;
  if ((asset.size ?? 0) > 40 * 1024 * 1024) throw new Error('数据包超过 40 MB，请改用局域网同步。');
  const text = Platform.OS === 'web'
    ? await (asset.file ? asset.file.text() : fetch(asset.uri).then((response) => response.text()))
    : await new File(asset.uri).text();
  return { text, name: asset.name };
}
