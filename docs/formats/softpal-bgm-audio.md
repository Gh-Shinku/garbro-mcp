# Softpal BGM audio

Reference: `GARbro/ArcFormats/Softpal/AudioBGM.cs`, class `BgmAudio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/softpal/bgm-audio.ts` (`softpalBgmAudioDescriptor`,
`softpalBgmAudioFormat`, id `softpal-bgm-audio`).

A standalone audio resource. The signature is `BGM ` (the little endian word `0x204D4742`), the
descriptor declares the `ogg` extension exactly as the reference constructor does, and the header is
`0x10` bytes of loop timing that the reference reads and discards. The only structural requirement is
`OggS` at `0x0C`, which is also where the stream begins; it runs to the end of the file and is not
transformed.

The port exposes the resource as a single entry:

* detection needs the signature, a header of at least `0x10` bytes and the Ogg page signature at
  `0x0C` (the header length check is a safety deviation; the reference reads a clamped header);
* the entry is named after the source file with an `ogg` extension and covers the tail of the file;
* `sizeKnown` is false because the stream is shorter than the source;
* entry metadata carries `type: "audio"` and the archive metadata records `audio: "ogg"`.

The loop timing fields are not interpreted, and decoding the Ogg stream plus archive creation are out
of scope.
