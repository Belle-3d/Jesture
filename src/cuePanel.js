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

function slotEls(root, slot) {
    const node = root.querySelector(`.cue-slot[data-slot="${slot}"]`);
    return {
        value: node?.querySelector('[data-cue-value]'),
        input: node?.querySelector('[data-cue-input]'),
        save: node?.querySelector('[data-cue-save]'),
        clear: node?.querySelector('[data-cue-clear]'),
    };
}

function render(root) {
    root.dataset.deck = cueState.deck;
    root.querySelectorAll('.cue-deck-btn').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.deck === cueState.deck);
    });
    const cues = cueState[cueState.deck];
    for (const slot of SLOTS) {
        const els = slotEls(root, slot);
        const saved = cues[slot];
        if (els.value) els.value.textContent = saved || 'Empty';
        if (els.input && document.activeElement !== els.input) {
            els.input.value = saved || '';
        }
    }
}

export function initCuePanel() {
    const openBtn = document.getElementById('edit-cues-btn');
    const panel = document.getElementById('cue-panel');
    const closeBtn = document.getElementById('cue-panel-close');
    if (!openBtn || !panel || !closeBtn) return;

    const setOpen = (open) => {
        cueState.open = open;
        panel.hidden = !open;
        document.body.classList.toggle('cue-panel-open', open);
        if (open) render(panel);
    };

    openBtn.addEventListener('click', () => setOpen(true));
    closeBtn.addEventListener('click', () => setOpen(false));

    panel.querySelectorAll('.cue-deck-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            cueState.deck = btn.dataset.deck === 'B' ? 'B' : 'A';
            render(panel);
        });
    });

    for (const slot of SLOTS) {
        const els = slotEls(panel, slot);
        els.save?.addEventListener('click', () => {
            const typed = (els.input?.value || '').trim();
            cueState[cueState.deck][slot] = typed || null;
            render(panel);
        });
        els.clear?.addEventListener('click', () => {
            cueState[cueState.deck][slot] = null;
            render(panel);
        });
    }

    setOpen(false);
}
