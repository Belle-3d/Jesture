import { stateStore } from './stateStore';
import { HAND_CONNECTIONS } from '@mediapipe/hands';
import { audioEngine } from './audioEngine';

const OVERLAY = {
    left: '#6BF2D3',
    right: '#C58AFF',
    cue1: '#F17BC6',
    cue2: '#57DAB0',
    labelBg: 'rgba(10, 14, 24, 0.78)',
    labelBorder: 'rgba(255, 255, 255, 0.22)',
    text: '#EFF4FC',
    textMuted: '#B7C5D8',
    joint: 'rgba(239, 244, 252, 0.72)',
    fingertip: 'rgba(255, 255, 255, 0.95)',
};

const FINGERTIPS = new Set([4, 8, 12, 16, 20]);

export class VisualEngine {
    constructor() {
        this.canvas = null;
        this.ctx = null;
        this.mixerCanvas = null;
    }

    init(canvasElement) {
        this.canvas = canvasElement;
        this.ctx = canvasElement.getContext('2d');
        this.mixerCanvas = document.getElementById('mixer-hud');
        this.resize();

        window.addEventListener('resize', () => {
            this.resize();
            this.drawMixerHud();
        });
        stateStore.subscribe(() => this.drawMixerHud());
        requestAnimationFrame(() => this.drawMixerHud());
    }

    resize() {
        if (this.canvas) {
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
        }
    }

    draw(results, handsData) {
        if (!this.ctx || !this.canvas) return;

        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;

        // Prefer the real frame size so the overlay stays aligned if the
        // camera cannot honor the 960×540 request in main.js.
        const videoWidth = results.image?.videoWidth || results.image?.width || 960;
        const videoHeight = results.image?.videoHeight || results.image?.height || 540;

        // Calculate COVER scale (fill screen, crop excess)
        const scale = Math.max(width / videoWidth, height / videoHeight);
        const scaledWidth = videoWidth * scale;
        const scaledHeight = videoHeight * scale;

        // Center the video
        const xOffset = (width - scaledWidth) / 2;
        const yOffset = (height - scaledHeight) / 2;

        ctx.save();
        ctx.clearRect(0, 0, width, height);

        // Mirror the content
        ctx.translate(width, 0);
        ctx.scale(-1, 1);

        // Draw video (Cover mode)
        ctx.drawImage(results.image, xOffset, yOffset, scaledWidth, scaledHeight);

        // Draw Landmarks with custom scaling
        if (results.multiHandLandmarks) {
            for (let i = 0; i < results.multiHandLandmarks.length; i++) {
                const meta = handsData?.[i];
                const accent = meta?.label === 'Left' ? OVERLAY.left : OVERLAY.right;
                this.drawSkeleton(ctx, results.multiHandLandmarks[i], xOffset, yOffset, scaledWidth, scaledHeight, accent);
            }
        }

        ctx.restore();

        // Draw Audio Visualizer (edge waves)
        this.drawAudioVisualizer(ctx, width, height);

        this.drawMixerHud();

        // Draw Hand Info (requires same coordinate transform as video)
        this.drawHandInfo(handsData, width, height, xOffset, yOffset, scaledWidth, scaledHeight);

        this.drawFingerPoseDebug(handsData, xOffset, yOffset, scaledWidth, scaledHeight);
    }

    /**
     * Custom skeleton drawer to match video scaling
     */
    drawSkeleton(ctx, landmarks, dx, dy, dw, dh, accent = OVERLAY.left) {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = this.withAlpha(accent, 0.48);
        ctx.shadowColor = this.withAlpha(accent, 0.35);
        ctx.shadowBlur = 5;
        for (const [start, end] of HAND_CONNECTIONS) {
            const p1 = landmarks[start];
            const p2 = landmarks[end];
            ctx.beginPath();
            ctx.moveTo(p1.x * dw + dx, p1.y * dh + dy);
            ctx.lineTo(p2.x * dw + dx, p2.y * dh + dy);
            ctx.stroke();
        }
        ctx.shadowBlur = 0;

        landmarks.forEach((point, index) => {
            const px = point.x * dw + dx;
            const py = point.y * dh + dy;
            const tip = FINGERTIPS.has(index);
            const r = tip ? 3.2 : 2.2;
            ctx.beginPath();
            ctx.arc(px, py, r, 0, 2 * Math.PI);
            ctx.fillStyle = tip ? OVERLAY.fingertip : OVERLAY.joint;
            if (tip) {
                ctx.shadowColor = this.withAlpha(accent, 0.45);
                ctx.shadowBlur = 6;
            }
            ctx.fill();
            ctx.shadowBlur = 0;
        });
        ctx.restore();
    }

    withAlpha(hex, alpha) {
        const h = hex.replace('#', '');
        const r = parseInt(h.slice(0, 2), 16);
        const g = parseInt(h.slice(2, 4), 16);
        const b = parseInt(h.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    /**
     * Draw the DJ mixing interface
     */
    drawMixerHud() {
        if (!this.mixerCanvas) this.mixerCanvas = document.getElementById('mixer-hud');
        const canvas = this.mixerCanvas;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const cssW = canvas.clientWidth || 1;
        const cssH = canvas.clientHeight || 1;
        const pixelW = Math.max(1, Math.floor(cssW * dpr));
        const pixelH = Math.max(1, Math.floor(cssH * dpr));
        if (canvas.width !== pixelW || canvas.height !== pixelH) {
            canvas.width = pixelW;
            canvas.height = pixelH;
        }

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cssW, cssH);

        const state = stateStore.getState();
        const midX = cssW / 2;
        const xfadeY = cssH - 34;
        const barHeight = Math.max(96, cssH - 124);
        const barsY = 34 + barHeight / 2;
        const col = Math.max(72, Math.min(cssW * 0.28, 96));
        const eqBarWidth = 40;
        const meterSpan = 2 * col + eqBarWidth;
        const xfadeWidth = meterSpan + 28;

        ctx.save();
        this.drawMasterVolume(ctx, midX, barsY, state, barHeight);
        this.drawEQIndicator(ctx, midX - col, barsY, 'Treble', state.treble, '#C850FF', 'left', barHeight);
        this.drawEQIndicator(ctx, midX + col, barsY, 'Bass', state.bass, '#00E8F0', 'right', barHeight);
        this.drawCrossfader(ctx, midX, xfadeY, state, xfadeWidth);
        ctx.restore();
    }

    drawDJInterface(ctx, width, height, state) {
        ctx.save();

        // Bottom Y position for controls
        const bottomY = height - 150;

        // Draw crossfader at bottom center
        this.drawCrossfader(ctx, width / 2, height - 60, state);

        // Bottom right control group: Master + Bass + Treble
        const rightGroupX = width - 140;
        this.drawMasterVolume(ctx, rightGroupX, bottomY, state);
        this.drawEQIndicator(ctx, rightGroupX - 50, bottomY, 'Treble', state.treble, '#C850FF');
        this.drawEQIndicator(ctx, rightGroupX + 50, bottomY, 'Bass', state.bass, '#00E8F0');

        ctx.restore();
    }

    /**
     * Draw the crossfader (horizontal slider at bottom)
     */
    drawCrossfader(ctx, x, y, state, barWidth = 360) {
        const barHeight = 14;
        const barX = x - barWidth / 2;
        const barY = y - barHeight / 2;

        // Outline and background
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(barX, barY, barWidth, barHeight);
        ctx.strokeStyle = 'rgba(255,255,255,0.20)';
        ctx.lineWidth = 1;
        ctx.strokeRect(barX, barY, barWidth, barHeight);

        // Left (A) and Right (B) gradients
        const leftGradient = ctx.createLinearGradient(barX, 0, barX + barWidth / 2, 0);
        leftGradient.addColorStop(0, 'rgba(0,232,240,0.55)');
        leftGradient.addColorStop(1, 'rgba(0,232,240,0.08)');
        ctx.fillStyle = leftGradient;
        ctx.fillRect(barX + 2, barY + 2, barWidth / 2 - 4, barHeight - 4);

        const rightGradient = ctx.createLinearGradient(barX + barWidth / 2, 0, barX + barWidth, 0);
        rightGradient.addColorStop(0, 'rgba(200,80,255,0.08)');
        rightGradient.addColorStop(1, 'rgba(200,80,255,0.55)');
        ctx.fillStyle = rightGradient;
        ctx.fillRect(barX + barWidth / 2 + 2, barY + 2, barWidth / 2 - 4, barHeight - 4);

        // Thumb
        const thumbX = barX + state.crossfaderPosition * barWidth;
        ctx.save();
        ctx.shadowBlur = 10;
        ctx.shadowColor = 'rgba(255, 255, 255, 0.7)';
        ctx.fillStyle = '#EFF4FC';
        ctx.fillRect(thumbX - 5, barY - 6, 10, barHeight + 12);
        ctx.restore();
        ctx.strokeStyle = 'rgba(0,232,240,0.55)';
        ctx.strokeRect(thumbX - 5, barY - 6, 10, barHeight + 12);

        // Labels A / B
        ctx.font = '300 12px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#00E8F0';
        ctx.fillText('A', barX - 16, barY + barHeight / 2 + 4);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#C850FF';
        ctx.fillText('B', barX + barWidth + 16, barY + barHeight / 2 + 4);

        ctx.textAlign = 'center';
        ctx.fillStyle = '#B7C5D8';
        ctx.font = '300 12px Inter, sans-serif';
        ctx.fillText('CROSSFADER', x, barY + barHeight + 16);
        ctx.fillStyle = '#EFF4FC';
        ctx.font = '300 13px Inter, sans-serif';
        ctx.fillText(`${Math.round(state.crossfaderPosition * 100)}%`, x + 72, barY + barHeight + 16);
    }

    /**
     * Draw master volume indicator (vertical bar)
     */
    drawMasterVolume(ctx, x, y, state, barHeight = 148) {
        const barWidth = 36;
        const barY = y - barHeight / 2;

        // Background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(x - barWidth / 2, barY, barWidth, barHeight);

        // Border
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.20)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - barWidth / 2, barY, barWidth, barHeight);

        // Volume fill
        const fillHeight = state.masterVolume * barHeight;
        const gradient = ctx.createLinearGradient(0, barY + barHeight, 0, barY);
        gradient.addColorStop(0, 'rgba(0, 232, 240, 0.9)');
        gradient.addColorStop(1, 'rgba(239, 244, 252, 0.5)');

        ctx.fillStyle = gradient;
        ctx.fillRect(x - barWidth / 2 + 2, barY + barHeight - fillHeight, barWidth - 4, fillHeight);

        // Volume percentage
        ctx.fillStyle = '#EFF4FC';
        ctx.font = '300 16px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.round(state.masterVolume * 100)}%`, x, barY - 8);

        // Label
        ctx.fillStyle = '#B7C5D8';
        ctx.font = '300 12px Inter, sans-serif';
        ctx.fillText('MASTER', x, barY + barHeight + 18);
    }

    /**
     * Draw track status indicator
     */
    drawTrackIndicator(ctx, x, y, trackLabel, isLoaded, isPlaying, state) {
        const barWidth = 25;
        const barHeight = 120;
        const barY = y - barHeight / 2;

        // Calculate effective volume from crossfader
        let effectiveVolume;
        if (trackLabel === 'A') {
            if (state.crossfaderPosition <= 0.5) {
                effectiveVolume = 1;
            } else {
                effectiveVolume = 1 - (state.crossfaderPosition - 0.5) * 2;
            }
        } else {
            if (state.crossfaderPosition >= 0.5) {
                effectiveVolume = 1;
            } else {
                effectiveVolume = state.crossfaderPosition * 2;
            }
        }
        effectiveVolume *= state.masterVolume;

        const trackColor = trackLabel === 'A' ? 'rgba(255, 255, 255, 0.8)' : 'rgba(200, 180, 140, 0.8)';

        // Background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.fillRect(x - barWidth / 2, barY, barWidth, barHeight);

        // Border
        ctx.strokeStyle = isPlaying ? trackColor : 'rgba(100, 100, 100, 0.3)';
        ctx.lineWidth = isPlaying ? 2 : 1;
        ctx.strokeRect(x - barWidth / 2, barY, barWidth, barHeight);

        // Volume fill
        const fillHeight = effectiveVolume * barHeight;
        ctx.fillStyle = trackColor;
        ctx.globalAlpha = isPlaying ? 0.6 : 0.2;
        ctx.fillRect(x - barWidth / 2 + 2, barY + barHeight - fillHeight, barWidth - 4, fillHeight);
        ctx.globalAlpha = 1;

        // Track label
        ctx.fillStyle = isLoaded ? trackColor : 'rgba(100, 100, 100, 0.5)';
        ctx.font = '300 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`Track ${trackLabel}`, x, barY - 8);

        // Status
        ctx.font = '400 10px Inter, sans-serif';
        if (!isLoaded) {
            ctx.fillStyle = 'rgba(100, 100, 100, 0.5)';
            ctx.fillText('No File', x, barY + barHeight + 20);
        } else {
            ctx.fillStyle = isPlaying ? trackColor : 'rgba(150, 150, 150, 0.6)';
            ctx.fillText(isPlaying ? '▶ Playing' : '⏸ Paused', x, barY + barHeight + 20);
        }

        // Effective volume
        ctx.font = '400 9px Inter, sans-serif';
        ctx.fillStyle = 'rgba(150, 150, 150, 0.6)';
        ctx.fillText(`${Math.round(effectiveVolume * 100)}%`, x, barY + barHeight + 35);
    }

    /**
     * Draw EQ indicator (bass or treble)
     * Value ranges from -1 (cut) to +1 (boost), 0 is neutral
     */
    drawEQIndicator(ctx, x, y, label, value, color, tickSide = 'right', barHeight = 148) {
        const barWidth = 40;
        const barY = y - barHeight / 2;
        const centerY = y; // Center line (neutral position)

        // Split-range background: positive above 0, negative below
        ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.fillRect(x - barWidth / 2, barY, barWidth, barHeight / 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fillRect(x - barWidth / 2, centerY, barWidth, barHeight / 2);

        // Border matches the master meter
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.20)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - barWidth / 2, barY, barWidth, barHeight);

        // Center line (0 dB), kept inside the bar
        ctx.strokeStyle = 'rgba(239, 244, 252, 0.75)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - barWidth / 2, centerY);
        ctx.lineTo(x + barWidth / 2, centerY);
        ctx.stroke();

        // Value fill
        const fillHeight = Math.abs(value) * (barHeight / 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = value >= 0 ? 0.72 : 0.42;

        if (value >= 0) {
            ctx.fillRect(x - barWidth / 2 + 3, centerY - fillHeight, barWidth - 6, fillHeight);
        } else {
            ctx.fillRect(x - barWidth / 2 + 3, centerY, barWidth - 6, fillHeight);
        }
        ctx.globalAlpha = 1;

        // Range ticks on the outer side so meters stay uncluttered
        ctx.font = '300 11px Inter, sans-serif';
        if (tickSide === 'left') {
            ctx.textAlign = 'right';
            const tx = x - barWidth / 2 - 6;
            ctx.fillStyle = '#B7C5D8';
            ctx.fillText('+12', tx, barY + 12);
            ctx.fillStyle = '#EFF4FC';
            ctx.fillText('0', tx, centerY + 4);
            ctx.fillStyle = '#B7C5D8';
            ctx.fillText('−12', tx, barY + barHeight);
        } else {
            ctx.textAlign = 'left';
            const tx = x + barWidth / 2 + 6;
            ctx.fillStyle = '#B7C5D8';
            ctx.fillText('+12', tx, barY + 12);
            ctx.fillStyle = '#EFF4FC';
            ctx.fillText('0', tx, centerY + 4);
            ctx.fillStyle = '#B7C5D8';
            ctx.fillText('−12', tx, barY + barHeight);
        }

        ctx.textAlign = 'center';
        ctx.fillStyle = color;
        ctx.font = '300 12px Inter, sans-serif';
        ctx.fillText(label.toUpperCase(), x, barY + barHeight + 16);

        const dbValue = Math.round(value * 12);
        ctx.fillStyle = '#EFF4FC';
        ctx.font = '300 16px Inter, sans-serif';
        ctx.fillText(`${dbValue >= 0 ? '+' : ''}${dbValue} DB`, x, barY - 8);
    }

    /**
     * Draw overall play status
     */
    drawPlayStatus(ctx, x, y, state) {
        const aPlaying = state.trackAPlaying;
        const bPlaying = state.trackBPlaying;

        ctx.font = '400 18px Inter, sans-serif';
        ctx.textAlign = 'center';

        // Track A status (left)
        ctx.fillStyle = aPlaying ? 'rgba(255,255,255,0.95)' : 'rgba(140,140,140,0.6)';
        ctx.fillText(aPlaying ? '▶ Track A' : '⏸ Track A', x - 90, y);

        // Track B status (right)
        ctx.fillStyle = bPlaying ? 'rgba(255,255,255,0.95)' : 'rgba(140,140,140,0.6)';
        ctx.fillText(bPlaying ? '▶ Track B' : '⏸ Track B', x + 90, y);

        ctx.font = '400 11px Inter, sans-serif';
        ctx.fillStyle = 'rgba(150, 150, 150, 0.5)';
        ctx.fillText('Keyboard: A + Space = Toggle Track A', x - 90, y + 20);
        ctx.fillText('Keyboard: B + Space = Toggle Track B', x + 90, y + 20);
    }

    /**
     * Draw two rectangular play/pause buttons for Track A and Track B
     * placed on the right side near other controls.
     */
    drawTrackButtons(ctx, x, y, state) {
        const w = 120;
        const h = 44;
        const gap = 12;

        // Track A button (above)
        const ax = x;
        const ay = y;
        const aPlaying = state.trackAPlaying;
        ctx.fillStyle = aPlaying ? 'rgba(40,160,40,0.95)' : 'rgba(60,60,60,0.85)';
        this.roundRect(ctx, ax - w/2, ay - h/2, w, h, 8, true, false);
        ctx.fillStyle = 'white';
        ctx.font = '400 14px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(aPlaying ? '▶ Track A' : '⏸ Track A', ax, ay + 4);
        ctx.font = '400 11px Inter, sans-serif';
        ctx.fillText('Keyboard: A + Space', ax, ay + 20 + 6);

        // Track B button (below)
        const bx = x;
        const by = y + h + gap;
        const bPlaying = state.trackBPlaying;
        ctx.fillStyle = bPlaying ? 'rgba(200,140,40,0.95)' : 'rgba(60,60,60,0.85)';
        this.roundRect(ctx, bx - w/2, by - h/2, w, h, 8, true, false);
        ctx.fillStyle = 'white';
        ctx.font = '400 14px Inter, sans-serif';
        ctx.fillText(bPlaying ? '▶ Track B' : '⏸ Track B', bx, by + 4);
        ctx.font = '400 11px Inter, sans-serif';
        ctx.fillText('Keyboard: B + Space', bx, by + 20 + 6);
    }

    // Utility: draw rounded rect
    roundRect(ctx, x, y, width, height, radius, fill, stroke) {
        if (typeof radius === 'number') radius = {tl: radius, tr: radius, br: radius, bl: radius};
        ctx.beginPath();
        ctx.moveTo(x + radius.tl, y);
        ctx.lineTo(x + width - radius.tr, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius.tr);
        ctx.lineTo(x + width, y + height - radius.br);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius.br, y + height);
        ctx.lineTo(x + radius.bl, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius.bl);
        ctx.lineTo(x, y + radius.tl);
        ctx.quadraticCurveTo(x, y, x + radius.tl, y);
        ctx.closePath();
        if (fill) { ctx.fill(); }
        if (stroke) { ctx.stroke(); }
    }

    drawFingerPoseDebug(handsData, dx, dy, dw, dh) {
        if (!handsData || !handsData.length) return;
        const poseMeta = {
            ONE_FINGER: { title: 'CUE 1', accent: OVERLAY.cue1 },
            TWO_FINGERS: { title: 'CUE 2', accent: OVERLAY.cue2 },
        };
        const ctx = this.ctx;
        ctx.save();
        handsData.forEach((hand) => {
            const meta = poseMeta[hand.fingerPose];
            if (!meta || !hand.landmarks) return;
            const tip = hand.landmarks[hand.fingerPose === 'TWO_FINGERS' ? 12 : 8];
            const x = (1 - tip.x) * dw + dx;
            const y = tip.y * dh + dy - 12;
            this.drawOverlayBadge(ctx, x, y, meta.title, null, meta.accent, 'center', 'bottom');
        });
        ctx.restore();
    }

    drawOverlayBadge(ctx, cx, cy, title, detail, accent, alignX = 'center', alignY = 'top') {
        const padX = 10;
        const padY = 6;
        const lineGap = 2;
        ctx.font = '600 13px Rajdhani, Inter, sans-serif';
        const titleW = ctx.measureText(title).width;
        let detailW = 0;
        if (detail) {
            ctx.font = '500 11px Inter, sans-serif';
            detailW = ctx.measureText(detail).width;
        }
        const w = Math.ceil(Math.max(titleW, detailW) + padX * 2);
        const h = detail ? padY * 2 + 28 : padY * 2 + 18;
        let x = cx - w / 2;
        if (alignX === 'left') x = cx;
        if (alignX === 'right') x = cx - w;
        let y = cy;
        if (alignY === 'bottom') y = cy - h;
        if (alignY === 'middle') y = cy - h / 2;

        ctx.fillStyle = OVERLAY.labelBg;
        ctx.strokeStyle = this.withAlpha(accent, 0.55);
        ctx.lineWidth = 1;
        this.roundRect(ctx, x, y, w, h, 8, true, true);

        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = OVERLAY.text;
        ctx.font = '600 13px Rajdhani, Inter, sans-serif';
        ctx.fillText(title, x + w / 2, y + padY);
        if (detail) {
            ctx.fillStyle = OVERLAY.textMuted;
            ctx.font = '500 11px Inter, sans-serif';
            ctx.fillText(detail, x + w / 2, y + padY + 14 + lineGap);
        }
    }

    drawHandInfo(handsData, width, height, dx, dy, dw, dh) {
        if (!handsData) return;

        const state = stateStore.getState();
        const ctx = this.ctx;
        ctx.save();

        handsData.forEach((hand) => {
            const wrist = hand.landmarks[0];
            const x = (1 - wrist.x) * dw + dx;
            const y = wrist.y * dh + dy;
            const accent = hand.label === 'Left' ? OVERLAY.left : OVERLAY.right;

            const controlType = hand.controlType || '';
            const cueLabel = hand.fingerPose === 'ONE_FINGER' || hand.fingerPose === 'TWO_FINGERS';
            const fistLabel = controlType.includes('(Fist)');

            if (!cueLabel && fistLabel) {
                const isRight = hand.label === 'Right';
                const eqVal = isRight ? state.bass : state.treble;
                const db = Math.round(eqVal * 12);
                const title = isRight ? 'BASS' : 'TREBLE';
                const detail = `${db >= 0 ? '+' : ''}${db} DB`;
                this.drawOverlayBadge(ctx, x, y - 18, title, detail, accent, 'center', 'bottom');
            } else if (!cueLabel && !fistLabel) {
                const deckTag = hand.label === 'Left' ? 'DECK A' : 'DECK B';
                this.drawOverlayBadge(ctx, x, y - 18, deckTag, controlType.toUpperCase(), accent, 'center', 'bottom');
            }

            if (hand.pinches && hand.pinches.index) {
                const indexTip = hand.landmarks[8];
                const ix = (1 - indexTip.x) * dw + dx;
                const iy = indexTip.y * dh + dy;
                const ringR = 14;

                ctx.beginPath();
                ctx.arc(ix, iy, ringR, 0, 2 * Math.PI);
                ctx.strokeStyle = this.withAlpha(accent, 0.9);
                ctx.lineWidth = 2;
                ctx.shadowColor = this.withAlpha(accent, 0.55);
                ctx.shadowBlur = 8;
                ctx.stroke();
                ctx.shadowBlur = 0;

                const isRight = hand.label === 'Right';
                const title = isRight ? 'MASTER' : 'CROSSFADER';
                const detail = isRight
                    ? `${Math.round(state.masterVolume * 100)}%`
                    : `${Math.round(state.crossfaderPosition * 100)}%`;
                this.drawOverlayBadge(ctx, ix + ringR + 10, iy, title, detail, accent, 'left', 'middle');
            }
        });
        ctx.restore();
    }
    /**
     * Draw audio-reactive visualizer around canvas edges
     * Continuous gradient waves - futuristic minimal style
     */
    drawAudioVisualizer(ctx, width, height) {
        // Get FFT data (or use idle animation if no audio)
        let fftData = null;
        if (audioEngine.analyser) {
            fftData = audioEngine.analyser.getValue();
        }

        const points = 48;
        const maxWaveHeight = 35;
        const edgeOffset = 2;

        ctx.save();
        ctx.lineWidth = 1.5;
        ctx.shadowBlur = 0;

        const getWaveValue = (index, total, offset = 0) => {
            if (!fftData) {
                const time = Date.now() / 1000;
                return 0.12 + Math.sin(time * 1.5 + (index + offset) * 0.1) * 0.08;
            }
            const binIndex = Math.floor((index / total) * fftData.length);
            const dB = fftData[binIndex] || -100;
            return Math.max(0, (dB + 100) / 100);
        };

        // ========== TOP EDGE ==========
        ctx.beginPath();
        ctx.moveTo(0, edgeOffset);
        for (let i = 0; i <= points; i++) {
            const x = (i / points) * width;
            const value = getWaveValue(i, points, 0);
            const y = edgeOffset + value * maxWaveHeight;
            ctx.lineTo(x, y);
        }
        ctx.lineTo(width, edgeOffset);
        ctx.lineTo(0, edgeOffset);
        ctx.closePath();

        const topGrad = ctx.createLinearGradient(0, 0, 0, maxWaveHeight + edgeOffset);
        topGrad.addColorStop(0, 'rgba(0, 232, 240, 0.55)');
        topGrad.addColorStop(1, 'rgba(0, 232, 240, 0)');
        ctx.fillStyle = topGrad;
        ctx.fill();

        // ========== BOTTOM EDGE ==========
        ctx.beginPath();
        ctx.moveTo(0, height - edgeOffset);
        for (let i = 0; i <= points; i++) {
            const x = (i / points) * width;
            const value = getWaveValue(i, points, points);
            const y = height - edgeOffset - value * maxWaveHeight;
            ctx.lineTo(x, y);
        }
        ctx.lineTo(width, height - edgeOffset);
        ctx.lineTo(0, height - edgeOffset);
        ctx.closePath();

        const bottomGrad = ctx.createLinearGradient(0, height, 0, height - maxWaveHeight - edgeOffset);
        bottomGrad.addColorStop(0, 'rgba(200, 80, 255, 0.55)');
        bottomGrad.addColorStop(1, 'rgba(200, 80, 255, 0)');
        ctx.fillStyle = bottomGrad;
        ctx.fill();

        // ========== LEFT EDGE ==========
        ctx.beginPath();
        ctx.moveTo(edgeOffset, 0);
        for (let i = 0; i <= points; i++) {
            const y = (i / points) * height;
            const value = getWaveValue(i, points, points * 2);
            const x = edgeOffset + value * maxWaveHeight;
            ctx.lineTo(x, y);
        }
        ctx.lineTo(edgeOffset, height);
        ctx.lineTo(edgeOffset, 0);
        ctx.closePath();

        const leftGrad = ctx.createLinearGradient(0, 0, maxWaveHeight + edgeOffset, 0);
        leftGrad.addColorStop(0, 'rgba(0, 232, 240, 0.55)');
        leftGrad.addColorStop(1, 'rgba(0, 232, 240, 0)');
        ctx.fillStyle = leftGrad;
        ctx.fill();

        // ========== RIGHT EDGE ==========
        ctx.beginPath();
        ctx.moveTo(width - edgeOffset, 0);
        for (let i = 0; i <= points; i++) {
            const y = (i / points) * height;
            const value = getWaveValue(i, points, points * 3);
            const x = width - edgeOffset - value * maxWaveHeight;
            ctx.lineTo(x, y);
        }
        ctx.lineTo(width - edgeOffset, height);
        ctx.lineTo(width - edgeOffset, 0);
        ctx.closePath();

        const rightGrad = ctx.createLinearGradient(width, 0, width - maxWaveHeight - edgeOffset, 0);
        rightGrad.addColorStop(0, 'rgba(200, 80, 255, 0.55)');
        rightGrad.addColorStop(1, 'rgba(200, 80, 255, 0)');
        ctx.fillStyle = rightGrad;
        ctx.fill();

        ctx.restore();
    }
}

export const visualEngine = new VisualEngine();
