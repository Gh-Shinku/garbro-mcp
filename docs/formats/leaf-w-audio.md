# Leaf W audio

Reference: `GARbro/ArcFormats/Leaf/AudioW.cs`, class `WAudio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/leaf/w-audio.ts` (`leafWAudioDescriptor`, `leafWAudioFormat`, id
`leaf-w-audio`).

Leaf PCM audio: an eighteen byte header followed by samples, with **no signature at all**. The file does not
even store a format tag — the reference hard codes plain PCM — and what stands in for a marker is a set of
consistency checks:

| field | offset | width |
|---|---|---|
| channels | 0 | 8 bits |
| block align | 1 | 8 bits |
| samples per second | 2 | 16 bits |
| bits per sample | 4 | 16 bits |
| average bytes per second | 6 | 32 bits |
| PCM size | 0xA | 32 bits |
| unused | 0xE | 4 bytes |
| PCM | 0x12 | |

`TryOpen` first requires the `w` extension, then rejects a header unless every one of these holds: the PCM
size and the average byte rate are non-zero, the bit depth is at least eight, the channel count is between
one and eight, the sample rate times the block align equals the average byte rate, and the file is **exactly**
`0x12` bytes longer than the PCM it declares. The port reproduces all of them, and the tests cover a
mismatched average rate, a length one byte off in each direction, a channel count of nine, a bit depth of
four and a zero PCM size. The two fields stored as single bytes are what make the channel limit eight.

The port exposes the resource as a single entry:

* extraction reserialises the sound: the stored fields go into a canonical 44 byte RIFF header, with the
  format tag supplied as `1` because the file has none, and the PCM follows. The four unused bytes between
  the fields and the PCM are never read — a test fills the header with `0x7F` filler and the file is still
  accepted, which also shows that no field beyond those listed is being consulted;
* a test with a deliberately odd but internally consistent format — two channels, a three byte block align,
  1000 Hz and 3000 bytes per second — asserts that the values reach the wave header unchanged, which is what
  distinguishes a verbatim copy from a recomputed header;
* the entry is named after the source file with a `wav` extension, covers the PCM region from `0x12`, and
  sets `sizeKnown: false` because the RIFF header is added;
* entry metadata carries `type: "audio"`, and the archive metadata records `audio: "pcm"`, the hard coded
  format tag, the channel count, the sample rate and the bit depth.

The descriptor advertises `w`, matching the reference's own extension list.

Encoding and archive creation are out of scope.
