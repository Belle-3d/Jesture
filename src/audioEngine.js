import * as Tone from 'tone';
import { stateStore } from './stateStore';

export class AudioEngine {
    constructor() {
        this.initialized = false;
        this.synth = null;
        this.instruments = {};

        // Track players (A and B)
        this.trackAPlayer = null;
        this.trackBPlayer = null;

        // EQ filters for bass and treble
        this.bassFilter = null;
        this.trebleFilter = null;

        // Pause state tracking for resume functionality
        this.pauseState = {
            A: { isPaused: false, pauseTime: 0, startTime: 0, audibleAt: 0 },
            B: { isPaused: false, pauseTime: 0, startTime: 0, audibleAt: 0 }
        };

        // Subscribe to state changes
        stateStore.subscribe((state) => {
            this.handleStateChange(state);
        });
    }

    // Robustly read playbackRate from a Tone.Player-like object
    getPlaybackRate(player) {
        try {
            if (!player) return 1;
            const pr = player.playbackRate;
            if (pr == null) return 1;
            if (typeof pr === 'object' && pr.value !== undefined) return pr.value;
            if (typeof pr === 'number') return pr;
            // fallback for Tone.Player#get API
            if (player.get && typeof player.get === 'function') {
                const v = player.get('playbackRate');
                if (typeof v === 'number') return v;
            }
        } catch (e) {
            // ignore and fallback
        }
        return 1;
    }

    async init() {
        if (this.initialized) return;

        await Tone.start();
        console.log('Audio Engine Initialized');

        // Initialize EQ filters
        // Bass: Low-shelf filter at 200Hz
        this.bassFilter = new Tone.Filter({
            type: 'lowshelf',
            frequency: 200,
            gain: 0
        }).toDestination();

        // Treble: High-shelf filter at 3000Hz
        this.trebleFilter = new Tone.Filter({
            type: 'highshelf',
            frequency: 3000,
            gain: 0
        }).connect(this.bassFilter);

        // FFT Analyzer for Audio Visualization (128 bins for edge detail)
        this.analyser = new Tone.Analyser('fft', 128);
        this.bassFilter.connect(this.analyser);

        console.log('EQ Filters & Analyser initialized');

        // Initialize Instruments (for sequencer - keeping for backwards compatibility)
        this.instruments = {
            0: new Tone.MembraneSynth().toDestination(), // Kick
            1: new Tone.NoiseSynth({
                noise: { type: 'white' },
                envelope: { attack: 0.005, decay: 0.1, sustain: 0 }
            }).toDestination(), // Snare
            2: new Tone.MetalSynth({
                frequency: 200,
                envelope: { attack: 0.001, decay: 0.1, release: 0.01 },
                harmonicity: 5.1,
                modulationIndex: 32,
                resonance: 4000,
                octaves: 1.5
            }).toDestination(), // Hi-hat
            3: new Tone.MembraneSynth({
                pitchDecay: 0.008,
                octaves: 4,
                oscillator: { type: 'sine' }
            }).toDestination() // Tom
        };

        // Adjust volumes
        this.instruments[0].volume.value = 0;
        this.instruments[1].volume.value = -10;
        this.instruments[2].volume.value = -15;
        this.instruments[3].volume.value = -5;

        this.initialized = true;
        this.startSequencer();
    }

    /**
     * Calculate track volumes based on crossfader and master volume
     * Crossfader: 0 = Track A only, 0.5 = Both tracks, 1 = Track B only
     */
    calculateTrackVolumes(masterVolume, crossfaderPosition) {
        let trackAVolume, trackBVolume;

        // Crossfader logic:
        // - Position 0: Track A = 100%, Track B = 0%
        // - Position 0.5: Track A = 100%, Track B = 100%
        // - Position 1: Track A = 0%, Track B = 100%

        if (crossfaderPosition <= 0.5) {
            // Left half: Track A stays full, Track B fades in
            trackAVolume = 1;
            trackBVolume = crossfaderPosition * 2; // 0 -> 0, 0.5 -> 1
        } else {
            // Right half: Track A fades out, Track B stays full
            trackAVolume = 1 - (crossfaderPosition - 0.5) * 2; // 0.5 -> 1, 1 -> 0
            trackBVolume = 1;
        }

        // Apply master volume
        trackAVolume *= masterVolume;
        trackBVolume *= masterVolume;

        return { trackAVolume, trackBVolume };
    }

    handleStateChange(state) {
        if (!this.initialized) return;

        // Handle Play/Stop for sequencer
        if (state.isPlaying && Tone.Transport.state !== 'started') {
            Tone.Transport.start();
        } else if (!state.isPlaying && Tone.Transport.state === 'started') {
            Tone.Transport.stop();
        }

        // Handle Tempo
        Tone.Transport.bpm.value = state.tempo;

        // Calculate and apply track volumes based on crossfader and master volume
        const { trackAVolume, trackBVolume } = this.calculateTrackVolumes(
            state.masterVolume,
            state.crossfaderPosition
        );

        // Apply to Track A
        if (this.trackAPlayer) {
            const dbA = trackAVolume === 0 ? -Infinity : -40 * (1 - trackAVolume);
            this.trackAPlayer.volume.value = dbA;
        }

        // Apply to Track B
        if (this.trackBPlayer) {
            const dbB = trackBVolume === 0 ? -Infinity : -40 * (1 - trackBVolume);
            this.trackBPlayer.volume.value = dbB;
        }

        // Apply EQ (bass and treble)
        // Map -1 to +1 range to -12dB to +12dB
        if (this.bassFilter) {
            this.bassFilter.gain.value = state.bass * 12;
        }
        if (this.trebleFilter) {
            this.trebleFilter.gain.value = state.treble * 12;
        }
    }

    startSequencer() {
        // Clear previous events to avoid duplicates
        Tone.Transport.cancel();

        // Schedule a repeating loop every 16th note
        Tone.Transport.scheduleRepeat((time) => {
            const state = stateStore.getState();
            const currentStep = state.currentStep;

            // 1. Play sounds for the current step
            state.beatGrid.forEach((row, rowIndex) => {
                if (row[currentStep]) {
                    this.playSound(rowIndex, time);
                }
            });

            // 2. Advance step
            const nextStep = (currentStep + 1) % 16;

            // 3. Update state
            // Use Tone.Draw to sync UI updates with the audio loop
            Tone.Draw.schedule(() => {
                stateStore.setState({ currentStep: nextStep });
            }, time);

        }, "16n");
    }

    playSound(row, time) {
        if (!this.initialized) return;

        const instrument = this.instruments[row];
        if (instrument) {
            switch (parseInt(row)) {
                case 0: // Kick
                    instrument.triggerAttackRelease("C2", "8n", time);
                    break;
                case 1: // Snare
                    instrument.triggerAttackRelease("8n", time);
                    break;
                case 2: // Hi-hat
                    instrument.triggerAttackRelease("32n", time);
                    break;
                case 3: // Tom
                    instrument.triggerAttackRelease("G2", "8n", time);
                    break;
            }
        }
    }

    /**
     * Load an audio track from a File object
     * @param {File} file - The audio file to load
     * @param {'A'|'B'} track - Which track to load (A or B)
     */
    async loadTrack(file, track) {
        // Ensure audio context is started
        if (!this.initialized) {
            await this.init();
        }

        // Make sure Tone.js context is running
        if (Tone.context.state !== 'running') {
            await Tone.start();
            console.log('Tone.js audio context started');
        }

        // Create object URL from file
        const url = URL.createObjectURL(file);
        console.log(`Loading Track ${track} from: ${url}`);

        // Stop and dispose of existing player if any
        if (track === 'A' && this.trackAPlayer) {
            this.trackAPlayer.stop();
            this.trackAPlayer.dispose();
            this.trackAPlayer = null;
        } else if (track === 'B' && this.trackBPlayer) {
            this.trackBPlayer.stop();
            this.trackBPlayer.dispose();
            this.trackBPlayer = null;
        }

        // Reset pause state for this track
        this.pauseState[track] = { isPaused: false, pauseTime: 0, startTime: 0, audibleAt: 0 };

        // Create new player with promise-based loading
        // Connect through EQ chain: Player -> Treble -> Bass -> Destination
        return new Promise((resolve, reject) => {
            const player = new Tone.Player({
                url: url,
                loop: true,
                autostart: false,
                onload: () => {
                    console.log(`Track ${track} loaded successfully: ${file.name}`);

                    // Store the player and connect it into the EQ chain
                    if (track === 'A') {
                        this.trackAPlayer = player;
                        if (this.trebleFilter) player.connect(this.trebleFilter);
                        stateStore.setState({ trackALoaded: true });
                    } else {
                        this.trackBPlayer = player;
                        if (this.trebleFilter) player.connect(this.trebleFilter);
                        stateStore.setState({ trackBLoaded: true });
                    }

                    // Apply current volume based on crossfader and master
                    const state = stateStore.getState();
                    const { trackAVolume, trackBVolume } = this.calculateTrackVolumes(
                        state.masterVolume,
                        state.crossfaderPosition
                    );
                    const volume = track === 'A' ? trackAVolume : trackBVolume;
                    const db = volume === 0 ? -Infinity : -40 * (1 - volume);
                    player.volume.value = db;
                    console.log(`Track ${track} volume set to ${db.toFixed(1)}dB`);

                    resolve(player);
                },
                onerror: (error) => {
                    console.error(`Error loading Track ${track}:`, error);
                    reject(error);
                }
            });
        });
    }

    /**
     * Toggle play/pause for BOTH tracks (overall play/pause)
     * Used by right hand quick pinch
     */
    async toggleAllTracks() {
        // Ensure audio context is running
        if (Tone.context.state !== 'running') {
            await Tone.start();
            console.log('Tone.js audio context started before toggle');
        }

        const state = stateStore.getState();
        const anyPlaying = state.trackAPlaying || state.trackBPlaying;

        console.log(`toggleAllTracks called - currently ${anyPlaying ? 'playing' : 'paused'}`);

        if (anyPlaying) {
            // PAUSE both tracks
            await this.pauseTrack('A');
            await this.pauseTrack('B');
            stateStore.setState({ isPlaying: false });
            console.log('All tracks paused');
        } else {
            // PLAY both tracks (if loaded)
            let anyStarted = false;
            if (this.trackAPlayer && this.trackAPlayer.loaded) {
                await this.resumeTrack('A');
                anyStarted = true;
            }
            if (this.trackBPlayer && this.trackBPlayer.loaded) {
                await this.resumeTrack('B');
                anyStarted = true;
            }
            if (anyStarted) {
                stateStore.setState({ isPlaying: true });
                console.log('All tracks started');
            } else {
                console.warn('No tracks loaded to play');
            }
        }
    }

    /**
     * Pause a single track with position saving
     */
    async pauseTrack(track) {
        const player = track === 'A' ? this.trackAPlayer : this.trackBPlayer;
        const pauseState = this.pauseState[track];

        const scheduled = !pauseState.isPaused && pauseState.audibleAt > Tone.now();
        if (player && player.loaded && (player.state === 'started' || scheduled)) {
            // Same clock as the waveform, so a pause during a scheduled start keeps the cue, including 0.
            const bufferPos = this.getTrackPosition(track);
            pauseState.pauseTime = bufferPos;
            pauseState.isPaused = true;
            pauseState.audibleAt = 0;
            player.stop();

            if (track === 'A') {
                stateStore.setState({ trackAPlaying: false });
            } else {
                stateStore.setState({ trackBPlaying: false });
            }
            console.log(`Track ${track} paused at buffer position ${bufferPos.toFixed(2)}s`);
        }
    }

    /**
     * Resume a single track from saved position
     */
    async resumeTrack(track) {
        const player = track === 'A' ? this.trackAPlayer : this.trackBPlayer;
        const pauseState = this.pauseState[track];

        if (player && player.loaded) {
            const rate = this.getPlaybackRate(player) || 1;
            const duration = player.buffer ? player.buffer.duration : 0;
            // A paused cue of 0 is a real offset. Only an unpaused deck starts at the beginning.
            const offset = pauseState.isPaused && duration > 0
                ? ((pauseState.pauseTime % duration) + duration) % duration
                : 0;
            console.log(pauseState.isPaused
                ? `Track ${track} resuming from ${offset.toFixed(2)}s (rate=${rate.toFixed(3)})`
                : `Track ${track} starting from beginning`);

            // loopEnd 0 makes a looping Player snap to the start. Set it through the public setter.
            if (duration > 0 && !(Number(player.loopEnd) > 0)) {
                player.loopEnd = Math.max(0, duration - 1e-4);
            }
            // Tone 15.1.22: restart() is a no-op unless state at that time is already
            // "started", and seek() stop-starts on one sample. Stop a running player,
            // then start() slightly later so the offset is the only source playing.
            const when = Tone.now() + 0.05;
            if (player.state === 'started' || pauseState.audibleAt > Tone.now()) player.stop();
            pauseState.pauseTime = offset;
            pauseState.startTime = when - (offset / rate);
            pauseState.audibleAt = when;
            pauseState.isPaused = false;
            player.start(when, offset);

            if (track === 'A') {
                stateStore.setState({ trackAPlaying: true });
            } else {
                stateStore.setState({ trackBPlaying: true });
            }
        }
    }

    playerFor(track) {
        return track === 'A' ? this.trackAPlayer : track === 'B' ? this.trackBPlayer : null;
    }

    /**
     * Native AudioBuffer already decoded by this deck's Tone.Player.
     * Returns null until the player has loaded.
     */
    getDecodedBuffer(track) {
        const player = this.playerFor(track);
        if (!player || !player.loaded || !player.buffer) return null;
        try {
            const buf = typeof player.buffer.get === 'function' ? player.buffer.get() : player.buffer;
            if (buf && typeof buf.getChannelData === 'function') return buf;
        } catch (e) {
            console.warn(`getDecodedBuffer(${track}) failed`, e);
        }
        return null;
    }

    getTrackDuration(track) {
        const player = this.playerFor(track);
        const duration = player && player.buffer ? player.buffer.duration : 0;
        return duration || 0;
    }

    /**
     * Buffer position in seconds. Paused decks return the stored pause point.
     * Playing decks use the same elapsed * playbackRate clock as pause/resume.
     */
    getTrackPosition(track) {
        const player = this.playerFor(track);
        const pause = this.pauseState[track];
        if (!player || !player.buffer || !pause) return 0;
        const duration = player.buffer.duration || 0;
        if (!(duration > 0)) return 0;
        const wrap = (value) => ((value % duration) + duration) % duration;
        const rate = this.getPlaybackRate(player) || 1;
        // Hold the stored offset, including 0, until a scheduled start() becomes audible.
        const waiting = !pause.isPaused && pause.audibleAt > Tone.now();
        if (pause.isPaused || player.state !== 'started' || waiting) return wrap(pause.pauseTime || 0);
        return wrap((Tone.now() - pause.startTime) * rate);
    }

    /**
     * Seek the existing player. A paused or stopped deck only stores the
     * position; a playing deck seeks in place and keeps startTime aligned.
     */
    seekTrack(track, seconds) {
        const player = this.playerFor(track);
        const pause = this.pauseState[track];
        if (!player || !player.loaded || !player.buffer || !pause) return;
        const duration = player.buffer.duration || 0;
        if (!(duration > 0) || !isFinite(seconds)) return;
        const offset = Math.min(Math.max(0, seconds), Math.max(0, duration - 1e-4));
        const rate = this.getPlaybackRate(player) || 1;
        const playing = !pause.isPaused && player.state === 'started';

        if (playing) {
            try {
                player.seek(offset);
            } catch (e) {
                try {
                    player.stop();
                    player.start(undefined, offset);
                } catch (err) {
                    console.warn(`seekTrack(${track}) failed`, err);
                    return;
                }
            }
            pause.isPaused = false;
            pause.pauseTime = offset;
            pause.startTime = Tone.now() - (offset / rate);
            return;
        }

        pause.pauseTime = offset;
        pause.isPaused = true;
    }

    /**
     * Set master volume (0 to 1)
     * Used by right hand pinch + up/down
     */
    setMasterVolume(volume) {
        const clampedVolume = Math.max(0, Math.min(1, volume));
        stateStore.setState({ masterVolume: clampedVolume });
    }

    /**
     * Set crossfader position (0 to 1)
     * 0 = Track A only, 0.5 = Both, 1 = Track B only
     * Used by left hand pinch + move
     */
    setCrossfaderPosition(position) {
        const clampedPosition = Math.max(0, Math.min(1, position));
        stateStore.setState({ crossfaderPosition: clampedPosition });
    }

    /**
     * Set bass level (-1 to +1)
     * -1 = -12dB cut, 0 = neutral, +1 = +12dB boost
     * Used by right fist + up/down
     */
    setBass(level) {
        const clampedLevel = Math.max(-1, Math.min(1, level));
        stateStore.setState({ bass: clampedLevel });
    }

    /**
     * Set treble level (-1 to +1)
     * -1 = -12dB cut, 0 = neutral, +1 = +12dB boost
     * Used by left fist + up/down
     */
    setTreble(level) {
        const clampedLevel = Math.max(-1, Math.min(1, level));
        stateStore.setState({ treble: clampedLevel });
    }
}

export const audioEngine = new AudioEngine();
