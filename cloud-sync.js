window.createCloudSync = function createCloudSync(ctx) {
  const { state, elements, readStorage, saveCurrentUserData, renderRecentRounds, showMessage } = ctx;
  const enabled = Boolean(window.google && window.google.script && window.google.script.run);
  let token = '';
  let generation = 0;
  let running = null;
  const key = id => `golf-score-outbox-${id}`;
  function readQueue(id) { const value = readStorage(key(id), []); return Array.isArray(value) ? value : []; }
  function writeQueue(id, queue) { localStorage.setItem(key(id), JSON.stringify(queue)); }
  function call(method, ...args) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('連線逾時，請重試同步。')), 30000);
      window.google.script.run.withSuccessHandler(result => { clearTimeout(timer); resolve(result); })
        .withFailureHandler(error => { clearTimeout(timer); reject(new Error(error.message || '同步失敗')); })[method](...args);
    });
  }
  function status(text, warn = false) {
    showMessage(elements.cloudSyncMessage, text, warn ? 'is-warn' : 'is-info');
    elements.cloudRetryButton.classList.toggle('hidden', !enabled || !state.profile.username);
  }
  function mark(id, value) {
    const round = state.rounds.find(item => item.id === id);
    if (round) round.syncStatus = value;
    saveCurrentUserData();
    renderRecentRounds();
  }
  async function login(id, name) {
    if (!enabled) return;
    const session = await call('loginStudent', id, name);
    generation += 1;
    token = session.token;
    status('已連接 Google 試算表。');
  }
  function enqueue(round, action = 'save') {
    if (!enabled || round.modeType !== 'score') return true;
    const id = state.profile.username;
    try {
      const queue = readQueue(id).filter(item => !(item.id === round.id && item.action === action));
      queue.push({ id: round.id, action, round: action === 'save' ? JSON.parse(JSON.stringify(round)) : null });
      writeQueue(id, queue);
      return true;
    } catch (error) {
      status('裝置暫存空間不足，請先匯出 CSV，未能加入同步佇列。', true);
      return false;
    }
  }
  function queueRound(round) {
    if (round.modeType !== 'score') return;
    if (!enabled) { round.syncStatus = 'local'; saveCurrentUserData(); status('已存於本機；此網址尚未連接 Google 試算表。', true); return; }
    round.syncStatus = enqueue(round) ? 'pending' : 'error';
    saveCurrentUserData();
    renderRecentRounds();
    status('已儲存於本機，尚未上傳。按「同步到後端」才會同步純記桿數紀錄。');
  }
  function queueDelete(round) {
    if (!enabled || round.modeType !== 'score') return true;
    const queued = enqueue(round, 'delete');
    if (queued) status('已從本機移除。按「同步到後端」才會同步刪除。');
    return queued;
  }
  async function runSync(upload = true) {
    const id = state.profile.username;
    const version = generation;
    const sessionToken = token;
    const active = () => generation === version && state.profile.username === id;
    if (!id) return;
    if (!sessionToken) { status('請重新登入以連接 Google 試算表；本機紀錄仍保留。', true); return; }
    try {
      status(upload ? '正在同步純記桿數紀錄…' : '正在讀取後端歷史紀錄…');
      // Include pending history restored from storage, but never upload simulation records or old local-only history automatically.
      for (const round of upload ? state.rounds.filter(item => item.modeType === 'score' && ['pending', 'error'].includes(item.syncStatus)) : []) {
        if (!readQueue(id).some(item => item.id === round.id && item.action === 'save') && !enqueue(round)) {
          throw new Error('裝置暫存空間不足');
        }
      }
      // A click authorizes only operations already queued at that moment.
      const operations = upload ? readQueue(id) : [];
      for (const item of operations) {
        if (!active()) return;
        const result = await call(item.action === 'delete' ? 'deleteScoreRound' : 'saveScoreRound', sessionToken, item.action === 'delete' ? item.id : item.round);
        if (!result || !result.ok) throw new Error('試算表尚未確認儲存成功。');
        // Remove only this operation, preserving anything queued while awaiting the server.
        writeQueue(id, readQueue(id).filter(entry => !(entry.id === item.id && entry.action === item.action)));
        if (!active()) return;
        if (item.action === 'save') mark(item.id, 'synced');
      }
      if (!active()) return;
      const remote = await call('listScoreRounds', sessionToken);
      if (!active()) return;
      const currentQueue = readQueue(id);
      const deletes = new Set(currentQueue.filter(item => item.action === 'delete').map(item => item.id));
      const local = state.rounds.filter(round => round.modeType !== 'score' || round.syncStatus !== 'synced');
      const merged = new Map(remote.filter(round => !deletes.has(round.id)).map(round => [round.id, round]));
      for (const round of local) if (!deletes.has(round.id)) merged.set(round.id, round);
      state.rounds = [...merged.values()].sort((a, b) => b.date.localeCompare(a.date));
      saveCurrentUserData(); renderRecentRounds();
      status(currentQueue.length ? '本機有尚未同步的變更，請按「同步到後端」。' : upload ? '純記桿數紀錄已同步至 Google 試算表。' : '已讀取後端歷史紀錄；新紀錄需按「同步到後端」才會上傳。');
    } catch (error) {
      if (!active()) return;
      if (upload) for (const item of readQueue(id)) if (item.action === 'save') mark(item.id, 'error');
      status(`尚未${upload ? '同步' : '讀取'}：${error.message}。紀錄保留在本機，可按「同步到後端」。`, true);
    }
  }
  function sync(upload = true) {
    if (!enabled) return Promise.resolve();
    if (running) return running;
    elements.cloudRetryButton.disabled = true;
    running = runSync(upload).finally(() => {
      running = null;
      elements.cloudRetryButton.disabled = false;
    });
    return running;
  }
  function logout() {
    const previous = token;
    token = ''; generation += 1;
    if (enabled && previous) void call('logoutStudent', previous).catch(() => {});
  }
  elements.cloudRetryButton.addEventListener('click', () => void sync());
  return { enabled, login, queueRound, queueDelete, sync, loadHistory: () => sync(false), logout };
};
