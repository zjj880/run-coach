import { brandTheme, displayFont } from './brandTheme';
import * as DocumentPicker from 'expo-document-picker';
import { File as NativeFile } from 'expo-file-system';
import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { dateIsValid, isDefaultDemoPlan, workoutTypes, type ImportRow, type PlanEntry } from './training';
import { canReviewTraining, trainingComparison, type ReviewChatMessage, type SavedReview, type TrainingReview, type TrainingReviewInput } from './evaluation';
import { FitReview } from './FitReview';
import { paceSecPerKm } from './autoclassify';
import type { Activity } from './training';
import { aiProviders, matchProvider, type AiProvider } from './providers';
import { openExternal, readClipboardText, writeClipboardText } from './externalLinks';

const localEndpoint = 'http://127.0.0.1:8091';
export function isWindowsDesktop() {
  return Platform.OS === 'web' && typeof window !== 'undefined' &&
    window.location.protocol === 'run-coach:' && window.location.hostname === 'app';
}
const maxImageBytes = 5 * 1024 * 1024;
const segmentLabels: Record<string, string> = {
  INTERVAL_WARMUP: '热身', INTERVAL_ACTIVE: '工作段', INTERVAL_RECOVERY: '恢复段',
  INTERVAL_REST: '休息段', INTERVAL_COOLDOWN: '冷身', RUN: '跑步', WALK: '步行',
  RWD_RUN: '跑步段', RWD_WALK: '步行段', RWD_STAND: '站立段', RWD_MOVE: '移动段', RWD_RUN_WALK: '跑走结合',
};
const segmentLabel = (type: string) => segmentLabels[type] ?? type;

const roundTo = (value: number, digits = 0) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
const minutesLabel = (minutes: number) => roundTo(minutes, 1) + ' 分钟';
const paceText = (secondsPerKm?: number | null) => secondsPerKm
  ? Math.floor(secondsPerKm / 60) + ':' + String(Math.round(secondsPerKm % 60)).padStart(2, '0') + '/公里'
  : undefined;
const durationText = (seconds?: number | null) => seconds === undefined || seconds === null
  ? undefined
  : Math.floor(seconds / 60) + ' 分 ' + String(Math.round(seconds % 60)).padStart(2, '0') + ' 秒';
type Config = { configured: true; endpoint: string; model: string } | { configured: false };
type RowDraft = Omit<ImportRow, 'minutes'> & { minutes: string; skip: boolean };
type SelectedSource = { name: string; image?: string };

const isNativeApp = () => Platform.OS !== 'web';

export async function aiRequest<T>(path: string, method = 'GET', body?: object): Promise<T> {
  // 手机 / 平板原生端：直接把请求发给用户配置的模型接口（密钥存系统安全存储）
  if (isNativeApp()) {
    const { nativeAiRequest } = await import('./mobileAi');
    return nativeAiRequest<T>(path, method, body);
  }
  let response: Response;
  try {
    response = await fetch((isWindowsDesktop() ? '' : localEndpoint) + path, {
      method,
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
  } catch {
    if (isWindowsDesktop()) throw new Error('电脑版本的本机服务暂时无法连接，请重新打开 App。');
    throw new Error(path.startsWith('/garmin')
      ? '连不上本机佳明同步服务。浏览器预览请先在项目目录运行 npm run ai。'
      : '连不上本机 AI 服务。浏览器预览请先在项目目录运行 npm run ai；手机端请「我的 → AI 接口」直接配置模型接口。');
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

/** 针对已保存的训练评估继续追问，返回教练的纯文本回答。 */
export async function requestReviewFollowUp(input: TrainingReviewInput, review: TrainingReview, messages: ReviewChatMessage[]) {
  const { reply } = await aiRequest<{ reply: string }>('/ai/review-chat', 'POST', { input, review, messages: messages.slice(-11) });
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
      placeholderTextColor={brandTheme.hint} autoCapitalize="none" autoCorrect={false} secureTextEntry={secure}
      multiline={multiline} maxLength={maxLength} style={[styles.input, multiline && styles.multiline]} />
  </View>;
}

export function Dialog({ title, children, footer, onClose, followContent }: {
  title: string; children: ReactNode; footer?: ReactNode; onClose: () => void; followContent?: boolean;
}) {
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.panel}>
        <View style={styles.between}>
          <Text accessibilityRole="header" style={styles.heading}>{title}</Text>
          <Button secondary label="关闭" onPress={onClose} />
        </View>
        <ScrollView ref={scroll} onContentSizeChange={followContent ? () => scroll.current?.scrollToEnd() : undefined}
          style={styles.scroll} contentContainerStyle={styles.fields} keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets>{children}</ScrollView>
        {footer && <View style={styles.buttons}>{footer}</View>}
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

export function AiSettings({ onClose }: { onClose: () => void }) {
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [config, setConfig] = useState<Config>({ configured: false });
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState('');
  const [provider, setProvider] = useState<AiProvider>(aiProviders[0]);
  const preset = provider.id === 'custom' ? undefined : provider;

  useEffect(() => {
    let mounted = true;
    aiRequest<Config>('/ai/settings').then((result) => {
      if (!mounted) return;
      setConfig(result);
      if (result.configured) {
        setBaseUrl(result.endpoint);
        setModel(result.model);
        const matched = matchProvider(result.endpoint);
        if (matched) setProvider(matched);
      }
    }).catch((error) => { if (mounted) setNotice(errorMessage(error)); })
      .finally(() => { if (mounted) setBusy(false); });
    return () => { mounted = false; };
  }, []);

  function choose(next: AiProvider) {
    setProvider(next);
    setNotice('');
    if (next.endpoint) setBaseUrl(next.endpoint);
    if (next.model) setModel(next.model);
  }

  async function pasteKey() {
    const text = await readClipboardText();
    if (!text) { setNotice('剪贴板里没有文本：先在密钥页点「复制」，再回到这里点「粘贴密钥」。'); return; }
    const cleaned = text.replace(/\s+/g, '');
    setApiKey(cleaned);
    setNotice(/^(sk-|GCDC_)/.test(cleaned) ? '已从剪贴板粘贴密钥，点「测试并保存」。' : '已粘贴剪贴板内容，请确认是 API 密钥。');
  }

  async function copyKeyPage() {
    if (!preset?.keyPage) return;
    const saved = await writeClipboardText(preset.keyPage);
    setNotice(saved ? '密钥页链接已复制，可以发到电脑或另一台手机打开。' : '无法写入剪贴板，请手动打开：' + preset.keyPage);
  }

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
    <Text style={styles.body}>先选服务商（地址和模型会自动填好），再去密钥页复制密钥粘贴进来，点「测试并保存」即可。</Text>
    <Text style={styles.label}>服务商</Text>
    <View style={styles.buttons}>{aiProviders.map((item) => <Pressable key={item.id} accessibilityRole="button"
      accessibilityState={{ selected: provider.id === item.id }} onPress={() => choose(item)}
      style={[styles.chip, provider.id === item.id && styles.chipActive]}>
      <Text style={[styles.body, provider.id === item.id && styles.chipTextActive]}>{item.label}</Text></Pressable>)}</View>
    {preset?.note && <Text style={styles.body}>{preset.note}</Text>}
    {preset?.models && preset.models.length > 0 && <>
      <Text style={styles.label}>模型</Text>
      <View style={styles.buttons}>{preset.models.map((option) => <Pressable key={option.id} accessibilityRole="button"
        accessibilityState={{ selected: model.trim() === option.id }} onPress={() => { setModel(option.id); setNotice(option.note); }}
        style={[styles.chip, model.trim() === option.id && styles.chipActive]}>
        <Text style={[styles.body, model.trim() === option.id && styles.chipTextActive]}>{option.label}</Text></Pressable>)}</View>
    </>}
    <View style={styles.buttons}>
      {preset?.keyPage && <Button secondary label={'打开 ' + preset.label + ' 密钥页'} onPress={() => void openExternal(preset.keyPage!)} />}
      {preset?.keyPage && <Button secondary label="复制密钥页链接" onPress={() => void copyKeyPage()} />}
      <Button secondary label="粘贴密钥" onPress={() => void pasteKey()} />
    </View>
    <Text style={styles.label}>{config.configured ? '已连接 · ' + config.model : '尚未连接'}</Text>
    <Field label="接口地址" value={baseUrl} onChangeText={setBaseUrl} placeholder="https://你的服务商域名/v1" />
    <Field label="模型" value={model} onChangeText={setModel} placeholder="填写服务商给出的模型名称" />
    <Field label="API 密钥" value={apiKey} onChangeText={setApiKey} secure placeholder={config.configured ? '地址不变时可留空复用' : '点上面「粘贴密钥」或手动粘贴'} />
    <Text style={styles.body}>{isNativeApp()
      ? '接口设置保存在手机系统安全存储里，只在本机使用，不会上传。'
      : isWindowsDesktop() ? '接口设置保存在这台电脑上，密钥由 Windows 加密。'
        : '密钥仅保留在电脑本机 AI 服务的内存中。重启该服务后需要重新填写。'}</Text>
    {notice !== '' && <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text>}
  </Dialog>;
}

export function TrainingReviewDialog({ input, activities, saved, onSave, onClose, onLoadDetails, onFeedback, onClassify }: {
  input: TrainingReviewInput; saved?: SavedReview; onSave: (review: SavedReview) => void; onClose: () => void;
  activities: Activity[]; onFeedback: (activity: Activity) => void;
  onClassify: (activity: Activity) => void;
  onLoadDetails?: () => Promise<{ details: number; parsed: number; requested: number }>;
}) {
  const [busy, setBusy] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [notice, setNotice] = useState('');
  const [chat, setChat] = useState<ReviewChatMessage[]>(saved?.chat ?? []);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [showData, setShowData] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const signature = JSON.stringify(input);
  const stale = saved && saved.signature !== signature;
  const primary = input.activities.find((activity) => activity.role === '主课');
  const ready = canReviewTraining(input);
  const { planned, compared, deltaMinutes } = trainingComparison(input);
  const working = busy || loadingDetails || asking;

  async function evaluate() {
    setBusy(true);
    setNotice('');
    try {
      const { review } = await aiRequest<{ review: TrainingReview }>('/ai/review', 'POST', input);
      const savedReview: SavedReview = { review, signature, reviewedAt: new Date().toISOString() };
      setChat([]);
      setQuestion('');
      onSave(savedReview);
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

  async function ask() {
    const text = question.trim();
    if (!text || asking || !saved) return;
    setAsking(true);
    setNotice('');
    const nextChat: ReviewChatMessage[] = [...chat, { role: 'user', text }];
    try {
      const reviewedInput = stale ? JSON.parse(saved.signature) as TrainingReviewInput : input;
      const reply = await requestReviewFollowUp(reviewedInput, saved.review, nextChat);
      const settled: ReviewChatMessage[] = [...nextChat, { role: 'assistant', text: reply }];
      setChat(settled);
      setQuestion('');
      onSave({ ...saved, chat: settled });
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setAsking(false); }
  }

  return <Dialog title="训练数据评估" onClose={() => { if (!asking) onClose(); }} footer={<>
    {onLoadDetails && <Button secondary label={loadingDetails ? '正在读取…' : '同步佳明明细与 FIT'} disabled={working} onPress={() => void loadDetails()} />}
    <Button label={busy ? '正在评估…' : saved ? '重新评估' : '用 AI 评估'} disabled={working || !ready} onPress={evaluate} />
  </>}>
    <View style={styles.summary}>
      <Text style={styles.small}>{input.date}</Text>
      <Text style={styles.summaryLine}>计划 · {input.plan.map((item) => item.type).join('、') || '未安排'}{planned !== null ? ' ' + minutesLabel(planned) : ''}</Text>
      <Text style={styles.summaryLine}>实际总量 · {minutesLabel(input.total.minutes)} · {roundTo(input.total.km, 2)} 公里</Text>
      {compared && deltaMinutes !== null && <Text style={styles.summaryLine}>
        {input.plan.length === 1 ? (primary?.roleSource === 'auto' ? '自动归类的主课' : '主课') +
          '及关联热身冷身 · ' + minutesLabel(compared.minutes) + ' · ' : '全天总量 · '}
        {deltaMinutes === 0 ? '与计划时长一致' : (deltaMinutes > 0 ? '比计划多 ' : '比计划少 ') + minutesLabel(Math.abs(deltaMinutes))}
      </Text>}
    </View>
    {saved && <View style={styles.field}>
      {stale && <Text style={styles.notice}>数据已更新，此处是上一次评估。</Text>}
      <Text style={styles.label}>{saved.review.summary}</Text>
      <Text style={styles.body}>下次建议 · {saved.review.next}</Text>
      <View style={styles.buttons}><Button secondary label={showAnalysis ? '收起评估依据' : '查看评估依据'} onPress={() => setShowAnalysis(!showAnalysis)} /></View>
      {showAnalysis && <>
        <Text style={styles.body}>计划与执行 · {saved.review.execution}</Text>
        <Text style={styles.body}>配速与心率 · {saved.review.intensity}</Text>
        <Text style={styles.body}>数据局限 · {saved.review.limitations}</Text>
      </>}
    </View>}
    {activities.map((activity) => {
      const { detail, fit, feedback, title, time, role, minutes, km, averageHr } = activity;
      const metrics = [
        minutesLabel(minutes),
        km > 0 ? roundTo(km, 2) + ' 公里' : undefined,
        paceText(paceSecPerKm(activity)),
        averageHr !== undefined ? '均心率 ' + averageHr : undefined,
      ].filter(Boolean).join(' · ');
      const feedbackLine = feedback && [
        feedback.effort !== null && 'RPE ' + feedback.effort + '/10',
        feedback.sensor !== '未注明' && feedback.sensor,
        feedback.heartRateTrust !== '未评估' && '心率' + feedback.heartRateTrust,
        feedback.cold && '天气偏冷', feedback.note,
      ].filter(Boolean).join(' · ');
      const detailLine = detail && [
        detail.maxHr !== undefined && '最高心率 ' + Math.round(detail.maxHr),
        detail.runningCadenceSpm !== undefined && '步频 ' + Math.round(detail.runningCadenceSpm),
        detail.strideLengthCm !== undefined && '步幅 ' + Math.round(detail.strideLengthCm) + 'cm',
        detail.elevationGainM !== undefined && '爬升 ' + Math.round(detail.elevationGainM) + 'm',
        detail.averagePowerW !== undefined && '功率 ' + Math.round(detail.averagePowerW) + 'W',
        detail.movingSeconds !== undefined && '移动 ' + Math.round(detail.movingSeconds / 60) + ' 分',
        detail.aerobicTrainingEffect !== undefined && '有氧 ' + roundTo(detail.aerobicTrainingEffect, 1),
        detail.anaerobicTrainingEffect !== undefined && '无氧 ' + roundTo(detail.anaerobicTrainingEffect, 1),
      ].filter(Boolean).join(' · ');
      return <View key={activity.id} style={styles.activityRow}>
        <View style={styles.between}>
          <Text style={styles.label}>{role}{activity.roleSource === 'auto' ? '（自动）' : ''} · {title}</Text>
          <Text style={styles.small}>{time}</Text>
        </View>
        <Text style={styles.body}>{metrics}</Text>
        {detail?.weather && <Text style={styles.body}>
          天气估计 · {roundTo(detail.weather.temperatureC, 1)} °C · 相对湿度 {roundTo(detail.weather.relativeHumidityPct)}%
        </Text>}
        {feedbackLine ? <Text style={styles.body}>{feedbackLine}</Text> : null}
        {showData && activity.roleReason && <Text style={styles.small}>{activity.roleReason}</Text>}
        {showData && detailLine ? <Text style={styles.small}>{detailLine}</Text> : null}
        {showData && detail?.segmentTotals?.map((segment, index) => <Text key={index} style={styles.small}>{[
          segmentLabel(segment.type),
          segment.count ? segment.count + ' 段' : undefined,
          durationText(segment.seconds),
          segment.meters ? roundTo(segment.meters / 1000, 2) + ' 公里' : undefined,
          segment.averageHr ? '均心率 ' + Math.round(segment.averageHr) : undefined,
        ].filter(Boolean).join(' · ')}</Text>)}
        <View style={styles.buttons}>
          <Button secondary label="手动归类" onPress={() => onClassify(activity)} disabled={working} />
          <Button secondary label={feedback ? '修改体感' : '填写体感'} onPress={() => onFeedback(activity)} disabled={working} />
        </View>
        {showData && fit && <FitReview fit={fit} heartRateSuspect={feedback?.heartRateTrust === '存疑'} />}
        {!fit && detail?.fitIssue && <Text style={styles.small}>{detail.fitIssue}</Text>}
      </View>;
    })}
    {activities.some((item) => !!(item.detail || item.fit || item.roleReason)) && <View style={styles.buttons}>
      <Button secondary label={showData ? '收起运动数据' : '展开运动数据和曲线'} onPress={() => setShowData(!showData)} />
    </View>}
    {!ready && <Text style={styles.notice}>当天没有可评估的活动记录。</Text>}
    {ready && input.activities.some((activity) => activity.role === '待归类') &&
      <Text style={styles.small}>待归类活动已计入总量，可在确认归属前查看评估。</Text>}
    {saved && <>
      <Text style={styles.label}>继续问教练</Text>
      {chat.length === 0 && <Text style={styles.small}>可以追问：这个判断的依据、下次怎么练、今天剩下的时间怎么安排。</Text>}
      {chat.map((message, index) => <View key={index} style={[styles.bubble, message.role === 'user' && styles.mine]}>
        <Text style={styles.small}>{message.role === 'user' ? '你' : 'AI 教练'}</Text>
        <Text style={styles.body}>{message.text}</Text>
      </View>)}
      <Field label="追问" value={question} onChangeText={setQuestion} multiline maxLength={400}
        placeholder="例：这次心率偏高说明什么？下次间歇跑要注意什么？" />
      <View style={styles.buttons}><Button label={asking ? '正在回答…' : '发送追问'} onPress={() => void ask()}
        disabled={working || !question.trim()} /></View>
    </>}
    {onLoadDetails && <Text style={styles.small}>同步明细时，Open-Meteo 按取整后的起点和开跑时间查询环境温湿度。</Text>}
    {ready && <Text style={styles.body}>点击评估会把当天课表、活动统计、圈摘要、已保存的温湿度和课后体感发给已配置的 AI 服务。</Text>}
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

const accent = brandTheme.accent;
const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: brandTheme.scrim, padding: 14 },
  panel: { width: '100%', maxWidth: 610, maxHeight: '92%', backgroundColor: 'white', padding: 16, borderRadius: 17, gap: 10 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  heading: { fontFamily: displayFont, fontSize: 23, color: brandTheme.ink },
  label: { fontSize: 14, color: brandTheme.ink, fontWeight: '700' },
  body: { fontSize: 13, lineHeight: 20, color: brandTheme.muted },
  scroll: { flexShrink: 1 },
  fields: { gap: 11, paddingBottom: 4 },
  field: { gap: 4 },
  input: { borderColor: brandTheme.border, borderWidth: 1, borderRadius: 9, minHeight: 42, padding: 9, fontSize: 16, color: brandTheme.ink },
  multiline: { minHeight: 82, textAlignVertical: 'top' },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  button: { minHeight: 42, borderRadius: 9, backgroundColor: accent, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  secondary: { backgroundColor: 'white', borderColor: brandTheme.controlBorder, borderWidth: 1 },
  buttonText: { fontWeight: '700', fontSize: 14, color: 'white' },
  secondaryText: { fontWeight: '700', fontSize: 13, color: accent },
  disabled: { opacity: 0.45 },
  chip: { paddingHorizontal: 9, paddingVertical: 7, borderWidth: 1, borderColor: brandTheme.border, borderRadius: 9 },
  activeChip: { backgroundColor: brandTheme.tint, borderColor: brandTheme.selectedBorder },
  chipActive: { backgroundColor: brandTheme.tint, borderColor: brandTheme.selectedBorder },
  chipTextActive: { color: brandTheme.accent, fontWeight: '800' },
  row: { padding: 12, borderWidth: 1, borderColor: brandTheme.border, borderRadius: 11, gap: 8 },
  notice: { backgroundColor: brandTheme.tint, color: brandTheme.ink, fontSize: 13, lineHeight: 19, borderRadius: 8, padding: 10 },
  summary: { gap: 3, padding: 10, borderRadius: 10, backgroundColor: brandTheme.soft },
  summaryLine: { color: brandTheme.ink, fontSize: 14, fontWeight: '700', lineHeight: 20 },
  activityRow: { padding: 11, borderWidth: 1, borderColor: brandTheme.border, borderRadius: 11, gap: 5 },
  bubble: { backgroundColor: brandTheme.soft, borderRadius: 10, padding: 10, gap: 3 },
  mine: { marginLeft: 28, backgroundColor: brandTheme.paper },
  small: { color: brandTheme.muted, fontSize: 12, lineHeight: 18 },
});
