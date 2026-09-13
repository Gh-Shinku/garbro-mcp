# Aoi engine AOG audio

Reference: `GARbro/ArcFormats/Aoi/AudioAOG.cs`, class `AogAudio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/aoi/aog-audio.ts` (`aoiAogAudioDescriptor`, `aoiAogAudioFormat`,
id `aoi-aog-audio`).

A standalone audio resource. The signature is `AoiO` (`0x4F696F41` as a little endian word), the
reference reads a `0x3C` byte header and requires the full `AoiOgg` signature, after which it accepts
exactly two shapes:

* **plain** — `OggS` sits at `0x2C`, so the stream starts there;
* **decoded** — `Decode` sits at `0x0C` *and* `OggS` sits at `0x38`, so the stream starts at `0x38`.

Anything else declines. The stream runs to the end of the file and is not transformed.

The port exposes the resource as a single entry:

* detection needs the signature, a header of at least `0x3C` bytes and one of the two shapes (the
  header length check is a safety deviation; the reference reads a clamped header);
* the entry is named after the source file with an `ogg` extension and covers the tail of the file;
* `sizeKnown` is false because the stream is shorter than the source;
* entry metadata carries `type: "audio"` and the archive metadata records `audio: "ogg"`.

Decoding the Ogg stream and archive creation are out of scope.
