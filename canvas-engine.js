/**
 * Ion Lab 3D — 원자 모형 렌더링 및 입력 엔진
 *
 * Canvas 2D 위에 원근 투영 + Z-buffer 정렬로 의사(pseudo) 3D 모형을 그린다.
 * 조작 규칙 판정은 Rules에 위임하고, 이 클래스는 "규칙이 금지한 조작을 애초에
 * 성립시키지 않는" 책임만 진다. (PRD 7.1 / Blueprint p.6 DON'T 항목)
 */
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
        this.shellRadii = [R * 0.30, R * 0.53, R * 0.77, R * 1.0];
        this.nucleusRadius = Math.max(R * 0.155, 20);
        this.electronRadius = Math.min(Math.max(R * 0.034, 5.5), 11);
    }

    /** 터치는 손가락 접촉면이 넓어 마우스보다 넉넉한 히트 반경이 필요하다. */
    hitRadius(isTouch) {
        return isTouch ? this.electronRadius * 3.0 : this.electronRadius * 2.2;
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
        this.ctx.clearRect(0, 0, this.width, this.height);

        const shells = this.getShells();
        const valenceIndex = Rules.getValenceShellIndex(shells);
        const renderList = [];

        const nucleus = this.project3D(0, 0, 0);
        renderList.push({ type: 'nucleus', z: nucleus.z, pos: nucleus });

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
            else if (item.type === 'nucleus') this.drawNucleus(item.pos);
            else if (item.type === 'slot') this.drawSlot(item.pos, item.isDroppable);
            else if (item.type === 'electron') this.drawElectron(item.pos, item.isValence, false);
        });

        if (this.draggedElectron) {
            this.drawElectron({ ...this.draggedElectron, scale: this.camera.zoom }, true, true);
        }
        this.drawParticles();
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

    drawNucleus(pos) {
        const ctx = this.ctx;
        const r = this.nucleusRadius * pos.scale;
        const atom = this.currentAtom;

        const grad = ctx.createRadialGradient(pos.x - r * 0.35, pos.y - r * 0.35, r * 0.1, pos.x, pos.y, r);
        grad.addColorStop(0, '#f08e8e');
        grad.addColorStop(0.55, '#d64545');
        grad.addColorStop(1, '#8e2020');

        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${Math.max(11, r * 0.42)}px "Malgun Gothic", sans-serif`;
        ctx.fillText(atom.symbol, pos.x, pos.y - r * 0.22);
        ctx.font = `bold ${Math.max(10, r * 0.34)}px "Malgun Gothic", sans-serif`;
        ctx.fillText(`+${atom.protonCount}`, pos.x, pos.y + r * 0.34);
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
        const ctx = this.ctx;
        const scale = pos.scale || 1;
        const r = this.electronRadius * (isValence ? 1 : 0.82) * scale;

        const grad = ctx.createRadialGradient(pos.x - r * 0.35, pos.y - r * 0.35, r * 0.1, pos.x, pos.y, r);
        if (isValence) {
            grad.addColorStop(0, '#8fc0ff');
            grad.addColorStop(0.5, '#2f6fd0');
            grad.addColorStop(1, '#123c78');
        } else {
            grad.addColorStop(0, '#d5dfea');
            grad.addColorStop(0.5, '#9aabbe');
            grad.addColorStop(1, '#6c7c8f');
        }

        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        if (isValence) {
            ctx.strokeStyle = isDragging ? '#ffffff' : 'rgba(255,255,255,0.9)';
            ctx.lineWidth = isDragging ? 2.5 : 1.8;
            ctx.setLineDash([]);
        } else {
            // 내각 전자는 '잠긴 상태'임을 점선 테두리로 알린다
            ctx.strokeStyle = 'rgba(76, 90, 107, 0.85)';
            ctx.lineWidth = 1.2;
            ctx.setLineDash([2, 2]);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${Math.max(8, r * 1.1)}px "Malgun Gothic", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('−', pos.x, pos.y);
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
