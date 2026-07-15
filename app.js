/**
 * Ion Lab 3D — 애플리케이션 상태 및 UI
 *
 * 판정은 전부 Rules에, 렌더링·입력은 전부 AtomCanvasEngine에 위임한다.
 * 이 파일은 "무엇을 화면에 보여줄지"만 결정한다.
 */

const STORAGE_KEY = 'ion-lab-3d/v1';
const PRACTICE_WELL_SEED = 3; // 최대로 얻어야 하는 전자 수(N³⁻, P³⁻)

const state = {
    view: 'ion',
    mode: 'explore',
    element: null,
    shells: [],
    well: Infinity,
    hintStage: 0,
    lastLiveStatus: null,
    zoneIons: [],
    completed: new Set(),
    soundEnabled: true,
    spin: true
};

let engine = null;
let toastTimer = null;
const $ = (id) => document.getElementById(id);

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── 부팅 ────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);

function init() {
    loadPrefs();

    engine = new AtomCanvasEngine('atomCanvas', {
        onStateChange: handleShellsChange,
        onBlocked: handleBlocked,
        onElectronRemoved: () => { if (state.well !== Infinity) state.well++; renderWell(); },
        onElectronAdded: () => renderWell(),
        onWellDragCancelled: () => { if (state.well !== Infinity) state.well++; renderWell(); }
    });
    engine.setSoundEnabled(state.soundEnabled);
    engine.setAnimateOrbit(state.spin && !prefersReducedMotion);

    buildPeriodicTable();
    buildIonCards();
    buildChecklist();
    bindEvents();

    applyMode(state.mode);
    selectElement(11); // 기본값: 나트륨
    renderCompoundZone();
    switchView(location.hash.replace('#', '') || 'ion');
}

// ── 저장 (PRD 15 — 로그인 없이 로컬 스토리지에만 선택적 저장) ──

function loadPrefs() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (typeof saved.soundEnabled === 'boolean') state.soundEnabled = saved.soundEnabled;
        if (typeof saved.spin === 'boolean') state.spin = saved.spin;
        if (saved.mode === 'explore' || saved.mode === 'practice') state.mode = saved.mode;
        if (Array.isArray(saved.completed)) state.completed = new Set(saved.completed);
    } catch (e) { /* 저장소를 못 쓰는 환경에서도 앱은 동작해야 한다 */ }
}

function savePrefs() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            soundEnabled: state.soundEnabled,
            spin: state.spin,
            mode: state.mode,
            completed: [...state.completed]
        }));
    } catch (e) { /* 무시 */ }
}

// ── 좌측: 미니 주기율표 ─────────────────────────────────────

function buildPeriodicTable() {
    const table = $('periodicTable');
    table.innerHTML = '';

    PERIODIC_LAYOUT.forEach(({ z, row, col }) => {
        const el = ELEMENTS[z];
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = `cell cat-${el.category}` + (el.isIonActivityEnabled ? '' : ' is-disabled');
        cell.dataset.z = z;
        cell.dataset.col = col;
        cell.style.gridRow = row;
        cell.style.gridColumn = col;
        cell.title = `${el.koreanName} (${el.symbol})` +
            (el.isIonActivityEnabled ? '' : ' — 이 활동에서는 이온을 만들지 않습니다');
        cell.setAttribute('aria-label',
            `원자번호 ${z}번 ${el.koreanName} ${el.symbol}` +
            (el.isIonActivityEnabled ? '' : ', 설명 전용 원소'));
        // 셀은 Blueprint p.3처럼 번호와 기호만 싣는다. 좁은 칸에 한글명을 7px로 욱여넣으면
        // 읽히지 않는다. 한글명은 hover 툴팁·스크린리더·선택 시 정보 패널에서 제공한다.
        cell.innerHTML = `
            <span class="z">${z}</span>
            <span class="sym">${el.symbol}</span>`;
        cell.addEventListener('click', () => selectElement(z));
        table.appendChild(cell);
    });
}

function markSelectedCell(z) {
    document.querySelectorAll('.cell').forEach(c => {
        c.classList.toggle('is-selected', Number(c.dataset.z) === z);
    });
}

// ── 원소 선택 ───────────────────────────────────────────────

function selectElement(z) {
    const el = ELEMENTS[z];
    if (!el) return;

    state.element = el;
    state.hintStage = 0;
    state.lastLiveStatus = null;
    state.well = state.mode === 'explore' ? Infinity : PRACTICE_WELL_SEED;

    markSelectedCell(z);
    engine.loadAtom(el);
    engine.setInteractive(el.isIonActivityEnabled);
    engine.resetView();

    renderWell();
    updateHintButton();
    updateMission();

    if (!el.isIonActivityEnabled) {
        // 비활성 기체 / 공유 결합 원소 — 조작을 막고 이유를 설명한다 (PRD 4.3)
        showFeedback(el.disabledReason, el.category === 'noble-gas' ? 'is-info' : 'is-warn',
            el.category === 'noble-gas' ? '이미 안정한 원자입니다' : '이온을 만들지 않는 원소입니다');
        toast(el.disabledReason, 'is-info');
    } else {
        hideFeedback();
    }
}

// ── 전자 상태 변화 ──────────────────────────────────────────

function handleShellsChange(shells) {
    state.shells = shells;
    updateInfoPanel();

    if (state.mode !== 'practice' || !state.element.isIonActivityEnabled) return;

    // 즉시 진단 (PRD 8.1) — 같은 오류를 반복해서 띄우지 않는다
    const result = Rules.evaluate(state.element, shells);
    if (result.status !== state.lastLiveStatus) {
        state.lastLiveStatus = result.status;
        const message = Rules.diagnoseLive(state.element, shells);
        if (message) toast(message, result.status === 'direction' ? 'is-warn' : 'is-err');
    }
}

function handleBlocked(message, kind) {
    toast(message, 'is-err');
    if (kind === 'inner-shell') {
        showFeedback(message, 'is-err', '안쪽 전자는 움직일 수 없습니다');
    }
}

// ── 우측: 실시간 정보 패널 ──────────────────────────────────

function updateInfoPanel() {
    const el = state.element;
    const shells = state.shells;
    const electrons = Rules.sumShells(shells);
    const charge = Rules.calcCharge(el, electrons);

    $('elemSymbol').textContent = el.symbol;
    $('elemName').textContent = el.koreanName;
    $('elemSub').textContent = `원자번호 ${el.atomicNumber} · ${categoryLabel(el.category)}`;

    // 전하 카드
    const card = $('chargeCard');
    card.classList.toggle('is-cation', charge > 0);
    card.classList.toggle('is-anion', charge < 0);
    $('chargeValue').textContent = Rules.chargeLabel(charge);
    $('chargeEq').textContent = Rules.chargeEquation(el, electrons);

    // 양성자 대 전자 저울 (Blueprint p.8)
    const knob = $('balanceKnob');
    const pct = Math.max(8, Math.min(92, 50 + charge * 11));
    knob.style.left = `${pct}%`;
    knob.style.background = charge === 0 ? 'var(--muted)' : (charge > 0 ? 'var(--proton)' : 'var(--electron)');

    // 기본 정보
    $('statProtons').textContent = el.protonCount;
    $('statNeutrons').textContent = el.neutronCount;
    $('statElectrons').textContent = electrons;
    $('statIonFormula').textContent = charge === 0 ? `${el.symbol} (원자)` : Rules.ionDisplay(el.symbol, charge);

    renderShellList();
    updateGoalBox();
}

function categoryLabel(category) {
    return { metal: '금속', nonmetal: '비금속', metalloid: '준금속', 'noble-gas': '비활성 기체' }[category] || '';
}

function renderShellList() {
    const list = $('shellList');
    const valenceIndex = Rules.getValenceShellIndex(state.shells);
    list.innerHTML = '';

    state.shells.forEach((count, i) => {
        const capacity = Rules.shellCapacity(i);
        const li = document.createElement('li');
        li.className = 'shell-row' + (i === valenceIndex ? ' is-valence' : '');
        li.innerHTML = `
            <span class="shell-name">${SHELL_NAMES[i]}</span>
            <span class="shell-bar"><span class="shell-fill" style="width:${(count / capacity) * 100}%"></span></span>
            <span class="shell-num">${count} / ${capacity}</span>`;
        list.appendChild(li);
    });
}

/** 목표 안내 — 정답(개수·방향)은 노출하지 않는다. 그건 힌트의 역할이다. (PRD 8.1) */
function updateGoalBox() {
    const el = state.element;
    const box = $('goalBox');

    if (!el.isIonActivityEnabled) { box.textContent = el.disabledReason; return; }
    if (state.mode === 'explore') { box.textContent = el.description; return; }

    box.textContent = el.ruleType === 'duet'
        ? '첫 번째 전자 껍질을 기준으로 안정한 상태가 되도록 전자를 이동시켜 보세요. (듀엣 규칙)'
        : '최외각 전자 껍질이 안정한 상태가 되도록 전자를 이동시켜 보세요.';
}

// ── 전자 보관함 ─────────────────────────────────────────────

function renderWell() {
    const body = $('wellBody');
    const count = $('wellCount');
    body.innerHTML = '';

    if (state.well === Infinity) {
        count.textContent = '∞';
        for (let i = 0; i < 3; i++) body.appendChild(makeWellElectron());
        const inf = document.createElement('span');
        inf.className = 'well-empty';
        inf.textContent = '자유 탐색 모드에서는 전자를 무제한으로 쓸 수 있습니다.';
        body.appendChild(inf);
        return;
    }

    count.textContent = state.well;
    if (state.well === 0) {
        const empty = document.createElement('span');
        empty.className = 'well-empty';
        empty.textContent = '보관함이 비었습니다. 원자에서 전자를 빼면 이곳에 모입니다.';
        body.appendChild(empty);
        return;
    }
    for (let i = 0; i < state.well; i++) body.appendChild(makeWellElectron());
}

function makeWellElectron() {
    const e = document.createElement('div');
    e.className = 'well-e';
    e.textContent = '−';
    e.title = '드래그하여 최외각 껍질의 빈 자리에 놓으세요';

    const start = (clientX, clientY, ev) => {
        if (!state.element.isIonActivityEnabled) {
            toast(state.element.disabledReason, 'is-info');
            return;
        }
        if (state.well !== Infinity && state.well <= 0) return;
        if (engine.startDragFromWell(clientX, clientY)) {
            if (state.well !== Infinity) { state.well--; renderWell(); }
            ev.preventDefault();
        }
    };

    e.addEventListener('mousedown', (ev) => start(ev.clientX, ev.clientY, ev));
    e.addEventListener('touchstart', (ev) => {
        if (ev.touches.length === 1) start(ev.touches[0].clientX, ev.touches[0].clientY, ev);
    }, { passive: false });

    return e;
}

// ── 학습 모드 ───────────────────────────────────────────────

function applyMode(mode) {
    state.mode = mode;
    state.hintStage = 0;
    state.lastLiveStatus = null;

    document.querySelectorAll('.mode').forEach(b => {
        const on = b.dataset.mode === mode;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-checked', String(on));
    });

    const isPractice = mode === 'practice';
    $('checkBtn').hidden = !isPractice;
    $('hintBtn').hidden = !isPractice;
    $('missionBar').hidden = !isPractice;

    state.well = isPractice ? PRACTICE_WELL_SEED : Infinity;

    if (state.element) {
        engine.loadAtom(state.element);
        renderWell();
        updateMission();
        updateGoalBox();
        hideFeedback();
    }
    savePrefs();
}

function updateMission() {
    if (state.mode !== 'practice' || !state.element) return;
    const el = state.element;
    $('missionText').textContent = el.isIonActivityEnabled
        ? `${el.koreanName}(${el.symbol})으로 안정한 이온을 만들어 보세요.`
        : `${el.koreanName}(${el.symbol})은(는) 이 활동의 대상이 아닙니다. 다른 원소를 골라 보세요.`;
}

/** 연습 모드 — 시스템이 임의의 대상 원소를 제시한다 (PRD 12.2) */
function newMission() {
    const pool = Object.values(ELEMENTS).filter(e => e.isIonActivityEnabled && e.atomicNumber !== state.element?.atomicNumber);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    selectElement(pick.atomicNumber);
}

// ── 힌트 (PRD 8.3 — 3단계 점진) ─────────────────────────────

function requestHint() {
    if (!state.element.isIonActivityEnabled) {
        toast(state.element.disabledReason, 'is-info');
        return;
    }
    state.hintStage = Math.min(3, state.hintStage + 1);
    const text = Rules.getHint(state.element, state.shells, state.hintStage);
    const titles = { 1: '1단계 · 현상 파악', 2: '2단계 · 목표 유도', 3: '3단계 · 직접 지시' };
    showFeedback(text, 'is-warn', `힌트 ${titles[state.hintStage]}`);
    updateHintButton();
}

function updateHintButton() {
    $('hintStage').textContent = state.hintStage ? `${state.hintStage}/3` : '';
    $('hintBtn').disabled = state.hintStage >= 3 && false; // 3단계 이후에도 다시 볼 수 있게 둔다
}

// ── 정답 확인 ───────────────────────────────────────────────

function checkAnswer() {
    const el = state.element;
    const result = Rules.evaluate(el, state.shells);

    if (result.status === 'disabled') {
        toast(result.message, 'is-info');
        return;
    }

    if (result.isSuccess) {
        celebrate(['#2f6fd0', '#d64545', '#2e7d5b', '#a9691a']);
        showIonSuccessModal(result);
        showFeedback(el.explanation, 'is-ok', `${el.ionName} 완성!`);
        state.hintStage = 0;
        updateHintButton();
        return;
    }

    showFeedback(result.message, 'is-err', '아직 완성되지 않았습니다');
    toast(result.message, 'is-err');
}

function showIonSuccessModal(result) {
    const el = state.element;
    $('modalIcon').className = 'modal-icon';
    $('modalIcon').textContent = '✓';
    $('modalTitle').textContent = '안정한 전자 배치 완성!';
    $('modalFormula').innerHTML = `${el.symbol} <span style="color:var(--muted)">→</span> ${el.ionFormulaDisplay}`;

    $('modalBody').innerHTML = `
        <dl class="result-grid">
            <div><dt>이온식</dt><dd>${el.ionFormulaDisplay}</dd></div>
            <div><dt>이름</dt><dd>${el.ionName}</dd></div>
            <div><dt>종류</dt><dd>${el.ionType === 'cation' ? '양이온' : '음이온'}</dd></div>
            <div><dt>양성자 수</dt><dd>${el.protonCount}</dd></div>
            <div><dt>전자 수</dt><dd>${result.electronCount}</dd></div>
            <div><dt>전하 계산식</dt><dd>${Rules.chargeEquation(el, result.electronCount)}</dd></div>
            <div><dt>전자 배치</dt><dd>${Rules.shellsText(state.shells)}</dd></div>
        </dl>
        <p class="result-note">
            ${el.koreanName} 원자는 최외각 전자 ${Math.abs(el.targetElectronChange)}개를
            ${el.targetElectronChange < 0 ? '잃었습니다' : '얻었습니다'}.
            전자보다 양성자가 ${Math.abs(result.charge)}개
            ${result.charge > 0 ? '더 많으므로' : '더 적으므로'}
            ${Rules.chargeToSuperscript(result.charge) || ''}의 전하를 띱니다.
        </p>`;

    $('modalBtn').textContent = state.mode === 'practice' ? '다음 원소' : '확인';
    $('modalBtn').onclick = () => {
        closeModal();
        if (state.mode === 'practice') newMission();
    };
    openModal('modalOverlay');
}

// ── 화합물 만들기 (PRD 11장 / Blueprint p.9-10) ─────────────

function buildIonCards() {
    renderCardList($('cationCards'), ION_CARDS.cations, 'cation');
    renderCardList($('anionCards'), ION_CARDS.anions, 'anion');
}

function renderCardList(container, cards, type) {
    container.innerHTML = '';
    cards.forEach(card => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `ion-card ${type}`;
        btn.draggable = true;
        btn.dataset.display = card.display;
        btn.innerHTML = `
            <span class="ion-sym">${card.display}</span>
            <span class="ion-meta">
                <span class="ion-kr">${card.koreanName}</span>
                <span class="ion-charge">${card.charge > 0 ? '+' : ''}${card.charge}</span>
            </span>`;
        btn.addEventListener('click', () => addIonToZone(card));
        btn.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', card.display));
        container.appendChild(btn);
    });
}

function findCard(display) {
    return [...ION_CARDS.cations, ...ION_CARDS.anions].find(c => c.display === display);
}

let zoneIonSeq = 0;

function addIonToZone(card) {
    state.zoneIons.push({ id: ++zoneIonSeq, ...card });
    renderCompoundZone();
}

function removeIonFromZone(id) {
    state.zoneIons = state.zoneIons.filter(i => i.id !== id);
    renderCompoundZone();
}

function renderCompoundZone() {
    const holder = $('dropzoneIons');
    holder.innerHTML = '';
    $('dropzoneEmpty').hidden = state.zoneIons.length > 0;

    // 화학식과 같은 순서로 — 양이온을 먼저, 음이온을 나중에 (PRD 11.5)
    const ordered = [...state.zoneIons].sort((a, b) => b.charge - a.charge);
    ordered.forEach(ion => {
        const el = document.createElement('div');
        el.className = `zone-ion ${ion.charge > 0 ? 'cation' : 'anion'}`;
        el.innerHTML = `${ion.display}<button class="zone-remove" aria-label="${ion.display} 제거">×</button>`;
        el.querySelector('.zone-remove').addEventListener('click', () => removeIonFromZone(ion.id));
        holder.appendChild(el);
    });

    updateCompoundStatus();
}

function updateCompoundStatus() {
    const ions = state.zoneIons;
    const positive = ions.filter(i => i.charge > 0).reduce((s, i) => s + i.charge, 0);
    const negative = ions.filter(i => i.charge < 0).reduce((s, i) => s + i.charge, 0);
    const total = positive + negative;

    $('sumEq').textContent = `(+${positive}) + (${negative}) = ${total > 0 ? '+' : ''}${total}`;

    const result = Rules.evaluateCompound(ions);
    const status = $('sumStatus');
    status.classList.remove('is-ok', 'is-err');

    if (result.status === 'idle') {
        status.textContent = '이온을 추가하세요';
        hideFeedback('compoundFeedback');
        return;
    }

    if (result.status === 'success') {
        status.textContent = '전하 균형 달성 (중성)';
        status.classList.add('is-ok');
        onCompoundComplete(result);
        return;
    }

    status.textContent = total === 0 ? '전하는 0 — 개수비 확인 필요' : (total > 0 ? '양전하 과다' : '음전하 과다');
    status.classList.add('is-err');
    showFeedback(result.message, total === 0 ? 'is-warn' : 'is-err', '아직 완성되지 않았습니다', 'compoundFeedback');
}

function onCompoundComplete(result) {
    showFeedback(result.message, 'is-ok', `${result.formula} 완성!`, 'compoundFeedback');
    celebrate(['#2f6fd0', '#d64545', '#2e7d5b', '#7a4d10']);

    if (result.isMvpTarget && !state.completed.has(result.formula)) {
        state.completed.add(result.formula);
        savePrefs();
        renderChecklist();
    }

    const cationUnit = Rules.formulaUnit(findCard(result.cationDisplay).symbol, result.cationRatio);
    const anionUnit = Rules.formulaUnit(findCard(result.anionDisplay).symbol, result.anionRatio);

    $('modalIcon').className = 'modal-icon is-compound';
    $('modalIcon').textContent = '★';
    $('modalTitle').textContent = '이온 결합 화합물 완성!';
    $('modalFormula').textContent = result.formula;
    $('modalBody').innerHTML = `
        <dl class="result-grid">
            <div><dt>화학식</dt><dd>${result.formula}</dd></div>
            <div><dt>이름</dt><dd>${result.koreanName}</dd></div>
            <div><dt>이온의 개수비</dt><dd>${result.cationDisplay} : ${result.anionDisplay} = ${result.cationRatio} : ${result.anionRatio}</dd></div>
            <div><dt>총전하</dt><dd>0 (전기적 중성)</dd></div>
            <div><dt>주요 쓰임</dt><dd style="font-weight:500">${result.uses}</dd></div>
        </dl>
        <p class="result-note">
            ${result.message}<br>
            화학식은 양이온(${cationUnit})을 먼저, 음이온(${anionUnit})을 나중에 쓰고,
            개수가 1일 때는 아래첨자를 생략합니다.
        </p>`;

    $('modalBtn').textContent = '계속하기';
    $('modalBtn').onclick = () => {
        closeModal();
        state.zoneIons = [];
        renderCompoundZone();
    };
    openModal('modalOverlay');
}

function buildChecklist() { renderChecklist(); }

function renderChecklist() {
    const targets = COMPOUNDS.filter(c => c.isMvpTarget);
    const list = $('checklistItems');
    list.innerHTML = '';

    targets.forEach(c => {
        const done = state.completed.has(c.formula);
        const li = document.createElement('li');
        li.className = 'check-item' + (done ? ' is-done' : '');
        li.innerHTML = `<span class="mark">${done ? '✓' : '○'}</span>${c.formula}`;
        li.title = c.koreanName;
        list.appendChild(li);
    });

    $('checklistCount').textContent = `${targets.filter(c => state.completed.has(c.formula)).length} / ${targets.length}`;
}

// ── 피드백 표시 ─────────────────────────────────────────────

function showFeedback(text, tone, title, targetId = 'feedback') {
    const box = $(targetId);
    box.className = `feedback ${tone}`;
    box.innerHTML = (title ? `<strong>${title}</strong>` : '') + text;
    box.hidden = false;
}

function hideFeedback(targetId = 'feedback') { $(targetId).hidden = true; }

function toast(text, tone = '') {
    const box = $('toast');
    box.className = `toast ${tone}`;
    box.textContent = text;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.hidden = true; }, 3800);
}

function openModal(id) { $(id).hidden = false; }
function closeModal() { $('modalOverlay').hidden = true; }

// ── 성공 연출 (외부 CDN 없이 자체 구현) ─────────────────────

function celebrate(colors) {
    if (prefersReducedMotion) return;

    const cv = $('celebrateCanvas');
    const ctx = cv.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = window.innerWidth, H = window.innerHeight;

    cv.width = W * dpr; cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cv.classList.add('is-on');

    const parts = [];
    for (let i = 0; i < 110; i++) {
        parts.push({
            x: W / 2 + (Math.random() - 0.5) * W * 0.3,
            y: H * 0.5,
            vx: (Math.random() - 0.5) * 10,
            vy: Math.random() * -12 - 3,
            size: 4 + Math.random() * 5,
            color: colors[i % colors.length],
            rot: Math.random() * Math.PI,
            vr: (Math.random() - 0.5) * 0.3,
            life: 1
        });
    }

    let frames = 0;
    (function tick() {
        ctx.clearRect(0, 0, W, H);
        let alive = false;

        parts.forEach(p => {
            if (p.life <= 0) return;
            alive = true;
            p.vy += 0.32;
            p.vx *= 0.995;
            p.x += p.vx;
            p.y += p.vy;
            p.rot += p.vr;
            p.life -= 0.008;

            ctx.save();
            ctx.globalAlpha = Math.max(0, p.life);
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
            ctx.restore();
        });

        if (alive && ++frames < 240) {
            requestAnimationFrame(tick);
        } else {
            ctx.clearRect(0, 0, W, H);
            cv.classList.remove('is-on');
        }
    })();
}

// ── 이벤트 바인딩 ───────────────────────────────────────────

/** 탭 전환. #compound 해시로 특정 활동에 바로 들어올 수 있다. */
function switchView(view) {
    state.view = view === 'compound' ? 'compound' : 'ion';

    document.querySelectorAll('.tab').forEach(t => {
        const on = t.dataset.view === state.view;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', String(on));
    });
    $('view-ion').classList.toggle('is-active', state.view === 'ion');
    $('view-compound').classList.toggle('is-active', state.view === 'compound');

    // 숨겨져 있던 캔버스는 크기가 0이므로 다시 보일 때 재측정해야 한다
    if (state.view === 'ion') requestAnimationFrame(() => engine.resize());
}

function bindEvents() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            switchView(tab.dataset.view);
            history.replaceState(null, '', tab.dataset.view === 'compound' ? '#compound' : '#ion');
        });
    });
    window.addEventListener('hashchange', () => switchView(location.hash.replace('#', '')));

    // 학습 모드
    document.querySelectorAll('.mode').forEach(btn => {
        btn.addEventListener('click', () => applyMode(btn.dataset.mode));
    });

    // 무대 컨트롤
    $('checkBtn').addEventListener('click', checkAnswer);
    $('hintBtn').addEventListener('click', requestHint);
    $('resetAtomBtn').addEventListener('click', () => selectElement(state.element.atomicNumber));
    $('newMissionBtn').addEventListener('click', newMission);

    $('zoomInBtn').addEventListener('click', () => engine.zoomIn());
    $('zoomOutBtn').addEventListener('click', () => engine.zoomOut());
    $('resetViewBtn').addEventListener('click', () => engine.resetView());

    // 전자 공전 On/Off — 모션 멀미 방지 (PRD 15)
    $('spinBtn').addEventListener('click', () => {
        state.spin = !state.spin;
        engine.setAnimateOrbit(state.spin);
        $('spinBtn').classList.toggle('is-active', state.spin);
        $('spinBtn').setAttribute('aria-pressed', String(state.spin));
        savePrefs();
    });

    // 소리
    $('soundBtn').addEventListener('click', () => {
        state.soundEnabled = !state.soundEnabled;
        engine.setSoundEnabled(state.soundEnabled);
        const btn = $('soundBtn');
        btn.textContent = state.soundEnabled ? '🔊' : '🔇';
        btn.setAttribute('aria-pressed', String(state.soundEnabled));
        btn.title = state.soundEnabled ? '소리 끄기' : '소리 켜기';
        savePrefs();
    });

    $('helpBtn').addEventListener('click', () => openModal('helpOverlay'));
    $('helpCloseBtn').addEventListener('click', () => { $('helpOverlay').hidden = true; });

    $('restartBtn').addEventListener('click', () => {
        if (!confirm('처음부터 다시 시작할까요? 완성한 화합물 기록도 지워집니다.')) return;
        state.completed.clear();
        state.zoneIons = [];
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* 무시 */ }
        renderChecklist();
        renderCompoundZone();
        applyMode('explore');
        selectElement(11);
    });

    // 화합물 드롭존
    const zone = $('dropzone');
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('is-hover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('is-hover'));
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('is-hover');
        const card = findCard(e.dataTransfer.getData('text/plain'));
        if (card) addIonToZone(card);
    });

    $('clearZoneBtn').addEventListener('click', () => {
        state.zoneIons = [];
        renderCompoundZone();
    });

    // 모달 바깥 클릭 / ESC
    $('modalOverlay').addEventListener('click', (e) => { if (e.target.id === 'modalOverlay') closeModal(); });
    $('helpOverlay').addEventListener('click', (e) => { if (e.target.id === 'helpOverlay') $('helpOverlay').hidden = true; });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        closeModal();
        $('helpOverlay').hidden = true;
    });

    // 저장된 설정을 버튼에 반영
    const soundBtn = $('soundBtn');
    soundBtn.textContent = state.soundEnabled ? '🔊' : '🔇';
    soundBtn.setAttribute('aria-pressed', String(state.soundEnabled));
    $('spinBtn').classList.toggle('is-active', state.spin);
    $('spinBtn').setAttribute('aria-pressed', String(state.spin));
}
