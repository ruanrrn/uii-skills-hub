// WebM Duration Patcher
//
// MediaRecorder produces WebM blobs without a Duration element in the Info
// section (because the total length isn't known at start-of-recording). Many
// parsers — including ffmpeg.wasm as bundled in vitallens.js — refuse to
// probe such files and report "Duration: N/A", which the SDK's regex
// (/Duration:\s*(\d+):(\d+):([\d.]+)/) then fails to match, throwing
// "Failed to extract metadata from ffmpeg output".
//
// This module patches an existing Duration element if present, or inserts a
// new one into the Info section if absent, and adjusts the parent Segment's
// size accordingly. The resulting Blob is fully spec-compliant WebM.
//
// Usage:
//   const fixed = await patchWebmDuration(blob, durationMs);
//   // then hand `fixed` to vl.processVideoFile(...)
//
// References:
//   EBML spec   https://github.com/Matroska-Org/ebml-specification
//   WebM spec   https://www.webmproject.org/docs/container/

(function (global) {
  'use strict';

  // EBML element IDs (encoded as numbers, leading-bit-marker bits intact).
  const ID_SEGMENT          = 0x18538067;
  const ID_INFO             = 0x1549A966;
  const ID_DURATION         = 0x4489;
  const ID_TRACKS           = 0x1654AE6B;
  const ID_TRACK_ENTRY      = 0xAE;
  const ID_TRACK_TYPE       = 0x83;
  const ID_DEFAULT_DURATION = 0x23E383;

  // --- VINT helpers ---

  // Read a variable-length integer at buf[offset].
  // Returns { value, length } where length is bytes consumed.
  // Note: for an EBML *Element ID* you keep the marker bits as part of the ID,
  // so use readVintRaw() instead. This function strips them and is for sizes.
  function readVint(buf, offset) {
    const first = buf[offset];
    if (first === 0) throw new Error('Invalid VINT: zero leading byte at ' + offset);
    let length = 1;
    for (let mask = 0x80; mask > 0 && !(first & mask); mask >>>= 1) length++;
    if (length > 8) throw new Error('VINT too long at offset ' + offset + ': ' + length);
    let value = first & (0xFF >>> length);
    for (let i = 1; i < length; i++) value = value * 256 + buf[offset + i];
    return { value, length };
  }

  // Read an Element ID at buf[offset], preserving marker bits.
  // Returns { id, length }.
  function readVintRaw(buf, offset) {
    const first = buf[offset];
    if (first === 0) throw new Error('Invalid Element ID: zero leading byte at ' + offset);
    let length = 1;
    for (let mask = 0x80; mask > 0 && !(first & mask); mask >>>= 1) length++;
    if (length > 4) throw new Error('Element ID too long at offset ' + offset + ': ' + length);
    let id = 0;
    for (let i = 0; i < length; i++) id = id * 256 + buf[offset + i];
    return { id, length };
  }

  // Encode a non-negative integer as a minimal-length VINT.
  // Returns Uint8Array.
  function writeVint(value) {
    if (value < 0) throw new Error('VINT cannot encode negative: ' + value);
    // Pick the smallest length such that value < (1<<(7*length)) - 1
    // (the all-1s value is reserved as "unknown size" sentinel).
    let length = 1;
    while (length <= 7 && value >= Math.pow(2, 7 * length) - 1) length++;
    const out = new Uint8Array(length);
    out[0] = (0x80 >>> (length - 1));  // marker bit
    // Pack the value into the remaining bits, MSB-first
    let v = value;
    for (let i = length - 1; i >= 0; i--) {
      const byte = v & 0xFF;
      v = Math.floor(v / 256);
      if (i === 0) {
        out[0] |= byte;
      } else {
        out[i] = byte;
      }
    }
    return out;
  }

  // Check whether the VINT at buf[offset] is the all-1s "unknown size" sentinel.
  function isUnknownSize(buf, offset) {
    const first = buf[offset];
    if (first === 0) return false;
    let length = 1;
    for (let mask = 0x80; mask > 0 && !(first & mask); mask >>>= 1) length++;
    const dataBits = first & (0xFF >>> length);
    if (dataBits !== (0xFF >>> length)) return false;
    for (let i = 1; i < length; i++) if (buf[offset + i] !== 0xFF) return false;
    return true;
  }

  // --- Element walker ---

  // Read a full element header at buf[offset].
  // Returns: { id, idLength, size (null if unknown), sizeLength, dataOffset, dataEnd (-1 if unknown) }.
  function readElement(buf, offset) {
    const idV = readVintRaw(buf, offset);
    const sizeOffset = offset + idV.length;
    const unknown = isUnknownSize(buf, sizeOffset);
    const sizeV = readVint(buf, sizeOffset);
    return {
      id: idV.id,
      idLength: idV.length,
      size: unknown ? null : sizeV.value,
      sizeLength: sizeV.length,
      dataOffset: sizeOffset + sizeV.length,
      dataEnd: unknown ? -1 : sizeOffset + sizeV.length + sizeV.value,
    };
  }

  // Find the first direct child element with the given ID, scanning from `start` to `end`.
  // Returns the element descriptor or null.
  function findChild(buf, start, end, targetId) {
    let p = start;
    while (p < end && p < buf.length) {
      const elem = readElement(buf, p);
      if (elem.id === targetId) return elem;
      if (elem.size === null) return null;       // unknown-size child blocks further scanning
      p = elem.dataEnd;
    }
    return null;
  }

  // --- Float64 encoding ---

  function encodeFloat64BE(value) {
    const buf = new ArrayBuffer(8);
    new DataView(buf).setFloat64(0, value, false);  // false = big-endian
    return new Uint8Array(buf);
  }

  // --- Main API ---

  /**
   * Patches a WebM blob to include or correct its Duration metadata.
   * @param {Blob} blob - WebM blob (e.g. from MediaRecorder)
   * @param {number} durationMs - Duration in milliseconds (TimecodeScale is 1ms by default)
   * @returns {Promise<Blob>} a new blob; the original is untouched
   */
  async function patchWebmDuration(blob, durationMs) {
    const ab = await blob.arrayBuffer();
    const buf = new Uint8Array(ab);

    // 1) Skip the EBML header (the first element at offset 0).
    let p = 0;
    const ebmlHeader = readElement(buf, p);
    p = ebmlHeader.dataEnd >= 0 ? ebmlHeader.dataEnd : buf.length;

    // 2) Find the Segment element.
    let segment = null;
    while (p < buf.length) {
      const elem = readElement(buf, p);
      if (elem.id === ID_SEGMENT) { segment = elem; break; }
      if (elem.size === null) break;
      p = elem.dataEnd;
    }
    if (!segment) throw new Error('WebM: Segment not found');

    const segEnd = segment.size === null ? buf.length : segment.dataEnd;

    // 3) Find Info inside Segment.
    const info = findChild(buf, segment.dataOffset, segEnd, ID_INFO);
    if (!info) throw new Error('WebM: Info element not found inside Segment');
    if (info.size === null) throw new Error('WebM: Info has unknown size — cannot patch');

    // 4) If Duration already exists and is float64 (8 bytes), just overwrite the value.
    const existingDur = findChild(buf, info.dataOffset, info.dataEnd, ID_DURATION);
    if (existingDur && existingDur.size === 8) {
      const result = new Uint8Array(buf);
      const newDur = encodeFloat64BE(durationMs);
      result.set(newDur, existingDur.dataOffset);
      return new Blob([result], { type: blob.type });
    }

    // 5) Otherwise, build a new Duration element and insert at the END of Info.
    //    New element layout: [0x44 0x89] [size VINT = 0x88 (i.e. 8)] [8-byte float64]
    const durIdBytes    = new Uint8Array([0x44, 0x89]);
    const durSizeBytes  = writeVint(8);                  // = 0x88
    const durValueBytes = encodeFloat64BE(durationMs);
    const durElementBytes = new Uint8Array(
      durIdBytes.length + durSizeBytes.length + durValueBytes.length);
    durElementBytes.set(durIdBytes, 0);
    durElementBytes.set(durSizeBytes, durIdBytes.length);
    durElementBytes.set(durValueBytes, durIdBytes.length + durSizeBytes.length);

    // 6) Rebuild Info with new size that includes Duration appended.
    const infoHeaderStart = info.dataOffset - info.sizeLength - info.idLength;
    const infoIdBytes     = buf.slice(infoHeaderStart, infoHeaderStart + info.idLength);
    const infoDataBytes   = buf.slice(info.dataOffset, info.dataEnd);
    const newInfoDataSize = info.size + durElementBytes.length;
    const newInfoSizeBytes = writeVint(newInfoDataSize);

    const newInfoBytes = new Uint8Array(
      infoIdBytes.length + newInfoSizeBytes.length + infoDataBytes.length + durElementBytes.length);
    let off = 0;
    newInfoBytes.set(infoIdBytes, off);        off += infoIdBytes.length;
    newInfoBytes.set(newInfoSizeBytes, off);   off += newInfoSizeBytes.length;
    newInfoBytes.set(infoDataBytes, off);      off += infoDataBytes.length;
    newInfoBytes.set(durElementBytes, off);

    const oldInfoTotalLen = info.dataEnd - infoHeaderStart;
    const infoDelta = newInfoBytes.length - oldInfoTotalLen;  // how many bytes we're adding overall

    // 7) Reassemble: [before Segment] [Segment header (size maybe updated)] [Seg content w/ new Info] [rest]
    const segHeaderStart = segment.dataOffset - segment.sizeLength - segment.idLength;
    const beforeSeg = buf.slice(0, segHeaderStart);
    const segIdBytes = buf.slice(segHeaderStart, segHeaderStart + segment.idLength);

    let segSizeBytes;
    if (segment.size === null) {
      // Unknown size — keep the original sentinel VINT as-is.
      segSizeBytes = buf.slice(segHeaderStart + segment.idLength, segment.dataOffset);
    } else {
      segSizeBytes = writeVint(segment.size + infoDelta);
    }

    const segBeforeInfo = buf.slice(segment.dataOffset, infoHeaderStart);
    const segAfterInfo  = buf.slice(info.dataEnd);

    const parts = [
      beforeSeg, segIdBytes, segSizeBytes, segBeforeInfo, newInfoBytes, segAfterInfo
    ];
    const totalLen = parts.reduce((s, x) => s + x.length, 0);
    const out = new Uint8Array(totalLen);
    let pos = 0;
    for (const part of parts) { out.set(part, pos); pos += part.length; }

    return new Blob([out], { type: blob.type });
  }

  // Quick self-check on VINT encoding/decoding (only when ?debug=1)
  if (typeof URLSearchParams === 'function' &&
      typeof location !== 'undefined' &&
      new URLSearchParams(location.search).get('debug') === '1') {
    const cases = [0, 1, 8, 126, 127, 1000, 16382, 16383, 100000];
    for (const v of cases) {
      const enc = writeVint(v);
      const dec = readVint(enc, 0);
      if (dec.value !== v || dec.length !== enc.length) {
        console.error('[webm-duration-fix] VINT self-check FAILED for', v, '->', enc, '->', dec);
      }
    }
    console.log('[webm-duration-fix] VINT self-check OK');
  }

  // Encode a non-negative integer as a minimal big-endian uint (1, 2, 3, or 4 bytes).
  function encodeUintBE(value) {
    if (value < 0) throw new Error('Cannot encode negative uint: ' + value);
    if (value < 256) {
      return new Uint8Array([value]);
    } else if (value < 65536) {
      return new Uint8Array([(value >> 8) & 0xFF, value & 0xFF]);
    } else if (value < 16777216) {
      return new Uint8Array([(value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF]);
    } else {
      // Up to 2^32-1
      const out = new Uint8Array(4);
      new DataView(out.buffer).setUint32(0, value, false);
      return out;
    }
  }

  /**
   * Patches a WebM blob to include a DefaultDuration element on the first Video
   * TrackEntry. ffmpeg uses this to compute fps; without it, ffmpeg's stream
   * line lacks "NN fps", and downstream regex matchers (e.g. vitallens.js's
   * parseFFmpegOutput) fail.
   *
   * @param {Blob} blob - WebM blob (typically after patchWebmDuration())
   * @param {number} fpsValue - fps to encode as (1e9 / fpsValue) ns per frame
   * @returns {Promise<Blob>}
   */
  async function patchWebmDefaultDuration(blob, fpsValue) {
    if (!fpsValue || fpsValue <= 0) throw new Error('fpsValue must be > 0');
    const ab = await blob.arrayBuffer();
    const buf = new Uint8Array(ab);

    // 1) Skip EBML header
    let p = 0;
    const ebml = readElement(buf, p);
    p = ebml.dataEnd >= 0 ? ebml.dataEnd : buf.length;

    // 2) Find Segment
    let segment = null;
    while (p < buf.length) {
      const elem = readElement(buf, p);
      if (elem.id === ID_SEGMENT) { segment = elem; break; }
      if (elem.size === null) break;
      p = elem.dataEnd;
    }
    if (!segment) throw new Error('WebM: Segment not found');

    // 3) Find Tracks
    const segEnd = segment.size === null ? buf.length : segment.dataEnd;
    const tracks = findChild(buf, segment.dataOffset, segEnd, ID_TRACKS);
    if (!tracks) throw new Error('WebM: Tracks not found');
    if (tracks.size === null) throw new Error('WebM: Tracks has unknown size');

    // 4) Find first Video TrackEntry inside Tracks
    let videoTE = null;
    let q = tracks.dataOffset;
    while (q < tracks.dataEnd) {
      const elem = readElement(buf, q);
      if (elem.id === ID_TRACK_ENTRY && elem.size !== null) {
        const tt = findChild(buf, elem.dataOffset, elem.dataEnd, ID_TRACK_TYPE);
        if (tt && tt.size === 1 && buf[tt.dataOffset] === 1) {  // TrackType=1 = video
          videoTE = elem;
          break;
        }
      }
      if (elem.size === null) break;
      q = elem.dataEnd;
    }
    if (!videoTE) throw new Error('WebM: Video TrackEntry not found');

    // 5) Build the new DefaultDuration element value
    const ddValueNs = Math.round(1e9 / fpsValue);
    const ddValueBytes = encodeUintBE(ddValueNs);

    // 6) If existing DefaultDuration has same size, overwrite in place
    const existing = findChild(buf, videoTE.dataOffset, videoTE.dataEnd, ID_DEFAULT_DURATION);
    if (existing && existing.size === ddValueBytes.length) {
      const out = new Uint8Array(buf);
      out.set(ddValueBytes, existing.dataOffset);
      return new Blob([out], { type: blob.type });
    }

    // 7) Otherwise, insert a new DefaultDuration at the end of TrackEntry's data.
    //    Build the new element: [id(3 bytes)][size VINT][value]
    const ddIdBytes   = new Uint8Array([0x23, 0xE3, 0x83]);
    const ddSizeBytes = writeVint(ddValueBytes.length);
    const ddElement   = new Uint8Array(ddIdBytes.length + ddSizeBytes.length + ddValueBytes.length);
    {
      let off = 0;
      ddElement.set(ddIdBytes, off);    off += ddIdBytes.length;
      ddElement.set(ddSizeBytes, off);  off += ddSizeBytes.length;
      ddElement.set(ddValueBytes, off);
    }

    // 8) Rebuild TrackEntry with new DefaultDuration appended.
    const teHeaderStart = videoTE.dataOffset - videoTE.sizeLength - videoTE.idLength;
    const teIdBytes     = buf.slice(teHeaderStart, teHeaderStart + videoTE.idLength);
    const teDataBytes   = buf.slice(videoTE.dataOffset, videoTE.dataEnd);
    const newTeDataSize = videoTE.size + ddElement.length;
    const newTeSizeBytes = writeVint(newTeDataSize);
    const newTeBytes = new Uint8Array(
      teIdBytes.length + newTeSizeBytes.length + teDataBytes.length + ddElement.length);
    {
      let off = 0;
      newTeBytes.set(teIdBytes, off);     off += teIdBytes.length;
      newTeBytes.set(newTeSizeBytes, off); off += newTeSizeBytes.length;
      newTeBytes.set(teDataBytes, off);   off += teDataBytes.length;
      newTeBytes.set(ddElement, off);
    }
    const oldTeTotal = videoTE.dataEnd - teHeaderStart;
    const teDelta = newTeBytes.length - oldTeTotal;

    // 9) Rebuild Tracks with updated size + new TrackEntry inside.
    const tracksHeaderStart = tracks.dataOffset - tracks.sizeLength - tracks.idLength;
    const tracksIdBytes     = buf.slice(tracksHeaderStart, tracksHeaderStart + tracks.idLength);
    const newTracksDataSize = tracks.size + teDelta;
    const newTracksSizeBytes = writeVint(newTracksDataSize);
    const preTeBytes  = buf.slice(tracks.dataOffset, teHeaderStart);
    const postTeBytes = buf.slice(videoTE.dataEnd, tracks.dataEnd);
    const newTracksBytes = new Uint8Array(
      tracksIdBytes.length + newTracksSizeBytes.length + preTeBytes.length + newTeBytes.length + postTeBytes.length);
    {
      let off = 0;
      newTracksBytes.set(tracksIdBytes, off);     off += tracksIdBytes.length;
      newTracksBytes.set(newTracksSizeBytes, off); off += newTracksSizeBytes.length;
      newTracksBytes.set(preTeBytes, off);         off += preTeBytes.length;
      newTracksBytes.set(newTeBytes, off);         off += newTeBytes.length;
      newTracksBytes.set(postTeBytes, off);
    }
    const oldTracksTotal = tracks.dataEnd - tracksHeaderStart;
    const tracksDelta = newTracksBytes.length - oldTracksTotal;

    // 10) Rebuild Segment header — if size was known, bump it by tracksDelta;
    //     if unknown, keep the original sentinel VINT.
    const segHeaderStart = segment.dataOffset - segment.sizeLength - segment.idLength;
    const segIdBytes     = buf.slice(segHeaderStart, segHeaderStart + segment.idLength);
    let segSizeBytes;
    if (segment.size === null) {
      segSizeBytes = buf.slice(segHeaderStart + segment.idLength, segment.dataOffset);
    } else {
      segSizeBytes = writeVint(segment.size + tracksDelta);
    }

    // 11) Assemble: [before Seg] [seg hdr] [seg pre-Tracks] [new Tracks] [rest after old Tracks]
    const parts = [
      buf.slice(0, segHeaderStart),
      segIdBytes,
      segSizeBytes,
      buf.slice(segment.dataOffset, tracksHeaderStart),
      newTracksBytes,
      buf.slice(tracks.dataEnd),
    ];
    const totalLen = parts.reduce((s, x) => s + x.length, 0);
    const out = new Uint8Array(totalLen);
    let pos = 0;
    for (const part of parts) { out.set(part, pos); pos += part.length; }
    return new Blob([out], { type: blob.type });
  }

  global.patchWebmDuration = patchWebmDuration;
  global.patchWebmDefaultDuration = patchWebmDefaultDuration;
})(typeof window !== 'undefined' ? window : globalThis);
