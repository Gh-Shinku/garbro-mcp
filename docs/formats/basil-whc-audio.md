# Basil WHC audio

Reference: `GARbro/ArcFormats/Basil/AudioWHC.cs`, class `WhcAudio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/basil/whc-audio.ts` (`whcAudioDescriptor`, `whcAudioFormat`, id
`basil-whc-audio`).

A **raw PCM resource**: the file opens with a wave format block and the payload follows. The reference
declares two signatures, which are really the first two header fields read as one word — a format tag of
one followed by one or two channels, i.e. `0x020001` and `0x010001` — and it rejects anything whose
**name is not `.whc`** before reading a byte.

| field | offset |
|---|---|
| format tag (u16) | 0 |
| channels (u16) | 2 |
| samples per second (u32) | 4 |
| average bytes per second (u32) | 8 |
| block align (u16) | 0x0C |
| bits per sample (u16) | 0x0E |
| unused | 0x10 |
| PCM data | 0x12 |

The port exposes the resource as a single entry:

* detection requires the `.whc` extension (case insensitively) *and* the header: format tag exactly 1 and
  one or two channels, both checks copied from the reference. The name gate lives in `detect` and `read`,
  where the source path is available, while `openEntry` validates the header alone;
* the entry is named after the source file with a `wav` extension, covers everything from `0x12` to the
  end of the file — the reference builds its region without a length, since none is stored — and sets
  `sizeKnown: false` because a RIFF header is prepended;
* extraction writes a 44 byte RIFF/WAVE header followed by the PCM bytes. The format block is **copied
  verbatim** rather than recomputed, which the test proves with deliberately inconsistent values (two
  channels, block align three, eight bits per sample) that survive into the output;
* entry metadata carries `type: "audio"`, and the archive metadata records `audio: "pcm"` with the
  format tag, channel count, sample rate and bit depth.

Encoding and archive creation are out of scope.
