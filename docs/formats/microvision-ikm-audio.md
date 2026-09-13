# MicroVision IKM audio

Reference: `GARbro/ArcFormats/MicroVision/AudioIKM.cs`, class `IkmAudio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/microvision/ikm-audio.ts` (`ikmAudioDescriptor`,
`ikmAudioFormat`, id `microvision-ikm-audio`).

A standalone audio resource. The signature is `IKM` plus a zero in the fourth byte (the reference
compares a little endian word, `0x004D4B49`), the header is `0x40` bytes long and the embedded Ogg
stream length sits at `0x24`. The stream is the **last** `length` bytes of the file, so its offset is
derived from the file size rather than stored, and nothing is transformed.

The port exposes the resource as a single entry:

* detection needs the four signature bytes and a length that is non zero and no larger than the file
  (the bound is a safety deviation; the reference reads the region unchecked);
* the entry is named after the source file with an `ogg` extension;
* `sizeKnown` is false because only a trailing region is the payload, so it is shorter than the
  source;
* entry metadata carries `type: "audio"` and the archive metadata records `audio: "ogg"`.

The decoder that consumes the Ogg stream and archive creation are out of scope.
