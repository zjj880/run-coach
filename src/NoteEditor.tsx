import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Dialog, Field } from './AiTools';
import { dateIsValid, noteKinds, type NoteKind, type TrainingNote } from './training';

const newId = () => 'note-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);

export function NoteEditor({ note, today, onSave, onDelete, onClose }: {
  note?: TrainingNote;
  today: string;
  onSave: (note: TrainingNote) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(note?.date ?? today);
  const [kind, setKind] = useState<NoteKind>(note?.kind ?? '力量');
  const [title, setTitle] = useState(note?.title ?? '');
  const [text, setText] = useState(note?.text ?? '');
  const [notice, setNotice] = useState('');

  function save() {
    if (!dateIsValid(date.trim())) { setNotice('请输入 YYYY-MM-DD 格式的有效日期。'); return; }
    const body = text.trim();
    if (!body) { setNotice('写点内容再保存（做了什么、感觉如何、学到什么）。'); return; }
    onSave({
      id: note?.id ?? newId(),
      date: date.trim(),
      kind,
      ...(title.trim() ? { title: title.trim().slice(0, 40) } : {}),
      text: body.slice(0, 2000),
      source: 'manual',
    });
  }

  return <Dialog title={note ? '编辑训练笔记' : '添加训练笔记'} onClose={onClose} footer={<>
    <Button label="保存笔记" onPress={save} />
    {note && onDelete && <Button secondary label="删除" onPress={() => onDelete(note.id)} />}
  </>}>
    <Text style={styles.body}>记录力量、跑技、恢复或比赛过程：做了哪些动作、组次与感觉、恢复方式、比赛时间与结果、学到什么。笔记只存在本机，不会自动发给 AI。</Text>
    <Text style={styles.label}>类型</Text>
    <View style={styles.chips}>{noteKinds.map((item) => <Pressable key={item} accessibilityRole="button"
      accessibilityState={{ selected: kind === item }} onPress={() => setKind(item)}
      style={[styles.chip, kind === item && styles.chipActive]}>
      <Text style={[styles.chipText, kind === item && styles.chipTextActive]}>{item}</Text>
    </Pressable>)}</View>
    <Field label="日期" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
    <Field label="标题（选填）" value={title} onChangeText={setTitle} placeholder="例如 力量 A / 比赛日 / 赛后恢复" maxLength={40} />
    <Field label="内容" value={text} onChangeText={setText} multiline maxLength={2000}
      placeholder={kind === '比赛' ? '例如：10 公里比赛，目标 35:30，实际 36:12，前 5 公里 3:40/km，后程掉速…'
        : kind === '恢复' ? '例如：赛后 30 分钟慢跑 + 泡沫轴，睡眠 8 小时，第二天腿部基本恢复…'
          : '例如：力量 A（核心、提踵各 2 组，留 3 次余力），跑后无明显不适…'} />
    {notice !== '' && <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text>}
  </Dialog>;
}

const styles = StyleSheet.create({
  body: { fontSize: 13, lineHeight: 20, color: '#566960' },
  label: { color: '#162f29', fontSize: 14, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderColor: '#dfe7df', borderRadius: 9, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: '#fff' },
  chipActive: { backgroundColor: '#e6f1e7', borderColor: '#8cb49a' },
  chipText: { color: '#162f29', fontSize: 13 },
  chipTextActive: { color: '#256447', fontWeight: '800' },
  notice: { backgroundColor: '#e6f1e7', color: '#162f29', fontSize: 13, lineHeight: 19, borderRadius: 8, padding: 10 },
});
