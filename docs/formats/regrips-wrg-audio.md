# Regrips WRG audio

Reference: `GARbro/Legacy/Regrips/AudioWRG.cs`, class `WrgAudio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/regrips/wrg-audio.ts` (`wrgAudioDescriptor`, `wrgAudioFormat`, id
`regrips-wrg-audio`).

An **inverted wave file**. The signature `0xB9B9B6AD` is `RIFF` with every byte exclusive-ored with `0xFF`,
which is exactly the transformation the reference applies, and the test asserts that relation rather than
trusting the constant. `TryOpen` wraps the whole stream in this inversion and hands it to `Wav.TryOpen`.

The port exposes the resource as a single entry:

* detection matches the signature, inverts the stream and then parses it with the shared `readWave` helper —
  the same code path the WAZ port uses, which is why that helper was extracted before this port rather than
  copied a second time. A stream that does not invert to a wave file, a truncated stream and a plain
  unscrambled wave file are all declined, each tested. The last of those is the interesting one: an
  unscrambled file begins with `RIFF`, which is not this format's signature, so it fails at the registry gate;
* extraction reserialises the sound: the `fmt ` chunk's fields go into a canonical 44 byte RIFF header and
  the `data` payload follows, which is what `RawPcmInput` emits. The fixture stores two channels with a six
  byte block align and eight bit samples and asserts those values survive, and a second fixture carries a
  `LIST` chunk between `fmt ` and `data` to show that chunks other than those two are dropped. Because the
  output is a rebuilt wave file rather than a copy, the entry sets `sizeKnown: false` even though the
  inversion itself preserves length;
* the entry is named after the source file with a `wav` extension, covers the whole stored file, and is
  flagged `encrypted`; the archive metadata records `audio: "wav"`, `encrypted: true` and the format fields;
* entry metadata carries `type: "audio"`.

A note on the test fixture, because it is the same trap the WAZ tests documented from the other side: every
wave chunk carries an eight byte header — an identifier and a size — and the first version of this fixture
wrote the `fmt ` identifier without its size field. The parser then read the format fields as a huge chunk
length, ran past the end of the stream and never found the data chunk, so two tests failed against a
correct port. When a WAV fixture fails, check the chunk headers before suspecting the reader.

The reference class declares no extension list, so the descriptor registers none.

Encoding and archive creation are out of scope.
