# Brownie obfuscated WAV audio

Reference: `GARbro/Legacy/Brownie/AudioWAV.cs`, class `WavAudio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/brownie/wav-audio.ts` (`brownieWavAudioDescriptor`,
`brownieWavAudioFormat`, id `brownie-wav-audio`).

A standalone audio resource. The declared signature is `g#tX` (`0x58742367` — the reference never
inspects those bytes itself, it only reaches the opener through the registry gate), and the first
sixteen bytes are obfuscated:

* bytes `0x00`–`0x03` are **replaced** with `RIFF` (that is why the stored signature looks nothing
  like a wave file);
* bytes `0x04`–`0x0F` are exclusive-ored with `0x5C`, which must reveal `WAVE` at offset eight;
* everything from `0x10` is a plain wave file.

The port exposes the resource as a single entry:

* detection needs the stored signature, a file of at least `0x10` bytes and an unmasked `WAVE` at
  offset eight;
* the entry is named after the source file with a `wav` extension and covers the whole file;
* extraction rebuilds the sixteen byte header (`RIFF` plus the unmasked remainder) and appends the
  stored bytes from `0x10` verbatim, so the payload keeps the source length and `sizeKnown` stays
  true; the entry is flagged encrypted;
* entry metadata carries `type: "audio"` and the archive metadata records `audio: "wav"` and the key.

Archive creation and audio writing are out of scope.
