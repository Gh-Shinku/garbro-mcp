# SYSD DWV audio

Reference: `GARbro/ArcFormats/SysD/AudioDWV.cs`, class `DwvAudio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/sysd/dwv-audio.ts` (`dwvAudioDescriptor`, `dwvAudioFormat`, id
`sysd-dwv-audio`).

SYSD engine PCM audio. The signature is `DW` (`0x5744`) and the header is 28 bytes:

| field | offset |
|---|---|
| signature `DW` | 0 |
| file length (`u32`) | 4 |
| format tag (`u16`) | 8 |
| channels (`u16`) | 0xA |
| samples per second (`u32`) | 0xC |
| average bytes per second (`u32`) | 0x10 |
| block align (`u16`) | 0x14 |
| PCM size (`u32`) | 0x18 |
| PCM | 0x1C |

The first thing worth noting is what the header does **not** contain: there is no bit depth field. The
reference recovers it arithmetically, dividing the average byte rate by the samples per second and the
channel count, and the division is integer division at every step. The port reproduces that, and the test
picks values whose exact quotient would be about 5.44 to prove the result is truncated to 5 rather than
rounded.

The second is that the header repeats the file length at offset 4, and `TryOpen` accepts the file only when
that value equals the actual length. A test shifts the file by a single byte in both directions and
confirms both are declined.

The port exposes the resource as a single entry:

* the header also stores the file length check's counterpart, the PCM size, which behaves like a region: a
  declared size reaching past the end of the file is **shortened** rather than rejected, and a test covers
  it;
* extraction reserialises the sound the way `RawPcmInput` does: the stored fields — plus the derived bit
  depth — go into a canonical 44 byte RIFF header and the PCM follows;
* the entry is named after the source file with a `wav` extension, covers the PCM region from `0x1C`, and
  sets `sizeKnown: false` because the RIFF header is added;
* entry metadata carries `type: "audio"`, and the archive metadata records `audio: "pcm"`, the format tag,
  the channel count, the sample rate and the derived bit depth.

One deviation: a zero sample rate or channel count would make the reference divide by zero and throw, so
those headers are declined instead. It is tested. The reference also registers a zero entry alongside its
`DW` signature, which nominally makes it a candidate for every file; as with the other ports that do this,
only the explicit signature is registered here.

The reference class declares no extension list, so the descriptor registers none.

Encoding and archive creation are out of scope.
