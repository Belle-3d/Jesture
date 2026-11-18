import { audioEngine } from './audioEngine';
import { stateStore } from './stateStore';

const SLOTS = [1, 2];

function emptyCues() {
    return { 1: null, 2: null };
}

const cueState = {
    open: false,
    deck: 'A',
    A: emptyCues(),
    B: emptyCues(),
};

const boundPlayer = { A: undefined, B: undefined };

function slotEls(root, slot) {
    const node = root.querySelector(`.cue-panel-slot[data-slot="${slot}"]`);
    return {
        value: node?.querySelector('[data-cue-value]'),
        input: node?.querySelector('[data-cue-input]'),
        save: node?.querySelector('[data-cue-save]'),
        clear: node?.querySelector('[data-cue-clear]'),
        jump: node?.querySelector('[data-cue-jump]'),
        play: node?.querySelector('[data-cue-play]'),
    };
}

function trackDuration(deck) {
    const state = stateStore.getState();
    const loaded = deck === 'A' ? state.trackALoaded : state.trackBLoaded;
    if (!loaded) return 0;
    const duration = audioEngine.getTrackDuration(deck);
    return typeof duration === 'number' && isFinite(duration) && duration > 0 ? duration : 0;
}

function loadedPlayer(deck) {
    const player = audioEngine.playerFor(deck);
    if (!player || !player.loaded) return null;
    return player;
}

function parseCue(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const parts = raw.split(':');
    const whole = (value, limit) => {
        if (!/^\d+$/.test(value)) return null;
        const number = Number(value);
        return number >= 0 && number < limit ? number : null;
    };
    const seconds = (value) => {
        if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
        const number = Number(value);
        return number >= 0 && number < 60 ? number : null;
    };

    if (parts.length === 1) {
        if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
        const number = Number(raw);
        return isFinite(number) ? number : null;
    }
    if (parts.length === 2) {
        const minutes = whole(parts[0], Infinity);
        const secs = seconds(parts[1]);
        if (minutes == null || secs == null) return null;
        return minutes * 60 + secs;
    }
    if (parts.length === 3) {
        const hours = whole(parts[0], Infinity);
        const minutes = whole(parts[1], 60);
        const secs = seconds(parts[2]);
        if (hours == null || minutes == null || secs == null) return null;
        return hours * 3600 + minutes * 60 + secs;
    }
    return null;
}

function formatCue(seconds) {
    const centi = Math.round(Math.max(0, seconds) * 100);
    const fraction = centi % 100;
    let whole = Math.floor(centi / 100);
    const hours = Math.floor(whole / 3600);
    whole %= 3600;
    const minutes = Math.floor(whole / 60);
    const secs = whole % 60;
    const clock = `${String(secs).padStart(2, '0')}${fraction ? `.${String(fraction).padStart(2, '0')}` : ''}`;
    if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${clock}`;
    return `${minutes}:${clock}`;
}

function cueInTrack(seconds, duration) {
    return typeof seconds === 'number' && isFinite(seconds) && seconds >= 0 && duration > 0 && seconds - duration <= 1e-3;
}

function savedCue(deck, seconds) {
    return cueInTrack(seconds, trackDuration(deck)) ? seconds : null;
}

async function jumpToCue(deck, seconds) {
    if (savedCue(deck, seconds) == null) return;
    await audioEngine.pauseTrack(deck);
    audioEngine.seekTrack(deck, seconds);
}

async function playFromCue(deck, seconds) {
    if (savedCue(deck, seconds) == null) return;
    await audioEngine.init();
    await audioEngine.pauseTrack(deck);
    audioEngine.seekTrack(deck, seconds);
    await audioEngine.resumeTrack(deck);
}

function render(root) {
    root.dataset.deck = cueState.deck;
    root.querySelectorAll('.cue-panel-deck').forEach((btn) => {
        btn.classList.toggle('cue-panel-active', btn.dataset.deck === cueState.deck);
    });
    const cues = cueState[cueState.deck];
    for (const slot of SLOTS) {
        const els = slotEls(root, slot);
        const saved = cues[slot];
        const label = typeof saved === 'number' ? formatCue(saved) : '—:——';
        if (els.value) els.value.textContent = label;
        if (els.input && document.activeElement !== els.input) {
            els.input.value = typeof saved === 'number' ? label : '';
        }
    }
}

function syncDeck(deck, panel) {
    const player = loadedPlayer(deck);
    let changed = false;
    if (player !== boundPlayer[deck]) {
        if (boundPlayer[deck]) {
            cueState[deck] = emptyCues();
            changed = true;
        }
        boundPlayer[deck] = player;
    }

    const duration = trackDuration(deck);
    for (const slot of SLOTS) {
        const saved = cueState[deck][slot];
        if (saved != null && !cueInTrack(saved, duration)) {
            cueState[deck][slot] = null;
            changed = true;
        }
    }

    if (changed && panel && !panel.hidden && cueState.deck === deck) render(panel);
}

export function initCuePanel() {
    const openBtn = document.getElementById('edit-cues-btn');
    const panel = document.getElementById('cue-panel');
    const closeBtn = document.getElementById('cue-panel-close');
    if (!openBtn || !panel || !closeBtn) return;

    const setOpen = (open) => {
        cueState.open = open;
        panel.hidden = !open;
        if (open) render(panel);
    };

    openBtn.addEventListener('click', () => setOpen(true));
    closeBtn.addEventListener('click', () => setOpen(false));

    panel.querySelectorAll('.cue-panel-deck').forEach((btn) => {
        btn.addEventListener('click', () => {
            cueState.deck = btn.dataset.deck === 'B' ? 'B' : 'A';
            render(panel);
        });
    });

    for (const slot of SLOTS) {
        const els = slotEls(panel, slot);
        els.save?.addEventListener('click', () => {
            const parsed = parseCue(els.input?.value || '');
            const duration = trackDuration(cueState.deck);
            if (!cueInTrack(parsed, duration)) return;
            cueState[cueState.deck][slot] = parsed;
            render(panel);
        });
        els.clear?.addEventListener('click', () => {
            cueState[cueState.deck][slot] = null;
            render(panel);
        });
        els.jump?.addEventListener('click', () => jumpToCue(cueState.deck, cueState[cueState.deck][slot]));
        els.play?.addEventListener('click', () => playFromCue(cueState.deck, cueState[cueState.deck][slot]));
    }

    const clearDeck = (deck) => {
        cueState[deck] = emptyCues();
        if (!panel.hidden && cueState.deck === deck) render(panel);
    };
    const watchReplace = (id, deck) => {
        const input = document.getElementById(id);
        input?.addEventListener('change', () => {
            if (input.files && input.files[0]) clearDeck(deck);
        });
    };
    watchReplace('track-a-input', 'A');
    watchReplace('track-b-input', 'B');

    const sync = () => {
        syncDeck('A', panel);
        syncDeck('B', panel);
    };
    stateStore.subscribe(sync);
    sync();
    setOpen(false);
}
