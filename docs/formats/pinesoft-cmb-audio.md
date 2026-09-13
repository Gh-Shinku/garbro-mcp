# PineSoft CMB PCM audio

Reference: `GARbro/Legacy/PineSoft/AudioCMB.cs`, class `CmbAudio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/pinesoft/cmb-audio.ts` (`cmbAudioDescriptor`, `cmbAudioFormat`, id
`pinesoft-cmb-audio`).

A **wave format header behind two leading lengths**. The reference declares no signature and registers the
empty extension, so what identifies the format is an exact length relation plus two field checks.

| field | offset |
|---|---|
| data size (`i32`) | 0 |
| header size (`i32`) | 4 |
| format tag (u16) | 8 |
| channels (u16) | 0xA |
| samples per second (u32) | 0xC |
| average bytes per second (u32) | 0x10 |
| block align (u16) | 0x14 |
| bits per sample (u16) | 0x16 |
| PCM data | `8 + header size` |

Acceptance requires `data size + header size + 8 == file length`, the low byte of the format tag to be
exactly one, and the channel count to be one or two. Two details are worth recording because they are easy
to "improve" into unfaithfulness:

* the tag check is a **byte** check, not a word check. The reference tests `header[8]` — the low byte of the
  little endian word — so a tag such as `0x0101` would be accepted. The port reproduces the byte test;
* the payload length is not stored separately from `data size`: the relation makes the two equal, so
  everything from `8 + header size` to the end of the file is the PCM, and any declared header bytes beyond
  the fixed 0x18 sit between the format block and the audio without being part of it. A test uses a header
  size of 0x28 to show the port follows the offset.

Deviations, all defensive and tested: a negative data size, or a data offset that is negative or beyond the
end of the file, is declined. The reference would compute such a region anyway, but it cannot be read and
describes no audio; every file GARbro accepts normally is unaffected.

The port exposes the resource as a single entry:

* the entry is named after the source file with a `wav` extension, covers exactly the payload and sets
  `sizeKnown: false` because a RIFF header is prepended;
* extraction writes a 44 byte RIFF/WAVE header with the format block copied verbatim, so the test's
  deliberately inconsistent values (two channels, block align six, eight bits) survive into the output;
* a header declaring an empty payload is accepted and yields a wave file with an empty data chunk;
* entry metadata carries `type: "audio"`, and the archive metadata records `audio: "pcm"` with the format
  tag, channel count, sample rate and bit depth.

Encoding and archive creation are out of scope.
