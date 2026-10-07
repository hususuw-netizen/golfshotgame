const SPREADSHEET_ID = '1efoO-gdSAVCYAY0jhX2Vb5HC3dMeiF_dSPVp3HeOZ38';
const ROSTER_SHEET = '學生名單';
const RECORD_SHEET = '純記桿數紀錄';
const HEADERS = ['紀錄編號', '學號', '姓名', '日期', '紀錄範圍',
  ...Array.from({ length: 18 }, (_, i) => `第${i + 1}洞`), '總桿數', '同步時間', '狀態'];

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('高爾夫上果嶺紀錄工具')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, viewport-fit=cover');
}

// Only the signed-in project owner may initialize the spreadsheet from the editor.
function initializeSpreadsheet() {
  const activeEmail = Session.getActiveUser().getEmail();
  if (!activeEmail || activeEmail !== Session.getEffectiveUser().getEmail()) throw new Error('僅專案擁有者可初始化工作表。');
  return setupSpreadsheet_();
}

function setupSpreadsheet_() {
  return withLock_(() => {
    const book = SpreadsheetApp.openById(SPREADSHEET_ID);
    const roster = book.getSheetByName(ROSTER_SHEET) || book.insertSheet(ROSTER_SHEET);
    if (!roster.getLastRow()) roster.getRange(1, 1, 1, 2).setValues([['學號', '姓名']]);
    if (roster.getRange(1, 1, 1, 2).getDisplayValues()[0].join('|') !== '學號|姓名') {
      throw new Error('學生名單第一列必須為「學號、姓名」，原有資料未更動。');
    }
    roster.getRange('A:A').setNumberFormat('@');
    roster.setFrozenRows(1);
    const records = getRecords_();
    records.setFrozenRows(1);
    records.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    records.autoResizeColumns(1, HEADERS.length);
    return '工作表設定完成';
  });
}

function getRecords_() {
  const book = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = book.getSheetByName(RECORD_SHEET) || book.insertSheet(RECORD_SHEET);
  if (sheet.getMaxColumns() < HEADERS.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), HEADERS.length - sheet.getMaxColumns());
  }
  if (!sheet.getLastRow()) sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  const actual = sheet.getRange(1, 1, 1, HEADERS.length).getDisplayValues()[0];
  if (actual.join('|') !== HEADERS.join('|')) throw new Error('純記桿數紀錄欄位不符，請檢查工作表。');
  sheet.getRange('B:B').setNumberFormat('@');
  return sheet;
}

function findStudent_(studentId, fullName) {
  const id = String(studentId || '').trim();
  const name = String(fullName || '').trim();
  if (!/^\d{1,24}$/.test(id) || !name || name.length > 24) throw new Error('請輸入正確的學號與姓名。');
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(ROSTER_SHEET);
  if (!sheet || sheet.getLastRow() < 2) throw new Error('學生名單尚未填寫，請老師先加入學號與姓名。');
  const matches = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getDisplayValues()
    .filter(row => row[0].trim() === id);
  if (matches.length !== 1 || matches[0][1].trim() !== name) throw new Error('學號與姓名不符合學生名單。');
  return { studentId: id, fullName: name };
}

function loginStudent(studentId, fullName) {
  const student = findStudent_(studentId, fullName);
  const token = Utilities.getUuid() + Utilities.getUuid();
  CacheService.getScriptCache().put('session:' + token, JSON.stringify(student), 21600);
  return { token, ...student };
}

function session_(token) {
  if (typeof token !== 'string' || token.length > 100) throw new Error('請重新登入。');
  const raw = CacheService.getScriptCache().get('session:' + token);
  if (!raw) throw new Error('登入已過期，請重新登入後再同步。');
  const student = JSON.parse(raw);
  return findStudent_(student.studentId, student.fullName);
}

function logoutStudent(token) {
  if (typeof token === 'string' && token.length <= 100) CacheService.getScriptCache().remove('session:' + token);
  return { ok: true };
}

function withLock_(callback) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('目前儲存人數較多，請稍後重試。');
  try { return callback(); } finally { lock.releaseLock(); }
}

function rows_(sheet) {
  return sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues();
}

function compareStudentIds_(a, b) {
  const left = String(a).replace(/^0+(?=\d)/, '');
  const right = String(b).replace(/^0+(?=\d)/, '');
  return left.length - right.length || left.localeCompare(right) || String(a).localeCompare(String(b));
}

function writeRows_(sheet, rows) {
  rows.sort((a, b) => compareStudentIds_(a[1], b[1]) || String(a[3]).localeCompare(String(b[3])) || String(a[0]).localeCompare(String(b[0])));
  if (rows.length + 1 > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), rows.length + 1 - sheet.getMaxRows());
  // Keep all text literal, even when a name starts with a spreadsheet formula character.
  const literalRows = rows.map(row => row.map(value => typeof value === 'string' && /^[=+\-@']/.test(value) ? "'" + value : value));
  sheet.getRange(2, 1, rows.length, HEADERS.length).setValues(literalRows);
  SpreadsheetApp.flush();
}

function validateRound_(round) {
  if (!round || round.modeType !== 'score' || !/^round-[A-Za-z0-9-]{1,100}$/.test(round.id || '')) throw new Error('僅接受純記桿數歷史紀錄。');
  const ranges = { front: [1, 9, '前 9'], back: [10, 18, '後 9'], full: [1, 18, '18 洞'] };
  const range = ranges[round.roundMode];
  const date = new Date(round.date);
  if (!range || !Number.isFinite(date.getTime()) || !Array.isArray(round.holes) || round.holes.length !== range[1] - range[0] + 1) throw new Error('紀錄日期或洞數不正確。');
  const scores = Array(18).fill('');
  round.holes.forEach((hole, index) => {
    const shots = hole && hole.savedRecord && hole.savedRecord.shots;
    if (hole.hole !== range[0] + index || !Number.isInteger(shots) || shots < 1 || shots > 20) throw new Error('每洞桿數須為 1 至 20 的整數。');
    scores[hole.hole - 1] = shots;
  });
  return { date: date.toISOString(), label: range[2], scores, total: scores.reduce((sum, value) => sum + Number(value || 0), 0) };
}

function saveScoreRound(token, round) {
  const student = session_(token);
  const data = validateRound_(round);
  return withLock_(() => {
    const sheet = getRecords_();
    const rows = rows_(sheet);
    const existing = rows.find(row => row[0] === round.id);
    if (existing && existing[1] !== student.studentId) throw new Error('紀錄編號已被使用。');
    // A repeated request never creates a duplicate or resurrects a deleted record.
    if (existing) return { ok: true, id: round.id, deleted: existing[25] === '已刪除' };
    rows.push([round.id, student.studentId, student.fullName, data.date, data.label,
      ...data.scores, data.total, new Date().toISOString(), '有效']);
    writeRows_(sheet, rows);
    return { ok: true, id: round.id };
  });
}

function listScoreRounds(token) {
  const student = session_(token);
  return withLock_(() => rows_(getRecords_())
    .filter(row => row[1] === student.studentId && row[25] === '有效')
    .map(row => ({
      id: String(row[0]), date: String(row[3]), courseId: 'score-only', courseName: '純記桿數', teeName: '',
      roundMode: row[4] === '前 9' ? 'front' : row[4] === '後 9' ? 'back' : 'full',
      roundLabel: String(row[4]), totalShots: Number(row[23]), modeType: 'score', syncStatus: 'synced',
      holes: row.slice(5, 23).flatMap((shots, i) => shots === '' ? [] : [{ hole: i + 1, par: 2, savedRecord: { shots: Number(shots), resultText: `${shots} 桿` } }])
    })).sort((a, b) => b.date.localeCompare(a.date)));
}

function deleteScoreRound(token, roundId) {
  const student = session_(token);
  return withLock_(() => {
    const sheet = getRecords_();
    const rows = rows_(sheet);
    const row = rows.find(item => item[0] === roundId && item[1] === student.studentId);
    if (row) { row[25] = '已刪除'; row[24] = new Date().toISOString(); writeRows_(sheet, rows); }
    return { ok: true, id: roundId };
  });
}
