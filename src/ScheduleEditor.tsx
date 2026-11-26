import { brandTheme } from './brandTheme';
import * as DocumentPicker from 'expo-document-picker';
import { File as NativeFile } from 'expo-file-system';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Dialog, errorMessage, Field } from './AiTools';
import { parseCalendar } from './calendarImport';
import { parseClock, rangeLabel, scheduleForDay, toClock, type CalendarBlock, type ScheduleBook, type TimeRange } from './schedule';
import { addDays, dateIsValid, dateLabel } from './training';

type CalendarChoice = { id: string; title: string };
const clockRange = (start: string, end: string): TimeRange => {
  const first = parseClock(start);
  const last = parseClock(end);
  if (first === null || last === null || last <= first) throw new Error('请填写同一天内的开始和结束时间，例如 18:30 至 19:15。');
  return { start: first, end: last };
};

export function ScheduleEditor({ initialDay, book, onUpdate, onClose }: {
  initialDay: string; book: ScheduleBook; onUpdate: (change: (book: ScheduleBook) => ScheduleBook) => void; onClose: () => void;
}) {
  const [day, setDay] = useState(initialDay);
  const [dateDraft, setDateDraft] = useState(initialDay);
  const [editing, setEditing] = useState<'busy' | 'window' | 'training'>();
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [title, setTitle] = useState('');
  const [calendars, setCalendars] = useState<CalendarChoice[]>([]);
  const [calendarIds, setCalendarIds] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const schedule = scheduleForDay(book, day);

  function visit(next: string) {
    if (!dateIsValid(next)) { setNotice('请输入 YYYY-MM-DD 格式的有效日期。'); return; }
    setDay(next);
    setDateDraft(next);
    setEditing(undefined);
    setNotice('');
  }

  function mark(range: TimeRange) {
    if (!schedule.available.some((slot) => slot.start <= range.start && slot.end >= range.end)) throw new Error('训练时段需要完整落在一个空档内。');
    onUpdate((current) => ({ ...current, selected: { ...current.selected, [day]: range } }));
    setNotice('已标注 ' + rangeLabel(range) + '。');
  }

  function edit(kind: 'busy' | 'window' | 'training') {
    const range = kind === 'window' ? book.window : kind === 'training' ? schedule.selected ?? schedule.available[0] : undefined;
    setStart(range ? toClock(range.start) : '');
    setEnd(range ? toClock(range.end) : '');
    setTitle('');
    setEditing(kind);
    setNotice('');
  }

  function saveRange() {
    try {
      const range = clockRange(start, end);
      if (editing === 'training') mark(range);
      if (editing === 'window') {
        onUpdate((current) => ({ ...current, window: range }));
        setNotice('训练时间范围已更新。');
      }
      if (editing === 'busy') {
        onUpdate((current) => ({
          ...current, manual: { ...current.manual, [day]: [...(current.manual[day] ?? []), { ...range, title: title.trim() || '忙碌' }] },
        }));
        setNotice('忙碌时段已添加。');
      }
      setEditing(undefined);
    } catch (error) { setNotice(errorMessage(error)); }
  }

  function saveSnapshot(source: string, blocks: CalendarBlock[]) {
    const until = addDays(day, 60);
    onUpdate((current) => ({ ...current, calendar: { source, from: day, until, blocks } }));
    setNotice('已更新从 ' + day + ' 起的 60 天日程。');
  }

  async function importIcs() {
    setBusy(true);
    setNotice('');
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ['text/calendar', 'application/ics', 'application/octet-stream'], copyToCacheDirectory: true, base64: false });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset?.name.toLowerCase().endsWith('.ics') || (asset.size ?? 0) > 1_000_000) throw new Error('请选择 1 MB 以内的 .ics 文件。');
      const text = Platform.OS === 'web'
        ? await (asset.file ? asset.file.text() : fetch(asset.uri).then((response) => response.text()))
        : await new NativeFile(asset.uri).text();
      if (text.length > 1_000_000) throw new Error('请选择 1 MB 以内的 .ics 文件。');
      let events: CalendarBlock[];
      try { events = parseCalendar(text, day, addDays(day, 60)); }
      catch (error) { throw new Error('日历导入失败。' + (error instanceof Error ? error.message : '请重新导出 .ics 文件。')); }
      saveSnapshot(asset.name, events);
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  }

  async function listCalendars() {
    setBusy(true);
    setNotice('');
    try {
      const Calendar = await import('expo-calendar');
      const permission = await Calendar.requestCalendarPermissions(false);
      if (!permission.granted) throw new Error('请在手机设置里允许读取系统日历。');
      const result = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
      setCalendars(result.map(({ id, title }) => ({ id, title })));
      if (!result.length) setNotice('系统没有可选日历。');
    } catch (error) { setNotice('读取系统日历失败。' + errorMessage(error)); }
    finally { setBusy(false); }
  }

  async function syncCalendars() {
    setBusy(true);
    setNotice('');
    try {
      const Calendar = await import('expo-calendar');
      const events = await Calendar.listEvents(calendarIds, new Date(day + 'T00:00:00'), new Date(addDays(day, 60) + 'T00:00:00'));
      const stamp = (value: string | Date, allDay: boolean) => {
        if (!allDay) return new Date(value).getTime();
        const date = value instanceof Date ? value.toISOString() : value;
        return new Date(date.slice(0, 10) + 'T00:00:00').getTime();
      };
      const blocks = events.filter((event) => event.availability !== Calendar.Availability.FREE && event.status !== Calendar.EventStatus.CANCELED)
        .map((event) => ({ startAt: stamp(event.startDate, event.allDay), endAt: stamp(event.endDate, event.allDay), title: event.title || '忙碌' }))
        .filter((event) => Number.isFinite(event.startAt) && Number.isFinite(event.endAt) && event.endAt > event.startAt);
      saveSnapshot('系统日历', blocks);
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  }

  return <Dialog title="日程与训练时间" onClose={onClose}>
    <View style={styles.row}>
      <Button label="前一天" secondary disabled={busy} onPress={() => visit(addDays(day, -1))} />
      <Text style={styles.label}>{dateLabel(day)}</Text>
      <Button label="后一天" secondary disabled={busy} onPress={() => visit(addDays(day, 1))} />
    </View>
    <View style={styles.row}><View style={styles.flex}><Field label="查看日期" value={dateDraft} onChangeText={setDateDraft} placeholder="YYYY-MM-DD" /></View>
      <Button label="查看" secondary disabled={busy} onPress={() => visit(dateDraft.trim())} />
    </View>
    <Text style={styles.label}>可训练时段</Text>
    <Text style={styles.text}>{schedule.covered ? '来源 · ' + book.calendar?.source : '未同步当天日历，空档按已记录的忙碌时段计算。'}</Text>
    <Text style={styles.text}>计算范围 {rangeLabel(book.window)}</Text>
    {schedule.hasConflict && <Text style={styles.alert}>原训练时段与当前日程冲突，请重新选择。</Text>}
    {schedule.selected && <Text style={styles.alert}>已标注 {rangeLabel(schedule.selected)} · {schedule.selected.end - schedule.selected.start} 分钟</Text>}
    <View style={styles.buttons}>{schedule.available.map((slot) => <Button key={rangeLabel(slot)} label={rangeLabel(slot)} secondary onPress={() => mark(slot)} />)}</View>
    {schedule.available.length === 0 && <Text style={styles.text}>当前范围内没有空档。</Text>}
    <View style={styles.buttons}>
      {schedule.available.length > 0 && <Button label="自定义训练时段" secondary onPress={() => edit('training')} />}
      {(schedule.selected || schedule.hasConflict) && <Button label="取消标注" secondary onPress={() => onUpdate((current) => {
        const selected = { ...current.selected };
        delete selected[day];
        return { ...current, selected };
      })} />}
      <Button label="设置计算范围" secondary onPress={() => edit('window')} />
    </View>
    <Text style={styles.label}>当天日程</Text>
    {schedule.imported.map((item, index) => <Text key={'calendar-' + index} style={styles.text}>{rangeLabel(item)} · {item.title}</Text>)}
    {schedule.supplied.map((item, index) => <View key={'manual-' + index} style={styles.row}>
      <Text style={[styles.text, styles.flex]}>{rangeLabel(item)} · {item.title}</Text>
      <Button label="移除" secondary onPress={() => onUpdate((current) => ({
        ...current, manual: { ...current.manual, [day]: (current.manual[day] ?? []).filter((_, position) => position !== index) },
      }))} />
    </View>)}
    {!schedule.imported.length && !schedule.supplied.length && <Text style={styles.text}>当天暂无已记录的忙碌时段。</Text>}
    <View style={styles.buttons}>
      <Button label={busy ? '处理中…' : '导入 .ics 日历'} secondary onPress={importIcs} disabled={busy} />
      {Platform.OS !== 'web' && <Button label="读取系统日历" secondary onPress={listCalendars} disabled={busy} />}
      <Button label="添加忙碌时段" secondary onPress={() => edit('busy')} />
    </View>
    {calendars.length > 0 && <>
      <Text style={styles.label}>选择要同步的日历</Text>
      <View style={styles.buttons}>{calendars.map(({ id, title }) => <Pressable key={id} accessibilityRole="checkbox"
        accessibilityState={{ checked: calendarIds.includes(id) }} style={styles.choice}
        onPress={() => setCalendarIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])}>
        <Text style={styles.text}>{calendarIds.includes(id) ? '✓ ' : ''}{title}</Text>
      </Pressable>)}</View>
      <Button label="同步所选日历" onPress={syncCalendars} disabled={busy || !calendarIds.length} />
    </>}
    {editing && <>
      <Text style={styles.label}>{editing === 'busy' ? '添加忙碌时段' : editing === 'window' ? '设置计算范围' : '自定义训练时段'}</Text>
      {editing === 'busy' && <Field label="事件名称（选填）" value={title} onChangeText={setTitle} maxLength={80} />}
      <View style={styles.row}>
        <View style={styles.flex}><Field label="开始时间" value={start} onChangeText={setStart} placeholder="18:30" /></View>
        <View style={styles.flex}><Field label="结束时间" value={end} onChangeText={setEnd} placeholder="19:15" /></View>
      </View>
      <View style={styles.buttons}><Button label="保存时段" onPress={saveRange} /><Button label="取消编辑" secondary onPress={() => setEditing(undefined)} /></View>
    </>}
    {notice !== '' && <Text accessibilityRole="alert" style={styles.alert}>{notice}</Text>}
  </Dialog>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  flex: { flex: 1 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  label: { color: brandTheme.ink, fontSize: 15, fontWeight: '700' },
  text: { color: brandTheme.muted, fontSize: 13, lineHeight: 20 },
  choice: { borderWidth: 1, borderColor: brandTheme.controlBorder, borderRadius: 8, padding: 9 },
  alert: { backgroundColor: brandTheme.tint, color: brandTheme.ink, fontSize: 13, lineHeight: 19, borderRadius: 8, padding: 9 },
});
