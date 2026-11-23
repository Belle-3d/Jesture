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

## Demo

<div align="center">

[![Watch the Jesture demo on YouTube](https://img.youtube.com/vi/3lUEl5AKHR8/maxresdefault.jpg)](https://www.youtube.com/watch?v=3lUEl5AKHR8)

</div>

To try it yourself, open the **[live demo](https://belle-3d.github.io/Jesture/)** in Chrome or Edge:

1. Allow camera access when the browser asks.
2. Click anywhere on the page once to switch on audio (browsers require this).
3. Load a song into **Track A** and another into **Track B**.
4. Raise both hands so the camera can see them, and start mixing.

---

## How you play it

Your left hand runs **Deck A** and the crossfader. Your right hand runs **Deck B** and the master volume. A quick pinch is a tap; a pinch you hold and move is a drag.

| | Gesture | What it does |
|---|---|---|
| **Left hand** | Quick pinch | Play or pause Track A |
| | Pinch and slide left or right | Move the crossfader between A and B |
| | Make a fist and move up or down | Treble up or down |
| **Right hand** | Quick pinch | Play or pause Track B |
| | Pinch and move up or down | Master volume |
| | Make a fist and move up or down | Bass up or down |

---

## How it works

Jesture is split into four small engines that never call each other directly. They only read from and write to one shared state store, so the hand tracking, the sound and the visuals can each run at their own pace.

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

<sub>Jesture began as a project in a multimodal interaction course at KTH Royal Institute of Technology.</sub>

</div>
