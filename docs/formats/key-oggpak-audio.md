# Key OGGPAK audio

Reference: `GARbro/ArcFormats/Key/AudioOGGPAK.cs`, class `OggPakAudio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/key/oggpak-audio.ts` (`keyOggpakAudioDescriptor`,
`keyOggpakAudioFormat`, id `key-oggpak-audio`).

A standalone audio resource. The signature gate compares the first four bytes as a little endian
word (`0x5047474F`, that is `OGGP`), and the opener re-checks the full `OGGPAK` signature. The header
is `0xF` bytes long and the embedded Ogg stream length sits at `0xB`; the stream starts right after
the header and nothing is transformed.

The port exposes the resource as a single entry:

* detection needs the full `OGGPAK` signature and a length that is non zero and fully inside the
  file (the placement check is a safety deviation; the reference reads the region unchecked);
* the entry is named after the source file with an `ogg` extension;
* `sizeKnown` is false because only a leading region is the payload, so it is shorter than the
  source;
* entry metadata carries `type: "audio"` and the archive metadata records `audio: "ogg"`.

The decoder that consumes the Ogg stream and archive creation are out of scope.
