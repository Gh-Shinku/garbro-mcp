# U-Me Soft WSTR audio

Reference: `GARbro/Legacy/UMeSoft/AudioSTR.cs`, class `WstrAudio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/ume-soft/str-audio.ts` (`wstrAudioDescriptor`,
`wstrAudioFormat`, id `ume-soft-wstr-audio`).

A standalone audio resource. The signature is `WSTR` (`0x52545357` as a little endian word), the
header is `0x20` bytes and the raw PCM stream follows it. The reference builds a `WaveFormat` from the
header:

| Offset | Field |
|--------|-------|
| `0x04` | channels (`u16`) |
| `0x06` | bits per sample (`u16`) |
| `0x08` | sample rate (`u32`) |

`blockAlign` is `channels * bitsPerSample / 8`, and the reference's `SetBPS()` sets
`averageBytesPerSecond` to `sampleRate * blockAlign`; the format tag is always 1 (PCM).

The port exposes the resource as a single entry:

* detection needs the signature, a header longer than `0x20` bytes and header fields that describe
  real PCM — non zero channels and sample rate, and a bit depth that is a multiple of eight (the
  reference trusts these fields unchecked, so the validation is a documented deviation);
* the entry is named after the source file with a `wav` extension and covers the stream after the
  header;
* `sizeKnown` is false because a wave header is prepended, so the payload is longer than the stored
  region;
* extraction prepends the standard 44 byte RIFF/WAVE header built from the header fields;
* entry metadata carries `type: "audio"` and the archive metadata records `audio: "pcm"` plus the
  sample rate, channel count and bit depth.

Archive creation and audio writing are out of scope.
