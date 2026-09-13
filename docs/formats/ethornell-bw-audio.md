# BGI/Ethornell engine BW audio

Reference: `GARbro/ArcFormats/Ethornell/AudioBGI.cs`, class `BgiAudio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/ethornell/bw-audio.ts` (`bgiAudioDescriptor`, `bgiAudioFormat`,
id `ethornell-bw-audio`).

A standalone audio resource. The reference does not have a conventional signature: it declares the
signature list `{ 0x40, 0 }`, so the first four bytes are accepted only when they are the little
endian word `0x40` or zero — that word is also the **absolute stream offset**. The remaining
requirement is the marker `bw  ` at offset `4`, and the stream runs from the offset to the end of the
file without any transformation. The descriptor carries the reference's extension list: `bw`, `_bw`
and the empty string.

The port exposes the resource as a single entry:

* detection needs one of the two accepted header words, the `bw  ` marker, a file of at least eight
  bytes and an offset below the file size (the reference checks the offset the same way);
* the entry is named after the source file with an `ogg` extension and covers the tail of the file —
  with the reference's quirk that an offset of zero keeps the whole file, header included;
* `sizeKnown` is false because the stream is normally shorter than the source;
* entry metadata carries `type: "audio"` and the archive metadata records `audio: "ogg"`.

Decoding the Ogg stream and archive creation are out of scope.
