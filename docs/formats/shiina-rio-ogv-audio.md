# ShiinaRio OGV audio

Reference: `GARbro/ArcFormats/ShiinaRio/AudioOGV.cs`, class `OgvAudio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/shiina-rio/ogv-audio.ts` (`ogvAudioDescriptor`, `ogvAudioFormat`,
id `shiina-rio-ogv-audio`).

A standalone audio resource whose header is walked rather than fixed. The signature is `OGV` plus a
zero fourth byte (`0x0056474F` as a little endian word), and the reference then:

1. seeks to `0x0C` and reads an eight byte chunk that must start with `fmt `, taking a little endian
   distance from its last four bytes;
2. seeks **relative** to its position after that chunk (`0x14`) by the distance;
3. reads another eight byte chunk there, which must start with `data`;
4. treats everything after that `data` header as the embedded Ogg stream.

So the stream starts at `0x1C + distance`. Nothing is transformed.

The port exposes the resource as a single entry:

* detection needs the signature, both chunk identifiers in place and a computed stream position that
  is not past the end of the file (the bound is a safety deviation; the reference seeks unchecked);
* the entry is named after the source file with an `ogg` extension and covers the tail of the file;
* `sizeKnown` is false because the stream is shorter than the source;
* entry metadata carries `type: "audio"` and the archive metadata records `audio: "ogg"`.

Decoding the Ogg stream and archive creation are out of scope.
