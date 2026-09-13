# Pan NSF audio

Reference: `GARbro/Legacy/Pan/AudioNSF.cs`, class `NsfAudio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/pan/nsf-audio.ts` (`nsfAudioDescriptor`, `nsfAudioFormat`, id
`pan-nsf-audio`).

Pan engine PCM audio: a format block followed by samples to the end of the file, with no marker at all. The
header is sixteen bytes:

| field | offset |
|---|---|
| format tag (`u16`) | 0 |
| channels (`u16`) | 2 |
| samples per second (`u32`) | 4 |
| average bytes per second (`u16`) | 8 |
| filler | 0xA |
| block align (`u16`) | 0xC |
| bits per sample (`u16`) | 0xE |
| PCM | 0x10 |

Three details distinguish this format from the other PCM ports:

* the average byte rate is a **sixteen bit** field, where a wave file stores thirty two bits. The port keeps
  the stored width and widens it when it writes the RIFF header, and a test asserts the header carries the
  full value at the thirty two bit offset;
* the gate is the file **name**: `TryOpen` returns early unless the name ends in `.NSF`, before it reads
  anything. That check lives in `detect` and `read`, the two places that receive a source path, and is
  compared without regard to case;
* the format is accepted only when the block is **internally consistent**: the tag has to be plain PCM and
  the stored average byte rate has to equal `sampleRate * channels * bitsPerSample / 8` exactly. A test
  keeps a plausible looking header and only changes the bit depth to sixteen, which makes the derived value
  88200 against a stored 44100, and the file has to be declined. This check is what replaces a signature;
  the reference's two registered signature words (`0x010001` and `0x020001`) are nothing more than the first
  two header fields read as one little endian word, so this port registers no signature and relies on the
  header check.

The port exposes the resource as a single entry:

* extraction reserialises the sound the way `RawPcmInput` does: the stored format block goes into a
  canonical 44 byte RIFF header and everything from `0x10` to the end of the file follows as PCM. A header
  with no samples at all is accepted and produces an empty data chunk, which is tested;
* the entry is named after the source file with a `wav` extension, covers the PCM region from `0x10`, and
  sets `sizeKnown: false` because the RIFF header is added;
* entry metadata carries `type: "audio"`, and the archive metadata records `audio: "pcm"`, the format tag,
  the channel count, the sample rate and the bit depth.

The descriptor advertises `nsf`, matching the reference's own extension list.

Encoding and archive creation are out of scope.
