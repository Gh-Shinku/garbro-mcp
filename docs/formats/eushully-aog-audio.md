# System3 engine AOG audio

Reference: `GARbro/ArcFormats/Eushully/AudioAOG.cs`, class `AogAudio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/eushully/aog-audio.ts` (`eushullyAogAudioDescriptor`,
`eushullyAogAudioFormat`, id `eushully-aog-audio`).

A standalone audio resource rather than an archive: the file starts with `AOGG`, and an Ogg stream
begins at `0x14`. The reference reads a `0x18` byte header, requires `OggS` at `0x14` and hands the
region from `0x14` to an `OggInput`; nothing is transformed.

The port exposes the same resource as a single entry:

* detection needs the `AOGG` signature and `OggS` at `0x14`;
* the entry is named after the source file with an `ogg` extension, starts at `0x14` and covers the
  rest of the file;
* `sizeKnown` is false because the twenty byte header is dropped, so the payload is shorter than the
  source;
* entry metadata carries `type: "audio"` and the archive metadata records `audio: "ogg"`.

Archive creation is out of scope.
