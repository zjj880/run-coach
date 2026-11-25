import assert from 'node:assert/strict'
import test from 'node:test'
import { zipSync, strToU8 } from 'fflate'
import { mapTrainingWorkbook, readWorkbook } from '../src/xlsxImport.ts'

function buildXlsx() {
  const shared = ['日期', '计划公里', '跑步主课', '历史计时', '实际跑步公里', '历史分段', '天', '慢跑', '10', '12.5', '轻松跑', '计时合计1:00:00', '5:00/km']
  const sharedXml = '<?xml version="1.0" encoding="UTF-8"?><sst count="' + shared.length + '">' +
    shared.map((value) => '<si><t>' + value + '</t></si>').join('') + '</sst>'
  const planRows = [
    '<row r="1"><c r="A1" t="s"><v>0</v></c></row>',
    '<row r="3"><c r="A3" t="s"><v>0</v></c><c r="B3" t="s"><v>1</v></c><c r="C3" t="s"><v>2</v></c><c r="D3" t="s"><v>3</v></c><c r="E3" t="s"><v>4</v></c><c r="F3" t="s"><v>5</v></c></row>',
    '<row r="4"><c r="A4"><v>46266</v></c><c r="B4"><v>10</v></c><c r="C4" t="s"><v>10</v></c><c r="D4" t="s"><v>11</v></c><c r="E4"><v>10.5</v></c><c r="F4" t="s"><v>12</v></c><c r="G4" t="inlineStr"><is><t>力量 A 核心 2 组</t></is></c></row>',
    '<row r="5"><c r="A5" t="inlineStr"><is><t>2026-09-02</t></is></c><c r="B5"><v>14</v></c><c r="C5" t="s"><v>10</v></c><c r="D5" t="inlineStr"><is><t>同日1条活动记录</t></is></c><c r="E5"><v>12.07</v></c><c r="F5" t="inlineStr"><is><t>22:36 跑步6km，29:21，4:53/km, HR148</t></is></c><c r="G5" t="inlineStr"><is><t>仅轻柔活动度，不加力量</t></is></c></row>',
    '<row r="6"><c r="A6" t="s"><v>6</v></c><c r="E6"><v>0</v></c></row>',
  ].join('')
  const planXml = '<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData>' + planRows + '</sheetData></worksheet>'
  // 支持列（力量/跑技）需要表头包含「力量」，补一个 G3 表头
  const planXmlWithSupport = planXml.replace('<c r="F3" t="s"><v>5</v></c>', '<c r="F3" t="s"><v>5</v></c><c r="G3" t="inlineStr"><is><t>力量跑技</t></is></c>')
  const libraryRows = [
    '<row r="1"><c r="A1" t="inlineStr"><is><t>模块</t></is></c><c r="B1" t="inlineStr"><is><t>动作</t></is></c><c r="C1" t="inlineStr"><is><t>组次</t></is></c></row>',
    '<row r="2"><c r="A2" t="inlineStr"><is><t>A 力量</t></is></c><c r="B2" t="inlineStr"><is><t>核心稳定</t></is></c><c r="C2" t="inlineStr"><is><t>2 组</t></is></c></row>',
  ].join('')
  const libraryXml = '<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData>' + libraryRows + '</sheetData></worksheet>'
  const workbookXml = '<?xml version="1.0" encoding="UTF-8"?><workbook><sheets>' +
    '<sheet name="训练计划" sheetId="1" r:id="rId1"/><sheet name="力量与跑技动作" sheetId="2" r:id="rId2"/></sheets></workbook>'
  const relsXml = '<?xml version="1.0" encoding="UTF-8"?><Relationships>' +
    '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>'
  return zipSync({
    'xl/workbook.xml': strToU8(workbookXml),
    'xl/_rels/workbook.xml.rels': strToU8(relsXml),
    'xl/sharedStrings.xml': strToU8(sharedXml),
    'xl/worksheets/sheet1.xml': strToU8(planXmlWithSupport),
    'xl/worksheets/sheet2.xml': strToU8(libraryXml),
  })
}

test('XLSX reader lists sheets and reads shared/inline/numeric cells', () => {
  const sheets = readWorkbook(buildXlsx())
  assert.equal(sheets.length, 2)
  assert.equal(sheets[0].name, '训练计划')
  assert.equal(sheets[1].name, '力量与跑技动作')
  assert.equal(sheets[0].rows[2][0], '46266')
})

test('training workbook mapping builds activities, plans and notes from the template layout', () => {
  const mapped = mapTrainingWorkbook(buildXlsx())
  assert.equal(mapped.sheetName, '训练计划')
  assert.equal(mapped.activities.length, 2)
  assert.equal(mapped.activities[0].date, '2026-09-01')
  assert.equal(mapped.activities[0].km, 10.5)
  assert.equal(mapped.activities[0].minutes, 60)
  assert.equal(mapped.activities[1].date, '2026-09-02')
  assert.equal(mapped.activities[1].minutes, 29.4)
  assert.equal(mapped.activities[1].averageHr, 148)
  assert.equal(mapped.plans.length, 2)
  assert.equal(mapped.plans[0].type, '轻松跑')
  assert.equal(mapped.plans[0].km, 10)
  assert.equal(mapped.plans[1].km, 14)
  // 支持列生成笔记：一行力量、一行「不加力量」应归为恢复
  assert.equal(mapped.notes.some((note) => note.kind === '力量' && note.date === '2026-09-01'), true)
  assert.equal(mapped.notes.some((note) => note.kind === '恢复' && note.text.includes('不加力量')), true)
  // 动作库表生成参考笔记
  assert.equal(mapped.notes.some((note) => note.kind === '力量' && note.text.includes('核心稳定')), true)
})

test('unsupported workbook returns a readable error instead of throwing', () => {
  const mapped = mapTrainingWorkbook(strToU8('not a zip'))
  assert.equal(mapped.activities.length, 0)
  assert.match(mapped.errors[0], /无法读取/)
})
