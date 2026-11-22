import WaveSurfer from 'wavesurfer.js';
import { audioEngine } from './audioEngine';
import { cueMarkers } from './cuePanel';

const DECKS = ['A', 'B'];
const VIEW_SPAN = 24;
const HALF_SPAN = VIEW_SPAN / 2;
const BUCKET_SECONDS = 0.05;

const WAVE = {
    A: 'rgba(255, 255, 255, 0.45)',
    B: 'rgba(255, 255, 255, 0.45)',
};

const PROGRESS = {
    A: 'rgba(255, 255, 255, 0.95)',
    B: 'rgba(255, 255, 255, 0.95)',
};

const PLAYHEAD = {
    A: 'rgba(255, 255, 255, 0.96)',
    B: 'rgba(255, 255, 255, 0.96)',
};

const PLAYHEAD_TINT = {
    A: 'rgba(255, 255, 255, 0.55)',
    B: 'rgba(255, 255, 255, 0.55)',
};

const OVERVIEW = {
    A: [255, 255, 255],
    B: [255, 255, 255],
};

function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    const ss = String(secs).padStart(2, '0');
    if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
    return `${minutes}:${ss}`;
}

function formatEdge(seconds, duration) {
    if (!(duration > 0) || seconds < -0.05 || seconds > duration + 0.05) return '—';
    return formatTime(Math.min(duration, Math.max(0, seconds)));
}

function formatRemaining(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    return `−${formatTime(seconds)}`;
}

function emptyDeck() {
    return {
        status: 'empty',
        envelope: null,
        duration: 0,
        message: '',
        generation: 0,
        wavesurfer: null,
        surferReady: false,
        pxPerSec: 0,
        padSeconds: HALF_SPAN,
    };
}

function rangePeak(envelope, bucketSeconds, t0, t1) {
    const count = envelope.length;
    if (!count || t1 <= 0) return 0;
    let i0 = Math.floor(Math.max(0, t0) / bucketSeconds);
    let i1 = Math.ceil(t1 / bucketSeconds);
    if (i0 < 0) i0 = 0;
    if (i1 > count) i1 = count;
    if (i1 <= i0) return 0;
    let peak = 0;
    for (let i = i0; i < i1; i++) {
        if (envelope[i] > peak) peak = envelope[i];
    }
    return peak;
}

function resizeCanvas(canvas) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cssWidth = canvas.clientWidth || 1;
    const cssHeight = canvas.clientHeight || 1;
    const width = Math.max(1, Math.floor(cssWidth * dpr));
    const height = Math.max(1, Math.floor(cssHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
    }
    return { width, height, dpr };
}

class Waveform {
    constructor() {
        this.decks = { A: emptyDeck(), B: emptyDeck() };
        this.views = { A: null, B: null };
        this.raf = 0;
        this.loop = this.loop.bind(this);
    }

    init() {
        for (const deck of DECKS) {
            const root = document.querySelector(`.waveform[data-deck="${deck}"]`);
            const detail = root?.querySelector('.waveform-detail');
            const overview = root?.querySelector('.waveform-overview-canvas');
            if (!root || !detail || !overview) continue;
            if (getComputedStyle(root).position === 'static') root.style.position = 'relative';
            const cueOverlay = document.createElement('canvas');
            cueOverlay.style.cssText = 'position:absolute;pointer-events:none;z-index:2;';
            root.appendChild(cueOverlay);
            this.views[deck] = {
                root,
                detail,
                overview,
                cueOverlay,
                start: root.querySelector('.waveform-start'),
                remaining: root.querySelector('.waveform-remaining'),
                total: root.querySelector('.waveform-total'),
                windowStart: root.querySelector('.waveform-window-start'),
                elapsed: root.querySelector('.waveform-elapsed'),
                windowEnd: root.querySelector('.waveform-window-end'),
                status: root.querySelector('.waveform-status'),
            };
            overview.addEventListener('click', (event) => this.onOverviewClick(deck, event));
        }
        if (this.raf) cancelAnimationFrame(this.raf);
        this.raf = requestAnimationFrame(this.loop);
    }

    destroySurfer(deck) {
        const state = this.decks[deck];
        if (!state?.wavesurfer) return;
        const ws = state.wavesurfer;
        state.wavesurfer = null;
        state.surferReady = false;
        state.pxPerSec = 0;
        try { ws.destroy(); } catch (error) { console.warn(`WaveSurfer ${deck} destroy failed`, error); }
    }

    beginLoad(deck) {
        const state = this.decks[deck];
        if (!state) return 0;
        state.generation += 1;
        state.status = 'loading';
        state.envelope = null;
        state.duration = 0;
        state.message = 'Reading waveform…';
        state.padSeconds = HALF_SPAN;
        this.destroySurfer(deck);
        return state.generation;
    }

    async setFromEngine(deck, generation = this.decks[deck]?.generation) {
        const state = this.decks[deck];
        if (!state || state.generation !== generation) return false;
        const buffer = audioEngine.getDecodedBuffer(deck);
        if (!buffer || !(buffer.length > 0)) {
            if (this.decks[deck].generation !== generation) return false;
            this.setError(deck, generation);
            throw new Error(`No decoded buffer for deck ${deck}`);
        }
        try {
            const envelope = await this.computeEnvelope(buffer, deck, generation);
            if (!envelope || this.decks[deck].generation !== generation) return false;
            state.envelope = envelope;
            state.duration = buffer.duration || audioEngine.getTrackDuration(deck) || 0;
            state.status = 'ready';
            state.message = '';
            this.mountSurfer(deck, generation);
            return true;
        } catch (error) {
            if (this.decks[deck].generation !== generation) return false;
            console.warn(`Waveform ${deck} failed`, error);
            this.setError(deck, generation);
            throw error;
        }
    }

    setError(deck, generation) {
        const state = this.decks[deck];
        if (!state) return;
        if (generation != null && state.generation !== generation) return;
        state.status = 'error';
        state.envelope = null;
        state.duration = 0;
        state.message = "Couldn't load track";
        this.destroySurfer(deck);
    }

    async computeEnvelope(buffer, deck, generation) {
        const channels = [];
        for (let c = 0; c < buffer.numberOfChannels; c++) {
            channels.push(buffer.getChannelData(c));
        }
        if (!channels.length) return null;
        const length = channels[0].length;
        const sampleRate = buffer.sampleRate || 44100;
        const samplesPerBucket = Math.max(1, Math.floor(sampleRate * BUCKET_SECONDS));
        const bucketCount = Math.max(1, Math.ceil(length / samplesPerBucket));
        const envelope = new Float32Array(bucketCount);
        const stride = samplesPerBucket > 2000 ? Math.floor(samplesPerBucket / 2000) : 1;

        for (let i = 0; i < bucketCount; i++) {
            if (i > 0 && i % 80 === 0) {
                await new Promise((resolve) => setTimeout(resolve, 0));
                if (this.decks[deck].generation !== generation) return null;
            }
            const start = i * samplesPerBucket;
            const end = Math.min(length, start + samplesPerBucket);
            let sumSq = 0;
            let count = 0;
            for (let s = start; s < end; s += stride) {
                let sample = 0;
                for (let c = 0; c < channels.length; c++) sample += channels[c][s];
                sample /= channels.length;
                sumSq += sample * sample;
                count++;
            }
            const rms = count ? Math.sqrt(sumSq / count) : 0;
            envelope[i] = Math.sqrt(rms);
        }
        return envelope;
    }

    mountSurfer(deck, generation) {
        const state = this.decks[deck];
        const view = this.views[deck];
        if (!state?.envelope || !view || state.generation !== generation) return;
        this.destroySurfer(deck);

        const duration = state.duration || 0;
        const sample = duration / state.envelope.length;
        const pad = Math.max(1, Math.round(HALF_SPAN / sample));
        const padded = new Float32Array(state.envelope.length + pad * 2);
        padded.set(state.envelope, pad);
        state.padSeconds = pad * sample;
        const paddedDuration = padded.length * sample;
        const width = view.detail.clientWidth || 300;
        const detailHeight = view.detail.clientHeight || 72;

        const ws = WaveSurfer.create({
            container: view.detail,
            height: detailHeight,
            waveColor: WAVE[deck],
            progressColor: PROGRESS[deck],
            cursorColor: PLAYHEAD[deck],
            cursorWidth: 2,
            barWidth: 2,
            barGap: 2,
            barRadius: 1,
            normalize: true,
            fillParent: false,
            hideScrollbar: true,
            interact: true,
            dragToSeek: false,
            autoScroll: false,
            autoCenter: false,
            autoplay: false,
            mediaControls: false,
            minPxPerSec: width / VIEW_SPAN,
            peaks: [padded],
            duration: paddedDuration,
        });
        state.wavesurfer = ws;
        state.pxPerSec = width / VIEW_SPAN;
        ws.on('ready', () => {
            if (state.wavesurfer !== ws || state.generation !== generation) return;
            state.surferReady = true;
        });
        ws.on('interaction', (paddedTime) => {
            if (state.wavesurfer !== ws || state.generation !== generation) return;
            const trackDuration = audioEngine.getTrackDuration(deck) || state.duration;
            if (!(trackDuration > 0)) return;
            const time = paddedTime - state.padSeconds;
            const offset = Math.min(Math.max(0, time), Math.max(0, trackDuration - 1e-4));
            audioEngine.seekTrack(deck, offset);
        });
        ws.on('error', (error) => {
            if (state.wavesurfer !== ws || state.generation !== generation) return;
            console.warn(`WaveSurfer ${deck} failed`, error);
            this.setError(deck, generation);
        });
    }

    syncSurfer(deck, position) {
        const state = this.decks[deck];
        const view = this.views[deck];
        const ws = state?.wavesurfer;
        if (!ws || !state.surferReady || !view) return;
        const width = ws.getWidth() || view.detail.clientWidth;
        if (!(width > 0)) return;
        const px = width / VIEW_SPAN;
        if (!state.pxPerSec || Math.abs(state.pxPerSec - px) > 0.5) {
            ws.zoom(px);
            state.pxPerSec = px;
        }
        const padded = position + state.padSeconds;
        ws.setTime(padded);
        ws.setScroll(Math.max(0, padded * px - width / 2));
    }

    onOverviewClick(deck, event) {
        const state = this.decks[deck];
        const view = this.views[deck];
        if (!state || !view || state.status !== 'ready') return;
        const duration = audioEngine.getTrackDuration(deck) || state.duration;
        const rect = view.overview.getBoundingClientRect();
        if (!(duration > 0) || !(rect.width > 0)) return;
        const x = Math.min(Math.max(0, event.clientX - rect.left), rect.width);
        const time = (x / rect.width) * duration;
        audioEngine.seekTrack(deck, Math.min(Math.max(0, time), Math.max(0, duration - 1e-4)));
    }

    loop() {
        this.raf = requestAnimationFrame(this.loop);
        for (const deck of DECKS) this.paint(deck);
    }

    paint(deck) {
        const view = this.views[deck];
        const state = this.decks[deck];
        if (!view || !state) return;

        const ready = state.status === 'ready' && state.envelope;
        const duration = ready ? (audioEngine.getTrackDuration(deck) || state.duration || 0) : 0;
        const position = ready ? audioEngine.getTrackPosition(deck) : 0;
        const windowStart = position - HALF_SPAN;

        const overview = resizeCanvas(view.overview);
        const overviewCtx = view.overview.getContext('2d');
        overviewCtx.clearRect(0, 0, overview.width, overview.height);
        if (ready && duration > 0) {
            this.drawOverview(overviewCtx, overview.width, overview.height, overview.dpr, state, position, duration, deck);
            this.syncSurfer(deck, position);
        } else {
            this.drawPlaceholder(overviewCtx, overview.width, overview.height, overview.dpr);
        }
        this.drawDetailMarkers(deck, duration);

        view.root.classList.toggle('ready', !!ready);
        if (view.start) view.start.textContent = '0:00';
        if (view.remaining) view.remaining.textContent = formatRemaining(ready ? duration - position : 0);
        if (view.total) view.total.textContent = formatTime(duration);
        if (view.windowStart) view.windowStart.textContent = ready ? formatEdge(windowStart, duration) : '—';
        if (view.elapsed) view.elapsed.textContent = formatTime(ready ? position : 0);
        if (view.windowEnd) view.windowEnd.textContent = ready ? formatEdge(windowStart + VIEW_SPAN, duration) : '—';
        if (view.status) view.status.textContent = state.message || '';
    }

    drawPlaceholder(ctx, width, height, dpr) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
        ctx.lineWidth = Math.max(1, dpr);
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();
    }

    drawOverview(ctx, width, height, dpr, state, position, duration, deck) {
        const [r, g, b] = OVERVIEW[deck];
        const columns = Math.max(1, Math.round(width / (window.devicePixelRatio || 1)));
        const colWidth = width / columns;
        const mid = height / 2;
        const ampScale = mid * 0.92;
        for (let i = 0; i < columns; i++) {
            const t0 = (i / columns) * duration;
            const t1 = ((i + 1) / columns) * duration;
            const peak = Math.min(1, rangePeak(state.envelope, BUCKET_SECONDS, t0, t1));
            const played = t1 <= position;
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${played ? 0.9 : 0.38})`;
            ctx.fillRect(i * colWidth, mid - peak * ampScale, colWidth, Math.max(1, peak * ampScale * 2));
        }

        const visStart = Math.max(0, position - HALF_SPAN);
        const visEnd = Math.min(duration, position + HALF_SPAN);
        const x0 = (visStart / duration) * width;
        const boxWidth = Math.max(dpr, ((visEnd - visStart) / duration) * width);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.16)`;
        ctx.fillRect(x0, 0, boxWidth, height);
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.9)`;
        ctx.lineWidth = Math.max(1, dpr);
        ctx.strokeRect(x0 + ctx.lineWidth / 2, ctx.lineWidth / 2, Math.max(1, boxWidth - ctx.lineWidth), Math.max(1, height - ctx.lineWidth));

        for (const marker of cueMarkers(deck)) {
            if (!(marker.time >= 0) || marker.time > duration + 1e-3) continue;
            const x = Math.min(width - 1, Math.max(0, (Math.min(marker.time, duration) / duration) * width));
            this.drawCueLine(ctx, x, height, marker.color, dpr);
        }

        const playX = Math.min(width - 1, Math.max(0, (position / duration) * width));
        const lineWidth = Math.max(1, Math.round(dpr));
        ctx.fillStyle = PLAYHEAD_TINT[deck];
        ctx.fillRect(playX - lineWidth, 0, lineWidth * 2, height);
        ctx.fillStyle = PLAYHEAD[deck];
        ctx.fillRect(playX - lineWidth / 2, 0, lineWidth, height);
    }

    drawCueLine(ctx, x, height, color, dpr) {
        const lineWidth = Math.max(1, Math.round(dpr));
        ctx.fillStyle = color;
        ctx.fillRect(x - lineWidth / 2, 0, lineWidth, height);
    }

    drawDetailMarkers(deck, duration) {
        const view = this.views[deck];
        const state = this.decks[deck];
        const canvas = view?.cueOverlay;
        if (!canvas || !state) return;
        const box = view.detail.getBoundingClientRect();
        const root = view.root.getBoundingClientRect();
        canvas.style.left = `${box.left - root.left}px`;
        canvas.style.top = `${box.top - root.top}px`;
        canvas.style.width = `${box.width}px`;
        canvas.style.height = `${box.height}px`;
        const sized = resizeCanvas(canvas);
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, sized.width, sized.height);
        const ws = state.wavesurfer;
        if (!ws || !state.surferReady || !(duration > 0) || !(box.width > 0)) return;
        const cssWidth = ws.getWidth() || box.width;
        const px = cssWidth / VIEW_SPAN;
        const scroll = ws.getScroll();
        const scale = sized.width / cssWidth;
        for (const marker of cueMarkers(deck)) {
            if (!(marker.time >= 0) || marker.time > duration + 1e-3) continue;
            const x = ((marker.time + state.padSeconds) * px - scroll) * scale;
            if (x < -sized.dpr || x > sized.width + sized.dpr) continue;
            this.drawCueLine(ctx, x, sized.height, marker.color, sized.dpr);
        }
    }
}

export const waveform = new Waveform();
