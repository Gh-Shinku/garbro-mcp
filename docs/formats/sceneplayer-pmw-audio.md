# ScenePlayer PMW compressed wave audio

Reference: `GARbro/ArcFormats/ScenePlayer/AudioPMW.cs`, class `PmwAudio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/sceneplayer/pmw-audio.ts` (`pmwAudioDescriptor`, `pmwAudioFormat`, id
`sceneplayer-pmw-audio`).

The audio counterpart of the PMP bitmap reader, ported in the same session and using the same mask: **a wave
file inside a zlib stream whose bytes are all exclusive ored with `0x21`**. The stored first byte is therefore
the masked zlib CMF, `0x78 ^ 0x21`; a test asserts that relation, checks that a file stored *without* the mask
(a plain `0x78`) is declined, and re-masks a stored file to recover a stream the standard library can inflate.

The port exposes the resource as a single entry:

* decompression uses the shared `inflateZlibBufferCapped` with a 256 MiB cap, the same deviation the PMP and
  GRA ports document, and it matters here too because detection decompresses for every candidate file;
* the inflated payload is parsed with the shared `readWave` helper and extraction writes a **canonical** wave
  file through `writeWave`, the shape used by the WAZ, WRG and VZY audio ports. A test appends a `LIST` chunk
  after the payload and asserts that the canonical output is the original wave without it, which is why
  `sizeKnown` is false;
* the entry is named after the source file with a `wav` extension, covers the whole stored file, and is flagged
  `encrypted: true` and `compressed: true`;
* entry and archive metadata carry `type: "audio"`, `format: "wav"`, the format tag, channel count, sample rate
  and bit depth, plus `encrypted: true`; the archive metadata adds the `pcmSize` from the data chunk.

The reference declares no signature and no extension gate, so every file is a candidate and detection rests on
the masked header byte and on the payload really being a wave file — the same weak-header design as PMP, tested
on the same four failure paths: a non-wave payload, a wrong first byte, a plain unmasked stream, a corrupted
stream and a one byte file.

GARbro *can* write this format — `PmwAudio.Write` masks a level nine zlib stream of the wave file — so the
reader here is the complete half of a symmetric pair, but encoding is out of scope and `create` stays false.
