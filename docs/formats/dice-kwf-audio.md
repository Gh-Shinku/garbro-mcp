# DiceSystem KWF audio

Reference: `GARbro/Legacy/Dice/AudioKWF.cs`, class `KwfAudio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/dice/kwf-audio.ts` (`kwfAudioDescriptor`, `kwfAudioFormat`, id
`dice-kwf-audio`).

A standalone audio resource. The signature is `KWF0` (`0x3046574B` as a little endian word), the
header is `0x40` bytes and the raw PCM stream follows it. Only one compression method is implemented:
the reference reads `method` as an `int32` at `0x04` and throws `NotImplementedException` for anything
other than `3`, which the port translates into a decline.

The header carries a complete wave format block, and the reference **copies every field** rather than
deriving them:

| Offset | Field |
|--------|-------|
| `0x28` | format tag (`u16`) |
| `0x2A` | channels (`u16`) |
| `0x2C` | sample rate (`u32`) |
| `0x30` | average bytes per second (`u32`) |
| `0x34` | block align (`u16`) |
| `0x36` | bits per sample (`u16`) |

The port exposes the resource as a single entry:

* detection needs the signature, the supported method, a file longer than the header and nothing else
  — the format fields are trusted exactly as the reference trusts them;
* the entry is named after the source file with a `wav` extension and covers the stream after the
  header;
* `sizeKnown` is false because a wave header is prepended, so the payload is longer than the stored
  region;
* extraction prepends the standard 44 byte RIFF/WAVE header built from the copied fields;
* entry metadata carries `type: "audio"` and the archive metadata records `audio: "pcm"` plus the
  sample rate, channel count and bit depth.

Archive creation and audio writing are out of scope.
