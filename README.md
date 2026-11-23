<div align="center">

![Jesture: DJ with gestures](public/banner.png)

## Story

I am not a DJ. I do not have a single musical bone in my body. What I do love is the idea that your hands can steer sound in the air, the same way other gesture music projects have shown especially in the past year.

When I found [Lumaire](https://github.com/sehgalbhavya/Lumaire) by [sehgalbhavya](https://github.com/sehgalbhavya), it clicked. Here was a clear two-deck mixer in the browser, driven by MediaPipe and a webcam. Lumaire began as a project in a multimodal interaction course at KTH Royal Institute of Technology, and it nailed the feeling of playing a mixer without touching hardware.

Jesture is my extension of that foundation. Rather than pretend I would compose or produce tracks, the honest move was to **mix music that already exists**: load your own files, set cues on the waveform, crossfade between decks, and shape EQ with gestures. The fun is in the performance and the interface, not in making the songs from scratch.

On top of Lumaire, Jesture adds a cue preparation panel, pink and green cue markers on each waveform, a redesigned console, and tighter gesture rules so a fist does not accidentally trigger play or a cue.

# Jesture

[![MediaPipe Hands](https://img.shields.io/badge/Hand%20tracking-MediaPipe-0A0A0A)](https://developers.google.com/mediapipe)
[![Tone.js](https://img.shields.io/badge/Audio-Tone.js-0A0A0A)](https://tonejs.github.io)
[![Vite](https://img.shields.io/badge/Built%20with-Vite-0A0A0A?logo=vite&logoColor=white)](https://vite.dev)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES%20modules-0A0A0A?logo=javascript&logoColor=white)](https://developer.mozilla.org/docs/Web/JavaScript)

</div>

To try it yourself, open the **[live demo](https://belle-3d.github.io/Jesture/)** in Chrome or Edge:

1. Allow camera access when the browser asks.
2. Click anywhere on the page once to switch on audio (browsers require this).
3. Load a song into **Track A** and another into **Track B**.
4. Raise both hands so the camera can see them, and start mixing.

---

<div align="center">

![Jesture: DJ with gestures](public/banner.png)

# Jesture

### DJ with gestures

Mix two decks with nothing but your hands and a webcam, right in the browser.

**[Try the live demo](https://belle-3d.github.io/Jesture/)**

[![MediaPipe Hands](https://img.shields.io/badge/Hand%20tracking-MediaPipe-0A0A0A)](https://developers.google.com/mediapipe)
[![Tone.js](https://img.shields.io/badge/Audio-Tone.js-0A0A0A)](https://tonejs.github.io)
[![Vite](https://img.shields.io/badge/Built%20with-Vite-0A0A0A?logo=vite&logoColor=white)](https://vite.dev)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES%20modules-0A0A0A?logo=javascript&logoColor=white)](https://developer.mozilla.org/docs/Web/JavaScript)

</div>

---

## Credit

Jesture is built from [Lumaire](https://github.com/sehgalbhavya/Lumaire) by [sehgalbhavya](https://github.com/sehgalbhavya). Lumaire began as a project in a multimodal interaction course at KTH Royal Institute of Technology.

Jesture keeps that two-deck gesture mixer and extends it. This version adds a cue preparation panel, colored cue markers on each waveform, a redesigned console, and gesture handling that keeps a closed fist from firing a pinch or a cue.

---

## The idea

A DJ mixer is a wall of knobs and faders. Every one of them is something your hands already know how to do: pinch, slide, point, clench.

A webcam tracks both hands in real time, and each gesture maps onto a control. You pinch to start a deck, slide to crossfade, point to jump to a saved cue, and raise a fist to shape the EQ.

---

## Demo

Open the **[live demo](https://belle-3d.github.io/Jesture/)** in Chrome or Edge:

1. Allow camera access when the browser asks.
2. Click anywhere on the page once to switch on audio (browsers require this).
3. Load a song into **Deck A** and another into **Deck B**.
4. Open **Edit Cues** and save Cue 1 and Cue 2 on each deck.
5. Raise both hands so the camera can see them, and start mixing.

---

## How you play it

Your left hand runs **Deck A**, the crossfader, and treble. Your right hand runs **Deck B**, the master volume, and bass. A quick pinch is a tap. A pinch you hold and move is a drag. A fist takes priority over a pinch, so closing your hand will not start or stop a deck.

| | Gesture | What it does |
|---|---|---|
| **Left hand** | Quick pinch | Play or pause Deck A |
| | Pinch and slide left or right | Move the crossfader between Deck A and Deck B |
| | Make a fist and move up or down | Treble up or down |
| | Hold up 1 finger | Play Cue 1 on Deck A |
| | Hold up 2 fingers | Play Cue 2 on Deck A |
| **Right hand** | Quick pinch | Play or pause Deck B |
| | Pinch and move up or down | Master volume |
| | Make a fist and move up or down | Bass up or down |
| | Hold up 1 finger | Play Cue 1 on Deck B |
| | Hold up 2 fingers | Play Cue 2 on Deck B |

Cue 1 is marked in pink and Cue 2 in green on that deck's waveform.

---

## How it works

Jesture is split into small engines that never call each other directly. They only read from and write to one shared state store, so the hand tracking, the sound, and the visuals can each run at their own pace.


```
 Webcam ──► MediaPipe Hands (21 landmarks per hand)
                     │
                     ▼
            ┌─────────────────┐
            │ Gesture engine  │  pinch and fist detection,
            │                 │  tap vs. drag, mirror correction
            └────────┬────────┘
                     │ writes
                     ▼
            ┌─────────────────┐
            │   State store   │  volume · crossfader · bass · treble
            │                 │  deck A/B playing
            └───┬─────────┬───┘
          reads │         │ reads
                ▼         ▼
   ┌────────────────┐  ┌──────────────────┐
   │  Audio engine  │  │  Visual engine   │
   │  Tone.js       │  │  Canvas 2D       │
   │  two decks,    │  │  hand skeletons, │
   │  EQ, fader     │  │  mixer HUD,      │
   │                │  │  live spectrum   │
   └────────────────┘  └──────────────────┘
```

A few details worth knowing:

- **Sound never waits for graphics.** Playback is scheduled on the Web Audio clock through Tone.js, so the music stays steady even if the video frame rate drops.
- **EQ like a real mixer.** Bass and treble are shelf filters (below 200 Hz and above 3 kHz) with ±12 dB of range.
- **Gestures that don't misfire.** A fist always wins over a pinch, and a pinch has to move before it counts as a drag.

---

## Run it locally

You need [Node.js](https://nodejs.org) 20 or newer and a webcam (optional, thanks to the keyboard controls).

```bash
git clone https://github.com/Belle-3d/Jesture.git
cd Jesture
npm install
npm run dev
```

Then open the address Vite prints (it ends in `/Jesture/`).

To build for production, run `npm run build`. Every push to `main` is built and published to GitHub Pages automatically.

---

## Project structure

```
Jesture/
├── index.html            App shell and mixer panel
├── public/
│   └── banner.png        README banner
├── src/
│   ├── main.js           Wiring, track loading, keyboard and mouse controls
│   ├── gestureEngine.js  Turns hand landmarks into pinch and fist gestures
│   ├── audioEngine.js    Two decks, EQ, crossfader
│   ├── visualEngine.js   Draws the video, hand skeletons, mixer HUD and spectrum
│   ├── stateStore.js     Shared state with subscribe and update
│   └── style.css         Interface styling
└── .github/workflows/
    └── deploy-pages.yml  Builds and deploys to GitHub Pages
```

---

<div align="center">


</div>
