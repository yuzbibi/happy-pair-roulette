/* ========================================
   ペアメーカー - アプリケーションロジック
   ======================================== */

// ===== データ管理 =====
class AppData {
  constructor() {
    this.classes = this.load('pairmaker_classes') || [];
    this.history = this.load('pairmaker_history') || {}; // classId -> [{groupSize, pairs: [[a,b],[c,d]...]}]
  }

  save(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
  }

  load(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  }

  saveClasses() {
    this.save('pairmaker_classes', this.classes);
  }

  saveHistory() {
    this.save('pairmaker_history', this.history);
  }

  addClass(name, students) {
    const id = 'cls_' + Date.now();
    this.classes.push({ id, name, students });
    this.saveClasses();
    return id;
  }

  updateClass(id, name, students) {
    const cls = this.classes.find(c => c.id === id);
    if (cls) {
      cls.name = name;
      cls.students = students;
      this.saveClasses();
    }
  }

  deleteClass(id) {
    this.classes = this.classes.filter(c => c.id !== id);
    delete this.history[id];
    this.saveClasses();
    this.saveHistory();
  }

  getClass(id) {
    return this.classes.find(c => c.id === id);
  }

  // 過去の組み合わせを記録
  recordGroups(classId, groups) {
    if (!this.history[classId]) this.history[classId] = [];
    const pairs = [];
    for (const group of groups) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const pair = [group[i], group[j]].sort();
          pairs.push(pair);
        }
      }
    }
    this.history[classId].push({ timestamp: Date.now(), pairs });
    this.saveHistory();
  }

  // 過去の組み合わせ回数を取得 (ペアのキー -> 回数)
  getPairCounts(classId) {
    const counts = {};
    const hist = this.history[classId] || [];
    for (const entry of hist) {
      for (const [a, b] of entry.pairs) {
        const key = `${a}|||${b}`;
        counts[key] = (counts[key] || 0) + 1;
      }
    }
    return counts;
  }

  resetHistory(classId) {
    delete this.history[classId];
    this.saveHistory();
  }
}

// ===== シャッフルアルゴリズム =====
class GroupShuffler {
  // Fisher-Yatesシャッフル
  static shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ペアスコアを最小化するようにシャッフル（重複を避ける）
  static createGroups(students, groupSize, pairCounts, remainderMode = 'distribute') {
    const n = students.length;
    if (n === 0) return { groups: [], hasOverlap: false, overlapInfo: [] };

    // 複数回試行して最良の組み合わせを選ぶ
    let bestGroups = null;
    let bestScore = Infinity;
    const maxTrials = 200;

    for (let trial = 0; trial < maxTrials; trial++) {
      const shuffled = this.shuffle(students);
      const groups = this.splitIntoGroups(shuffled, groupSize, remainderMode);
      const score = this.calcScore(groups, pairCounts);
      if (score < bestScore) {
        bestScore = score;
        bestGroups = groups;
        if (score === 0) break; // 完全に重複なし
      }
    }

    // 重複情報を収集
    const overlapInfo = [];
    for (const group of bestGroups) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const key = [...[group[i], group[j]]].sort().join('|||');
          if (pairCounts[key]) {
            overlapInfo.push({ a: group[i], b: group[j], count: pairCounts[key] });
          }
        }
      }
    }

    return {
      groups: bestGroups,
      hasOverlap: bestScore > 0,
      overlapInfo
    };
  }

  static splitIntoGroups(students, groupSize, remainderMode = 'distribute') {
    const groups = [];
    const n = students.length;
    const remainder = n % groupSize;
    const numFullGroups = Math.floor(n / groupSize);

    let idx = 0;
    if (remainder === 0) {
      // ちょうど割り切れる
      for (let i = 0; i < numFullGroups; i++) {
        groups.push(students.slice(idx, idx + groupSize));
        idx += groupSize;
      }
    } else if (remainderMode === 'distribute') {
      // 余りをどこかのグループに分散（+1人）
      const bigGroups = remainder;
      const smallGroups = numFullGroups - remainder;
      for (let i = 0; i < bigGroups; i++) {
        groups.push(students.slice(idx, idx + groupSize + 1));
        idx += groupSize + 1;
      }
      for (let i = 0; i < smallGroups; i++) {
        groups.push(students.slice(idx, idx + groupSize));
        idx += groupSize;
      }
    } else {
      // 余りを小グループにする（separate）
      for (let i = 0; i < numFullGroups; i++) {
        groups.push(students.slice(idx, idx + groupSize));
        idx += groupSize;
      }
      if (remainder > 0) {
        groups.push(students.slice(idx)); // 余り人数の小グループ
      }
    }

    return groups;
  }

  static calcScore(groups, pairCounts) {
    let score = 0;
    for (const group of groups) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const key = [...[group[i], group[j]]].sort().join('|||');
          score += (pairCounts[key] || 0);
        }
      }
    }
    return score;
  }

  // 重複が理論上不可避かどうかを事前チェック
  static checkUnavoidableOverlap(students, groupSize, pairCounts) {
    // 全ての可能なペアが既に使われていれば不可避
    const n = students.length;
    let allPairsUsed = true;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const key = [...[students[i], students[j]]].sort().join('|||');
        if (!pairCounts[key]) {
          allPairsUsed = false;
          break;
        }
      }
      if (!allPairsUsed) break;
    }

    return allPairsUsed && n > 1;
  }
}

// ===== UI管理 =====
class PairMakerApp {
  constructor() {
    this.data = new AppData();
    this.selectedClassId = null;
    this.absentStudents = new Set();
    this.groupSize = 4;
    this.remainderMode = 'distribute'; // 'distribute' | 'separate'
    this.editingClassId = null;
    this.currentGroups = null;
    this.modalCallback = null;

    this.init();
  }

  init() {
    this.bindTabEvents();
    this.bindClassManagement();
    this.bindSessionEvents();
    this.bindResultEvents();
    this.bindModalEvents();
    this.bindRemainderEvents();
    this.renderClassesList();
    this.renderClassSelectList();
    this.updateShuffleBtn();
  }

  // ===== タブ =====
  bindTabEvents() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`tab-content-${tab}`).classList.add('active');
      });
    });
  }

  // ===== クラス管理 =====
  bindClassManagement() {
    document.getElementById('btn-add-class').addEventListener('click', () => {
      this.editingClassId = null;
      document.getElementById('class-name-input').value = '';
      document.getElementById('students-textarea').value = '';
      document.getElementById('edit-panel-title').textContent = 'クラスを追加';
      document.getElementById('class-edit-form').classList.remove('hidden');
      document.getElementById('class-edit-placeholder').style.display = 'none';
      document.querySelectorAll('.class-list-item').forEach(i => i.classList.remove('active'));
    });

    document.getElementById('btn-save-class').addEventListener('click', () => {
      this.saveClass();
    });

    document.getElementById('btn-delete-class').addEventListener('click', () => {
      if (!this.editingClassId) return;
      const cls = this.data.getClass(this.editingClassId);
      this.showModal(
        'クラスを削除',
        `「${cls.name}」を削除します。この操作は元に戻せません。`,
        true,
        () => {
          this.data.deleteClass(this.editingClassId);
          if (this.selectedClassId === this.editingClassId) {
            this.selectedClassId = null;
            this.absentStudents.clear();
          }
          this.editingClassId = null;
          this.renderClassesList();
          this.renderClassSelectList();
          this.renderAbsentSelect();
          this.updateShuffleBtn();
          document.getElementById('class-edit-form').classList.add('hidden');
          document.getElementById('class-edit-placeholder').style.display = '';
          document.getElementById('edit-panel-title').textContent = 'クラスを選択';
        }
      );
    });

    document.getElementById('btn-cancel-class').addEventListener('click', () => {
      this.editingClassId = null;
      document.getElementById('class-edit-form').classList.add('hidden');
      document.getElementById('class-edit-placeholder').style.display = '';
      document.getElementById('edit-panel-title').textContent = 'クラスを選択';
      document.querySelectorAll('.class-list-item').forEach(i => i.classList.remove('active'));
    });
  }

  saveClass() {
    const name = document.getElementById('class-name-input').value.trim();
    const rawStudents = document.getElementById('students-textarea').value;
    const students = rawStudents.split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .map(s => s.slice(0, 5)); // 5文字以内に制限

    if (!name) {
      this.showModal('エラー', 'クラス名を入力してください。');
      return;
    }
    if (students.length < 2) {
      this.showModal('エラー', '生徒を2人以上入力してください。');
      return;
    }

    if (this.editingClassId) {
      this.data.updateClass(this.editingClassId, name, students);
    } else {
      const newId = this.data.addClass(name, students);
      this.editingClassId = newId;
    }

    this.renderClassesList();
    this.renderClassSelectList();
    if (this.selectedClassId === this.editingClassId) {
      this.renderAbsentSelect();
    }
    this.updateShuffleBtn();
    this.showModal('保存しました', `「${name}」（${students.length}名）を保存しました。`);
  }

  renderClassesList() {
    const list = document.getElementById('classes-list');
    if (this.data.classes.length === 0) {
      list.innerHTML = '<p class="empty-hint">クラスがありません</p>';
      return;
    }
    list.innerHTML = '';
    this.data.classes.forEach(cls => {
      const item = document.createElement('div');
      item.className = 'class-list-item';
      item.dataset.id = cls.id;
      if (cls.id === this.editingClassId) item.classList.add('active');
      item.innerHTML = `
        <span class="name">${this.esc(cls.name)}</span>
        <span class="count">${cls.students.length}名</span>
      `;
      item.addEventListener('click', () => {
        this.editingClassId = cls.id;
        document.querySelectorAll('.class-list-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        document.getElementById('class-name-input').value = cls.name;
        document.getElementById('students-textarea').value = cls.students.join('\n');
        document.getElementById('edit-panel-title').textContent = cls.name;
        document.getElementById('class-edit-form').classList.remove('hidden');
        document.getElementById('class-edit-placeholder').style.display = 'none';
      });
      list.appendChild(item);
    });
  }

  // ===== セッション（グループ分け）=====
  renderClassSelectList() {
    const list = document.getElementById('class-select-list');
    if (this.data.classes.length === 0) {
      list.innerHTML = '<p class="empty-hint">クラス管理タブでクラスを登録してください</p>';
      return;
    }
    list.innerHTML = '';
    this.data.classes.forEach(cls => {
      const item = document.createElement('div');
      item.className = 'class-select-item';
      item.dataset.id = cls.id;
      if (cls.id === this.selectedClassId) item.classList.add('active');
      item.innerHTML = `
        <span>📚 ${this.esc(cls.name)}</span>
        <span class="class-count">${cls.students.length}名</span>
      `;
      item.addEventListener('click', () => {
        this.selectedClassId = cls.id;
        this.absentStudents.clear();
        document.querySelectorAll('.class-select-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        this.renderAbsentSelect();
        this.updateShuffleBtn();
      });
      list.appendChild(item);
    });
  }

  renderAbsentSelect() {
    const area = document.getElementById('absent-select-area');
    const badge = document.getElementById('absent-count-badge');

    if (!this.selectedClassId) {
      area.innerHTML = '<p class="empty-hint">クラスを選択してください</p>';
      badge.textContent = '0人欠席';
      return;
    }

    const cls = this.data.getClass(this.selectedClassId);
    if (!cls) return;

    area.innerHTML = '';
    cls.students.forEach(student => {
      const chip = document.createElement('div');
      chip.className = 'student-chip';
      chip.textContent = student;
      if (this.absentStudents.has(student)) chip.classList.add('absent');
      chip.addEventListener('click', () => {
        if (this.absentStudents.has(student)) {
          this.absentStudents.delete(student);
          chip.classList.remove('absent');
        } else {
          this.absentStudents.add(student);
          chip.classList.add('absent');
        }
        badge.textContent = `${this.absentStudents.size}人欠席`;
        this.updateShuffleBtn();
      });
      area.appendChild(chip);
    });
    badge.textContent = `${this.absentStudents.size}人欠席`;
  }

  bindSessionEvents() {
    // グループサイズ選択
    document.querySelectorAll('.size-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.groupSize = parseInt(btn.dataset.size);
        this.updateShuffleBtn();
      });
    });

    // シャッフルボタン
    document.getElementById('shuffle-btn').addEventListener('click', () => {
      this.doShuffle();
    });

    // 履歴リセット
    document.getElementById('reset-history-btn').addEventListener('click', () => {
      if (!this.selectedClassId) return;
      const cls = this.data.getClass(this.selectedClassId);
      this.showModal(
        '履歴をリセット',
        `「${cls.name}」の組み合わせ履歴をリセットします。全ての過去の記録が消えます。`,
        true,
        () => {
          this.data.resetHistory(this.selectedClassId);
          this.updateShuffleBtn();
          this.showModal('リセット完了', '履歴をリセットしました。');
        }
      );
    });
  }

  // ===== 余りモード =====
  bindRemainderEvents() {
    document.querySelectorAll('.remainder-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.remainder-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.remainderMode = btn.dataset.mode;
        this.updateShuffleBtn();
      });
    });
  }

  updateShuffleBtn() {
    const btn = document.getElementById('shuffle-btn');
    const warning = document.getElementById('duplicate-warning');
    const info = document.getElementById('shuffle-info');
    const remainderOption = document.getElementById('remainder-option');

    if (!this.selectedClassId) {
      btn.disabled = true;
      warning.classList.add('hidden');
      info.textContent = 'クラスを選択してください';
      remainderOption.style.display = '';
      return;
    }

    const cls = this.data.getClass(this.selectedClassId);
    const available = cls.students.filter(s => !this.absentStudents.has(s));

    // 1人選出モードは余りオプション不要
    if (this.groupSize === 1) {
      remainderOption.style.display = 'none';
      if (available.length === 0) {
        btn.disabled = true;
        info.textContent = '出席者がいません';
      } else {
        btn.disabled = false;
        info.textContent = `出席者 ${available.length}人 の中から1人を選びます`;
      }
      warning.classList.add('hidden');
      return;
    }

    remainderOption.style.display = '';

    if (available.length < this.groupSize) {
      btn.disabled = true;
      warning.classList.add('hidden');
      info.textContent = `出席者が${available.length}人のため、${this.groupSize}人組が作れません`;
      return;
    }

    btn.disabled = false;

    // 重複の事前チェック
    const pairCounts = this.data.getPairCounts(this.selectedClassId);
    const unavoidable = GroupShuffler.checkUnavoidableOverlap(available, this.groupSize, pairCounts);

    if (unavoidable) {
      const msg = document.getElementById('warning-message');
      msg.textContent = `出席者${available.length}人で${this.groupSize}人組を作るには、すべての組み合わせが使い尽くされています。どうしても重複が生じます。`;
      warning.classList.remove('hidden');
    } else {
      warning.classList.add('hidden');
    }

    // グループ数の情報
    const numGroups = Math.ceil(available.length / this.groupSize);
    info.textContent = `出席者 ${available.length}人 → 約${numGroups}グループ`;
  }

  doShuffle() {
    if (!this.selectedClassId) return;
    const cls = this.data.getClass(this.selectedClassId);
    const available = cls.students.filter(s => !this.absentStudents.has(s));

    // 進行中の1人選出アニメーションがあればキャンセル
    if (this.soloTimers) {
      this.soloTimers.forEach(t => clearTimeout(t));
      this.soloTimers = null;
    }

    // 1人選出モード
    if (this.groupSize === 1) {
      const picked = available[Math.floor(Math.random() * available.length)];
      this.showSoloResult(cls.name, available, picked);
      return;
    }

    const pairCounts = this.data.getPairCounts(this.selectedClassId);
    const result = GroupShuffler.createGroups(available, this.groupSize, pairCounts, this.remainderMode);
    this.currentGroups = result.groups;

    // 履歴に記録
    this.data.recordGroups(this.selectedClassId, result.groups);

    // 結果画面へ
    this.showResult(cls.name, result);
  }

  showSoloResult(className, allStudents, pickedName) {
    document.getElementById('result-class-name').textContent = className;
    document.getElementById('result-group-info').textContent = '1人選出';

    const container = document.getElementById('result-container');
    container.innerHTML = '';

    // 全員をグリッドに表示
    const wrapper = document.createElement('div');
    wrapper.className = 'solo-elim-wrapper';

    // フォントサイズ
    const n = allStudents.length;
    const fontSize = 48;

    // 列数を決定
    let cols;
    if (n <= 4) cols = 2;
    else if (n <= 9) cols = 3;
    else if (n <= 16) cols = 4;
    else if (n <= 25) cols = 5;
    else cols = 6;

    wrapper.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

    const chips = [];
    allStudents.forEach(name => {
      const chip = document.createElement('div');
      chip.className = 'solo-elim-chip';
      chip.textContent = name;
      chip.style.fontSize = `${fontSize}px`;
      chip.dataset.name = name;
      wrapper.appendChild(chip);
      chips.push(chip);
    });

    container.appendChild(wrapper);

    // 画面切り替え
    document.getElementById('app-admin').classList.remove('active');
    document.getElementById('app-result').classList.add('active');

    // 消す順番を決定（pickedName以外をシャッフル）
    const toRemove = allStudents.filter(s => s !== pickedName);
    for (let i = toRemove.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [toRemove[i], toRemove[j]] = [toRemove[j], toRemove[i]];
    }

    // 残り3人になったら消去をストップしてぼかし→フェードアウト
    const removeCount = toRemove.length;
    const stopAt = Math.min(2, removeCount); // 残り3人（= picked + 2人）で止める
    const elimCount = removeCount - stopAt; // 実際に消す人数

    // elimCount人を消す時間配分
    const elimDuration = 8000; // 8秒で消去
    const intervals = [];
    for (let i = 0; i < elimCount; i++) {
      const progress = i / Math.max(elimCount, 1);
      intervals.push(200 + (elimDuration / Math.max(elimCount, 1)) * (0.4 + progress * 1.2));
    }
    if (intervals.length > 0) {
      const sumIntervals = intervals.reduce((a, b) => a + b, 0);
      const scale = elimDuration / sumIntervals;
      for (let i = 0; i < intervals.length; i++) intervals[i] *= scale;
    }

    // タイマーで1人ずつ消す
    this.soloTimers = [];
    let elapsed = 0;

    // フェーズ1: 1人ずつ消す（残り3人まで）
    for (let idx = 0; idx < elimCount; idx++) {
      elapsed += intervals[idx];
      const name = toRemove[idx];
      const timer = setTimeout(() => {
        const chip = wrapper.querySelector(`[data-name="${CSS.escape(name)}"]`);
        if (chip) {
          chip.classList.add('eliminating');
          setTimeout(() => chip.classList.add('eliminated'), 400);
        }
      }, elapsed);
      this.soloTimers.push(timer);
    }

    // フェーズ2: 残り3人をぼかす
    const blurTime = elapsed + 500;
    this.soloTimers.push(setTimeout(() => {
      wrapper.querySelectorAll('.solo-elim-chip:not(.eliminated)').forEach(c => {
        c.classList.add('blurred');
      });
    }, blurTime));

    // フェーズ3: グリッド全体をフェードアウト
    const fadeTime = blurTime + 1500;
    this.soloTimers.push(setTimeout(() => {
      this.showSoloFinal(wrapper, container, pickedName);
    }, fadeTime));
  }

  showSoloFinal(wrapper, container, pickedName) {
    // グリッドをフェードアウト
    wrapper.classList.add('solo-elim-fadeout');

    setTimeout(() => {
      container.innerHTML = '';

      const finalWrapper = document.createElement('div');
      finalWrapper.className = 'solo-result-wrapper';
      finalWrapper.innerHTML = `
        <div class="solo-name-card">
          <div class="solo-name">${this.esc(pickedName)}</div>
        </div>
      `;
      container.appendChild(finalWrapper);
    }, 600);
  }

  showResult(className, result) {
    const { groups, hasOverlap, overlapInfo } = result;

    document.getElementById('result-class-name').textContent = className;
    document.getElementById('result-group-info').textContent =
      `${this.groupSize}人組 / ${groups.length}グループ`;

    const container = document.getElementById('result-container');
    container.innerHTML = '';

    // グリッドを作成
    const grid = document.createElement('div');
    grid.className = 'groups-grid';

    if (groups.length >= 17) {
      grid.classList.add('many-groups');
    } else {
      grid.dataset.count = groups.length;
    }

    // フォントサイズをグループ数に応じて決定
    const fontSize = this.calcFontSize(groups.length);
    const labelSize = Math.max(14, fontSize * 0.6);

    groups.forEach((group, idx) => {
      const card = document.createElement('div');
      card.className = 'group-card';
      card.style.animationDelay = `${idx * 0.04}s`;

      const label = document.createElement('div');
      label.className = 'group-label';
      label.style.fontSize = `${labelSize}px`;
      label.textContent = `Group ${idx + 1}`;

      const members = document.createElement('div');
      members.className = 'group-members';

      group.forEach(name => {
        const nameEl = document.createElement('div');
        nameEl.className = 'member-name';
        nameEl.style.fontSize = `${fontSize}px`;
        nameEl.textContent = name;
        members.appendChild(nameEl);
      });

      card.appendChild(label);
      card.appendChild(members);
      grid.appendChild(card);
    });

    container.appendChild(grid);

    // 重複警告（結果画面にも小さく表示）
    if (hasOverlap && overlapInfo.length > 0) {
      const warnEl = document.createElement('div');
      warnEl.className = 'duplicate-warning';
      warnEl.style.margin = '12px 0 0';
      const names = overlapInfo.map(o => `${o.a}・${o.b}`).join('、');
      warnEl.innerHTML = `
        <span class="warning-icon">⚠️</span>
        <div class="warning-text">
          <strong>重複あり</strong>
          <p>以前と同じ組み合わせが含まれています：${names}</p>
        </div>
      `;
      container.appendChild(warnEl);
    }

    // 画面切り替え
    document.getElementById('app-admin').classList.remove('active');
    document.getElementById('app-result').classList.add('active');
  }

  calcFontSize(groupCount) {
    // グループ数が少ないほど大きく
    if (groupCount <= 2) return 72;
    if (groupCount <= 4) return 60;
    if (groupCount <= 6) return 52;
    if (groupCount <= 9) return 44;
    if (groupCount <= 12) return 40;
    if (groupCount <= 16) return 40;
    return 28;
  }

  bindResultEvents() {
    document.getElementById('btn-back').addEventListener('click', () => {
      document.getElementById('app-result').classList.remove('active');
      document.getElementById('app-admin').classList.add('active');
      this.updateShuffleBtn();
    });

    document.getElementById('btn-reshuffle').addEventListener('click', () => {
      this.doShuffle();
    });
  }

  // ===== モーダル =====
  bindModalEvents() {
    document.getElementById('modal-confirm').addEventListener('click', () => {
      document.getElementById('modal-overlay').classList.add('hidden');
      if (this.modalCallback) {
        this.modalCallback();
        this.modalCallback = null;
      }
    });

    document.getElementById('modal-cancel').addEventListener('click', () => {
      document.getElementById('modal-overlay').classList.add('hidden');
      this.modalCallback = null;
    });
  }

  showModal(title, message, hasCancel = false, callback = null) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').textContent = message;
    const cancelBtn = document.getElementById('modal-cancel');
    if (hasCancel) {
      cancelBtn.classList.remove('hidden');
    } else {
      cancelBtn.classList.add('hidden');
    }
    this.modalCallback = callback;
    document.getElementById('modal-overlay').classList.remove('hidden');
  }

  // ===== ユーティリティ =====
  esc(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

// ===== アプリ起動 =====
const app = new PairMakerApp();
