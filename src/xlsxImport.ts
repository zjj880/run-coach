import { unzipSync } from 'fflate';
import { noteKindFromText } from './training.ts';
import type { Activity, TrainingNote, WorkoutType } from './training';
import { averageHeartRate, cleanTitle, flattenText, minutesFromText, planTypeFromText } from './importRecords.ts';

/** 最小 OOXML 读取：只用 fflate 解压 + 文本解析，不引入 SheetJS 之类的大依赖。
 *  同时兼容带命名空间前缀的写法（Excel / WPS / 三方库都可能输出 <x:sheet> 这种标签）。 */
export type SheetRows = string[][];
export type WorkbookSheet = { name: string; rows: SheetRows };
export type PlannedRow = { date: string; type: WorkoutType; km: number; detail: string };
export type MappedWorkbook = {
  sheetName: string;
  activities: Activity[];
  planned: PlannedRow[];
  plans: PlannedRow[];
  notes: TrainingNote[];
  errors: string[];
  skipped: number;
};

const PREFIX = '(?:[A-Za-z_][\\w.-]*:)?';
const tag = (name: string) => '<' + PREFIX + name + '\\b';
const closeTag = (name: string) => '</' + PREFIX + name + '>';

const decodeUtf8 = (bytes: Uint8Array): string => {
  let out = '';
  let index = 0;
  while (index < bytes.length) {
    const byte = bytes[index++];
    if (byte < 0x80) out += String.fromCharCode(byte);
    else if (byte < 0xe0) out += String.fromCharCode(((byte & 0x1f) << 6) | (bytes[index++] & 0x3f));
    else if (byte < 0xf0) {
      out += String.fromCharCode(((byte & 0x0f) << 12) | ((bytes[index++] & 0x3f) << 6) | (bytes[index++] & 0x3f));
    } else {
      const codePoint = ((byte & 0x07) << 18) | ((bytes[index++] & 0x3f) << 12) | ((bytes[index++] & 0x3f) << 6) | (bytes[index++] & 0x3f);
      out += String.fromCodePoint(codePoint);
    }
  }
  return out;
};

const unescapeXml = (text: string): string => text
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
  .replace(/&amp;/g, '&');

const textRuns = (xml: string): string => {
  const pattern = new RegExp(tag('t') + '[^>]*>([\\s\\S]*?)' + closeTag('t'), 'g');
  return [...xml.matchAll(pattern)].map((match) => unescapeXml(match[1])).join('');
};

function parseSharedStrings(xml?: string): string[] {
  if (!xml) return [];
  const pattern = new RegExp(tag('si') + '[^>]*>([\\s\\S]*?)' + closeTag('si'), 'g');
  return [...xml.matchAll(pattern)].map((match) => textRuns(match[1]));
}

const columnIndex = (reference: string): number => {
  const letters = /^([A-Z]+)/.exec(reference)?.[1] ?? '';
  let value = 0;
  for (const letter of letters) value = value * 26 + (letter.charCodeAt(0) - 64);
  return value - 1;
};

const valueOf = (body: string): string => {
  const pattern = new RegExp(tag('v') + '>([\\s\\S]*?)' + closeTag('v'));
  const raw = pattern.exec(body)?.[1];
  return raw === undefined ? '' : unescapeXml(raw);
};

function sheetRows(xml: string, shared: string[]): SheetRows {
  const rows: SheetRows = [];
  const rowPattern = new RegExp(tag('row') + '([^>]*)>([\\s\\S]*?)' + closeTag('row'), 'g');
  const cellPattern = new RegExp(tag('c') + '([^>]*?)(?:/>|>([\\s\\S]*?)' + closeTag('c') + ')', 'g');
  for (const rowMatch of xml.matchAll(rowPattern)) {
    const row: string[] = [];
    for (const cellMatch of rowMatch[2].matchAll(cellPattern)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2] ?? '';
      const reference = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      let value = '';
      if (type === 's') {
        const index = Number(valueOf(body));
        value = Number.isInteger(index) ? (shared[index] ?? '') : '';
      } else if (type === 'inlineStr') {
        value = textRuns(body);
      } else if (type === 'str') {
        value = valueOf(body);
      } else {
        value = valueOf(body);
      }
      if (reference) row[columnIndex(reference)] = value;
    }
    rows.push(row.map((cell) => (cell ?? '').trim()));
  }
  return rows;
}

function sheetTargets(zip: Record<string, Uint8Array>): { name: string; path: string }[] {
  const workbook = zip['xl/workbook.xml'] ? decodeUtf8(zip['xl/workbook.xml']) : '';
  const rels = zip['xl/_rels/workbook.xml.rels'] ? decodeUtf8(zip['xl/_rels/workbook.xml.rels']) : '';
  const relMap = new Map<string, string>();
  const relPattern = new RegExp(tag('Relationship') + '([^>]*?)\\/?>', 'g');
  for (const match of rels.matchAll(relPattern)) {
    const id = /\bId="([^"]+)"/.exec(match[1])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(match[1])?.[1];
    if (id && target) relMap.set(id, target.replace(/^\/?xl\//, '').replace(/^\.\//, ''));
  }
  const sheets: { name: string; path: string }[] = [];
  const sheetPattern = new RegExp(tag('sheet') + '([^>]*?)\\/?>', 'g');
  for (const match of workbook.matchAll(sheetPattern)) {
    const name = /\bname="([^"]*)"/.exec(match[1])?.[1];
    const rid = /(?:\s|[^A-Za-z0-9_])(?:[A-Za-z_][\w.-]*:)?id="([^"]+)"/.exec(match[1])?.[1];
    if (!name) continue;
    const target = rid ? relMap.get(rid) : undefined;
    if (target && zip['xl/' + target]) sheets.push({ name: unescapeXml(name), path: 'xl/' + target });
  }
  return sheets;
}

const normalizeHeader = (text: string) => text.replace(/\s+/g, '').replace(/\//g, '').toLowerCase();

const serialToDate = (value: number): string | undefined => {
  if (!Number.isFinite(value) || value < 20000 || value > 80000) return undefined;
  const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000);
  return date.toISOString().slice(0, 10);
};

const dateValue = (raw: string): string | undefined => {
  const text = raw.trim();
  if (!text) return undefined;
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(text);
  if (iso) {
    const candidate = iso[1] + '-' + String(Number(iso[2])).padStart(2, '0') + '-' + String(Number(iso[3])).padStart(2, '0');
    return new Date(candidate + 'T00:00:00Z').toISOString().slice(0, 10) === candidate ? candidate : undefined;
  }
  const serial = Number(text);
  return Number.isFinite(serial) ? serialToDate(serial) : undefined;
};

/** 把 Excel 时间序列号（0–1 表示一天内的时刻）格式化成 35:30 / 3:33。 */
const formatTimeSerial = (raw: string): string => {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value >= 1) return raw;
  const seconds = Math.round(value * 86400);
  if (seconds >= 3600) {
    return Math.floor(seconds / 3600) + ':' + String(Math.floor(seconds % 3600 / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
  }
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
};

const numeric = (raw: string): number | undefined => {
  const cleaned = raw.replace(/[^\d.\-]/g, '');
  if (!cleaned) return undefined;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : undefined;
};

export function readWorkbook(bytes: Uint8Array): WorkbookSheet[] {
  const zip = unzipSync(bytes);
  const shared = parseSharedStrings(zip['xl/sharedStrings.xml'] ? decodeUtf8(zip['xl/sharedStrings.xml']) : undefined);
  return sheetTargets(zip).map(({ name, path }) => ({ name, rows: sheetRows(decodeUtf8(zip[path]), shared) }));
}

/** 识别「日期 / 计划公里 / 跑步主课 / 实际跑步 / 历史分段」这类训练课表模板。 */
export function mapTrainingWorkbook(bytes: Uint8Array): MappedWorkbook {
  let sheets: WorkbookSheet[];
  try { sheets = readWorkbook(bytes); }
  catch {
    return { sheetName: '', activities: [], planned: [], plans: [], notes: [], errors: ['无法读取这个 XLSX，请确认文件未加密且为 .xlsx 格式。'], skipped: 0 };
  }

  const findHeader = (rows: SheetRows) => {
    for (let index = 0; index < Math.min(rows.length, 30); index += 1) {
      const cells = rows[index].map(normalizeHeader);
      const date = cells.findIndex((cell) => cell.includes('日期'));
      if (date < 0) continue;
      const header = {
        index,
        date,
        planned: cells.findIndex((cell) => cell.includes('计划') && cell.includes('公里')),
        main: cells.findIndex((cell) => cell.includes('主课')),
        actual: cells.findIndex((cell) => cell.includes('实际')),
        splits: cells.findIndex((cell) => cell.includes('分段')),
        timing: cells.findIndex((cell) => cell.includes('计时')),
        support: cells.findIndex((cell) => cell.includes('力量') || cell.includes('跑技')),
      };
      if (header.actual >= 0 || header.planned >= 0 || header.splits >= 0) return header;
    }
    return undefined;
  };

  const candidates = sheets.map((sheet) => ({ sheet, header: findHeader(sheet.rows) }))
    .filter((entry) => entry.header);
  const chosen = candidates.sort((left, right) =>
    (right.sheet.name.includes('训练计划') ? 1 : 0) - (left.sheet.name.includes('训练计划') ? 1 : 0))[0];
  if (!chosen || !chosen.header) {
    return { sheetName: '', activities: [], planned: [], plans: [], notes: [], errors: ['没有找到含「日期 / 实际」列的表格，请确认工作表结构与训练课表模板一致。'], skipped: 0 };
  }

  const header = chosen.header;
  const pick = (row: string[], index: number) => (index >= 0 ? (row[index] ?? '') : '');
  const activities: Activity[] = [];
  const plans: PlannedRow[] = [];
  const notes: TrainingNote[] = [];
  const errors: string[] = [];
  let skipped = 0;

  for (let index = header.index + 1; index < chosen.sheet.rows.length; index += 1) {
    const row = chosen.sheet.rows[index];
    const date = dateValue(pick(row, header.date));
    if (!date) continue;
    const main = pick(row, header.main);
    const support = pick(row, header.support);
    const splits = flattenText(pick(row, header.splits));
    const timing = flattenText(pick(row, header.timing));
    const plannedKm = numeric(pick(row, header.planned));
    const actualKm = numeric(pick(row, header.actual));

    if (plannedKm && plannedKm > 0) {
      const type = planTypeFromText(main);
      if (type) {
        plans.push({ date, type, km: Math.round(plannedKm * 10) / 10,
          detail: flattenText([main, support].filter(Boolean).join(' ')).slice(0, 300) });
      }
    }

    // 支持列（力量 / 跑技 / 活动度 / 恢复）单独记成训练笔记
    if (support) {
      const kind = noteKindFromText(support);
      if (kind) {
        notes.push({ id: 'xlsx-note-' + date + '-' + index, date, kind, text: flattenText(support).slice(0, 1200), source: 'xlsx' });
      }
    }
    if (!actualKm || actualKm <= 0) continue;
    const minutes = minutesFromText(timing + ' ' + splits);
    if (!minutes) skipped += 1;
    activities.push({
      id: 'xlsx-' + date + '-' + index,
      date,
      time: '导入',
      title: cleanTitle(main).slice(0, 60),
      minutes: minutes ?? 0,
      km: Math.round(actualKm * 100) / 100,
      averageHr: averageHeartRate(splits),
      core: splits ? splits.slice(0, 300) : undefined,
      role: '待归类',
    });
  }

  // 其它参考表：比赛日与目标、营养恢复、动作库，转成训练笔记
  const byName = new Map(sheets.map((sheet) => [sheet.name, sheet]));
  const fallbackDate = plans[0]?.date ?? activities[0]?.date;
  let raceDate: string | undefined;

  const basic = byName.get('基本信息与说明');
  if (basic) {
    const rows = basic.rows.map((row) => row.map((cell) => flattenText(cell)));
    for (const row of rows) {
      const label = normalizeHeader(row[0] ?? '');
      if (label.includes('比赛日')) raceDate = dateValue(row[1] ?? '') ?? raceDate;
    }
    const target = rows.find((row) => normalizeHeader(row[0] ?? '').includes('目标用时'));
    if (raceDate) {
      let goal = '';
      if (target) {
        const values = target.slice(1).map((cell) => formatTimeSerial(cell)).filter((cell) => cell && !/^对应配速/.test(cell));
        goal = values.join(' / ');
      }
      notes.push({ id: 'xlsx-note-race', date: raceDate, kind: '比赛', title: '比赛日',
        text: ('比赛日目标：' + (goal || '见课表')).slice(0, 600), source: 'xlsx' });
    }
  }

  const recovery = byName.get('恢复与比赛');
  if (recovery) {
    const lines = recovery.rows.map((row) => flattenText(row.filter(Boolean).join(' · '))).filter(Boolean);
    const nutrition = lines.filter((line) => /蛋白质|碳水|补水|营养/.test(line)).slice(0, 8).join('\n');
    const raceFlow = lines.filter((line) => /比赛|起跑|热身|补给/.test(line)).slice(0, 8).join('\n');
    const dateForNote = raceDate ?? fallbackDate;
    if (nutrition && dateForNote) notes.push({ id: 'xlsx-note-nutrition', date: dateForNote, kind: '恢复',
      title: '营养与恢复参考', text: nutrition.slice(0, 1500), source: 'xlsx' });
    if (raceFlow && dateForNote) notes.push({ id: 'xlsx-note-raceflow', date: dateForNote, kind: '比赛',
      title: '比赛流程与补给', text: raceFlow.slice(0, 1500), source: 'xlsx' });
  }

  const library = byName.get('力量与跑技动作');
  if (library && fallbackDate) {
    const groups = new Map<string, string[]>();
    let current = '其它说明';
    const moduleKey = (module: string) => {
      if (/^A|力量\s*A/.test(module)) return '力量 A';
      if (/^B|力量\s*B/.test(module)) return '力量 B';
      if (/^H|跑技|动态|短加速/.test(module)) return '跑技 H';
      if (/^M|活动度/.test(module)) return '活动度 M';
      return undefined;
    };
    for (const row of library.rows) {
      const module = flattenText(row[0] ?? '');
      const action = flattenText(row[1] ?? '');
      if (module === '模块' && action === '动作') continue;
      const explicit = module ? moduleKey(module) : undefined;
      if (explicit) current = explicit;
      const key = explicit ?? (module ? '其它说明' : current);
      if (!action) continue;
      const line = action + (row[2] ? '（' + flattenText(row[2]) + '）' : '') + (row[3] ? '：' + flattenText(row[3]) : '');
      const list = groups.get(key) ?? [];
      list.push(line);
      groups.set(key, list);
    }
    for (const [title, lines] of groups) {
      const kind = title.includes('力量') ? '力量' : title.includes('跑技') ? '跑技' : '恢复';
      notes.push({ id: 'xlsx-note-lib-' + title, date: fallbackDate, kind,
        title: '动作库 · ' + title, text: lines.join('\n').slice(0, 1800), source: 'xlsx' });
    }
  }
  if (!activities.length && !plans.length) errors.push('表格里没有可导入的训练行（需要有实际公里或计划公里）。');
  return { sheetName: chosen.sheet.name, activities, planned: plans, plans, notes, errors, skipped };
}
