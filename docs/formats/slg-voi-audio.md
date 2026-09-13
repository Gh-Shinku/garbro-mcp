# SLG system VOI audio

Reference: `GARbro/ArcFormats/Slg/AudioVOI.cs`, class `VoiAudio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/slg/voi-audio.ts` (`voiAudioDescriptor`, `voiAudioFormat`, id
`slg-voi-audio`).

A standalone audio resource. There is no signature: the reference reads a single byte at `0x1E`,
requires it to be positive, and then requires `OggS` at `0x20 + offset`. The stream runs from that
position to the end of the file and is not transformed, so the "obfuscation" is only the indirection
through the offset byte.

The port exposes the resource as a single entry:

* detection needs a positive offset byte and an Ogg page signature at the computed position, with the
  position required to leave room for the four signature bytes (a safety deviation; the reference
  reads unchecked);
* the entry is named after the source file with an `ogg` extension and covers the tail of the file;
* `sizeKnown` is false because the stream is shorter than the source;
* entry metadata carries `type: "audio"` and the archive metadata records `audio: "ogg"`.

Decoding the Ogg stream and archive creation are out of scope.
