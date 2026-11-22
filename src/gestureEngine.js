import { stateStore } from './stateStore';
import { audioEngine } from './audioEngine';
import { playSavedCue } from './cuePanel';

export class GestureEngine {
    constructor() {
        this.pinchThreshold = 0.03; // Fingers must be very close (almost touching)
        this.lastPinchState = { Left: { index: false, middle: false }, Right: { index: false, middle: false } };

        // Control state tracking for each hand
        this.controlState = {
            // Right hand: Master volume control (pinch)
            Right: { isPinching: false, startY: 0, startValue: 0, hasMoved: false, pinchFrames: 0 },
            // Left hand: Crossfader control (pinch)
            Left: { isPinching: false, startX: 0, startValue: 0, hasMoved: false, pinchFrames: 0 }
        };

        // EQ control state tracking for fist gestures
        this.eqControlState = {
            // Right fist: Bass control
            Right: { isFist: false, startY: 0, startValue: 0 },
            // Left fist: Treble control
            Left: { isFist: false, startY: 0, startValue: 0 }
        };

        // Sensitivity settings
        this.volumeSensitivity = 0.3;  // For master volume (vertical movement)
        // Simple: horizontal delta of this.crossfaderFullDelta (normalized 0..1) => full crossfade (0..1)
        this.crossfaderFullDelta = 0.10;  // default: 0.10 normalized units (adjust if needed)
        this.eqSensitivity = 0.25;  // For bass/treble (vertical movement)
        this.cueLatch = { Left: null, Right: null };
        // Fist stays latched until the hand clearly opens, so a closed hand
        // cannot flicker into a cue or a pinch-to-play tap.
        this.poseHold = { Left: false, Right: false };
        this.fistCooldown = { Left: 0, Right: 0 };
        this.poseStreak = {
            Left: { pose: 'NONE', count: 0 },
            Right: { pose: 'NONE', count: 0 },
        };
        this.stableFinger = { Left: 'NONE', Right: 'NONE' };
        this.closedStreak = { Left: 0, Right: 0 };

        // Minimum movement threshold to distinguish tap from drag (smaller for quicker response)
        this.movementThreshold = 0.01;
        this.minPinchTapFrames = 4;
        this.fistCooldownFrames = 6;
        this.cueHoldFrames = 3;
        this.fistArmFrames = 5;
    }

    process(results) {
        if (!results.multiHandLandmarks || !results.multiHandedness) return [];

        for (const hand of ['Left', 'Right']) {
            if (this.fistCooldown[hand] > 0) this.fistCooldown[hand] -= 1;
        }

        const handsData = [];
        const seenHands = new Set();
        for (let i = 0; i < results.multiHandLandmarks.length; i++) {
            const landmarks = results.multiHandLandmarks[i];
            const classification = results.multiHandedness[i];

            // Swap labels because of mirrored video
            const rawLabel = classification.label;
            const label = rawLabel === 'Left' ? 'Right' : 'Left';

            // 1. Pinch Detection
            const pinches = this.detectPinches(landmarks);

            // 2. Open vs Fist. Cue poses must hold for a few frames so the
            // tag and the trigger do not flicker, and a single missed frame
            // cannot latch a point as a fist.
            const rawFinger = this.detectFingerCount(landmarks);
            const fingerPose = this.settleFingerPose(label, rawFinger);
            const gesture = this.stableGesture(label, this.curledFingerCount(landmarks), fingerPose);

            const pinchActive = gesture === 'Open' && (pinches.index || pinches.middle);
            const rawCue = fingerPose === 'ONE_FINGER' || fingerPose === 'TWO_FINGERS';
            const cuePose = rawCue && !pinchActive && gesture === 'Open' && !this.eqControlState[label].isFist;
            seenHands.add(label);
            if (cuePose) {
                if (!this.cueLatch[label]) {
                    this.cueLatch[label] = fingerPose;
                    const deck = label === 'Left' ? 'A' : 'B';
                    const slot = fingerPose === 'ONE_FINGER' ? 1 : 2;
                    playSavedCue(deck, slot);
                }
            } else if (pinchActive && rawCue) {
                if (!this.cueLatch[label]) this.cueLatch[label] = fingerPose;
            } else if (!pinchActive) {
                this.cueLatch[label] = null;
            }

            // Get control state for this hand
            const controlState = this.controlState[label];
            const eqState = this.eqControlState[label];

            // Determine what this hand is controlling
            let controlType = label === 'Right' ? 'Master Volume' : 'Crossfader';
            let isControlling = controlState.isPinching && controlState.hasMoved;

            if (gesture === 'Closed' && !pinches.index && !cuePose) {
                controlType = label === 'Right' ? 'Bass (Fist)' : 'Treble (Fist)';
                isControlling = eqState.isFist;
            }

            // Store data for visualization
            handsData.push({
                label,
                landmarks,
                gesture,
                pinches,
                isControlling,
                controlType,
                fingerPose: pinchActive ? 'NONE' : fingerPose
            });

            // Update pinch states
            if (!this.lastPinchState[label]) {
                this.lastPinchState[label] = { index: false, middle: false };
            }

            // Debug logging for pinches
            if (pinches.index && !this.lastPinchState[label].index) {
                console.log(`${label} Hand Index Pinch Started`);
            }

            // =============================================
            // HAND-SPECIFIC CONTROLS
            // =============================================
            if (label === 'Right') {
                // RIGHT HAND: Play/Pause (tap) + Master Volume (pinch drag)
                this.handleRightHandGesture(landmarks, pinches, gesture, cuePose);
            } else {
                // LEFT HAND: Crossfader control (pinch drag)
                this.handleLeftHandGesture(landmarks, pinches, gesture, cuePose);
            }

            this.lastPinchState[label] = pinches;
        }
        for (const hand of ['Left', 'Right']) {
            if (!seenHands.has(hand)) {
                this.cueLatch[hand] = null;
                this.poseHold[hand] = false;
                this.stableFinger[hand] = 'NONE';
                this.poseStreak[hand] = { pose: 'NONE', count: 0 };
                this.closedStreak[hand] = 0;
            }
        }
        return handsData;
    }

    detectPinches(landmarks) {
        const thumbTip = landmarks[4];
        const indexTip = landmarks[8];
        const middleTip = landmarks[12];

        const indexDistance = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
        const middleDistance = Math.hypot(thumbTip.x - middleTip.x, thumbTip.y - middleTip.y);

        return {
            index: indexDistance < this.pinchThreshold,
            middle: middleDistance < this.pinchThreshold
        };
    }

    curledFingerCount(landmarks) {
        const fingerTips = [8, 12, 16, 20];
        const fingerPIPs = [6, 10, 14, 18];
        const wrist = landmarks[0];

        let curledCount = 0;
        for (let i = 0; i < 4; i++) {
            const tip = landmarks[fingerTips[i]];
            const pip = landmarks[fingerPIPs[i]];

            const distTip = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
            const distPip = Math.hypot(pip.x - wrist.x, pip.y - wrist.y);

            if (distTip < distPip) curledCount++;
        }
        return curledCount;
    }

    settleFingerPose(label, raw) {
        const streak = this.poseStreak[label];
        if (raw === streak.pose) streak.count += 1;
        else {
            streak.pose = raw;
            streak.count = 1;
        }
        const current = this.stableFinger[label];
        const enteringCue = raw === 'ONE_FINGER' || raw === 'TWO_FINGERS';
        const holdingCue = current === 'ONE_FINGER' || current === 'TWO_FINGERS';
        const need = enteringCue ? this.cueHoldFrames : (holdingCue ? 5 : 3);
        if (streak.count >= need) this.stableFinger[label] = raw;
        return this.stableFinger[label];
    }

    /**
     * A point or peace sign is not a fist, and it releases a latched fist.
     * A real fist must stay closed for several frames before it latches, then
     * it stays closed until the hand opens or a cue pose holds.
     */
    stableGesture(label, curledCount, fingerPose) {
        const cueLike = fingerPose === 'ONE_FINGER' || fingerPose === 'TWO_FINGERS';
        if (cueLike) {
            this.closedStreak[label] = 0;
            this.poseHold[label] = false;
            return 'Open';
        }
        if (curledCount >= 3) this.closedStreak[label] += 1;
        else this.closedStreak[label] = 0;

        if (this.poseHold[label]) {
            if (curledCount <= 1) this.poseHold[label] = false;
        } else if (this.closedStreak[label] >= this.fistArmFrames) {
            this.poseHold[label] = true;
        }
        return this.poseHold[label] ? 'Closed' : 'Open';
    }

    pinchIsLive(label, gesture, pinches, eqState) {
        return gesture === 'Open'
            && pinches.index
            && !eqState.isFist
            && (this.fistCooldown[label] || 0) <= 0;
    }

    cancelPinch(controlState) {
        controlState.isPinching = false;
        controlState.hasMoved = false;
        controlState.pinchFrames = 0;
    }

    noteFistEnded(label) {
        this.fistCooldown[label] = this.fistCooldownFrames;
    }

    /**
     * Cosine of the angle at `joint` between prev and next.
     * Straight finger ≈ -1; a bent joint moves toward 0 and then positive.
     */
    jointBend(prev, joint, next) {
        const ax = prev.x - joint.x;
        const ay = prev.y - joint.y;
        const az = (prev.z || 0) - (joint.z || 0);
        const bx = next.x - joint.x;
        const by = next.y - joint.y;
        const bz = (next.z || 0) - (joint.z || 0);
        const magA = Math.hypot(ax, ay, az) || 1;
        const magB = Math.hypot(bx, by, bz) || 1;
        return (ax * bx + ay * by + az * bz) / (magA * magB);
    }

    fingerReach(landmarks, mcp, tip) {
        const knuckle = landmarks[mcp];
        const tipPoint = landmarks[tip];
        return Math.hypot(tipPoint.x - knuckle.x, tipPoint.y - knuckle.y, (tipPoint.z || 0) - (knuckle.z || 0));
    }

    /**
     * Extended when the PIP itself is straight and the tip reaches past the knuckle.
     * The DIP is allowed to hook slightly, which is how a single pointing finger usually sits.
     * Thumb is not considered.
     */
    isFingerExtended(landmarks, mcp, pip, dip, tip) {
        const knuckle = landmarks[mcp];
        const pipJoint = landmarks[pip];
        const dipJoint = landmarks[dip];
        const tipPoint = landmarks[tip];
        const tipReach = this.fingerReach(landmarks, mcp, tip);
        const pipReach = Math.hypot(pipJoint.x - knuckle.x, pipJoint.y - knuckle.y, (pipJoint.z || 0) - (knuckle.z || 0));
        const straightPip = this.jointBend(knuckle, pipJoint, dipJoint) < -0.35;
        const hookedDip = this.jointBend(pipJoint, dipJoint, tipPoint) > 0.45;
        return straightPip && !hookedDip && tipReach > pipReach * 1.08;
    }

    isFingerCurled(landmarks, mcp, pip, dip, tip) {
        const bend = this.jointBend(landmarks[mcp], landmarks[pip], landmarks[dip]);
        return bend > -0.4 && !this.isFingerExtended(landmarks, mcp, pip, dip, tip);
    }

    detectFingerCount(landmarks) {
        if (!landmarks || landmarks.length < 21) return 'NONE';
        const index = this.isFingerExtended(landmarks, 5, 6, 7, 8);
        const middle = this.isFingerExtended(landmarks, 9, 10, 11, 12);
        const ring = this.isFingerCurled(landmarks, 13, 14, 15, 16);
        const pinky = this.isFingerCurled(landmarks, 17, 18, 19, 20);
        if (!index || !ring || !pinky) return 'NONE';
        if (middle) return 'TWO_FINGERS';
        const middleDown = this.isFingerCurled(landmarks, 9, 10, 11, 12)
            || this.fingerReach(landmarks, 9, 12) < this.fingerReach(landmarks, 5, 8) * 0.78;
        return middleDown ? 'ONE_FINGER' : 'NONE';
    }

    /**
    * RIGHT HAND CONTROLS:
    * - Quick pinch (tap) = Toggle Play/Pause for Track B (right deck)
    * - Pinch + UP/DOWN = Master Volume control
    * - Fist (Closed hand) + UP/DOWN = Bass control
     */
    handleRightHandGesture(landmarks, pinches, gesture, cuePose) {
        const state = stateStore.getState();
        const controlState = this.controlState.Right;
        const eqState = this.eqControlState.Right;

        // A cue pose on this hand suppresses fist EQ until the pose ends.
        const isFist = gesture === 'Closed' && !cuePose;
        // PINCH detection: only a stable open hand, and not in the post-fist cooldown
        const isPinching = this.pinchIsLive('Right', gesture, pinches, eqState);

        // Get current hand Y position (use wrist for stability)
        const currentY = landmarks[0].y;

        // =============================================
        // FIST CONTROL (Bass) - Takes priority when fist is detected
        // =============================================
        if (isFist) {
            // Cancel any ongoing pinch without treating it as a play/pause tap
            if (controlState.isPinching) this.cancelPinch(controlState);

            if (!eqState.isFist) {
                // Fist started
                eqState.isFist = true;
                eqState.startY = currentY;
                eqState.startValue = state.bass;
                console.log(`Right Fist: Bass control started at ${(state.bass * 100).toFixed(0)}%`);
            } else {
                // Fist held - adjust bass
                const deltaY = currentY - eqState.startY;
                // Moving UP = boost bass, moving DOWN = cut bass
                const bassChange = -deltaY / this.eqSensitivity;
                let newBass = eqState.startValue + bassChange;
                newBass = Math.max(-1, Math.min(1, newBass));
                audioEngine.setBass(newBass);
            }
            return; // Don't process pinch while fist is active
        } else if (eqState.isFist) {
            // Fist released
            eqState.isFist = false;
            this.noteFistEnded('Right');
            const finalBass = stateStore.getState().bass;
            const dbValue = (finalBass * 12).toFixed(0);
            console.log(`Right Fist: Bass set to ${dbValue > 0 ? '+' : ''}${dbValue}dB`);
        }

        // =============================================
        // PINCH STARTED
        // =============================================
        if (isPinching && !controlState.isPinching) {
            controlState.isPinching = true;
            controlState.pinchFrames = 1;
            controlState.startY = currentY;
            controlState.startValue = state.masterVolume;
            controlState.hasMoved = false;
            console.log(`Right Hand: Pinch Started - Y: ${currentY.toFixed(3)}, Master Vol: ${(state.masterVolume * 100).toFixed(0)}%`);
        }
        // =============================================
        // PINCH HELD - Check for master volume control
        // =============================================
        else if (isPinching && controlState.isPinching) {
            controlState.pinchFrames += 1;
            const deltaY = currentY - controlState.startY;
            const absDeltaY = Math.abs(deltaY);

            if (absDeltaY > this.movementThreshold) {
                controlState.hasMoved = true;

                // Calculate volume change (up = increase, down = decrease)
                const volumeChange = -deltaY / this.volumeSensitivity;
                let newVolume = controlState.startValue + volumeChange;
                newVolume = Math.max(0, Math.min(1, newVolume));

                audioEngine.setMasterVolume(newVolume);
            }
        }
        // =============================================
        // PINCH RELEASED
        // =============================================
        else if (!isPinching && controlState.isPinching) {
            const frames = controlState.pinchFrames || 0;
            const cooling = (this.fistCooldown.Right || 0) > 0;
            controlState.isPinching = false;
            controlState.pinchFrames = 0;

            if (!controlState.hasMoved && frames >= this.minPinchTapFrames && !cooling) {
                // TAP = Toggle Play/Pause for Track B (right hand controls Track B)
                const s = stateStore.getState();
                console.log(`Right Hand: Tap Detected - Toggling Track B Play/Pause`);
                if (s.trackBPlaying) {
                    audioEngine.pauseTrack('B');
                } else {
                    audioEngine.resumeTrack('B');
                }
            } else if (controlState.hasMoved) {
                // Movement occurred, it was master volume control
                const finalVolume = stateStore.getState().masterVolume;
                console.log(`Right Hand: Master Volume set to ${(finalVolume * 100).toFixed(0)}%`);
            }

            controlState.hasMoved = false;
        }
    }

    /**
    * LEFT HAND CONTROLS:
    * - Quick pinch (tap) = Toggle Play/Pause for Track A (left deck)
    * - Pinch + MOVE (horizontal) = Crossfader control
    * - 0% = Track A only, 50% = Both, 100% = Track B only
    * - Fist + UP/DOWN = Treble control
     */
    handleLeftHandGesture(landmarks, pinches, gesture, cuePose) {
        const state = stateStore.getState();
        const controlState = this.controlState.Left;
        const eqState = this.eqControlState.Left;

        // A cue pose on this hand suppresses fist EQ until the pose ends.
        const isFist = gesture === 'Closed' && !cuePose;
        // PINCH detection: only a stable open hand, and not in the post-fist cooldown
        const isPinching = this.pinchIsLive('Left', gesture, pinches, eqState);

        // Use X position for crossfader (left = Track A, right = Track B)
        const currentX = landmarks[8].x;
        const currentY = landmarks[0].y;

        // =============================================
        // FIST CONTROL (Treble) - Takes priority when fist is detected
        // =============================================
        if (isFist) {
            // Cancel any ongoing pinch without treating it as a play/pause tap
            if (controlState.isPinching) this.cancelPinch(controlState);

            if (!eqState.isFist) {
                // Fist started
                eqState.isFist = true;
                eqState.startY = currentY;
                eqState.startValue = state.treble;
                console.log(`Left Fist: Treble control started at ${(state.treble * 100).toFixed(0)}%`);
            } else {
                // Fist held - adjust treble
                const deltaY = currentY - eqState.startY;
                // Moving UP = boost treble, moving DOWN = cut treble
                const trebleChange = -deltaY / this.eqSensitivity;
                let newTreble = eqState.startValue + trebleChange;
                newTreble = Math.max(-1, Math.min(1, newTreble));
                audioEngine.setTreble(newTreble);
            }
            return; // Don't process pinch while fist is active
        } else if (eqState.isFist) {
            // Fist released
            eqState.isFist = false;
            this.noteFistEnded('Left');
            const finalTreble = stateStore.getState().treble;
            const dbValue = (finalTreble * 12).toFixed(0);
            console.log(`Left Fist: Treble set to ${dbValue > 0 ? '+' : ''}${dbValue}dB`);
        }

        // =============================================
        // PINCH STARTED
        // =============================================
        if (isPinching && !controlState.isPinching) {
            controlState.isPinching = true;
            controlState.pinchFrames = 1;
            controlState.startX = currentX;
            controlState.startValue = state.crossfaderPosition;
            controlState.hasMoved = false;
            console.log(`Left Hand: Pinch Started - Crossfader: ${(state.crossfaderPosition * 100).toFixed(0)}%`);
        }
        // =============================================
        // PINCH HELD - Crossfader control
        // =============================================
        else if (isPinching && controlState.isPinching) {
            controlState.pinchFrames += 1;
            const deltaX = currentX - controlState.startX;
            const absDeltaX = Math.abs(deltaX);

            if (absDeltaX > this.movementThreshold) {
                controlState.hasMoved = true;

                // Simple mapping: deltaX / fullDelta -> fraction of full crossfade
                // Moving RIGHT (deltaX>0) increases crossfader (towards Track B).
                const crossfaderChange = -deltaX / this.crossfaderFullDelta;
                let newPosition = controlState.startValue + crossfaderChange;

                newPosition = Math.max(0, Math.min(1, newPosition));

                audioEngine.setCrossfaderPosition(newPosition);
            }
        }
        // =============================================
        // PINCH RELEASED
        // =============================================
        else if (!isPinching && controlState.isPinching) {
            const frames = controlState.pinchFrames || 0;
            const cooling = (this.fistCooldown.Left || 0) > 0;
            controlState.isPinching = false;
            controlState.pinchFrames = 0;

            if (!controlState.hasMoved && frames >= this.minPinchTapFrames && !cooling) {
                // TAP = Toggle Play/Pause for Track A (left hand controls Track A)
                const s = stateStore.getState();
                console.log(`Left Hand: Tap Detected - Toggling Track A Play/Pause`);
                if (s.trackAPlaying) {
                    audioEngine.pauseTrack('A');
                } else {
                    audioEngine.resumeTrack('A');
                }
            } else if (controlState.hasMoved) {
                const finalPosition = stateStore.getState().crossfaderPosition;
                let description;
                if (finalPosition < 0.25) {
                    description = 'Track A';
                } else if (finalPosition > 0.75) {
                    description = 'Track B';
                } else {
                    description = 'Both Tracks';
                }
                console.log(`Left Hand: Crossfader set to ${(finalPosition * 100).toFixed(0)}% (${description})`);
            }

            controlState.hasMoved = false;
        }
    }
}

export const gestureEngine = new GestureEngine();
