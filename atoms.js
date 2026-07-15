/**
 * Ion Lab 3D — 원소 및 화합물 데이터
 *
 * 스키마는 PRD 13장 / Blueprint p.12 규격을 따른다.
 * 모든 원소는 다음 항등식을 만족해야 한다:
 *   protonCount - (neutralElectronCount + targetElectronChange) === targetCharge
 * (isIonActivityEnabled가 false인 원소는 검사 대상에서 제외)
 */

const SHELL_CAPACITY = [2, 8, 8, 8]; // K, L, M, N (학습용 단순화 모형)
const SHELL_NAMES = ['K', 'L', 'M', 'N'];

const ELEMENTS = {
    1: {
        atomicNumber: 1, symbol: 'H', koreanName: '수소', category: 'nonmetal',
        protonCount: 1, neutronCount: 0, neutralElectronCount: 1,
        neutralShells: [1], valenceElectrons: 1,
        isIonActivityEnabled: true, ruleType: 'duet',
        targetElectronChange: -1, targetCharge: 1, targetShells: [],
        ionFormula: 'H+', ionFormulaDisplay: 'H⁺', ionName: '수소 이온', ionType: 'cation',
        explanation: '수소는 첫 번째 껍질을 채우는 듀엣 규칙의 예외 원소입니다. 전자 1개를 잃어 양성자만 남은 H⁺가 됩니다.',
        description: '우주에서 가장 흔한 원소입니다. 옥텟 규칙이 아니라 첫 번째 껍질(최대 2개)을 기준으로 하는 듀엣 규칙을 적용합니다.'
    },
    2: {
        atomicNumber: 2, symbol: 'He', koreanName: '헬륨', category: 'noble-gas',
        protonCount: 2, neutronCount: 2, neutralElectronCount: 2,
        neutralShells: [2], valenceElectrons: 2,
        isIonActivityEnabled: false, ruleType: 'duet',
        disabledReason: '이 원자는 최외각 전자 껍질이 이미 채워져 있어 이 활동에서는 이온을 만들지 않습니다.',
        description: '첫 번째 전자 껍질이 2개의 전자로 가득 찬 비활성 기체입니다. 매우 안정하여 이온을 형성하지 않습니다.'
    },
    3: {
        atomicNumber: 3, symbol: 'Li', koreanName: '리튬', category: 'metal',
        protonCount: 3, neutronCount: 4, neutralElectronCount: 3,
        neutralShells: [2, 1], valenceElectrons: 1,
        isIonActivityEnabled: true, ruleType: 'octet',
        targetElectronChange: -1, targetCharge: 1, targetShells: [2],
        ionFormula: 'Li+', ionFormulaDisplay: 'Li⁺', ionName: '리튬 이온', ionType: 'cation',
        explanation: '최외각 전자 1개를 잃어 안정한 전자 배치를 이룹니다.',
        description: '가장 가벼운 금속으로 스마트폰 배터리 등에 널리 쓰입니다. 최외각 전자를 잃기 쉽습니다.'
    },
    4: {
        atomicNumber: 4, symbol: 'Be', koreanName: '베릴륨', category: 'metal',
        protonCount: 4, neutronCount: 5, neutralElectronCount: 4,
        neutralShells: [2, 2], valenceElectrons: 2,
        isIonActivityEnabled: true, ruleType: 'octet',
        targetElectronChange: -2, targetCharge: 2, targetShells: [2],
        ionFormula: 'Be2+', ionFormulaDisplay: 'Be²⁺', ionName: '베릴륨 이온', ionType: 'cation',
        explanation: '최외각 전자 2개를 잃어 안정한 전자 배치를 이룹니다.',
        description: '가볍고 단단한 금속으로 우주선이나 특수 합금에 사용됩니다.'
    },
    5: {
        atomicNumber: 5, symbol: 'B', koreanName: '붕소', category: 'metalloid',
        protonCount: 5, neutronCount: 6, neutralElectronCount: 5,
        neutralShells: [2, 3], valenceElectrons: 3,
        isIonActivityEnabled: false, ruleType: 'covalent',
        disabledReason: '이 원소는 단순히 전자를 얻거나 잃는 옥텟 모형만으로 대표적인 이온을 설명하기 어렵습니다. 주로 다른 원자와 전자를 공유하여 결합합니다.',
        description: '반금속 원소로 유리나 반도체 재료에 쓰입니다. 이온 결합보다는 공유 결합을 합니다.'
    },
    6: {
        atomicNumber: 6, symbol: 'C', koreanName: '탄소', category: 'nonmetal',
        protonCount: 6, neutronCount: 6, neutralElectronCount: 6,
        neutralShells: [2, 4], valenceElectrons: 4,
        isIonActivityEnabled: false, ruleType: 'covalent',
        disabledReason: '이 원소는 단순히 전자를 얻거나 잃는 옥텟 모형만으로 대표적인 이온을 설명하기 어렵습니다. 주로 다른 원자와 전자를 공유하여 결합합니다.',
        description: '생명체의 기초가 되는 원소입니다. 최외각 전자 4개를 다른 원자와 공유하여 결합합니다.'
    },
    7: {
        atomicNumber: 7, symbol: 'N', koreanName: '질소', category: 'nonmetal',
        protonCount: 7, neutronCount: 7, neutralElectronCount: 7,
        neutralShells: [2, 5], valenceElectrons: 5,
        isIonActivityEnabled: true, ruleType: 'octet',
        targetElectronChange: 3, targetCharge: -3, targetShells: [2, 8],
        ionFormula: 'N3-', ionFormulaDisplay: 'N³⁻', ionName: '질화 이온', ionType: 'anion',
        explanation: '최외각 전자 3개를 얻어 안정한 전자 배치를 이룹니다.',
        description: '대기의 약 78%를 차지하는 기체입니다. 최외각 껍질에 전자를 채워 음이온을 형성합니다.'
    },
    8: {
        atomicNumber: 8, symbol: 'O', koreanName: '산소', category: 'nonmetal',
        protonCount: 8, neutronCount: 8, neutralElectronCount: 8,
        neutralShells: [2, 6], valenceElectrons: 6,
        isIonActivityEnabled: true, ruleType: 'octet',
        targetElectronChange: 2, targetCharge: -2, targetShells: [2, 8],
        ionFormula: 'O2-', ionFormulaDisplay: 'O²⁻', ionName: '산화 이온', ionType: 'anion',
        explanation: '최외각 전자 2개를 얻어 안정한 전자 배치를 이룹니다.',
        description: '생명 호흡에 필수적인 원소입니다. 전자 2개를 얻어 음이온이 되려는 성질이 매우 강합니다.'
    },
    9: {
        atomicNumber: 9, symbol: 'F', koreanName: '플루오린', category: 'nonmetal',
        protonCount: 9, neutronCount: 10, neutralElectronCount: 9,
        neutralShells: [2, 7], valenceElectrons: 7,
        isIonActivityEnabled: true, ruleType: 'octet',
        targetElectronChange: 1, targetCharge: -1, targetShells: [2, 8],
        ionFormula: 'F-', ionFormulaDisplay: 'F⁻', ionName: '플루오린화 이온', ionType: 'anion',
        explanation: '최외각 전자 1개를 얻어 안정한 전자 배치를 이룹니다.',
        description: '반응성이 매우 강한 비금속 원소로 충치 예방 치약 등에 사용됩니다. 전자 1개를 매우 쉽게 얻습니다.'
    },
    10: {
        atomicNumber: 10, symbol: 'Ne', koreanName: '네온', category: 'noble-gas',
        protonCount: 10, neutronCount: 10, neutralElectronCount: 10,
        neutralShells: [2, 8], valenceElectrons: 8,
        isIonActivityEnabled: false, ruleType: 'octet',
        disabledReason: '이 원자는 최외각 전자 껍질이 이미 채워져 있어 이 활동에서는 이온을 만들지 않습니다.',
        description: '네온사인에 쓰이는 기체입니다. 최외각 L껍질이 8개로 가득 차 매우 안정적입니다.'
    },
    11: {
        atomicNumber: 11, symbol: 'Na', koreanName: '나트륨', category: 'metal',
        protonCount: 11, neutronCount: 12, neutralElectronCount: 11,
        neutralShells: [2, 8, 1], valenceElectrons: 1,
        isIonActivityEnabled: true, ruleType: 'octet',
        targetElectronChange: -1, targetCharge: 1, targetShells: [2, 8],
        ionFormula: 'Na+', ionFormulaDisplay: 'Na⁺', ionName: '나트륨 이온', ionType: 'cation',
        explanation: '최외각 전자 1개를 잃어 안정한 전자 배치를 이룹니다.',
        description: '소금(NaCl)의 구성 성분입니다. 물과 격렬히 반응하는 금속으로 전자 1개를 쉽게 잃습니다.'
    },
    12: {
        atomicNumber: 12, symbol: 'Mg', koreanName: '마그네슘', category: 'metal',
        protonCount: 12, neutronCount: 12, neutralElectronCount: 12,
        neutralShells: [2, 8, 2], valenceElectrons: 2,
        isIonActivityEnabled: true, ruleType: 'octet',
        targetElectronChange: -2, targetCharge: 2, targetShells: [2, 8],
        ionFormula: 'Mg2+', ionFormulaDisplay: 'Mg²⁺', ionName: '마그네슘 이온', ionType: 'cation',
        explanation: '최외각 전자 2개를 잃어 안정한 전자 배치를 이룹니다.',
        description: '식물 엽록소의 중심 원소이며 우리 몸의 필수 미네랄입니다.'
    },
    13: {
        atomicNumber: 13, symbol: 'Al', koreanName: '알루미늄', category: 'metal',
        protonCount: 13, neutronCount: 14, neutralElectronCount: 13,
        neutralShells: [2, 8, 3], valenceElectrons: 3,
        isIonActivityEnabled: true, ruleType: 'octet',
        targetElectronChange: -3, targetCharge: 3, targetShells: [2, 8],
        ionFormula: 'Al3+', ionFormulaDisplay: 'Al³⁺', ionName: '알루미늄 이온', ionType: 'cation',
        explanation: '최외각 전자 3개를 잃어 안정한 전자 배치를 이룹니다.',
        description: '가볍고 녹이 잘 슬지 않는 은백색 금속입니다.'
    },
    14: {
        atomicNumber: 14, symbol: 'Si', koreanName: '규소', category: 'metalloid',
        protonCount: 14, neutronCount: 14, neutralElectronCount: 14,
        neutralShells: [2, 8, 4], valenceElectrons: 4,
        isIonActivityEnabled: false, ruleType: 'covalent',
        disabledReason: '이 원소는 단순히 전자를 얻거나 잃는 옥텟 모형만으로 대표적인 이온을 설명하기 어렵습니다. 주로 다른 원자와 전자를 공유하여 결합합니다.',
        description: '반도체의 주원료이자 지각에서 산소 다음으로 풍부한 원소입니다. 공유 결합을 합니다.'
    },
    15: {
        atomicNumber: 15, symbol: 'P', koreanName: '인', category: 'nonmetal',
        protonCount: 15, neutronCount: 16, neutralElectronCount: 15,
        neutralShells: [2, 8, 5], valenceElectrons: 5,
        isIonActivityEnabled: true, ruleType: 'octet',
        targetElectronChange: 3, targetCharge: -3, targetShells: [2, 8, 8],
        ionFormula: 'P3-', ionFormulaDisplay: 'P³⁻', ionName: '인화 이온', ionType: 'anion',
        explanation: '최외각 전자 3개를 얻어 안정한 전자 배치를 이룹니다.',
        description: '생명체의 DNA 뼈대와 뼈를 구성하는 중요한 원소입니다.'
    },
    16: {
        atomicNumber: 16, symbol: 'S', koreanName: '황', category: 'nonmetal',
        protonCount: 16, neutronCount: 16, neutralElectronCount: 16,
        neutralShells: [2, 8, 6], valenceElectrons: 6,
        isIonActivityEnabled: true, ruleType: 'octet',
        targetElectronChange: 2, targetCharge: -2, targetShells: [2, 8, 8],
        ionFormula: 'S2-', ionFormulaDisplay: 'S²⁻', ionName: '황화 이온', ionType: 'anion',
        explanation: '최외각 전자 2개를 얻어 안정한 전자 배치를 이룹니다.',
        description: '단백질 구성 성분으로도 발견되는 노란색 비금속 원소입니다.'
    },
    17: {
        atomicNumber: 17, symbol: 'Cl', koreanName: '염소', category: 'nonmetal',
        protonCount: 17, neutronCount: 18, neutralElectronCount: 17,
        neutralShells: [2, 8, 7], valenceElectrons: 7,
        isIonActivityEnabled: true, ruleType: 'octet',
        targetElectronChange: 1, targetCharge: -1, targetShells: [2, 8, 8],
        ionFormula: 'Cl-', ionFormulaDisplay: 'Cl⁻', ionName: '염화 이온', ionType: 'anion',
        explanation: '최외각 전자 1개를 얻어 안정한 전자 배치를 이룹니다.',
        description: '수돗물 소독이나 소금의 원료로 쓰이는 황록색 기체입니다. 전자 1개를 강하게 끌어당깁니다.'
    },
    18: {
        atomicNumber: 18, symbol: 'Ar', koreanName: '아르곤', category: 'noble-gas',
        protonCount: 18, neutronCount: 22, neutralElectronCount: 18,
        neutralShells: [2, 8, 8], valenceElectrons: 8,
        isIonActivityEnabled: false, ruleType: 'octet',
        disabledReason: '이 원자는 최외각 전자 껍질이 이미 채워져 있어 이 활동에서는 이온을 만들지 않습니다.',
        description: '전구나 용접 보호 기체로 쓰입니다. M껍질이 8개로 가득 차 있는 비활성 기체입니다.'
    },
    19: {
        atomicNumber: 19, symbol: 'K', koreanName: '칼륨', category: 'metal',
        protonCount: 19, neutronCount: 20, neutralElectronCount: 19,
        neutralShells: [2, 8, 8, 1], valenceElectrons: 1,
        isIonActivityEnabled: true, ruleType: 'octet',
        targetElectronChange: -1, targetCharge: 1, targetShells: [2, 8, 8],
        ionFormula: 'K+', ionFormulaDisplay: 'K⁺', ionName: '칼륨 이온', ionType: 'cation',
        explanation: '최외각 전자 1개를 잃어 안정한 전자 배치를 이룹니다.',
        description: '신경 전달과 세포 기능 조절에 필수적인 미네랄 원소입니다.'
    },
    20: {
        atomicNumber: 20, symbol: 'Ca', koreanName: '칼슘', category: 'metal',
        protonCount: 20, neutronCount: 20, neutralElectronCount: 20,
        neutralShells: [2, 8, 8, 2], valenceElectrons: 2,
        isIonActivityEnabled: true, ruleType: 'octet',
        targetElectronChange: -2, targetCharge: 2, targetShells: [2, 8, 8],
        ionFormula: 'Ca2+', ionFormulaDisplay: 'Ca²⁺', ionName: '칼슘 이온', ionType: 'cation',
        explanation: '최외각 전자 2개를 잃어 안정한 전자 배치를 이룹니다.',
        description: '뼈와 이의 주성분이 되는 금속 원소입니다.'
    }
};

/**
 * 미니 주기율표 배치 (Blueprint p.3 기준).
 * 18족 주기율표에서 3~12족(전이금속)을 생략한 8열 압축 배치.
 * col: 1~8 (1,2 = 1·2족 / 3~8 = 13~18족)
 */
const PERIODIC_LAYOUT = [
    { z: 1, row: 1, col: 1 }, { z: 2, row: 1, col: 8 },
    { z: 3, row: 2, col: 1 }, { z: 4, row: 2, col: 2 },
    { z: 5, row: 2, col: 3 }, { z: 6, row: 2, col: 4 }, { z: 7, row: 2, col: 5 },
    { z: 8, row: 2, col: 6 }, { z: 9, row: 2, col: 7 }, { z: 10, row: 2, col: 8 },
    { z: 11, row: 3, col: 1 }, { z: 12, row: 3, col: 2 },
    { z: 13, row: 3, col: 3 }, { z: 14, row: 3, col: 4 }, { z: 15, row: 3, col: 5 },
    { z: 16, row: 3, col: 6 }, { z: 17, row: 3, col: 7 }, { z: 18, row: 3, col: 8 },
    { z: 19, row: 4, col: 1 }, { z: 20, row: 4, col: 2 }
];

/** 화합물 만들기 탭에서 제공하는 이온 카드 */
const ION_CARDS = {
    cations: [
        { symbol: 'Na', display: 'Na⁺', charge: 1, koreanName: '나트륨 이온' },
        { symbol: 'K', display: 'K⁺', charge: 1, koreanName: '칼륨 이온' },
        { symbol: 'Mg', display: 'Mg²⁺', charge: 2, koreanName: '마그네슘 이온' },
        { symbol: 'Ca', display: 'Ca²⁺', charge: 2, koreanName: '칼슘 이온' },
        { symbol: 'Al', display: 'Al³⁺', charge: 3, koreanName: '알루미늄 이온' }
    ],
    anions: [
        { symbol: 'Cl', display: 'Cl⁻', charge: -1, koreanName: '염화 이온' },
        { symbol: 'F', display: 'F⁻', charge: -1, koreanName: '플루오린화 이온' },
        { symbol: 'O', display: 'O²⁻', charge: -2, koreanName: '산화 이온' }
    ]
};

/**
 * 화합물 이름표.
 * isMvpTarget: true — PRD 11.3이 지정한 MVP 목표 화합물 8종 (체크리스트 대상).
 * 나머지는 제공된 이온 카드로 만들 수 있는 나머지 조합으로, 올바른 조합을
 * "목록에 없다"는 이유로 오답 처리하지 않기 위해 이름을 함께 정의한다.
 */
const COMPOUNDS = [
    { cation: 'Na⁺', anion: 'Cl⁻', cationRatio: 1, anionRatio: 1, formula: 'NaCl', koreanName: '염화 나트륨', isMvpTarget: true, uses: '조미료, 생리식염수, 겨울철 도로 융설제' },
    { cation: 'Mg²⁺', anion: 'O²⁻', cationRatio: 1, anionRatio: 1, formula: 'MgO', koreanName: '산화 마그네슘', isMvpTarget: true, uses: '제산제, 내화 벽돌, 마그네슘 보충제' },
    { cation: 'Ca²⁺', anion: 'Cl⁻', cationRatio: 1, anionRatio: 2, formula: 'CaCl₂', koreanName: '염화 칼슘', isMvpTarget: true, uses: '제설제, 제습제, 식품 보존제' },
    { cation: 'K⁺', anion: 'O²⁻', cationRatio: 2, anionRatio: 1, formula: 'K₂O', koreanName: '산화 칼륨', isMvpTarget: true, uses: '비료 원료, 유리·세라믹 제조' },
    { cation: 'Mg²⁺', anion: 'Cl⁻', cationRatio: 1, anionRatio: 2, formula: 'MgCl₂', koreanName: '염화 마그네슘', isMvpTarget: true, uses: '두부 제조용 간수, 친환경 제설제' },
    { cation: 'Na⁺', anion: 'O²⁻', cationRatio: 2, anionRatio: 1, formula: 'Na₂O', koreanName: '산화 나트륨', isMvpTarget: true, uses: '유리 제조 배합 성분' },
    { cation: 'Al³⁺', anion: 'O²⁻', cationRatio: 2, anionRatio: 3, formula: 'Al₂O₃', koreanName: '산화 알루미늄', isMvpTarget: true, uses: '세라믹 신소재, 루비·사파이어의 주성분, 연마제' },
    { cation: 'Ca²⁺', anion: 'F⁻', cationRatio: 1, anionRatio: 2, formula: 'CaF₂', koreanName: '플루오린화 칼슘', isMvpTarget: true, uses: '광학 렌즈용 결정(형석), 제철용 융제' },

    { cation: 'Na⁺', anion: 'F⁻', cationRatio: 1, anionRatio: 1, formula: 'NaF', koreanName: '플루오린화 나트륨', isMvpTarget: false, uses: '치약의 충치 예방 성분' },
    { cation: 'K⁺', anion: 'Cl⁻', cationRatio: 1, anionRatio: 1, formula: 'KCl', koreanName: '염화 칼륨', isMvpTarget: false, uses: '비료, 저염 소금의 나트륨 대체재' },
    { cation: 'K⁺', anion: 'F⁻', cationRatio: 1, anionRatio: 1, formula: 'KF', koreanName: '플루오린화 칼륨', isMvpTarget: false, uses: '유리 가공, 화학 시약' },
    { cation: 'Ca²⁺', anion: 'O²⁻', cationRatio: 1, anionRatio: 1, formula: 'CaO', koreanName: '산화 칼슘', isMvpTarget: false, uses: '건축용 모르타르, 산성 토양 중화제' },
    { cation: 'Mg²⁺', anion: 'F⁻', cationRatio: 1, anionRatio: 2, formula: 'MgF₂', koreanName: '플루오린화 마그네슘', isMvpTarget: false, uses: '광학 렌즈 반사 방지 코팅' },
    { cation: 'Al³⁺', anion: 'Cl⁻', cationRatio: 1, anionRatio: 3, formula: 'AlCl₃', koreanName: '염화 알루미늄', isMvpTarget: false, uses: '화학 반응 촉매' },
    { cation: 'Al³⁺', anion: 'F⁻', cationRatio: 1, anionRatio: 3, formula: 'AlF₃', koreanName: '플루오린화 알루미늄', isMvpTarget: false, uses: '알루미늄 제련 첨가제' }
];

if (typeof module !== 'undefined') {
    module.exports = { ELEMENTS, COMPOUNDS, ION_CARDS, PERIODIC_LAYOUT, SHELL_CAPACITY, SHELL_NAMES };
}
