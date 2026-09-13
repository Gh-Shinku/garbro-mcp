# SVIU System KOG audio

Reference: `GARbro/ArcFormats/Sviu/AudioKOG.cs`, class `KogAudio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/sviu/kog-audio.ts` (`kogAudioDescriptor`, `kogAudioFormat`, id
`sviu-kog-audio`).

A standalone audio resource. There is no signature in the usual sense: the reference requires the
first four bytes to be **zero** (`file.Signature != 0` declines), reads the header size as a signed
little endian word at `4`, jumps to that absolute position and requires the Ogg signature there. The
stream then runs from that position to the end of the file and is not transformed.

The port exposes the resource as a single entry:

* detection needs a zero first word, a positive header size, room for the four signature bytes and
  the Ogg signature at the computed position (the size and room checks are safety deviations; the
  reference seeks unchecked);
* the entry is named after the source file with an `ogg` extension and covers the tail of the file;
* `sizeKnown` is false because the stream is shorter than the source;
* entry metadata carries `type: "audio"` and the archive metadata records `audio: "ogg"`.

Decoding the Ogg stream and archive creation are out of scope.
