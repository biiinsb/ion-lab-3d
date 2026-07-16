/**
 * Ion Lab 3D — 이온 결정 격자 3D 뷰어
 *
 * 왜 '분자 모형'이 아니라 '결정 격자'인가:
 * 이온 화합물은 분자로 존재하지 않는다. NaCl 분자라는 것은 없고, 수많은 Na⁺와 Cl⁻가
 * 정전기적 인력으로 규칙적으로 배열된 결정이 있을 뿐이다. 화학식 NaCl은 그 결정 안의
 * '개수비'를 나타낸다. 그래서 이온을 막대(결합선)로 잇지 않는다 — 정전기적 인력은
 * 특정 방향으로만 작용하는 것이 아니라 주변의 모든 반대 전하를 향하기 때문이다.
 *
 * AtomCanvasEngine과 같은 방식(원근 투영 + 깊이 정렬)을 쓰되, 격자는 전자 조작이
 * 없으므로 훨씬 단순하다.
 */
class LatticeEngine {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');

        this.camera = { rx: -0.5, ry: 0.6, zoom: 1, distance: 900 };
        this.isRotating = false;
        this.lastPointer = { x: 0, y: 0 };
        this.autoSpin = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        this.compound = null;
        this.sites = [];
        this.spriteCache = new Map();
        this.animationFrameId = null;

        this.initEvents();
        this.resize();
        this._onResize = () => this.resize();
        window.addEventListener('resize', this._onResize);
    }

    resize() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.width = Math.max(rect.width, 1);
        this.height = Math.max(rect.height, 1);
        this.canvas.width = this.width * dpr;
        this.canvas.height = this.height * dpr;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.spriteCache.clear();
    }

    initEvents() {
        this.canvas.style.touchAction = 'none';

        const down = (x, y) => { this.isRotating = true; this.lastPointer = { x, y }; };
        const move = (x, y) => {
            if (!this.isRotating) return;
            this.camera.ry += (x - this.lastPointer.x) * 0.008;
            this.camera.rx = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2,
                this.camera.rx + (y - this.lastPointer.y) * 0.008));
            this.lastPointer = { x, y };
        };
        const up = () => { this.isRotating = false; };

        this.canvas.addEventListener('mousedown', e => down(e.clientX, e.clientY));
        window.addEventListener('mousemove', e => move(e.clientX, e.clientY));
        window.addEventListener('mouseup', up);

        this.canvas.addEventListener('touchstart', e => {
            if (e.touches.length === 1) { down(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); }
        }, { passive: false });
        window.addEventListener('touchmove', e => {
            if (this.isRotating && e.touches.length === 1) {
                move(e.touches[0].clientX, e.touches[0].clientY);
                e.preventDefault();
            }
        }, { passive: false });
        window.addEventListener('touchend', up);

        this.canvas.addEventListener('wheel', e => {
            this.camera.zoom = Math.max(0.5, Math.min(2.2, this.camera.zoom * (e.deltaY < 0 ? 1.12 : 0.89)));
            e.preventDefault();
        }, { passive: false });
    }

    /**
     * 격자를 만든다.
     * 1:1은 진짜 암염(rock salt) 구조 — 체스판처럼 양·음이온이 번갈아 놓인다.
     * 그 외의 개수비는 (i+j+k)를 개수비 주기로 나눠 규칙적으로 섞는다. 실제 결정 구조
     * (예: Al₂O₃의 강옥 구조)와는 다르므로 화면에 '모식도'임을 명시한다.
     */
    setCompound(compound) {
        this.compound = compound;
        this.sites = [];

        const N = 4; // 4×4×4 = 64자리
        const a = compound.cationRatio;
        const b = compound.anionRatio;
        const period = a + b;
        const half = (N - 1) / 2;

        for (let i = 0; i < N; i++) {
            for (let j = 0; j < N; j++) {
                for (let k = 0; k < N; k++) {
                    const isCation = ((i + j + k) % period) < a;
                    this.sites.push({ isCation, gx: i - half, gy: j - half, gz: k - half });
                }
            }
        }

        this.camera.rx = -0.5;
        this.camera.ry = 0.6;
        this.camera.zoom = 1;
        this.spriteCache.clear();
        this.start();
    }

    isRockSalt() {
        return this.compound && this.compound.cationRatio === 1 && this.compound.anionRatio === 1;
    }

    project(x, y, z) {
        const cx = this.width / 2;
        const cy = this.height / 2;
        const { rx, ry, zoom, distance } = this.camera;

        const x1 = x * Math.cos(ry) - z * Math.sin(ry);
        const z1 = x * Math.sin(ry) + z * Math.cos(ry);
        const y2 = y * Math.cos(rx) - z1 * Math.sin(rx);
        const z2 = y * Math.sin(rx) + z1 * Math.cos(rx);

        const scale = (distance / (distance + z2)) * zoom;
        return { x: cx + x1 * scale, y: cy + y2 * scale, z: z2, scale };
    }

    /** 이온 구 스프라이트를 반지름·색상별로 한 번만 구워 재사용한다. */
    sprite(key, radius, colors, glyph) {
        const cached = this.spriteCache.get(key);
        if (cached) return cached;

        const pad = 2;
        const S = 3;
        const cv = document.createElement('canvas');
        cv.width = cv.height = Math.ceil((radius + pad) * 2 * S);
        const c = cv.getContext('2d');
        c.scale(S, S);
        c.translate(radius + pad, radius + pad);

        const g = c.createRadialGradient(-radius * 0.35, -radius * 0.35, radius * 0.1, 0, 0, radius);
        g.addColorStop(0, colors[0]);
        g.addColorStop(0.55, colors[1]);
        g.addColorStop(1, colors[2]);
        c.beginPath();
        c.arc(0, 0, radius, 0, Math.PI * 2);
        c.fillStyle = g;
        c.fill();
        c.strokeStyle = 'rgba(255,255,255,0.65)';
        c.lineWidth = 1;
        c.stroke();

        // 접근성: 색상 외에 부호로도 구분한다 (PRD 10.4)
        c.fillStyle = '#fff';
        c.font = `bold ${Math.max(9, radius * 0.85)}px "Malgun Gothic", sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(glyph, 0, 0);

        const out = { canvas: cv, radius: radius + pad };
        this.spriteCache.set(key, out);
        return out;
    }

    start() {
        if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
        const loop = () => {
            if (this.autoSpin && !this.isRotating) this.camera.ry += 0.0025;
            this.render();
            this.animationFrameId = requestAnimationFrame(loop);
        };
        this.animationFrameId = requestAnimationFrame(loop);
    }

    stop() {
        if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
    }

    setAutoSpin(v) { this.autoSpin = v; }

    resetView() {
        this.camera.rx = -0.5;
        this.camera.ry = 0.6;
        this.camera.zoom = 1;
    }

    render() {
        if (!this.compound) return;
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.width, this.height);

        const c = this.compound;
        // 이온 반지름 비율을 그대로 반영한다. 양이온이 작고 음이온이 크다는 것이 보인다.
        const maxR = Math.max(c.cationRadius, c.anionRadius);
        const base = Math.min(this.width, this.height) * 0.075;
        const rCation = base * (c.cationRadius / maxR);
        const rAnion = base * (c.anionRadius / maxR);
        const spacing = base * 2.15;

        const cationSprite = this.sprite('c' + Math.round(rCation), rCation,
            ['#f9b1b1', '#d64545', '#8e2020'], '+');
        const anionSprite = this.sprite('a' + Math.round(rAnion), rAnion,
            ['#9fc7ff', '#2f6fd0', '#123c78'], '−');

        const list = this.sites.map(s => {
            const p = this.project(s.gx * spacing, s.gy * spacing, s.gz * spacing);
            return { p, isCation: s.isCation };
        });
        list.sort((m, n) => n.p.z - m.p.z);

        list.forEach(item => {
            const sp = item.isCation ? cationSprite : anionSprite;
            const r = sp.radius * item.p.scale;
            // 뒤쪽 이온은 옅게 — 깊이감을 준다
            ctx.globalAlpha = Math.max(0.35, Math.min(1, item.p.scale * 0.95));
            ctx.drawImage(sp.canvas, item.p.x - r, item.p.y - r, r * 2, r * 2);
        });
        ctx.globalAlpha = 1;
    }

    destroy() {
        this.stop();
        window.removeEventListener('resize', this._onResize);
    }
}

if (typeof module !== 'undefined') {
    module.exports = LatticeEngine;
}
