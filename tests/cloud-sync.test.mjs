import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

class Sheet {
  constructor(rows = []) { this.rows = rows; this.maxRows = 1000; this.maxCols = 26; }
  getLastRow() { return this.rows.length; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertRowsAfter(_, n) { this.maxRows += n; }
  insertColumnsAfter(_, n) { this.maxCols += n; }
  setFrozenRows() {}
  autoResizeColumns() {}
  getRange(r, c, height, width) {
    if (typeof r === 'string') return { setNumberFormat() {} };
    const get = () => Array.from({length: height}, (_, i) => Array.from({length: width}, (_, j) => this.rows[r+i-1]?.[c+j-1] ?? ''));
    return {
      getValues: get,
      getDisplayValues: () => get().map(row => row.map(String)),
      setFontWeight() {},
      setValues: values => values.forEach((row, i) => { this.rows[r+i-1] ||= []; row.forEach((v,j) => { this.rows[r+i-1][c+j-1] = v; }); })
    };
  }
}
const sheets = new Map([['學生名單', new Sheet([['學號','姓名'], ['0010','甲'], ['0002','乙'], ['100','丙']])]]);
const book = { getSheetByName: name => sheets.get(name), insertSheet: name => { const sheet = new Sheet(); sheets.set(name, sheet); return sheet; } };
const cache = new Map();
let uuid = 0;
let activeEmail = 'owner@example.test';
const backend = vm.createContext({
  Session: { getActiveUser: () => ({ getEmail: () => activeEmail }), getEffectiveUser: () => ({ getEmail: () => 'owner@example.test' }) },
  SpreadsheetApp: { openById: () => book, flush() {} },
  Utilities: { getUuid: () => `uuid-${++uuid}` },
  CacheService: { getScriptCache: () => ({ put: (k,v) => cache.set(k,v), get: k => cache.get(k), remove: k => cache.delete(k) }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) }
});
vm.runInContext(fs.readFileSync('apps-script/Code.gs','utf8'), backend);
backend.setupSpreadsheet_();
assert.equal(backend.initializeSpreadsheet(),'工作表設定完成');
activeEmail = '';
assert.throws(() => backend.initializeSpreadsheet(), /擁有者/);
activeEmail = 'student@example.test';
assert.throws(() => backend.initializeSpreadsheet(), /擁有者/);
activeEmail = 'owner@example.test';
const a = backend.loginStudent('0010', '甲');
const b = backend.loginStudent('0002', '乙');
assert.throws(() => backend.loginStudent('0010','乙'), /不符合/);
const makeRound = (id, mode = 'front') => ({ id, date:'2026-10-01T01:00:00.000Z', modeType:'score', roundMode:mode,
  holes:Array.from({length:mode === 'full' ? 18 : 9}, (_,i) => ({hole: i + (mode === 'back' ? 10 : 1), par:2, savedRecord:{shots:3}})) });
const front = makeRound('round-1');
assert.throws(() => backend.saveScoreRound('invalid-token',front), /重新登入/);
assert.throws(() => backend.deleteScoreRound('invalid-token','round-1'), /重新登入/);
backend.saveScoreRound(a.token,front);
backend.saveScoreRound(a.token,front);
assert.equal(sheets.get('純記桿數紀錄').rows.length,2,'idempotent saves');
backend.saveScoreRound(b.token,makeRound('round-2','back'));
assert.equal(sheets.get('純記桿數紀錄').rows[1][1],'0002','numeric student sorting');
assert.equal(backend.listScoreRounds(a.token).length,1,'student isolation');
assert.equal(backend.listScoreRounds(b.token)[0].holes[0].hole,10,'back nine mapping');
assert.throws(() => backend.saveScoreRound(b.token,front), /已被使用/);
assert.throws(() => backend.saveScoreRound(a.token,{...front,id:'round-sim',modeType:'simulation'}), /僅接受/);
assert.throws(() => backend.saveScoreRound(a.token,{...front,id:'round-bad',holes:[]}), /洞數/);
const decimal = makeRound('round-decimal'); decimal.holes[0].savedRecord.shots = 1.5;
assert.throws(() => backend.saveScoreRound(a.token,decimal), /整數/);
backend.deleteScoreRound(b.token,'round-1');
assert.equal(backend.listScoreRounds(a.token).length,1,'cannot delete another student');
backend.deleteScoreRound(a.token,'round-1');
backend.saveScoreRound(a.token,front);
assert.equal(backend.listScoreRounds(a.token).length,0,'retry cannot resurrect deleted rows');
assert.equal(backend.compareStudentIds_('9','100'),-2);
assert.ok(backend.compareStudentIds_('9007199254740993','9007199254740992') > 0,'large IDs sort without numeric precision loss');

const storage = new Map();
const state = { profile: { username:'0010', fullName:'甲' }, rounds:[] };
let syncButtonHandler;
const elements = { cloudRetryButton: { classList: { toggle() {} }, addEventListener(_, handler) { syncButtonHandler = handler; } }, cloudSyncMessage: {} };
const onlineListeners = [];
let fail = false;
const requests = [];
function runner(success, failure) {
  return new Proxy({ withSuccessHandler: fn => runner(fn,failure), withFailureHandler: fn => runner(success,fn) }, {
    get(target, property) {
      if (property in target) return target[property];
      return (...args) => queueMicrotask(() => {
        requests.push(property);
        try { if(fail) throw Error('offline'); success(JSON.parse(JSON.stringify(backend[property](...args)))); } catch(error) { failure(error); }
      });
    }
  });
}
const client = vm.createContext({ window: { google:{script:{run:runner()}}, addEventListener(event,handler) { if(event === 'online') onlineListeners.push(handler); } },
  localStorage: { setItem: (k,v) => storage.set(k,v) }, setTimeout, clearTimeout, console });
vm.runInContext(fs.readFileSync('cloud-sync.js','utf8'),client);
const sync = client.window.createCloudSync({ state, elements,
  readStorage: (k, fallback) => storage.has(k) ? JSON.parse(storage.get(k)) : fallback,
  saveCurrentUserData() {}, renderRecentRounds() {}, showMessage: (target,text) => { target.text = text; } });
await sync.login('0010','甲');
const offline = makeRound('round-offline'); state.rounds.push(offline);
const beforeQueue = requests.length;
sync.queueRound(offline);
await Promise.resolve();
assert.equal(requests.length,beforeQueue,'saving history never contacts backend');
assert.equal(offline.syncStatus,'pending');
assert.equal(onlineListeners.length,0,'restoring network must not trigger sync');
await sync.loadHistory();
assert.equal(requests.filter(r=>r==='saveScoreRound').length,0,'login history read must not upload pending records');
fail = true; await sync.sync();
assert.equal(offline.syncStatus,'error');
assert.equal(JSON.parse(storage.get('golf-score-outbox-0010')).length,1,'failed sync persists pending queue');
fail = false; syncButtonHandler(); await sync.sync();
assert.equal(state.rounds.find(r => r.id === offline.id).syncStatus,'synced');
assert.equal(JSON.parse(storage.get('golf-score-outbox-0010')).length,0);
const requestCount = requests.length;
sync.queueRound({...makeRound('round-local'),modeType:'simulation'});
assert.equal(requests.length,requestCount,'simulation never uploads');
const beforeDelete = requests.length;
sync.queueDelete(offline); state.rounds = state.rounds.filter(r => r.id !== offline.id);
await Promise.resolve();
assert.equal(requests.length,beforeDelete,'delete remains local until button click');
await sync.sync();
assert.equal(backend.listScoreRounds(a.token).length,0,'cloud soft delete');

// Actual score module button: a completed round enters history, then invokes sync.
let saveHandler;
let syncedRound;
const fakeElements = new Proxy({}, { get: (_, name) => ({ addEventListener: (_, fn) => { if(name === 'scoreSaveRoundButton') saveHandler = fn; } }) });
const moduleState = { rounds:[], profile:{} };
const holes = front.holes.map(h => ({...h}));
const score = vm.createContext({window:{confirm:()=>true}});
vm.runInContext(fs.readFileSync('page-score.js','utf8'),score);
const noop = () => {};
score.window.createScorePageModule({state:moduleState, elements:{...fakeElements,
  scoreTabs:[], scoreShotPresetButtons:[], scoreRoundSaveModeTabs:[],
  scoreHoleList:{addEventListener:noop}, scoreMoreShotsButton:{addEventListener:noop}, scoreShotsInput:{addEventListener:noop},
  scoreSaveHoleButton:{addEventListener:noop}, scoreResetHoleButton:{addEventListener:noop}, scoreGoSummaryButton:{addEventListener:noop},
  scoreSaveRoundButton:{addEventListener:(_,fn)=>{saveHandler=fn;}}},
  canSaveScoreRoundHistory:()=>true, getScoreRoundSaveConfig:()=>({mode:'front',label:'前 9',start:0,end:9}),
  getScoreRoundSaveHoles:()=>holes, cloneScoreHoleState:h=>h, createRoundId:()=> 'round-click',
  getTotalShotsForHoles:()=>27, currentScoreHoles:()=>holes, makeScoreHoleState:i=>({hole:i}),
  saveCurrentUserData:noop, setActiveAppPage:noop, confirmRoundSave:async()=>true, syncScoreRound:r=>{syncedRound=r;}
}).bindEvents();
await saveHandler();
assert.equal(moduleState.rounds[0].id,'round-click');
assert.equal(syncedRound,moduleState.rounds[0],'history save triggers sync');
assert.equal(syncedRound.holes.length,9);
console.log('PASS: roster login, isolated history, numeric sorting, duplicate retries, validation, soft delete, offline queue, simulation exclusion, history-save trigger.');
