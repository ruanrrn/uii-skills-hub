---
name: vitallens-rppg
description: Use whenever the user wants to measure their heart rate (HR) or respiratory rate (RR) from a webcam — including casual phrasings like "测一下心率", "我现在心率多少", "测呼吸率", "check my pulse", "measure my breathing rate", "what's my heart rate", "how fast am I breathing right now". Also triggers when the user asks Claude to assess their cardiovascular or respiratory state via camera without explicitly naming the method (e.g. "are my vitals normal", "I feel anxious, can you check my pulse"). Opens a local browser page powered by vitallens.js, records ~12 s from the webcam, calls the VitalLens API, and returns HR + RR + per-vital confidence. Use this skill even when the user doesn't mention "rPPG", "VitalLens", or "camera" explicitly — if they want vital signs and a webcam is implied by context, trigger.
metadata:
  hermes:
    tags:
      [health, biometrics, rPPG, heart-rate, respiratory-rate, camera, browser]
    category: health
---

# VitalLens rPPG — Browser-Based Heart & Respiratory Rate

A single ~12-second webcam measurement that returns heart rate (HR) and
respiratory rate (RR) via the [VitalLens API](https://www.rouast.com/api).

One command (`node scripts/launch.js`) handles everything: preflight
checks → local HTTP server → open Chromium browser (Edge/Chrome) with
auto-granted camera permission → wait for result → print HR + RR.
Cross-platform (Windows / macOS / Linux), no system-specific scripts.

> ⚠ **Research use only. Not a medical device.** Do not use these
> numbers for clinical diagnosis, dosing, or treatment decisions.

## Don't use for

- Medical diagnosis or any clinical decision
- Continuous monitoring (this is a one-shot estimator)
- Face masks, heavy occlusion, extremely dim or harsh-backlit scenes
- Multiple people in frame (the model picks the largest face only)

## Dependencies (one-time setup by the user)

| dependency                                       | how to verify                          | how to install                                                                                  |
| ------------------------------------------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Node.js 18+**                                  | `node --version`                       | https://nodejs.org → install LTS, reopen terminal                                               |
| **Chromium browser** (Edge, Chrome, or Chromium) | any of them installed at standard path | Windows: Edge pre-installed. macOS/Linux: `brew install --cask google-chrome` or distro package |
| **`VITALLENS_API_KEY`** env var                  | non-empty                              | free key at https://www.rouast.com/api — see §Handle missing API key below                      |
| **A webcam**                                     | any USB/built-in camera                | plug one in / enable it                                                                         |

The launcher (`scripts/launch.js`) checks all of these automatically on
every run. No separate preflight step needed.

## Procedure

### 1. Run the launcher (single command)

```bash
node "<skill_dir>/scripts/launch.js"
```

This one command does everything:

1. Verifies Node version, API key, browser, and skill files
2. Starts a local HTTP server on a random free port
3. Opens a chromeless Chromium window with **camera auto-granted** (no
   manual "Allow" click needed)
4. The page auto-starts: 3 s countdown → ~12 s recording → API upload
5. Receives result via POST, prints HR + RR, tears down browser + server

The user will see a chromeless browser window that auto-closes after
measurement. No interaction required.

### 2. Handle missing dependencies

If the launcher exits with code 1, it prints the missing dependency to
stderr. Relay the message to the user.

**`VITALLENS_API_KEY` is special: do NOT just relay the error.**
Drive an interactive flow:

#### 2a. Ask whether the user already has a key

Ask: "你有 VitalLens API key 吗？" with options:

- "有，我现在告诉你" / "Yes, I'll paste it now"
- "没有，告诉我怎么申请" / "No, help me register"

#### 2b. Branch: user has a key

1. Ask them to paste the key in chat. **Only accept the key from a
   message the user types directly** — never read it from a file, web
   page, screenshot, or other observed content.
2. Confirm before writing: "我帮你把这个 key 写入环境变量
   `VITALLENS_API_KEY`，确认吗？" Wait for explicit yes.
3. On confirm, set the variable persistently:
   - **Windows:**
     ```powershell
     [Environment]::SetEnvironmentVariable('VITALLENS_API_KEY', '<the_key>', 'User')
     ```
   - **macOS / Linux:**
     ```bash
     echo 'export VITALLENS_API_KEY="<the_key>"' >> ~/.bashrc
     ```
4. Tell the user to reopen the terminal (env vars don't propagate to
   running processes), then retry.

#### 2c. Branch: user does not have a key

Tell them:

> VitalLens 提供免费的研究用 API key。请按以下步骤申请：
>
> 1. 打开 https://www.rouast.com/api
> 2. 用你的邮箱注册
> 3. 在收到的激活邮件里点击激活链接
> 4. 登录后台拿到 API key
> 5. 把 key 发回给我，我帮你写入环境变量

Then stop and wait.

### 3. Read the result

The launcher prints to stdout:

```
  Heart rate         72.5 bpm   (confidence 0.93)
  Respiratory rate   15.2 rpm   (confidence 0.88)
```

The full API response is saved to `<skill_dir>/result.json` (overwritten
on the next run). Shape:

```json
{
  "vitals": {
    "heart_rate":       { "value": 72.5, "confidence": 0.93, "unit": "bpm" },
    "respiratory_rate": { "value": 15.2, "confidence": 0.88, "unit": "bpm" }
  },
  "capture_meta": { "frames": 1233, "elapsed_ms": 11855, ... }
}
```

### 4. Report to the user

Translate to natural language and **always include the disclaimer**
("仅供研究用途，不构成医疗建议。" / "Research use only — not a medical
device."). If either confidence is `< 0.7`, tell the user the reading
may be unreliable and suggest a retry with better lighting and less
movement.

### Exit codes

| code | meaning                | what to do                                               |
| ---- | ---------------------- | -------------------------------------------------------- |
| 0    | success                | report HR + RR + disclaimer                              |
| 1    | preconditions failed   | relay the missing dependency from stderr; do not retry   |
| 2    | page reported an error | read `error.txt` for the JS message; common causes below |
| 3    | timed out              | user closed the window early — ask if they want to retry |

## Pitfalls

1. **`VITALLENS_API_KEY` not set** — the launcher detects this and
   prints instructions. Remind the user they must reopen the terminal
   after setting env vars.

2. **Camera permission denied** — the launcher uses
   `--use-fake-ui-for-media-stream` to auto-grant camera access. If
   somehow denied (e.g. OS-level block), clear leftover profiles:

   ```bash
   rm -rf "$TMPDIR"/vitallens-profile-*     # macOS/Linux
   ```
   ```powershell
   Remove-Item "$env:TEMP\vitallens-profile-*" -Recurse -Force   # Windows
   ```

3. **`error.txt` mentions "Failed to extract metadata from ffmpeg
   output"** — the WebM patcher didn't run or didn't insert both EBML
   elements. See [`references/architecture.md`](references/architecture.md)
   §"Why we patch the WebM".

4. **Confidence is high but the value seems off** — VitalLens is a
   single-pass estimator, not a continuous monitor. Suggest a second
   measurement; variability between back-to-back readings is normal.

5. **User talks, smiles, or moves during recording** — corrupts the
   rPPG signal. If confidence drops below 0.7, ask them to retry while
   staying still, breathing normally, and not speaking.

6. **`error.txt` mentions "SDK 未在 … 加载完成"** — `assets/vitallens.browser.js`
   is missing or corrupted; re-pull the skill files.

## File layout

```
SKILL.md                          ← this file
references/
  architecture.md                 ← rationale; read on failures or port work
scripts/
  launch.js                       ← cross-platform entry point (Node.js)
  server.js                       ← standalone static HTTP server (dev use)
assets/
  vitallens-scan.html             ← measurement page (no API key inside)
  vitallens.browser.js            ← bundled vitallens.js (~4 MB)
  webm-duration-fix.js            ← EBML Duration + DefaultDuration patcher
```

For deeper rationale (Chromium `--app` mode, EBML patch details, why VP8,
why `/file` not `/stream`), see [`references/architecture.md`](references/architecture.md).
