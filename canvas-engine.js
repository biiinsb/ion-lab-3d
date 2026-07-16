/**
 * Ion Lab 3D — 원자 모형 렌더링 및 입력 엔진
 *
 * Canvas 2D 위에 원근 투영 + Z-buffer 정렬로 의사(pseudo) 3D 모형을 그린다.
 * 조작 규칙 판정은 Rules에 위임하고, 이 클래스는 "규칙이 금지한 조작을 애초에
 * 성립시키지 않는" 책임만 진다. (PRD 7.1 / Blueprint p.6 DON'T 항목)
 */

/** 스프라이트를 화면 크기의 몇 배로 구울지. 확대(zoom)해도 뭉개지지 않을 만큼. */
const SPRITE_SCALE = 3;

class AtomCanvasEngine {
    constructor(canvasId, callbacks = {}) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');

        this.onStateChange = callbacks.onStateChange || (() => {});
        this.onBlocked = callbacks.onBlocked || (() => {});
        this.onElectronRemoved = callbacks.onElectronRemoved || (() => {});
        this.onElectronAdded = callbacks.onElectronAdded || (() => {});
        this.onWellDragCancelled = callbacks.onWellDragCancelled || (() => {});

        // rx는 궤도를 얼마나 눕혀 볼지 결정한다. 너무 눕히면(0에 가까우면) 껍질이 납작한
        // 선이 되어 전자를 셀 수 없고, 너무 세우면 3D 느낌이 사라진다. 약 35°가 절충점.
        this.camera = { rx: -0.62, ry: 0.5, zoom: 1, distance: 620 };

        this.isOrbitRotating = false;
        this.lastPointer = { x: 0, y: 0 };
        this.draggedElectron = null;
        this.pinchStartDistance = null;
        this.pinchStartZoom = 1;

        this.currentAtom = null;
        this.shellsData = [];
        this.particles = [];

        this.interactive = true;
        this.animateOrbit = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        this.soundEnabled = true;

        this.animationFrameId = null;
        this.orbitSpeed = 0.004;
        this.globalAngle = 0;
        this.audioCtx = null;

        this.initEvents();
        this.resize();
        this._onResize = () => this.resize();
        window.addEventListener('resize', this._onResize);
    }

    // ── 레이아웃 ────────────────────────────────────────────────

    resize() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.width = Math.max(rect.width, 1);
        this.height = Math.max(rect.height, 1);
        this.canvas.width = this.width * dpr;
        this.canvas.height = this.height * dpr;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.computeMetrics();
    }

    computeMetrics() {
        const R = Math.min(this.width, this.height) * 0.42;
        // 원자핵 안의 입자를 하나씩 보여주려면 핵이 커야 한다. 그만큼 껍질도 밖으로 민다.
        this.shellRadii = [R * 0.44, R * 0.63, R * 0.82, R * 1.0];
        this.nucleusRadius = Math.max(R * 0.17, 22);
        this.nucleonRadius = Math.max(this.nucleusRadius * 0.32, 5);
        this.electronRadius = Math.min(Math.max(R * 0.034, 5.5), 11);
        this.sprites = null; // 크기가 바뀌었으니 스프라이트를 다시 굽는다
    }

    /**
     * 양성자·중성자·전자 구를 오프스크린 캔버스에 한 번만 그려 두고 재사용한다.
     * 핵자만 최대 40개(Ca)라 매 프레임 그라디언트를 새로 만들면 보급형 태블릿에서
     * 프레임이 무너진다. drawImage는 그보다 훨씬 싸다.
     */
    buildSprites() {
        const make = (radius, draw) => {
            const pad = 2;
            const size = Math.ceil((radius + pad) * 2 * SPRITE_SCALE);
            const cv = document.createElement('canvas');
            cv.width = cv.height = size;
            const c = cv.getContext('2d');
            c.scale(SPRITE_SCALE, SPRITE_SCALE);
            c.translate(radius + pad, radius + pad);
            draw(c, radius);
            return { canvas: cv, radius: radius + pad };
        };

        const ball = (c, r, inner, mid, outer) => {
            const g = c.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
            g.addColorStop(0, inner);
            g.addColorStop(0.55, mid);
            g.addColorStop(1, outer);
            c.beginPath();
            c.arc(0, 0, r, 0, Math.PI * 2);
            c.fillStyle = g;
            c.fill();
        };

        const nr = this.nucleonRadius;
        this.sprites = {
            // 양성자 — 빨강 + '+' 기호 (색상 외 단서, PRD 10.4)
            proton: make(nr, (c, r) => {
                ball(c, r, '#f9a8a8', '#d64545', '#8e2020');
                c.strokeStyle = 'rgba(255,255,255,0.5)';
                c.lineWidth = 0.8;
                c.stroke();
                c.strokeStyle = '#fff';
                c.lineWidth = Math.max(1.4, r * 0.22);
                c.lineCap = 'round';
                c.beginPath();
                c.moveTo(-r * 0.42, 0); c.lineTo(r * 0.42, 0);
                c.moveTo(0, -r * 0.42); c.lineTo(0, r * 0.42);
                c.stroke();
            }),
            // 중성자 — 전하가 없다. 기호를 붙이지 않고 회색 + 매끈한 테두리로만 구분한다.
            neutron: make(nr, (c, r) => {
                ball(c, r, '#dfe6ee', '#9aa8b8', '#5d6b7c');
                c.strokeStyle = 'rgba(255,255,255,0.45)';
                c.lineWidth = 0.8;
                c.stroke();
            }),
            valence: make(this.electronRadius, (c, r) => {
                ball(c, r, '#8fc0ff', '#2f6fd0', '#123c78');
                c.strokeStyle = 'rgba(255,255,255,0.9)';
                c.lineWidth = 1.8;
                c.stroke();
                c.fillStyle = '#fff';
                c.font = `bold ${Math.max(8, r * 1.1)}px "Malgun Gothic", sans-serif`;
                c.textAlign = 'center';
                c.textBaseline = 'middle';
                c.fillText('−', 0, 0);
            }),
            inner: make(this.electronRadius * 0.82, (c, r) => {
                ball(c, r, '#d5dfea', '#9aabbe', '#6c7c8f');
                c.strokeStyle = 'rgba(76, 90, 107, 0.85)';
                c.lineWidth = 1.2;
                c.setLineDash([2, 2]);
                c.stroke();
                c.setLineDash([]);
                c.fillStyle = '#fff';
                c.font = `bold ${Math.max(7, r * 1.1)}px "Malgun Gothic", sans-serif`;
                c.textAlign = 'center';
                c.textBaseline = 'middle';
                c.fillText('−', 0, 0);
            })
        };
    }

    drawSprite(sprite, x, y, scale) {
        const r = sprite.radius * scale;
        this.ctx.drawImage(sprite.canvas, x - r, y - r, r * 2, r * 2);
    }

    /**
     * 원자핵 안의 핵자 위치를 만든다. 피보나치 구면 분포로 결정론적·균일하게 배치한다.
     * 양성자와 중성자를 번갈아 섞어 한쪽으로 몰리지 않게 한다.
     */
    buildNucleons(atom) {
        const total = atom.protonCount + atom.neutronCount;
        const out = [];

        // 양성자/중성자를 인덱스에 고르게 섞는다 (예: 11p 12n → p n p n …)
        const flags = [];
        let p = atom.protonCount, n = atom.neutronCount;
        for (let i = 0; i < total; i++) {
            const takeProton = p > 0 && (n === 0 || p / (p + n) >= 0.5);
            flags.push(takeProton);
            if (takeProton) p--; else n--;
        }

        const golden = Math.PI * (1 + Math.sqrt(5));
        for (let i = 0; i < total; i++) {
            const phi = Math.acos(1 - (2 * (i + 0.5)) / total);
            const theta = golden * i;
            // 표면에만 붙지 않도록 반경을 살짝 흩는다
            const r = 1 - 0.34 * ((i * 0.618) % 1);
            out.push({
                isProton: flags[i],
                ux: r * Math.sin(phi) * Math.cos(theta),
                uy: r * Math.sin(phi) * Math.sin(theta),
                uz: r * Math.cos(phi)
            });
        }
        return out;
    }

    /** 터치는 손가락 접촉면이 넓어 마우스보다 넉넉한 히트 반경이 필요하다. */
    hitRadius(isTouch) {
        return isTouch ? this.electronRadius * 3.6 : this.electronRadius * 2.8;
    }

    /**
     * 전자를 잡으려다 살짝 빗나갔을 때 모형이 홱 돌아가 버리면 조작이 어긋난다.
     * 히트 반경보다 넓은 이 '의도 반경' 안에서 시작한 드래그는 회전으로 넘기지 않는다.
     * (아무 일도 일어나지 않으므로 다시 시도하면 된다)
     */
    intentRadius(isTouch) {
        return this.hitRadius(isTouch) * 1.7;
    }

    /** mx, my 근처에 전자가 있는가? (빗나감 판정용 — 내각/최외각 가리지 않는다) */
    hasElectronNear(mx, my, radius) {
        for (let s = 0; s < this.shellsData.length; s++) {
            const slots = this.shellsData[s].slots;
            for (let i = 0; i < slots.length; i++) {
                if (!slots[i].filled) continue;
                const pos = this.getSlotScreenPos(s, i);
                if (Math.hypot(pos.x - mx, pos.y - my) < radius) return true;
            }
        }
        return false;
    }

    // ── 입력 ────────────────────────────────────────────────────

    initEvents() {
        this.canvas.style.touchAction = 'none';

        this.canvas.addEventListener('mousedown', (e) => {
            this.handleStart(e.clientX, e.clientY, false);
        });
        window.addEventListener('mousemove', (e) => this.handleMove(e.clientX, e.clientY));
        window.addEventListener('mouseup', (e) => this.handleEnd(e.clientX, e.clientY));

        this.canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                // 두 손가락 → 확대/축소
                this.isOrbitRotating = false;
                this.pinchStartDistance = this.touchDistance(e.touches);
                this.pinchStartZoom = this.camera.zoom;
                e.preventDefault();
                return;
            }
            if (e.touches.length === 1) {
                this.handleStart(e.touches[0].clientX, e.touches[0].clientY, true);
                e.preventDefault();
            }
        }, { passive: false });

        window.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2 && this.pinchStartDistance) {
                const ratio = this.touchDistance(e.touches) / this.pinchStartDistance;
                this.setZoom(this.pinchStartZoom * ratio);
                e.preventDefault();
                return;
            }
            if (e.touches.length === 1) {
                this.handleMove(e.touches[0].clientX, e.touches[0].clientY);
                // 전자를 끌거나 모형을 돌리는 동안 페이지가 함께 스크롤되지 않도록 막는다.
                if (this.draggedElectron || this.isOrbitRotating) e.preventDefault();
            }
        }, { passive: false });

        window.addEventListener('touchend', (e) => {
            this.pinchStartDistance = null;
            // touchend의 touches는 비어 있다. 좌표는 changedTouches에서 가져와야 한다.
            const t = e.changedTouches && e.changedTouches[0];
            if (t) this.handleEnd(t.clientX, t.clientY);
            else this.handleEnd(null, null);
        });
        window.addEventListener('touchcancel', () => this.handleEnd(null, null));

        this.canvas.addEventListener('wheel', (e) => {
            this.setZoom(this.camera.zoom * (e.deltaY < 0 ? 1.12 : 0.89));
            e.preventDefault();
        }, { passive: false });
    }

    touchDistance(touches) {
        return Math.hypot(
            touches[0].clientX - touches[1].clientX,
            touches[0].clientY - touches[1].clientY
        );
    }

    toLocal(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        return { x: clientX - rect.left, y: clientY - rect.top };
    }

    handleStart(clientX, clientY, isTouch) {
        const { x, y } = this.toLocal(clientX, clientY);

        if (this.interactive) {
            const hit = this.findElectronAtPos(x, y, isTouch);
            if (hit) {
                // 최외각 껍질의 전자만 집을 수 있다. (PRD 7.1)
                if (!Rules.canDragElectron(this.getShells(), hit.shellIndex)) {
                    this.onBlocked(Rules.innerShellMessage(), 'inner-shell');
                    this.pulseShell(hit.shellIndex);
                    return;
                }
                this.draggedElectron = {
                    shellIndex: hit.shellIndex,
                    slotIndex: hit.slotIndex,
                    x, y, fromWell: false
                };
                this.shellsData[hit.shellIndex].slots[hit.slotIndex].filled = false;
                this.emitState();
                if (navigator.vibrate) navigator.vibrate(8);
                return;
            }

            // 전자를 노렸으나 살짝 빗나간 경우 — 회전시키지 않고 그냥 무시한다.
            // 회전해 버리면 노리던 전자가 달아나 다시 잡기가 더 어려워진다.
            if (this.hasElectronNear(x, y, this.intentRadius(isTouch))) return;
        }

        this.isOrbitRotating = true;
        this.lastPointer = { x: clientX, y: clientY };
    }

    handleMove(clientX, clientY) {
        if (this.isOrbitRotating) {
            const dx = clientX - this.lastPointer.x;
            const dy = clientY - this.lastPointer.y;
            this.camera.ry += dx * 0.007;
            this.camera.rx = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, this.camera.rx + dy * 0.007));
            this.lastPointer = { x: clientX, y: clientY };
            return;
        }

        if (!this.draggedElectron) return;

        const { x, y } = this.toLocal(clientX, clientY);
        this.draggedElectron.x = x;
        this.draggedElectron.y = y;

        const well = document.getElementById('electronWell');
        if (well && !this.draggedElectron.fromWell) {
            well.classList.toggle('is-hover', this.isInside(well, clientX, clientY));
        }
    }

    handleEnd(clientX, clientY) {
        this.isOrbitRotating = false;
        if (!this.draggedElectron) return;

        const dragged = this.draggedElectron;
        const well = document.getElementById('electronWell');
        well?.classList.remove('is-hover');

        // 1) 전자 보관함에 떨어뜨림 → 전자를 잃는다
        if (!dragged.fromWell && clientX != null && this.isInside(well, clientX, clientY)) {
            this.createBurst(dragged.x, dragged.y, '#c23b3b');
            this.draggedElectron = null;
            this.onElectronRemoved();
            this.emitState();
            this.playSound('remove');
            return;
        }

        // 2) 궤도의 빈 자리에 안착시킴
        const snap = this.electronRadius * 4;
        const emptySlot = this.findClosestSlot(dragged.x, dragged.y, true);

        if (emptySlot && emptySlot.distance < snap) {
            emptySlot.slot.filled = true;
            const pos = this.getSlotScreenPos(emptySlot.shellIndex, emptySlot.slotIndex);
            this.createBurst(pos.x, pos.y, '#2f6fd0');
            this.draggedElectron = null;
            if (dragged.fromWell) this.onElectronAdded();
            this.emitState();
            this.playSound('add');
            return;
        }

        // 3) 안착 실패 — 꽉 찬 껍질에 넣으려 했는지 확인해 안내한다
        const anySlot = this.findClosestSlot(dragged.x, dragged.y, false);
        if (anySlot && anySlot.distance < snap && anySlot.slot.filled) {
            this.onBlocked(Rules.shellFullMessage(anySlot.shellIndex), 'shell-full');
        }

        this.draggedElectron = null;
        if (dragged.fromWell) {
            this.onWellDragCancelled();
        } else {
            // 원래 궤도로 되돌린다
            this.shellsData[dragged.shellIndex].slots[dragged.slotIndex].filled = true;
            this.emitState();
        }
    }

    isInside(el, clientX, clientY) {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
    }

    /** 전자 보관함에서 전자를 끌어오기 시작한다. (app.js가 호출) */
    startDragFromWell(clientX, clientY) {
        if (!this.interactive) return false;
        const { x, y } = this.toLocal(clientX, clientY);
        this.draggedElectron = { x, y, fromWell: true };
        return true;
    }

    // ── 조회 ────────────────────────────────────────────────────

    /** 껍질별 현재 전자 수 (예: [2, 8, 1]) */
    getShells() {
        return this.shellsData.map(s => s.slots.reduce((n, slot) => n + (slot.filled ? 1 : 0), 0));
    }

    getElectronCount() {
        return Rules.sumShells(this.getShells());
    }

    findElectronAtPos(mx, my, isTouch) {
        const limit = this.hitRadius(isTouch);
        let found = null;
        let minDist = limit;

        for (let s = 0; s < this.shellsData.length; s++) {
            const slots = this.shellsData[s].slots;
            for (let i = 0; i < slots.length; i++) {
                if (!slots[i].filled) continue;
                const pos = this.getSlotScreenPos(s, i);
                const dist = Math.hypot(pos.x - mx, pos.y - my);
                // 같은 거리면 앞쪽(카메라에 가까운) 전자를 우선 집는다
                if (dist < minDist) {
                    minDist = dist;
                    found = { shellIndex: s, slotIndex: i };
                }
            }
        }
        return found;
    }

    findClosestSlot(mx, my, emptyOnly) {
        let closest = null;
        let minDist = Infinity;

        for (let s = 0; s < this.shellsData.length; s++) {
            const slots = this.shellsData[s].slots;
            for (let i = 0; i < slots.length; i++) {
                if (emptyOnly && slots[i].filled) continue;
                const pos = this.getSlotScreenPos(s, i);
                const dist = Math.hypot(pos.x - mx, pos.y - my);
                if (dist < minDist) {
                    minDist = dist;
                    closest = { shellIndex: s, slotIndex: i, slot: slots[i], distance: dist };
                }
            }
        }
        return closest;
    }

    // ── 3D 투영 ─────────────────────────────────────────────────

    project3D(x, y, z) {
        const cx = this.width / 2;
        const cy = this.height / 2;

        const x1 = x * Math.cos(this.camera.ry) - z * Math.sin(this.camera.ry);
        const z1 = x * Math.sin(this.camera.ry) + z * Math.cos(this.camera.ry);
        const y2 = y * Math.cos(this.camera.rx) - z1 * Math.sin(this.camera.rx);
        const z2 = y * Math.sin(this.camera.rx) + z1 * Math.cos(this.camera.rx);

        const perspective = this.camera.distance / (this.camera.distance + z2);
        const scale = perspective * this.camera.zoom;

        return { x: cx + x1 * scale, y: cy + y2 * scale, z: z2, scale };
    }

    getSlotScreenPos(shellIndex, slotIndex) {
        const radius = this.shellRadii[shellIndex];
        const shell = this.shellsData[shellIndex];
        const slot = shell.slots[slotIndex];
        const angle = slot.baseAngle + this.globalAngle * shell.speedDirection;
        return this.project3D(radius * Math.cos(angle), 0, radius * Math.sin(angle));
    }

    // ── 상태 ────────────────────────────────────────────────────

    loadAtom(atom) {
        this.currentAtom = atom;
        this.shellsData = [];
        this.particles = [];
        this.draggedElectron = null;
        this.nucleons = this.buildNucleons(atom);

        atom.neutralShells.forEach((electronCount, sIndex) => {
            const capacity = Rules.shellCapacity(sIndex);
            const slots = [];
            for (let i = 0; i < capacity; i++) {
                slots.push({
                    baseAngle: (2 * Math.PI / capacity) * i,
                    filled: i < electronCount
                });
            }
            this.shellsData.push({
                shellIndex: sIndex,
                slots,
                pulse: 0,
                speedDirection: (sIndex % 2 === 0 ? 1 : -1) * (1 - sIndex * 0.15)
            });
        });

        this.emitState();
        this.startLoop();
    }

    setInteractive(v) { this.interactive = v; }
    setAnimateOrbit(v) { this.animateOrbit = v; }
    setSoundEnabled(v) { this.soundEnabled = v; }

    setZoom(z) { this.camera.zoom = Math.max(0.55, Math.min(2.2, z)); }
    zoomIn() { this.setZoom(this.camera.zoom * 1.2); }
    zoomOut() { this.setZoom(this.camera.zoom / 1.2); }

    resetView() {
        this.camera.rx = -0.62;
        this.camera.ry = 0.5;
        this.camera.zoom = 1;
    }

    pulseShell(shellIndex) {
        if (this.shellsData[shellIndex]) this.shellsData[shellIndex].pulse = 1;
    }

    emitState() { this.onStateChange(this.getShells()); }

    // ── 루프 ────────────────────────────────────────────────────

    startLoop() {
        if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
        const loop = () => {
            this.update();
            this.render();
            this.animationFrameId = requestAnimationFrame(loop);
        };
        this.animationFrameId = requestAnimationFrame(loop);
    }

    destroy() {
        if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
        window.removeEventListener('resize', this._onResize);
    }

    update() {
        if (this.animateOrbit) this.globalAngle += this.orbitSpeed;

        this.shellsData.forEach(s => { if (s.pulse > 0) s.pulse = Math.max(0, s.pulse - 0.02); });

        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.06;
            p.alpha -= 0.022;
            if (p.alpha <= 0) this.particles.splice(i, 1);
        }
    }

    createBurst(x, y, color) {
        for (let i = 0; i < 12; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 1 + Math.random() * 3;
            this.particles.push({
                x, y, color,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: 1.5 + Math.random() * 2.5,
                alpha: 1
            });
        }
    }

    playSound(type) {
        if (!this.soundEnabled) return;
        try {
            if (!this.audioCtx) {
                this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            const ctx = this.audioCtx;
            if (ctx.state === 'suspended') ctx.resume();

            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);

            const t = ctx.currentTime;
            if (type === 'add') {
                osc.frequency.setValueAtTime(520, t);
                osc.frequency.exponentialRampToValueAtTime(880, t + 0.1);
            } else {
                osc.frequency.setValueAtTime(320, t);
                osc.frequency.exponentialRampToValueAtTime(160, t + 0.18);
            }
            gain.gain.setValueAtTime(0.08, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
            osc.start(t);
            osc.stop(t + 0.22);
        } catch (e) {
            /* 사용자 제스처 이전에는 오디오가 차단될 수 있다 — 무시한다 */
        }
    }

    // ── 렌더링 ──────────────────────────────────────────────────

    render() {
        if (!this.currentAtom) return;
        if (!this.sprites) this.buildSprites();
        this.ctx.clearRect(0, 0, this.width, this.height);

        const shells = this.getShells();
        const valenceIndex = Rules.getValenceShellIndex(shells);
        const renderList = [];

        // 원자핵 — 양성자와 중성자를 하나씩 그린다. 핵자도 궤도·전자와 함께 깊이 정렬해야
        // 앞뒤 겹침이 맞는다.
        const R = this.nucleusRadius;
        this.nucleons.forEach(n => {
            const pos = this.project3D(n.ux * R, n.uy * R, n.uz * R);
            renderList.push({ type: 'nucleon', z: pos.z, pos, isProton: n.isProton });
        });

        this.shellsData.forEach((shell, sIndex) => {
            const radius = this.shellRadii[sIndex];
            const segments = 72;
            const points = [];
            let avgZ = 0;
            for (let i = 0; i <= segments; i++) {
                const a = (2 * Math.PI / segments) * i;
                const p = this.project3D(radius * Math.cos(a), 0, radius * Math.sin(a));
                points.push(p);
                avgZ += p.z;
            }
            renderList.push({
                type: 'orbit', z: avgZ / points.length, points,
                shellIndex: sIndex, isValence: sIndex === valenceIndex, pulse: shell.pulse
            });

            shell.slots.forEach((slot, slotIndex) => {
                const pos = this.getSlotScreenPos(sIndex, slotIndex);
                renderList.push({
                    type: slot.filled ? 'electron' : 'slot',
                    z: pos.z, pos,
                    isValence: sIndex === valenceIndex,
                    isDroppable: !slot.filled && this.draggedElectron != null
                });
            });
        });

        // z가 큰 것(뒤쪽)부터 그려 앞뒤 겹침을 표현한다
        renderList.sort((a, b) => b.z - a.z);

        renderList.forEach(item => {
            if (item.type === 'orbit') this.drawOrbit(item);
            else if (item.type === 'nucleon') {
                this.drawSprite(item.isProton ? this.sprites.proton : this.sprites.neutron,
                    item.pos.x, item.pos.y, item.pos.scale);
            }
            else if (item.type === 'slot') this.drawSlot(item.pos, item.isDroppable);
            else if (item.type === 'electron') this.drawElectron(item.pos, item.isValence, false);
        });

        this.drawNucleusLabel();

        if (this.draggedElectron) {
            this.drawElectron({ ...this.draggedElectron, scale: this.camera.zoom }, true, true);
        }
        this.drawParticles();
    }

    /**
     * 원자핵 구성을 캔버스 좌상단에 고정 표기한다.
     * 모형 위에 띄우면 회전·확대에 따라 궤도나 전자와 겹치므로 고정 위치가 안전하다.
     */
    drawNucleusLabel() {
        const ctx = this.ctx;
        const atom = this.currentAtom;
        const x = 12, y = 12;

        ctx.save();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 13px "Malgun Gothic", sans-serif';

        const rows = [
            { color: '#d64545', mark: '+', text: `양성자 ${atom.protonCount}` },
            { color: '#9aa8b8', mark: '', text: `중성자 ${atom.neutronCount} (전하 없음)` }
        ];

        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.strokeStyle = 'rgba(200,211,224,0.9)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x, y, 164, 52, 8);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#16202c';
        ctx.font = 'bold 12.5px "Malgun Gothic", sans-serif';
        ctx.fillText(`${atom.symbol} 원자핵`, x + 10, y + 14);

        ctx.font = '11.5px "Malgun Gothic", sans-serif';
        rows.forEach((row, i) => {
            const ry = y + 30 + i * 14;
            ctx.beginPath();
            ctx.arc(x + 15, ry, 4.5, 0, Math.PI * 2);
            ctx.fillStyle = row.color;
            ctx.fill();
            if (row.mark) {
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 7px "Malgun Gothic", sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(row.mark, x + 15, ry + 0.5);
                ctx.textAlign = 'left';
            }
            ctx.fillStyle = '#46586c';
            ctx.font = '11.5px "Malgun Gothic", sans-serif';
            ctx.fillText(row.text, x + 25, ry);
        });
        ctx.restore();
    }

    drawOrbit({ points, shellIndex, isValence, pulse }) {
        const ctx = this.ctx;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);

        if (pulse > 0) {
            ctx.strokeStyle = `rgba(194, 59, 59, ${0.35 + pulse * 0.5})`;
            ctx.lineWidth = 2.5;
        } else if (isValence) {
            ctx.strokeStyle = 'rgba(47, 111, 208, 0.55)';
            ctx.lineWidth = 2;
        } else {
            ctx.strokeStyle = 'rgba(120, 138, 160, 0.32)';
            ctx.lineWidth = 1.2;
        }
        ctx.setLineDash([]);
        ctx.stroke();

        // 라벨은 궤도의 가장 오른쪽 지점에 건다. 고정 각도에 걸면 카메라를 돌릴 때
        // 라벨이 안쪽 껍질의 전자 위로 올라와 겹친다.
        let label = points[0];
        for (const p of points) if (p.x > label.x) label = p;

        ctx.fillStyle = isValence ? 'rgba(47, 111, 208, 0.95)' : 'rgba(110, 128, 150, 0.8)';
        ctx.font = `${isValence ? 'bold ' : ''}11px "Malgun Gothic", sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(SHELL_NAMES[shellIndex] + (isValence ? ' 최외각' : ''), label.x + 7, label.y);
    }

    drawSlot(pos, isDroppable) {
        const ctx = this.ctx;
        const r = this.electronRadius * 0.75 * pos.scale;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
        ctx.fillStyle = isDroppable ? 'rgba(47,111,208,0.14)' : 'rgba(120,138,160,0.06)';
        ctx.fill();
        ctx.strokeStyle = isDroppable ? 'rgba(47,111,208,0.7)' : 'rgba(120,138,160,0.4)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    /**
     * 전자 렌더링.
     * 접근성(PRD 10.4): 색상 하나에 의존하지 않고 [색상 + '−' 기호 + 테두리 + 크기]로 구분한다.
     * 최외각 전자는 밝은 파랑 + 흰 테두리 + 큰 크기, 내각 전자는 회청색 + 점선 테두리 + 작은 크기.
     */
    drawElectron(pos, isValence, isDragging) {
        const sprite = isValence ? this.sprites.valence : this.sprites.inner;
        const scale = pos.scale || 1;

        if (isDragging) {
            this.ctx.save();
            this.ctx.shadowColor = 'rgba(47, 111, 208, 0.55)';
            this.ctx.shadowBlur = 12;
            this.drawSprite(sprite, pos.x, pos.y, scale * 1.15);
            this.ctx.restore();
            return;
        }
        this.drawSprite(sprite, pos.x, pos.y, scale);
    }

    drawParticles() {
        const ctx = this.ctx;
        this.particles.forEach(p => {
            ctx.save();
            ctx.globalAlpha = Math.max(0, p.alpha);
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.fill();
            ctx.restore();
        });
    }
}

if (typeof module !== 'undefined') {
    module.exports = AtomCanvasEngine;
}
