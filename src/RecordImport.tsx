import * as DocumentPicker from 'expo-document-picker';
import { File as NativeFile } from 'expo-file-system';
import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Button, Dialog, errorMessage, Field } from './AiTools';
import { mergeImportedActivities, parseRecordsCsv, type ParsedRecords } from './importRecords';
import { dateLabel, ensureCycleCovers, type Activity, type CoachState } from './training';
import { autoClassifyDates } from './autoclassify';

export function RecordImport({ state, onDone, onClose }: {
  state: CoachState;
  onDone: (result: { added: number; duplicates: number; skipped: number; errors: string[]; state: CoachState }) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ParsedRecords | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  async function choose() {
    setNotice('');
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/plain', 'application/csv', 'application/vnd.ms-excel'],
        copyToCacheDirectory: true,
        base64: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      if ((asset.size ?? 0) > 10 * 1024 * 1024) throw new Error('请选择 10 MB 以内的 CSV 文件。');
      const content = Platform.OS === 'web'
        ? await (asset.file ? asset.file.text() : fetch(asset.uri).then((response) => response.text()))
        : await new NativeFile(asset.uri).text();
      setFileName(asset.name);
      setText(content);
      setPreview(parseRecordsCsv(content));
    } catch (error) { setNotice(errorMessage(error)); }
  }

  function analyze() {
    setNotice('');
    const parsed = parseRecordsCsv(text);
    if (!parsed.activities.length && parsed.errors.length) { setNotice(parsed.errors[0]); return; }
    setFileName('');
    setPreview(parsed);
  }

  function commit() {
    if (!preview) return;
    setBusy(true);
    try {
      const merged = mergeImportedActivities(state, preview.activities);
      const dates = merged.added.map((activity: Activity) => activity.date);
      const classified = autoClassifyDates(merged.state, dates).state;
      onDone({
        added: merged.added.length,
        duplicates: merged.duplicates,
        skipped: preview.skipped,
        errors: preview.errors,
        state: ensureCycleCovers(classified, dates),
      });
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  }

  return <Dialog title="导入训练记录" onClose={onClose} footer={preview ? <>
    <Button label={'导入 ' + preview.activities.length + ' 条'} onPress={commit} disabled={busy || !preview.activities.length} />
    <Button secondary label="重新解析" onPress={() => { setPreview(null); setNotice(''); }} />
  </> : <Button label="选择 CSV 文件" onPress={() => void choose()} disabled={busy} />}>
    {!preview ? <>
      <Text style={styles.body}>从 Excel 导出为 CSV（第一行表头需包含：日期、公里、分钟、平均心率、标题、训练内容；列顺序不限）。导入后自动按心率/配速归类，并与已有活动按「同一天 + 里程」去重。</Text>
      <Button secondary label="选择 CSV 文件" onPress={() => void choose()} disabled={busy} />
      {fileName !== '' && <Text style={styles.small}>已选择：{fileName}</Text>}
      <Text style={styles.small}>或直接粘贴 CSV 内容：</Text>
      <Field label="CSV 内容" value={text} onChangeText={setText} multiline placeholder="日期,公里,分钟,平均心率,标题,训练内容" />
      <View style={styles.buttons}><Button secondary label="解析预览" onPress={analyze} disabled={!text.trim()} /></View>
    </> : <>
      <Text style={styles.label}>解析结果</Text>
      <Text style={styles.body}>{preview.activities.length} 条活动{preview.skipped ? '，跳过 ' + preview.skipped + ' 条无里程/时长的行' : ''}{preview.errors.length ? '，' + preview.errors.length + ' 行有问题' : ''}</Text>
      <Text style={styles.small}>日期范围：{preview.activities.length ? preview.activities[0].date + ' ~ ' + preview.activities[preview.activities.length - 1].date : '—'}
        {'  '}总里程：{Math.round(preview.activities.reduce((sum, item) => sum + item.km, 0) * 10) / 10} 公里</Text>
      {preview.activities.slice(0, 5).map((activity) => <View key={activity.id} style={styles.row}>
        <Text style={styles.label}>{activity.date} · {activity.title}</Text>
        <Text style={styles.small}>{activity.km} 公里{activity.minutes ? ' · ' + activity.minutes + ' 分钟' : ''}{activity.averageHr ? ' · 均心率 ' + activity.averageHr : ''}</Text>
      </View>)}
      {preview.errors.slice(0, 3).map((error) => <Text key={error} style={styles.small}>{error}</Text>)}
      <Text style={styles.small}>导入后会出现在「记录」页，并自动归类；与佳明已同步的同一天同里程活动会保留佳明数据。</Text>
    </>}
    {notice !== '' && <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text>}
  </Dialog>;
}

const styles = StyleSheet.create({
  body: { fontSize: 13, lineHeight: 20, color: '#566960' },
  label: { color: '#162f29', fontSize: 14, fontWeight: '700' },
  small: { color: '#566960', fontSize: 12, lineHeight: 18 },
  row: { borderWidth: 1, borderColor: '#dfe7df', borderRadius: 10, padding: 9, gap: 2 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  notice: { backgroundColor: '#e6f1e7', color: '#162f29', fontSize: 13, lineHeight: 19, borderRadius: 8, padding: 10 },
});
