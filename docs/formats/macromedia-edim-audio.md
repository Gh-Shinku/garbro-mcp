# Macromedia Director EDIM audio

Reference: `GARbro/ArcFormats/Macromedia/AudioEDIM.cs`, class `EdimAudio` (derived from `Mp3Audio`)
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/macromedia/edim-audio.ts` (`edimAudioDescriptor`,
`edimAudioFormat`, id `macromedia-edim-audio`).

A standalone audio resource. The reference declares the signature list `{ 0x40010000, 0x64010000 }`
but then reads the same word as **big endian** to compute the payload offset:

```text
offset = 4 + Binary.BigEndian (file.Signature)
```

so the stored bytes are `00 00 01 40` (distance `0x140`) or `00 00 01 64` (distance `0x164`), and the
MP3 stream starts four bytes after the end of that distance. Nothing is transformed.

The port exposes the resource as a single entry:

* detection needs one of the two stored words, a file longer than four bytes and an offset below the
  file size (the reference does not check the offset, so that bound is a documented deviation);
* the entry is named after the source file with an `mp3` extension and covers the tail of the file;
* `sizeKnown` is false because the stream is shorter than the source;
* entry metadata carries `type: "audio"` and the archive metadata records `audio: "mp3"`.

The port does not re-validate the MP3 frame header the way the reference's `Mp3Audio` base class does,
and archive creation plus audio writing are out of scope.
