# RealLive OWP obfuscated Ogg audio

Reference: `GARbro/ArcFormats/RealLive/AudioOWP.cs`, class `OwpAudio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/reallive/owp-audio.ts` (`realliveOwpAudioDescriptor`,
`realliveOwpAudioFormat`, id `reallive-owp-audio`).

A standalone audio resource and the simplest shape in this family: the whole file is an Ogg stream
whose every byte is exclusive-ored with the single byte key `0x39`. The declared signature is
therefore the masked page header, `'OggS' ^ 0x39` = `0x6A5E5E76` (bytes `76 5E 5E 6A`), and the
reference does nothing else — it wraps the masked stream in an `XoredStream` and hands it to the Ogg
reader, whose own checks reject anything that is not really an Ogg file.

The port exposes the resource as a single entry:

* detection is the signature alone, exactly as the reference has it;
* the entry is named after the source file with an `ogg` extension and covers the whole file;
* the mask preserves the length, so `sizeKnown` stays true and the entry is flagged encrypted;
* extraction unmasks every byte with the same key;
* entry metadata carries `type: "audio"` and the archive metadata records `audio: "ogg"` and the key.

Decoding the Ogg stream and archive creation are out of scope.
