/**
 * Ion Lab 3D — 판정 규칙 엔진
 *
 * UI·렌더링과 완전히 분리된 순수 함수 모음. 부수 효과 없음.
 * PRD 7장(조작 규칙), 8장(판정·피드백), 9장(전하 계산), 11장(화합물)을 구현한다.
 */
const Rules = (() => {

    const SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻' };
    const SUB = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' };

    const toSuperscript = (s) => String(s).split('').map(c => SUP[c] || c).join('');
    const toSubscript = (s) => String(s).split('').map(c => SUB[c] || c).join('');

    /** 전하를 이온식 위첨자로 표기. 1은 숫자를 생략한다. (예: +1 → '⁺', -2 → '²⁻') */
    function chargeToSuperscript(charge) {
        if (charge === 0) return '';
        const sign = charge > 0 ? '+' : '-';
        const magnitude = Math.abs(charge);
        return toSuperscript((magnitude === 1 ? '' : String(magnitude)) + sign);
    }

    /** 이온식 표기 (예: 'Na', 1 → 'Na⁺') */
    const ionDisplay = (symbol, charge) => symbol + chargeToSuperscript(charge);

    /** 화학식의 아래첨자. 계수 1은 생략한다. (PRD 19) */
    const formulaUnit = (symbol, count) => symbol + (count === 1 ? '' : toSubscript(count));

    const gcd = (a, b) => (b === 0 ? Math.abs(a) : gcd(b, a % b));

    /** 껍질별 최대 전자 수 (학습용 단순화 모형: K=2, L=8, M=8, N=8) */
    const shellCapacity = (shellIndex) => SHELL_CAPACITY[shellIndex] ?? 8;

    /** 전자가 1개 이상 남아 있는 가장 바깥 껍질의 인덱스. 전자가 하나도 없으면 -1. */
    function getValenceShellIndex(shells) {
        for (let i = shells.length - 1; i >= 0; i--) {
            if (shells[i] > 0) return i;
        }
        return -1;
    }

    /** 뒤쪽의 빈 껍질을 제거한다. ([2,8,0] → [2,8]) */
    function trimShells(shells) {
        const out = shells.slice();
        while (out.length > 0 && out[out.length - 1] === 0) out.pop();
        return out;
    }

    const shellsEqual = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

    /**
     * 이 전자를 드래그할 수 있는가? (PRD 7.1)
     * 최외각 껍질의 전자만 조작할 수 있다. 안쪽 껍질 전자는 원자핵에 강하게 묶여 있다.
     */
    function canDragElectron(shells, shellIndex) {
        return shellIndex === getValenceShellIndex(shells);
    }

    /** 이 껍질에 전자를 더 넣을 수 있는가? (PRD 7.3 — 껍질 수용량 초과 차단) */
    const canAcceptElectron = (shells, shellIndex) => shells[shellIndex] < shellCapacity(shellIndex);

    /** 현재 전하 = 양성자 수 − 전자 수 (PRD 9장) */
    const calcCharge = (element, electronCount) => element.protonCount - electronCount;

    const sumShells = (shells) => shells.reduce((a, b) => a + b, 0);

    /** 전하 상태 라벨 */
    function chargeLabel(charge) {
        if (charge === 0) return '중성 원자';
        if (charge > 0) return `+${charge} 양이온`;
        return `${charge} 음이온`;
    }

    /**
     * 현재 상태를 평가한다. (PRD 8.4 성공 판정 4조건)
     * @returns {{status, charge, electronCount, actualChange, message, isSuccess}}
     *   status: 'disabled' | 'success' | 'untouched' | 'direction' | 'over-remove'
     *         | 'over-add' | 'incomplete' | 'wrong-config'
     */
    function evaluate(element, shells) {
        const electronCount = sumShells(shells);
        const charge = calcCharge(element, electronCount);
        const actualChange = electronCount - element.neutralElectronCount;

        const base = { charge, electronCount, actualChange, isSuccess: false };

        // 조건 0 — 이 활동의 대상 원소인가?
        if (!element.isIonActivityEnabled) {
            return { ...base, status: 'disabled', message: element.disabledReason };
        }

        const target = element.targetElectronChange;

        // 조건 1·2 — 전자 수와 전자 배치가 모두 목표 이온과 일치하는가?
        if (actualChange === target) {
            if (shellsEqual(trimShells(shells), element.targetShells)) {
                return {
                    ...base, status: 'success', isSuccess: true,
                    message: element.explanation
                };
            }
            return {
                ...base, status: 'wrong-config',
                message: '전자의 개수는 맞지만 전자 배치가 안정한 상태가 아닙니다. 어느 껍질에 전자가 들어가 있는지 확인해 보세요.'
            };
        }

        if (actualChange === 0) {
            return {
                ...base, status: 'untouched',
                message: '아직 최외각 전자 껍질이 안정한 상태가 아닙니다.'
            };
        }

        // 조건 3 — 전자의 이동 방향이 이 원소의 대표적인 이온 형성 과정과 일치하는가?
        if (Math.sign(actualChange) !== Math.sign(target)) {
            return {
                ...base, status: 'direction',
                message: '이 원자가 안정한 전자 배치를 이루려면 전자를 얻는 것과 잃는 것 중 어느 쪽이 더 적을까요?'
            };
        }

        // 방향은 맞으나 개수가 어긋난 경우
        if (Math.abs(actualChange) > Math.abs(target)) {
            return target < 0
                ? { ...base, status: 'over-remove', message: '전자를 너무 많이 잃었습니다. 안정한 전자 배치가 되었는지 확인해 보세요.' }
                : { ...base, status: 'over-add', message: '최외각 전자 껍질에 필요한 수보다 많은 전자를 넣었습니다.' };
        }

        return {
            ...base, status: 'incomplete',
            message: '아직 최외각 전자 껍질이 안정한 상태가 아닙니다.'
        };
    }

    /**
     * 조작 즉시 내보내는 진단 메시지. (PRD 8.1 — 정답을 노출하지 않고 원인을 짚어 준다)
     * 정답이거나 아직 판단할 근거가 없으면 null.
     */
    function diagnoseLive(element, shells) {
        const result = evaluate(element, shells);
        if (result.status === 'success' || result.status === 'untouched') return null;
        if (result.status === 'incomplete') return null; // 진행 중인 상태는 재촉하지 않는다
        return result.message;
    }

    /** 안쪽 껍질 전자를 건드렸을 때의 안내 (PRD 8.2) */
    const innerShellMessage = () =>
        '안쪽 전자는 원자핵에 더 강하게 묶여 있습니다. 이 활동에서는 최외각 전자만 이동할 수 있습니다.';

    /** 껍질 수용량을 초과해 넣으려 할 때의 안내 (PRD 7.3) */
    function shellFullMessage(shellIndex) {
        const name = SHELL_NAMES[shellIndex] ?? '';
        return `${name}껍질에는 전자가 최대 ${shellCapacity(shellIndex)}개까지만 들어갈 수 있습니다.`;
    }

    /**
     * 3단계 점진 힌트. (PRD 8.3 / Blueprint p.7)
     * 1단계 현상 파악 → 2단계 목표 유도 → 3단계 직접 지시
     */
    function getHint(element, shells, stage) {
        if (!element.isIonActivityEnabled) return element.disabledReason;

        const valenceIndex = getValenceShellIndex(shells);
        const valenceCount = valenceIndex >= 0 ? shells[valenceIndex] : 0;
        const target = element.targetElectronChange;
        const amount = Math.abs(target);
        const isLosing = target < 0;

        if (stage <= 1) {
            const shellName = valenceIndex >= 0 ? `${SHELL_NAMES[valenceIndex]}껍질` : '전자 껍질';
            return `현재 최외각 전자는 몇 개인가요? ${element.koreanName}의 가장 바깥쪽 ${shellName}을 세어 보세요. (지금 ${valenceCount}개)`;
        }

        if (stage === 2) {
            if (isLosing) {
                return `최외각 전자를 모두 잃으면 안쪽의 가득 찬 껍질이 새로운 최외각이 되어 안정해집니다. 전자를 몇 개 잃어야 할까요?`;
            }
            const cap = element.ruleType === 'duet' ? 2 : 8;
            return `최외각 껍질이 ${cap}개로 가득 차야 안정해집니다. ${cap}개가 되려면 전자가 몇 개 더 필요할까요?`;
        }

        return `전자 ${amount}개를 ${isLosing ? '잃어' : '얻어'} 보세요.`;
    }

    /** 결과 화면용 전하 계산식 (예: '11 − 10 = +1') */
    function chargeEquation(element, electronCount) {
        const charge = calcCharge(element, electronCount);
        const sign = charge > 0 ? '+' : '';
        return `${element.protonCount} − ${electronCount} = ${sign}${charge}`;
    }

    /** 껍질별 전자 배치 표기 (예: '2, 8') */
    const shellsText = (shells) => {
        const trimmed = trimShells(shells);
        return trimmed.length ? trimmed.join(', ') : '없음';
    };

    // ─────────────────────────────────────────────────────────────
    // 화합물 판정 (PRD 11장 / Blueprint p.10 — 총전하 0 + 최소 정수비 2중 검증)
    // ─────────────────────────────────────────────────────────────

    /**
     * @param {Array<{display, symbol, charge}>} ions 결합 영역에 놓인 이온들
     * @returns {{status, message, formula?, koreanName?, uses?, cationRatio?, anionRatio?}}
     *   status: 'idle' | 'need-both' | 'too-many-species' | 'excess-positive'
     *         | 'excess-negative' | 'not-simplest' | 'success'
     */
    function evaluateCompound(ions) {
        if (!ions.length) {
            return { status: 'idle', message: '양이온과 음이온 카드를 결합 영역으로 끌어다 놓으세요.' };
        }

        const cations = ions.filter(i => i.charge > 0);
        const anions = ions.filter(i => i.charge < 0);

        if (!cations.length || !anions.length) {
            return { status: 'need-both', message: '이온 화합물은 양이온과 음이온이 모두 있어야 만들어집니다.' };
        }

        const cationSpecies = [...new Set(cations.map(i => i.display))];
        const anionSpecies = [...new Set(anions.map(i => i.display))];

        if (cationSpecies.length > 1 || anionSpecies.length > 1) {
            return {
                status: 'too-many-species',
                message: '이 활동에서는 양이온 한 종류와 음이온 한 종류로만 화합물을 만듭니다.'
            };
        }

        const totalCharge = ions.reduce((sum, i) => sum + i.charge, 0);

        // 1차 검증 — 총전하가 0인가?
        if (totalCharge > 0) {
            return {
                status: 'excess-positive', totalCharge,
                message: '양전하가 더 큽니다. 음이온을 추가하거나 양이온의 수를 줄여 보세요.'
            };
        }
        if (totalCharge < 0) {
            return {
                status: 'excess-negative', totalCharge,
                message: '음전하가 더 큽니다. 양이온을 추가하거나 음이온의 수를 줄여 보세요.'
            };
        }

        // 2차 검증 — 가장 간단한 정수비인가?
        const cationCount = cations.length;
        const anionCount = anions.length;
        const divisor = gcd(cationCount, anionCount);

        if (divisor > 1) {
            return {
                status: 'not-simplest', totalCharge,
                message: `전체 전하는 0이지만 가장 간단한 개수비가 아닙니다. 지금은 ${cationCount}:${anionCount}이므로 ${cationCount / divisor}:${anionCount / divisor}로 줄여 보세요.`
            };
        }

        const recipe = COMPOUNDS.find(c =>
            c.cation === cationSpecies[0] && c.anion === anionSpecies[0] &&
            c.cationRatio === cationCount && c.anionRatio === anionCount
        );

        if (!recipe) {
            return {
                status: 'not-simplest', totalCharge,
                message: '총전하는 0이지만 이번 활동에서 다루는 화합물 조합이 아닙니다. 이온의 개수비를 다시 확인해 보세요.'
            };
        }

        return {
            status: 'success', totalCharge: 0,
            formula: recipe.formula,
            koreanName: recipe.koreanName,
            uses: recipe.uses,
            isMvpTarget: recipe.isMvpTarget,
            cationRatio: cationCount,
            anionRatio: anionCount,
            cationDisplay: cationSpecies[0],
            anionDisplay: anionSpecies[0],
            message: `${cationSpecies[0]} ${cationCount}개와 ${anionSpecies[0]} ${anionCount}개가 결합하면 전체 전하가 0이 됩니다.`
        };
    }

    return {
        toSuperscript, toSubscript, chargeToSuperscript, ionDisplay, formulaUnit,
        gcd, shellCapacity, getValenceShellIndex, trimShells, shellsEqual,
        canDragElectron, canAcceptElectron, calcCharge, sumShells, chargeLabel,
        evaluate, diagnoseLive, innerShellMessage, shellFullMessage,
        getHint, chargeEquation, shellsText, evaluateCompound
    };
})();

if (typeof module !== 'undefined') {
    module.exports = Rules;
}
