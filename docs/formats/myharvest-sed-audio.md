# MyHarvest SED audio

Reference: `GARbro/Legacy/Harvest/AudioSED.cs`, class `SedAudio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/myharvest/sed-audio.ts` (`sedAudioDescriptor`, `sedAudioFormat`,
id `myharvest-sed-audio`).

A **raw PCM audio resource** with a complete wave format block in its header. The file starts with
`SE`, a version byte and a zero (`0x14553` as a little endian word), the 24 byte header is laid out like
a RIFF `fmt ` chunk, and the payload is announced by a `da` marker plus a length:

| field | offset |
|---|---|
| `SE` | 0 |
| format tag (u16) | 2 |
| channels (u16) | 4 |
| samples per second (u32) | 6 |
| average bytes per second (u32) | 0x0A |
| block align (u16) | 0x0E |
| bits per sample (u16) | 0x10 |
| `da` marker | 0x12 |
| payload length (u32) | 0x14 |
| PCM data | 0x18 |

The reference lists two signatures, `0x14553` and `0`, but the content check is what decides: it
requires `SE` at the start *and* `da` at `0x12`. Only the explicit signature is registered here, so the
port is not proposed for files that merely begin with a zero word, and `detect` re-checks both markers.

The port exposes the resource as a single entry:

* detection needs the full header, both markers, a non-zero channel count and bit depth, and a payload
  that fits inside the file — the reference builds a region of the declared length and fails outside it,
  so the bound is a documented deviation, as is declining a zero channel count or bit depth that the
  reference would pass on;
* the entry is named after the source file with a `wav` extension, covers exactly the declared payload —
  a trailing region the header does not account for is ignored, since the reference uses the declared
  length rather than reading to the end — and sets `sizeKnown: false`;
* extraction writes a 44 byte RIFF/WAVE header followed by the PCM bytes. The format block is **copied
  verbatim** rather than recomputed, which the test proves with deliberately inconsistent values (two
  channels, block align six, eight bits per sample) that survive into the output;
* entry metadata carries `type: "audio"`, and the archive metadata records `audio: "pcm"` with the
  format tag, channel count, sample rate and bit depth.

Encoding and archive creation are out of scope.
