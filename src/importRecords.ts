import type { Activity, CoachState, WorkoutType } from './training';

/** CSV 导入：表头支持中英文，列顺序不限；未识别的行记录下来而不是直接失败。 */
export type ImportRow = {
  date: string;
  km?: number;
  minutes?: number;
  averageHr?: number;
  title?: string;
  detail?: string;
};

export type ParsedRecords = {
  activities: Activity[];
  errors: string[];
  skipped: number;
};

const headerAliases: Record<string, keyof ImportRow> = {
  '日期': 'date', 'date': 'date', '训练日期': 'date',
  '公里': 'km', '里程': 'km', '距离': 'km', 'km': 'km', 'distance': 'km',
  '分钟': 'minutes', '时长': 'minutes', '时长(分钟)': 'minutes', 'minutes': 'minutes',
  '平均心率': 'averageHr', '心率': 'averageHr', 'averagehr': 'averageHr', 'avg_hr': 'averageHr',
  '标题': 'title', '名称': 'title', 'title': 'title', 'title（标题）': 'title',
  '训练内容': 'detail', '备注': 'detail', '分段': 'detail', 'detail': 'detail',
};

/** 把整段 CSV 拆成记录，正确处理引号、转义双引号与单元格内换行。 */
function tokenizeCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cells: string[] = [];
  let current = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') { current += '"'; index += 1; }
        else quoted = false;
      } else if (char === '\r') {
        // 单元格内换行保留为空格，避免破坏记录
      } else current += char;
    } else if (char === '"') quoted = true;
    else if (char === ',' ) { cells.push(current); current = ''; }
    else if (char === '\n') { cells.push(current); rows.push(cells); cells = []; current = ''; }
    else if (char === '\r') { /* 跳过 */ }
    else current += char;
  }
  if (current !== '' || cells.length) { cells.push(current); rows.push(cells); }
  return rows.map((row) => row.map((cell) => cell.trim())).filter((row) => row.some((cell) => cell !== ''));
}

/** 多行/多余空白压成单行，便于存进 detail。 */
export function flattenText(text: string | undefined | null): string {
  if (!text) return '';
  return String(text).replace(/\s*\r?\n+\s*/g, ' / ').replace(/\s{2,}/g, ' ').trim();
}

/** 从「计时合计1:05:49」或分段「9:45，5:54/km」里推算总时长（分钟）。 */
export function minutesFromText(text: string): number | undefined {
  const source = text || '';
  const total = /计时合计\s*(\d+):(\d{2}):(\d{2})/.exec(source);
  if (total) return Math.round((Number(total[1]) * 60 + Number(total[2]) + Number(total[3]) / 60) * 10) / 10;
  const shortTotal = /计时合计\s*(\d+):(\d{2})\b/.exec(source);
  if (shortTotal) return Math.round((Number(shortTotal[1]) + Number(shortTotal[2]) / 60) * 10) / 10;
  let seconds = 0;
  for (const match of source.matchAll(/(?<![\d.])(\d{1,2}):(\d{2}):(\d{2})(?=\s*[，,])/g)) {
    seconds += Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  }
  for (const match of source.matchAll(/(?<![\d.:])(\d{1,2}):(\d{2})(?![\d:])(?=\s*[，,])/g)) {
    seconds += Number(match[1]) * 60 + Number(match[2]);
  }
  return seconds > 0 ? Math.round(seconds / 60 * 10) / 10 : undefined;
}

/** 取分段里所有 HR 读数的平均值。 */
export function averageHeartRate(text: string): number | undefined {
  const values = [...(text || '').matchAll(/HR\s*(\d{2,3})/gi)].map((match) => Number(match[1]))
    .filter((value) => value >= 40 && value <= 240);
  if (!values.length) return undefined;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

/** 清洗课表原文，生成简短标题。 */
export function cleanTitle(main: string | undefined | null): string {
  let text = flattenText(main);
  if (!text) return '跑步';
  if (/^分段跑步合计/.test(text) || /^\d+(\.\d+)?\s*公里/.test(text)) return '跑步';
  text = text.replace(/^\d{1,2}:\d{2}\s*开始[，,]?\s*/, '');
  text = text.replace(/^(下午|上午|晚上|周六|周日)[，,]\s*/, '');
  text = text.replace(/^建议\d{1,2}:\d{2}[^。]*?。/, '');
  text = text.split('。')[0];
  text = text.replace(/^[，,\s]+|[，,\s]+$/g, '');
  return text || '跑步';
}

const normalizeDate = (value: string): string | undefined => {
  const text = value.trim();
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(text);
  if (!match) return undefined;
  const result = match[1] + '-' + String(Number(match[2])).padStart(2, '0') + '-' + String(Number(match[3])).padStart(2, '0');
  const check = new Date(result + 'T00:00:00Z');
  return check.toISOString().slice(0, 10) === result ? result : undefined;
};

const toNumber = (value: string): number | undefined => {
  const cleaned = value.replace(/[^\d.\-]/g, '');
  if (!cleaned) return undefined;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : undefined;
};

export function parseRecordsCsv(text: string): ParsedRecords {
  const rows = tokenizeCsv(text);
  if (rows.length < 2) return { activities: [], errors: ['文件里没有数据行（第一行应为表头）。'], skipped: 0 };
  const header = rows[0].map((cell) => cell.replace(/\s+/g, '').toLowerCase());
  const mapping = header.map((cell) => headerAliases[cell] ?? headerAliases[cell.replace(/[（）()]/g, '')]);
  if (!mapping.includes('date')) return { activities: [], errors: ['找不到「日期」列，请确认第一行是表头：日期,公里,分钟,平均心率,标题,训练内容。'], skipped: 0 };

  const activities: Activity[] = [];
  const errors: string[] = [];
  let skipped = 0;
  for (let index = 1; index < rows.length; index += 1) {
    const cells = rows[index];
    const row: ImportRow = { date: '' };
    mapping.forEach((field, position) => {
      if (!field) return;
      const value = cells[position] ?? '';
      if (field === 'date') row.date = value;
      else if (field === 'km') row.km = toNumber(value);
      else if (field === 'minutes') row.minutes = toNumber(value);
      else if (field === 'averageHr') row.averageHr = toNumber(value);
      else if (field === 'title') row.title = value;
      else row.detail = value;
    });
    const date = normalizeDate(row.date ?? '');
    if (!date) { errors.push('第 ' + (index + 1) + ' 行日期无法识别：' + (row.date || '(空)')); continue; }
    const km = row.km !== undefined && row.km > 0 ? Math.round(row.km * 100) / 100 : 0;
    const derived = row.minutes !== undefined && row.minutes > 0 ? undefined : minutesFromText((row.detail ?? '') + ' ' + (row.title ?? ''));
    const minutes = row.minutes !== undefined && row.minutes > 0 ? Math.round(row.minutes * 10) / 10 : (derived ?? 0);
    if (!km && !minutes) { skipped += 1; continue; }
    const averageHr = row.averageHr !== undefined && row.averageHr > 0 && row.averageHr <= 300 ? Math.round(row.averageHr) : undefined;
    activities.push({
      id: 'import-' + date + '-' + index,
      date,
      time: '导入',
      title: (row.title || '跑步').slice(0, 60),
      minutes,
      km,
      averageHr,
      core: row.detail ? row.detail.slice(0, 300) : undefined,
      role: '待归类',
    });
  }
  return { activities, errors, skipped };
}

/** 与已有活动去重：同一天、里程差 ≤0.1 公里视为同一条（保留已有数据）。 */
export function mergeImportedActivities(state: CoachState, incoming: Activity[]) {
  const existing = state.activities;
  const added: Activity[] = [];
  let duplicates = 0;
  for (const activity of incoming) {
    const clash = existing.some((item) => item.date === activity.date && Math.abs(item.km - activity.km) <= 0.1 && Math.abs(item.minutes - activity.minutes) <= 1);
    if (clash) { duplicates += 1; continue; }
    added.push(activity);
  }
  return { state: { ...state, activities: [...existing, ...added] }, added, duplicates };
}

export const planTypeFromText = (text: string): WorkoutType | undefined => {
  const value = text || '';
  if (/比赛日|比赛$/.test(value)) return '节奏跑';
  if (/间歇|专项|1200|1000|800米|600米|2000米|2400米/.test(value)) return '间歇跑';
  if (/阈值|节奏|持续快跑|目标配速/.test(value)) return '节奏跑';
  if (/长跑|长距离|公里轻松跑|18公里/.test(value)) return '长跑';
  if (/力量|器械|核心|提踵/.test(value)) return '力量训练';
  if (/休息|恢复|活动度|轻松|慢跑/.test(value)) return '轻松跑';
  return undefined;
};
