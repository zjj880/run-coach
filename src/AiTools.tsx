import * as DocumentPicker from 'expo-document-picker';
import { File as NativeFile } from 'expo-file-system';
import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { dateIsValid, isDefaultDemoPlan, workoutTypes, type ImportRow, type PlanEntry } from './training';
import { canReviewTraining, type SavedReview, type TrainingReview, type TrainingReviewInput } from './evaluation';
import { FitReview } from './FitReview';
import type { Activity } from './training';

const localEndpoint = 'http://127.0.0.1:8091';
export function isWindowsDesktop() {
  return Platform.OS === 'web' && typeof window !== 'undefined' &&
    window.location.protocol === 'run-coach:' && window.location.hostname === 'app';
}
const maxImageBytes = 5 * 1024 * 1024;
const segmentLabels: Record<string, string> = {
  INTERVAL_WARMUP: '热身', INTERVAL_ACTIVE: '工作段', INTERVAL_RECOVERY: '恢复段',
  INTERVAL_REST: '休息段', INTERVAL_COOLDOWN: '冷身', RUN: '跑步', WALK: '步行',
};
type Config = { configured: true; endpoint: string; model: string } | { configured: false };
type RowDraft = Omit<ImportRow, 'minutes'> & { minutes: string; skip: boolean };
type SelectedSource = { name: string; image?: string };

export async function aiRequest<T>(path: string, method = 'GET', body?: object): Promise<T> {
  let response: Response;
  try {
    response = await fetch((isWindowsDesktop() ? '' : localEndpoint) + path, {
      method,
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
  } catch {
    if (isWindowsDesktop()) throw new Error('电脑版本的本机服务暂时无法连接，请重新打开 App。');
    throw new Error(path.startsWith('/garmin') ? '连不上本机佳明同步服务，请在电脑上运行 npm run ai。' : '连不上本机 AI 服务，请在电脑上运行 npm run ai。');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || 'AI 服务返回异常，请重试。');
  return data as T;
}

export const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。';

export async function requestMoodReply(mood: string, note: string) {
  const { reply } = await aiRequest<{ reply: string }>('/ai/mood', 'POST', { mood, note });
  return reply;
}

export function Button({ label, onPress, secondary = false, disabled = false }: {
  label: string; onPress: () => void; secondary?: boolean; disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled}
    style={[styles.button, secondary && styles.secondary, disabled && styles.disabled]}>
    <Text style={secondary ? styles.secondaryText : styles.buttonText}>{label}</Text>
  </Pressable>;
}

export function Field({ label, value, onChangeText, placeholder, secure = false, multiline = false, maxLength }: {
  label: string; value: string; onChangeText: (text: string) => void; placeholder?: string; secure?: boolean; multiline?: boolean; maxLength?: number;
}) {
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} placeholder={placeholder}
      placeholderTextColor="#607168" autoCapitalize="none" autoCorrect={false} secureTextEntry={secure}
      multiline={multiline} maxLength={maxLength} style={[styles.input, multiline && styles.multiline]} />
  </View>;
}

export function Dialog({ title, children, footer, onClose, followContent }: {
  title: string; children: ReactNode; footer?: ReactNode; onClose: () => void; followContent?: boolean;
}) {
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.overlay}>
      <View style={styles.panel}>
        <View style={styles.between}>
          <Text accessibilityRole="header" style={styles.heading}>{title}</Text>
          <Button secondary label="关闭" onPress={onClose} />
        </View>
        <ScrollView ref={scroll} onContentSizeChange={followContent ? () => scroll.current?.scrollToEnd() : undefined}
          style={styles.scroll} contentContainerStyle={styles.fields} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        {footer && <View style={styles.buttons}>{footer}</View>}
      </View>
    </View>
  </Modal>;
}

export function AiSettings({ onClose }: { onClose: () => void }) {
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [config, setConfig] = useState<Config>({ configured: false });
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let mounted = true;
    aiRequest<Config>('/ai/settings').then((result) => {
      if (!mounted) return;
      setConfig(result);
      if (result.configured) {
        setBaseUrl(result.endpoint);
        setModel(result.model);
      }
    }).catch((error) => { if (mounted) setNotice(errorMessage(error)); })
      .finally(() => { if (mounted) setBusy(false); });
    return () => { mounted = false; };
  }, []);

  async function testAndSave() {
    setBusy(true);
    setNotice('');
    try {
      const saved = await aiRequest<Config>('/ai/settings', 'POST', { baseUrl, model, apiKey });
      setConfig(saved);
      setApiKey('');
      setNotice('连接测试通过，可以去「课表」识别导入。');
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  }

  async function disconnect() {
    setBusy(true);
    try {
      setConfig(await aiRequest<Config>('/ai/settings', 'DELETE'));
      setApiKey('');
      setNotice('已断开 AI 接口。');
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  }

  return <Dialog title="AI 接口" onClose={onClose} footer={<>
    <Button label={busy ? '处理中…' : '测试并保存'} onPress={testAndSave}
      disabled={busy || !baseUrl.trim() || !model.trim() || (!config.configured && !apiKey.trim())} />
    {config.configured && <Button secondary label="断开连接" onPress={disconnect} disabled={busy} />}
  </>}>
    <Text style={styles.body}>用于识别课表、评估训练和回应心情。填写兼容 Chat Completions 的服务地址、模型和 API 密钥。识别图片时请选择支持看图的模型。</Text>
    <Text style={styles.label}>{config.configured ? '已连接 · ' + config.model : '尚未连接'}</Text>
    <Field label="接口地址" value={baseUrl} onChangeText={setBaseUrl} placeholder="https://你的服务商域名/v1" />
    <Field label="模型" value={model} onChangeText={setModel} placeholder="填写服务商给出的模型名称" />
    <Field label="API 密钥" value={apiKey} onChangeText={setApiKey} secure placeholder={config.configured ? '地址不变时可留空复用' : '填写 AI 服务商的 API 密钥'} />
    <Text style={styles.body}>{isWindowsDesktop() ? '接口设置保存在这台电脑上，密钥由 Windows 加密。' : '密钥仅保留在电脑本机 AI 服务的内存中。重启该服务后需要重新填写。'}</Text>
    {notice !== '' && <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text>}
  </Dialog>;
}

export function TrainingReviewDialog({ input, activities, saved, onSave, onClose, onLoadDetails, onFeedback }: {
  input: TrainingReviewInput; saved?: SavedReview; onSave: (review: SavedReview) => void; onClose: () => void;
  activities: Activity[]; onFeedback: (activity: Activity) => void;
  onLoadDetails?: () => Promise<{ details: number; parsed: number; requested: number }>;
}) {
  const [busy, setBusy] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [notice, setNotice] = useState('');
  const signature = JSON.stringify(input);
  const stale = saved && saved.signature !== signature;
  const primary = input.activities.find((activity) => activity.role === '主课');
  const ready = canReviewTraining(input);

  async function evaluate() {
    setBusy(true);
    setNotice('');
    try {
      const { review } = await aiRequest<{ review: TrainingReview }>('/ai/review', 'POST', input);
      onSave({ review, signature, reviewedAt: new Date().toISOString() });
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  }

  async function loadDetails() {
    if (!onLoadDetails) return;
    setLoadingDetails(true);
    setNotice('');
    try {
      const { details, parsed, requested } = await onLoadDetails();
      setNotice(`收到 ${details} 条佳明明细，成功解析 ${parsed}/${requested} 条 FIT。` +
        (parsed < requested ? ' 其余活动可用已同步数据和体感评估。' : ''));
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setLoadingDetails(false); }
  }

  return <Dialog title="训练数据评估" onClose={onClose} footer={<>
    {onLoadDetails && <Button secondary label={loadingDetails ? '正在读取…' : '同步佳明明细与 FIT'} disabled={busy || loadingDetails} onPress={() => void loadDetails()} />}
    <Button label={busy ? '正在评估…' : saved ? '重新评估' : '用 AI 评估'} disabled={busy || loadingDetails || !ready} onPress={evaluate} />
  </>}>
    <Text style={styles.body}>{input.date} · {input.activities.length} 条活动 · {input.total.minutes} 分钟 · {input.total.km} 公里</Text>
    {primary && <Text style={styles.body}>
      主课 · {primary.title}{primary.core ? ' · 核心段 ' + primary.core : ''}{primary.averageHr ? ' · 平均心率 ' + primary.averageHr + ' 次/分' : ''}
    </Text>}
    {activities.map((activity) => {
      const { detail, fit, feedback, title, time, role } = activity;
      return <View key={activity.id} style={styles.field}>
      <Text style={styles.label}>{title} · {time} · {role}</Text>
      {feedback && <Text style={styles.body}>{[
        feedback.effort !== null && 'RPE ' + feedback.effort + '/10',
        feedback.sensor !== '未注明' && feedback.sensor,
        feedback.heartRateTrust !== '未评估' && '心率' + feedback.heartRateTrust,
        feedback.cold && '天气偏冷', feedback.note,
      ].filter(Boolean).join(' · ')}</Text>}
      <View style={styles.buttons}><Button secondary label={feedback ? '修改这节课体感' : '填写这节课体感'} onPress={() => onFeedback(activity)}
        disabled={busy || loadingDetails} /></View>
      {detail && <Text style={styles.body}>{[
        detail.maxHr && '最高心率 ' + Math.round(detail.maxHr) + ' 次/分',
        detail.runningCadenceSpm && '平均步频 ' + Math.round(detail.runningCadenceSpm) + ' 步/分',
        detail.strideLengthCm && '步幅 ' + Math.round(detail.strideLengthCm) + ' 厘米',
        detail.elevationGainM && '爬升 ' + Math.round(detail.elevationGainM) + ' 米',
        detail.averagePowerW && '均功率 ' + Math.round(detail.averagePowerW) + ' 瓦',
        detail.movingSeconds && '移动 ' + Math.round(detail.movingSeconds / 60) + ' 分钟',
        detail.aerobicTrainingEffect && '有氧效果 ' + detail.aerobicTrainingEffect,
        detail.anaerobicTrainingEffect && '无氧效果 ' + detail.anaerobicTrainingEffect,
      ].filter(Boolean).join(' · ')}</Text>}
      {detail?.segmentTotals?.map((segment, index) => <Text key={index} style={styles.body}>{[
        '分段汇总 · ' + (segmentLabels[segment.type] ?? segment.type),
        segment.count && segment.count + ' 段',
        segment.seconds && Math.round(segment.seconds) + ' 秒',
        segment.meters && Math.round(segment.meters) + ' 米',
        segment.averageHr && '平均心率 ' + Math.round(segment.averageHr) + ' 次/分',
      ].filter(Boolean).join(' · ')}</Text>)}
      {fit ? <FitReview fit={fit} /> : activity.id.startsWith('garmin-cn-') && <Text style={styles.body}>暂无 FIT 圈记录或曲线。</Text>}
    </View>;
    })}
    {!ready && <Text style={styles.notice}>{input.activities.length ? '请先在课表确认当天各条活动的归属。' : '当天没有可评估的活动记录。'}</Text>}
    {stale && <Text style={styles.notice}>当天课表、活动数据或体感已更新，下方是上一次评估。</Text>}
    {saved && <>
      <Text style={styles.label}>{saved.review.summary}</Text>
      <Text style={styles.body}>评估时间 · {new Date(saved.reviewedAt).toLocaleString('zh-CN')}</Text>
      {([
        ['计划与执行', saved.review.execution], ['配速与心率', saved.review.intensity],
        ['下次建议', saved.review.next], ['数据局限', saved.review.limitations],
      ] as const).map(([label, message]) => <View key={label} style={styles.field}>
        <Text style={styles.label}>{label}</Text><Text style={styles.body}>{message}</Text>
      </View>)}
    </>}
    {ready && <Text style={styles.body}>点击评估会把当天课表、活动统计、圈摘要和课后体感发给已配置的 AI 服务。</Text>}
    {notice !== '' && <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text>}
  </Dialog>;
}

async function pickMaterial(): Promise<{ file: SelectedSource; text?: string } | undefined> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/csv', 'application/csv', 'application/vnd.ms-excel'],
    copyToCacheDirectory: true,
    base64: false,
  });
  if (result.canceled) return;
  const asset = result.assets[0];
  if (!asset || (asset.size ?? 0) > maxImageBytes) throw new Error('请选择 5 MB 以内的课表文件。');
  const extension = asset.name.toLowerCase().split('.').pop();
  if (extension === 'txt' || extension === 'csv') {
    const text = Platform.OS === 'web'
      ? await (asset.file ? asset.file.text() : fetch(asset.uri).then((response) => response.text()))
      : await new NativeFile(asset.uri).text();
    if (text.length > 30_000) throw new Error('课表文字超过 3 万字，请分批识别。');
    return { file: { name: asset.name }, text };
  }
  const mime = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp'
    : extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : null;
  if (!mime) throw new Error('请选择 PNG、JPEG、WebP、TXT 或 CSV。');
  if (Platform.OS === 'web') {
    const blob = asset.file ?? await fetch(asset.uri).then((response) => response.blob());
    if (!blob) throw new Error('图片读取失败。');
    if (blob.size > maxImageBytes) throw new Error('请选择 5 MB 以内的课表图片。');
    const encoded = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(new Error('图片读取失败。'));
      reader.readAsDataURL(blob);
    });
    return { file: { name: asset.name, image: 'data:' + mime + ';base64,' + encoded } };
  }
  const encoded = await new NativeFile(asset.uri).base64();
  return { file: { name: asset.name, image: 'data:' + mime + ';base64,' + encoded } };
}

export function PlanImport({ startDate, existingPlan, hasDemo, onClose, onImport }: {
  startDate: string; existingPlan: PlanEntry[]; hasDemo: boolean; onClose: () => void;
  onImport: (rows: ImportRow[], replaceDemo: boolean) => void;
}) {
  const [start, setStart] = useState(startDate);
  const [text, setText] = useState('');
  const [file, setFile] = useState<SelectedSource>();
  const [rows, setRows] = useState<RowDraft[]>();
  const [replaceDemo, setReplaceDemo] = useState(hasDemo);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const selected = rows?.filter((row) => !row.skip).length ?? 0;
  const existingDates = new Set(existingPlan.filter((entry) => !replaceDemo || !isDefaultDemoPlan(entry)).map((entry) => entry.date));

  async function choose() {
    setNotice('');
    try {
      const result = await pickMaterial();
      if (!result) return;
      setFile(result.file);
      if (result.text !== undefined) setText(result.text);
    } catch (error) { setNotice(errorMessage(error)); }
  }

  async function recognize() {
    setBusy(true);
    setNotice('');
    try {
      const result = await aiRequest<{ rows: ImportRow[] }>('/ai/recognize', 'POST', { start: start.trim(), text, image: file?.image });
      if (!result.rows.length) throw new Error('没有识别到训练。请确认文字或图片中有课表。');
      setRows(result.rows.map((row) => ({ ...row, minutes: row.minutes === null ? '' : String(row.minutes), skip: false })));
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  }

  function edit(index: number, change: Partial<RowDraft>) {
    setRows((current) => current?.map((row, position) => position === index ? { ...row, ...change } : row));
  }

  function commit() {
    setNotice('');
    try {
      const included = rows?.filter((row) => !row.skip) ?? [];
      const ready = included.map(({ skip: _skip, minutes, ...row }, index) => {
        const date = row.date.trim();
        if (!dateIsValid(date) || !row.type) throw new Error('请补齐待导入的第 ' + (index + 1) + ' 条的日期和训练类型。');
        return { ...row, date, minutes: minutes.trim() ? Number(minutes) : null };
      });
      onImport(ready, replaceDemo);
    } catch (error) { setNotice(errorMessage(error)); }
  }

  return <Dialog title={rows ? '核对识别结果' : '识别导入课表'} onClose={onClose} footer={rows ? <>
    <Button label={'导入 ' + selected + ' 条到课表'} onPress={commit} disabled={!selected} />
    <Button secondary label="返回材料" onPress={() => { setRows(undefined); setNotice(''); }} />
  </> : <Button label={busy ? '正在识别…' : '让 AI 识别'} onPress={recognize} disabled={busy || (!text.trim() && !file?.image)} />}>
    {!rows ? <>
      <Text style={styles.body}>粘贴训练计划，或选择图片、TXT、CSV。点击识别会把所选材料发送到你配置的 AI 服务。</Text>
      <Field label="第 1 周周一（仅相对日期使用）" value={start} onChangeText={setStart} placeholder="YYYY-MM-DD" />
      <Field label="训练计划文字" value={text} onChangeText={setText} multiline placeholder="例如：第 1 周周三，间歇跑 6 × 800 米，热身 12 分钟，冷身 10 分钟" />
      <View style={styles.buttons}><Button secondary label="选择课表文件" onPress={choose} disabled={busy} />
        {file && <Button secondary label="移除文件" onPress={() => { if (!file.image) setText(''); setFile(undefined); }} disabled={busy} />}
      </View>
      {file && <Text style={styles.body}>{file.name}</Text>}
    </> : <>
      <Text style={styles.body}>核对日期和训练内容。相同训练会跳过，同一天其他训练会追加。日期超出当前周期时会扩展周期。</Text>
      {hasDemo && <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: replaceDemo }} style={[styles.chip, replaceDemo && styles.activeChip]}
        onPress={() => setReplaceDemo(!replaceDemo)}><Text style={styles.secondaryText}>{replaceDemo ? '☑' : '☐'} 替换未修改的示例课表</Text></Pressable>}
      {rows.map((row, index) => <View key={index} style={styles.row}>
        <View style={styles.between}><Text style={styles.label}>{'第 ' + (index + 1) + ' 条'}</Text>
          <Button secondary label={row.skip ? '重新选入' : '跳过此条'} onPress={() => edit(index, { skip: !row.skip })} />
        </View>
        {row.source && <Text style={styles.body}>原文 · {row.source}</Text>}
        {!row.skip && <>
          <Field label="日期" value={row.date} onChangeText={(date) => edit(index, { date })} placeholder="YYYY-MM-DD" />
          {existingDates.has(row.date.trim()) && <Text style={styles.body}>当天已有安排，请核对是否为另一节训练。</Text>}
          <View style={styles.buttons}>{workoutTypes.map((type) => <Pressable key={type} accessibilityRole="button"
            accessibilityState={{ selected: type === row.type }} onPress={() => edit(index, { type })}
            style={[styles.chip, type === row.type && styles.activeChip]}><Text style={styles.secondaryText}>{type}</Text></Pressable>)}</View>
          <Field label="总时长（分钟，可空）" value={row.minutes} onChangeText={(minutes) => edit(index, { minutes })} />
          <Field label="训练内容" value={row.detail} onChangeText={(detail) => edit(index, { detail })} multiline />
        </>}
      </View>)}
    </>}
    {notice !== '' && <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text>}
  </Dialog>;
}

const green = '#256447';
const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0d271f80', padding: 14 },
  panel: { width: '100%', maxWidth: 610, maxHeight: '90%', backgroundColor: 'white', padding: 16, borderRadius: 17, gap: 10 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  heading: { fontSize: 22, color: '#162f29', fontWeight: '800' },
  label: { fontSize: 14, color: '#162f29', fontWeight: '700' },
  body: { fontSize: 13, lineHeight: 20, color: '#566960' },
  scroll: { flexShrink: 1 },
  fields: { gap: 11, paddingBottom: 4 },
  field: { gap: 4 },
  input: { borderColor: '#dfe7df', borderWidth: 1, borderRadius: 9, minHeight: 42, padding: 9, fontSize: 16, color: '#162f29' },
  multiline: { minHeight: 82, textAlignVertical: 'top' },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  button: { minHeight: 42, borderRadius: 9, backgroundColor: green, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  secondary: { backgroundColor: 'white', borderColor: '#cadace', borderWidth: 1 },
  buttonText: { fontWeight: '700', fontSize: 14, color: 'white' },
  secondaryText: { fontWeight: '700', fontSize: 13, color: green },
  disabled: { opacity: 0.45 },
  chip: { paddingHorizontal: 9, paddingVertical: 7, borderWidth: 1, borderColor: '#dfe7df', borderRadius: 9 },
  activeChip: { backgroundColor: '#e6f1e7', borderColor: '#8cb49a' },
  row: { padding: 12, borderWidth: 1, borderColor: '#dfe7df', borderRadius: 11, gap: 8 },
  notice: { backgroundColor: '#e6f1e7', color: '#162f29', fontSize: 13, lineHeight: 19, borderRadius: 8, padding: 10 },
});
