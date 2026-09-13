# Crowd engine EOG audio

Reference: `GARbro/ArcFormats/Crowd/AudioEOG.cs`, class `EogAudio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/crowd/eog-audio.ts` (`eogAudioDescriptor`, `eogAudioFormat`,
id `crowd-eog-audio`).

A standalone audio resource. The signature is `CRM` plus a zero in the fourth byte (the reference
compares the little endian word `0x004D5243`), the file declares the `eog` and `amb` extensions, and
the embedded Ogg stream starts at offset `8` and runs to the end of the file. Nothing is transformed
and the reference performs no further check, so detection only needs the signature and room for a
stream.

The port exposes the resource as a single entry:

* the entry is named after the source file with an `ogg` extension and covers the tail of the file;
* `sizeKnown` is false because the eight byte header is dropped, so the payload is shorter than the
  source;
* entry metadata carries `type: "audio"` and the archive metadata records `audio: "ogg"`.

The reference's `Write` throws `NotImplementedException`; decoding the Ogg stream and archive
creation are out of scope here as well.
