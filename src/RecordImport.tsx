import * as DocumentPicker from 'expo-document-picker';
import { File as NativeFile } from 'expo-file-system';
import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Button, Dialog, errorMessage, Field } from './AiTools';
import { mergeImportedActivities, parseRecordsCsv, type ParsedRecords } from './importRecords';
import { mapTrainingWorkbook, type PlannedRow } from './xlsxImport';
import { autoClassifyDates } from './autoclassify';
import { ensureCycleCovers, makeEntry, type Activity, type CoachState, type PlanEntry } from './training';

type ImportResult = {
  state: CoachState;
  added: number;
  duplicates: number;
  plansAdded: number;
  skipped: number;
  errors: string[];
  source: string;
};

function mergePlans(state: CoachState, plans: PlannedRow[]) {
  const next: PlanEntry[] = [...state.plan];
  let added = 0;
  for (const row of plans) {
    const detail = ('计划 ' + row.km + ' 公里' + (row.detail ? ' · ' + row.detail : '')).slice(0, 300);
    const duplicate = next.some((entry) => entry.date === row.date && entry.current &&
      entry.current.type === row.type && entry.current.detail === detail);
    if (duplicate) continue;
    next.push(makeEntry(row.date, { type: row.type, minutes: 0, detail }));
    added += 1;
  }
  return { plan: next, added };
}

export function RecordImport({ state, onDone, onClose }: {
  state: CoachState;
  onDone: (result: ImportResult) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<{ activities: Activity[]; plans: PlannedRow[]; errors: string[]; skipped: number; source: string } | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  async function readAsset(asset: { name?: string; size?: number; uri: string; file?: File | null }) {
    const name = asset.name || '';
    const extension = name.toLowerCase().split('.').pop();
    if (extension === 'xlsx') {
      if ((asset.size ?? 0) > 15 * 1024 * 1024) throw new Error('请选择 15 MB 以内的 XLSX 文件。');
      const bytes = Platform.OS === 'web'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? new Uint8Array(await ((asset.file ?? await fetch(asset.uri).then((response) => response.blob())) as any).arrayBuffer())
        : await new NativeFile(asset.uri).bytes();
      return { kind: 'xlsx' as const, name, bytes };
    }
    if (extension === 'csv' || extension === 'txt') {
      if ((asset.size ?? 0) > 10 * 1024 * 1024) throw new Error('请选择 10 MB 以内的 CSV 文件。');
      const content = Platform.OS === 'web'
        ? await (asset.file ? asset.file.text() : fetch(asset.uri).then((response) => response.text()))
        : await new NativeFile(asset.uri).text();
      setText(content);
      return { kind: 'csv' as const, name, content };
    }
    throw new Error('请选择 .xlsx、.csv 或 .txt 文件。');
  }

  async function choose() {
    setNotice('');
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'text/plain', 'application/csv'],
        copyToCacheDirectory: true,
        base64: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      setBusy(true);
      const loaded = await readAsset(asset as unknown as { name?: string; size?: number; uri: string; file?: File | null });
      setFileName(loaded.name);
      if (loaded.kind === 'xlsx') {
        const mapped = mapTrainingWorkbook(loaded.bytes ?? new Uint8Array());
        setPreview({ activities: mapped.activities, plans: mapped.plans, errors: mapped.errors,
          skipped: mapped.skipped, source: 'XLSX · ' + (mapped.sheetName || '未识别工作表') });
      } else {
        const parsed: ParsedRecords = parseRecordsCsv(loaded.content ?? '');
        setPreview({ activities: parsed.activities, plans: [], errors: parsed.errors, skipped: parsed.skipped, source: 'CSV' });
      }
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  }

  function analyze() {
    setNotice('');
    const parsed = parseRecordsCsv(text);
    if (!parsed.activities.length && parsed.errors.length) { setNotice(parsed.errors[0]); return; }
    setFileName('');
    setPreview({ activities: parsed.activities, plans: [], errors: parsed.errors, skipped: parsed.skipped, source: 'CSV（粘贴）' });
  }

  function commit() {
    if (!preview) return;
    setBusy(true);
    try {
      const merged = mergeImportedActivities(state, preview.activities);
      const plansMerged = mergePlans(merged.state, preview.plans);
      const dates = [
        ...merged.added.map((activity) => activity.date),
        ...preview.plans.map((plan) => plan.date),
      ];
      const classified = autoClassifyDates({ ...merged.state, plan: plansMerged.plan }, dates).state;
      onDone({
        state: ensureCycleCovers(classified, dates),
        added: merged.added.length,
        duplicates: merged.duplicates,
        plansAdded: plansMerged.added,
        skipped: preview.skipped,
        errors: preview.errors,
        source: preview.source,
      });
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  }

  const totalKm = preview ? preview.activities.reduce((sum, item) => sum + item.km, 0) : 0;

  return <Dialog title="导入训练记录" onClose={onClose} footer={preview ? <>
    <Button label={'导入 ' + preview.activities.length + ' 条' + (preview.plans.length ? ' + ' + preview.plans.length + ' 条计划' : '')} onPress={commit} disabled={busy || (!preview.activities.length && !preview.plans.length)} />
    <Button secondary label="重新选择" onPress={() => { setPreview(null); setNotice(''); }} />
  </> : <Button label={busy ? '读取中…' : '选择 XLSX / CSV 文件'} onPress={() => void choose()} disabled={busy} />}>
    {!preview ? <>
      <Text style={styles.body}>支持 <b>Excel（.xlsx）</b> 和 CSV。XLSX 会读取「训练计划」这类工作表，识别「日期 / 计划公里 / 跑步主课 / 实际跑步 / 历史分段」列，同时导入<b>历史活动</b>和<b>课表计划</b>。导入后自动按心率/配速归类，并与已有活动按「同一天 + 里程 + 时长」去重。</Text>
      <Button secondary label={busy ? '读取中…' : '选择 XLSX / CSV 文件'} onPress={() => void choose()} disabled={busy} />
      {fileName !== '' && <Text style={styles.small}>已选择：{fileName}</Text>}
      <Text style={styles.small}>或粘贴 CSV 内容：</Text>
      <Field label="CSV 内容" value={text} onChangeText={setText} multiline placeholder="日期,公里,分钟,平均心率,标题,训练内容" />
      <View style={styles.buttons}><Button secondary label="解析预览" onPress={analyze} disabled={!text.trim()} /></View>
    </> : <>
      <Text style={styles.label}>解析结果 · {preview.source}</Text>
      <Text style={styles.body}>{preview.activities.length} 条活动 · {preview.plans.length} 条计划
        {preview.skipped ? ' · ' + preview.skipped + ' 条缺时长' : ''}{preview.errors.length ? ' · ' + preview.errors.length + ' 条问题' : ''}</Text>
      <Text style={styles.small}>日期范围：{preview.activities.length ? preview.activities[0].date + ' ~ ' + preview.activities[preview.activities.length - 1].date : '—'}
        {'  '}总里程：{Math.round(totalKm * 10) / 10} 公里</Text>
      {preview.activities.slice(0, 4).map((activity) => <View key={activity.id} style={styles.row}>
        <Text style={styles.label}>{activity.date} · {activity.title}</Text>
        <Text style={styles.small}>{activity.km} 公里{activity.minutes ? ' · ' + activity.minutes + ' 分钟' : ''}{activity.averageHr ? ' · 均心率 ' + activity.averageHr : ''}</Text>
      </View>)}
      {preview.plans.length > 0 && <Text style={styles.small}>计划示例：{preview.plans.slice(0, 2).map((plan) => plan.date + ' ' + plan.type + ' ' + plan.km + ' 公里').join('；')}</Text>}
      {preview.errors.slice(0, 3).map((error) => <Text key={error} style={styles.small}>{error}</Text>)}
      <Text style={styles.small}>导入后活动出现在「记录」页，计划写入对应日期课表并自动扩展训练周期。</Text>
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
