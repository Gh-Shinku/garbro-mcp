# TamaSoft ADV system ESD audio

Reference: `GARbro/ArcFormats/TamaSoft/AudioESD.cs`, class `EsdAudio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/tamasoft/esd-audio.ts` (`esdAudioDescriptor`, `esdAudioFormat`,
id `tamasoft-esd-audio`).

A standalone audio resource. The signature is `ESD ` (`0x20445345` as a little endian word), the
header is `0x20` bytes and the raw PCM stream follows it. The reference builds a `WaveFormat` from
the header rather than assuming one:

| Offset | Field |
|--------|-------|
| `0x08` | sample rate (`u32`) |
| `0x0C` | bits per sample (`u16`) |
| `0x10` | channels (`u16`) |

`blockAlign` is `channels * bitsPerSample / 8` and `averageBytesPerSecond` is
`sampleRate * blockAlign`; the format tag is always 1 (PCM).

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
