# vitallens-rppg — architecture notes

Read this when something goes wrong or when you want to understand _why_ the
skill is shaped this way. The main `SKILL.md` is the operational guide; this
file is the rationale.

## End-to-end flow

```
node scripts/launch.js
  ├─ preflight (Node version, API key, browser detection, skill files)
  ├─ start embedded HTTP server (port 0 = OS-assigned)
  ├─ spawn chromium --app=http://127.0.0.1:PORT/assets/vitallens-scan.html#key=KEY
  │         --use-fake-ui-for-media-stream   ← auto-grant camera
  │         --user-data-dir=$TMPDIR/vitallens-profile-<timestamp>
  │         --force-device-scale-factor=1     ← prevent DPR scaling
  │                                                          │
  │    browser: load assets/vitallens-scan.html              │
  │           imports vitallens.browser.js + webm-duration-fix.js
  │           page calls getUserMedia → MediaRecorder (VP8 WebM)
  │           time-based recording until ≥ 350 frames
  │           patchWebmDuration(blob) + patchWebmDefaultDuration(blob)
  │           vl.processVideoFile(file)  →  POST /vitallens-v3/file
  │           POST result back to /save?name=result.json
  │           window.close()                                 │
  │                                                          │
  ← poll for result.json (or error.txt) ←────────────────────┘
  kill browser + clean up temp profile + close server
  print HR + RR + confidence; exit
```

## Why a local HTTP server?

Chromium browsers (Edge included) treat every `file://` URL as a **unique
null origin**. The page loads vitallens.js as an ES module
(`<script type="module">`), and the resulting `import` of
`vitallens.browser.js` is a cross-origin request — null vs null does **not**
satisfy CORS, so the import is blocked.

A `http://localhost:NNNN` origin satisfies the same-origin policy normally,
so the ESM chain works. The server is ~80 lines of Node stdlib only.

## Why Edge `--app` mode?

`--app=URL` gives a chromeless, kiosk-style window with no address bar, no
tabs, and no download tray. That's good for the user experience (it feels
like a native dialog) and lets the launcher cleanly tear down the window
with `Stop-Process` when measurement is done.

The downside: in `--app` mode, the browser's auto-download fallback is
unreliable — that's why the page POSTs `result.json` back to the local
server instead of relying on the `<a download>` trick.

## Why API key in URL hash, not query string?

The fragment (`#key=...`) is **not** sent to the server in the `Referer`
header and **not** logged in access logs. The launcher tells the page the
key locally; nothing about the key leaves the user's machine except the
authenticated request from vitallens.js to `api.rouast.com`.

## Why we patch the WebM

`vitallens.js` uses `ffmpeg.wasm` internally to demux the recorded blob
before sending the frames to the API. Its `parseFFmpegOutput` regex
requires **two** lines in the ffmpeg probe output:

| ffmpeg output line      | comes from EBML element | element ID |
| ----------------------- | ----------------------- | ---------- |
| `Duration: HH:MM:SS.ms` | `Duration` (float64)    | `0x4489`   |
| `Stream … NN fps`       | `DefaultDuration` (ns)  | `0x23E383` |

`MediaRecorder` writes neither, so ffmpeg.wasm rejects the blob with
"Failed to extract metadata from ffmpeg output."

`scripts/webm-duration-fix.js` splices both elements in:

- `patchWebmDuration(blob, durationMs)` inserts an 11-byte
  `Duration` element at the end of the `Info` master and rewrites the
  Info VINT size.
- `patchWebmDefaultDuration(blob, fpsValue)` inserts a `DefaultDuration`
  element at the end of the Video `TrackEntry`, rewrites the TrackEntry
  size, then the parent Tracks size.

The Segment outer size is left at its original "unknown" sentinel
(`0xFF…FF` VINT), so we don't need to rewrite that.

## Why VP8 over VP9?

`MediaRecorder` in modern Edge defaults to VP9 if available. However,
VP9 encoding in Edge produces WebM files where the encoded frame
dimensions don't match the container metadata, causing ffmpeg.wasm
inside `vitallens.js` to throw "Mismatch in raw data size" errors. VP8
is universally supported and, with `--force-device-scale-factor=1` to
fix DPR scaling, probes and decodes cleanly. The page picks the first
available codec from a preference list that starts with
`video/webm;codecs=vp8`.

The launcher also adds `--force-device-scale-factor=1` to Chromium's
command-line flags, which forces `devicePixelRatio` to 1.0 and
prevent the VP8 encoder from occasionally applying DPR scaling to
encoded frames. Combined with the launcher-level retry mechanism
(up to 3 attempts with fresh browser processes), this makes VP8
reliable on high-DPI displays.

## Why 350 frames (not a fixed duration)?

VitalLens needs enough signal length to recover both heart-rate (~1 Hz)
and respiratory-rate (~0.2–0.4 Hz) components. 350 frames at the
camera's native rate (typically 30 fps) gives ~12 s — plenty for HR and
just enough for RR. We record for a duration calculated from the
camera's reported frame rate (`TARGET_FRAMES / fps + 0.5s buffer`)
instead of counting actual frames, because `requestVideoFrameCallback`
is unreliable with virtual cameras (e.g. OBS Virtual Camera triggers
it at ~1 Hz regardless of actual video frame rate).

`MAX_WAIT_MS = 60000` is a safety cap: if something goes wrong with the
timing calculation we give up rather than recording forever.

## Why `/file` not `/stream`?

The SDK exposes two API endpoints:

- `/vitallens-v3/file` — single video → full HR/RR analysis
- `/vitallens-v3/stream` — chunked frames → waveforms only, **no HR/RR**

Earlier iterations of this skill tried streaming for "real-time"
feedback but the stream endpoint genuinely doesn't return aggregate HR
or RR values — only per-frame rPPG/respiration waveforms that you have
to interpret yourself. `/file` is the right call for a one-shot
measurement.

## Output schema

The API response (also written to `result.json` after we tack on
`capture_meta`):

```json
{
  "vitals": {
    "heart_rate":       { "value": 72.5, "confidence": 0.95, "unit": "bpm",
                          "note": "Global estimate of Heart Rate ..." },
    "respiratory_rate": { "value": 15.2, "confidence": 0.88, "unit": "bpm",
                          "note": "Global estimate of Respiratory Rate ..." }
  },
  "face": { "coordinates": [...], "confidence": [...] },
  "vital_signs": { /* per-frame waveforms */ },
  "capture_meta": {
    "frames": 1233, "elapsed_ms": 11855, "target_frames": 350,
    "mime": "video/webm;codecs=vp8", "blob_size": 3772532
  }
}
```

Note that the API returns `unit: "bpm"` for both vitals — that's how the
API ships it. We translate to `bpm`/`rpm` in user-facing output.

## Confidence thresholds

VitalLens returns per-vital confidence in `[0, 1]`. The launcher's
heuristic: anything `< 0.7` is "questionable" — ask the user to retry
with better lighting / less movement. This threshold comes from the
VitalLens docs, not from independent validation.

## Platform support

| platform      | status    | notes                                              |
| ------------- | --------- | -------------------------------------------------- |
| Windows 10/11 | supported | Edge or Chrome auto-detected                       |
| macOS         | supported | Chrome or Edge auto-detected                       |
| Linux         | supported | chrome / chromium / edge auto-detected via `which` |

The launcher (`scripts/launch.js`) is pure Node.js — the only
platform-specific logic is the browser path lookup in `findBrowser()`.
The HTML, server, shim, SDK, and WebM patcher are all platform-neutral.

## Camera permission auto-grant

Chromium's `--use-fake-ui-for-media-stream` flag auto-accepts the camera
permission dialog without user interaction. Combined with a unique
`--user-data-dir` per run (in the OS temp directory), this means:

- Every run gets a fresh profile with all command-line flags honoured
- No manual click needed for camera access
- Temp profiles are cleaned up after each attempt
