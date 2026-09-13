# Artel MUW audio

Reference: `GARbro/Legacy/Artel/AudioMUW.cs`, class `MuwAudio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/artel/muw-audio.ts` (`muwAudioDescriptor`, `muwAudioFormat`, id
`artel-muw-audio`).

The ADVG engine's wave file. It announces itself with `RIFF` like any wave file, but where a canonical file
carries `WAVEfmt ` at offset 8 this one carries the eight character tag `PCMWFMT `, and the `data` chunk sits
at a distance the header stores rather than immediately after the format block:

| field | offset |
|---|---|
| tag `RIFF` | 0 |
| tag `PCMWFMT ` | 8 |
| distance to the chunk (`u32`) | 0x10 |
| format tag (`u16`) | 0x14 |
| channels (`u16`) | 0x16 |
| samples per second (`u32`) | 0x18 |
| average bytes per second (`u32`) | 0x1C |
| block align (`u16`) | 0x20 |
| bits per sample (`u16`) | 0x22 |
| `data` tag then size | 0x14 + distance |

The format fields occupy `0x14..0x23`, so the smallest meaningful distance is `0x10` and the earliest a
chunk can appear is `0x24`. A test fixture built with a distance of zero would put the chunk on top of the
format fields, where the reference would read the format tag as the chunk tag and decline — the fixture
builder therefore expresses its padding as a **gap** on top of that minimum, and the test for a non
trivial distance asserts the resulting offset.

The port exposes the resource as a single entry:

* `TryOpen` checks both tags, follows the distance, requires the literal `data` tag and then treats the
  following size as a region. The port reproduces that, including the region behaviour: a declared size
  reaching past the end of the file is **shortened** rather than rejected, and a test covers it. A file
  whose chunk starts past the end of the file, or whose chunk tag is not `data`, is declined;
* extraction reserialises the sound the way `RawPcmInput` does: the format fields go into a canonical
  44 byte RIFF header and the PCM follows. The fixture stores internally inconsistent values — two
  channels with a six byte block align and eight bit samples — and the test asserts they survive, which
  distinguishes a verbatim copy from a recomputed header;
* the entry is named after the source file with a `wav` extension, covers the PCM region that follows the
  chunk header, and sets `sizeKnown: false` because the RIFF header is added;
* entry metadata carries `type: "audio"`, and the archive metadata records `audio: "pcm"`, the format tag,
  the channel count, the sample rate and the bit depth.

The reference class declares no extension list, so the descriptor registers none.

Encoding and archive creation are out of scope.
