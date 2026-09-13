# Regrips MRG audio

Reference: `GARbro/Legacy/Regrips/AudioWRG.cs`, class `MrgAudio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/regrips/mrg-audio.ts` (`regripsMrgAudioDescriptor`,
`regripsMrgAudioFormat`, id `regrips-mrg-audio`).

An **inverted MP3**: the whole stream is exclusive-ored with `0xFF`, the same transformation the WRG class
in the same reference file uses, but the result is handed to the MP3 reader instead of the wave reader. The
reference declares no signature, so this port registers none either, and the symbol names are prefixed with
the engine because the tag `MRG` is already used by the FC01 archive format in this repository.

The detection rule looks like a single stray byte check and is more than that:

* `TryOpen` reads two bytes and rejects the file unless the **stored** first byte is zero, then inverts the
  whole stream. Exclusive-oring zero with `0xFF` gives `0xFF`, which is the first byte of an MPEG frame
  header — so the check is a proxy for "the decoded stream begins with a frame sync", expressed on the
  stored byte. The port reproduces it in that order: it checks the stored byte, then decodes, then verifies
  the frame header at offset zero. A test asserts both halves of the relation (`stored[0] === 0` and
  `decoded[0] === 0xFF`) rather than just the outcome;
* that constraint has a consequence worth stating, because it is not obvious: an MP3 preceded by an `ID3`
  tag **cannot** be carried by this format. Its frame header sits at a later offset, so its scrambled first
  byte is not zero and the reference rejects the file before looking any further. The port has no `ID3`
  branch, and a test pins the rejection;
* the frame header check also inspects the version and layer fields, both of which have a reserved value, so
  a stream that merely starts with `0xFF` is not enough. A test builds one and expects a decline.

The port exposes the resource as a single entry:

* the reference hands the decoded stream to the MP3 reader, so extraction emits those bytes unchanged rather
  than transcoding them. Inverting preserves length, so this is one of the ports that can honestly claim
  `sizeKnown: true`;
* the entry is named after the source file with an `mp3` extension, covers the whole stored file, and is
  flagged `encrypted`; the archive metadata records `audio: "mp3"` and `encrypted: true`;
* entry metadata carries `type: "audio"`.

The reference class declares no extension list, so the descriptor registers none.

Encoding and archive creation are out of scope.
