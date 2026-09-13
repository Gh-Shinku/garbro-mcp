# C4 engine VMD MP3 audio

Reference: `GARbro/ArcFormats/C4/AudioVMD.cs`, class `VmdAudio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/c4/vmd-audio.ts` (`vmdAudioDescriptor`, `vmdAudioFormat`, id
`c4-vmd-audio`).

A standalone audio resource: the whole file is an MP3 stream whose every byte is exclusive-ored with
the single byte key `0xE5`. There is no signature, so detection unmasks the first three bytes and
requires an MP3 frame header:

* `header[0] ^ key == 0xFF` — the frame sync byte;
* `(header[1] ^ key) & 0xE6 == 0xE2` — the MPEG version and layer bits the reference accepts;
* `(header[2] ^ key) & 0xF0 != 0xF0` — a usable bitrate index.

The port exposes the resource as a single entry:

* the entry is named after the source file with an `mp3` extension and covers the whole file;
* the mask preserves the length, so `sizeKnown` stays true and the entry is flagged encrypted;
* extraction unmasks every byte with the same key;
* entry metadata carries `type: "audio"` and the archive metadata records `audio: "mp3"` and the key.

Decoding the MP3 stream and archive creation are out of scope.
