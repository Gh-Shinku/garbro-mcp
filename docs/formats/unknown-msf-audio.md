# 'Unknown' MSF PCM audio

Reference: `GARbro/Legacy/Unknown/AudioMSF.cs`, class `MsfAudio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/unknown/msf-audio.ts` (`msfAudioDescriptor`, `msfAudioFormat`, id
`unknown-msf-audio`).

A **scrambled wave format header followed by raw PCM**. The file starts with `MSF `, and the reference
descrambles the whole forty eight byte header in place before reading the format from it:

| field | offset |
|---|---|
| signature `MSF ` (stored in the clear) | 0 |
| scramble key word (stored) | 4 |
| unused, scrambled | 6 |
| PCM size (u32) | 0x18 |
| format tag (u16) | 0x1C |
| channels (u16) | 0x1E |
| samples per second (u32) | 0x20 |
| average bytes per second (u32) | 0x24 |
| block align (u16) | 0x28 |
| bits per sample (u16) | 0x2A |
| unused, scrambled | 0x2C |
| PCM data | 0x30 |

The scramble key is **derived from the stored header**: `key = (101 * <u16 at 4> + 778) & 0xFFFF`, and
every two byte pair of the header is then XORed with it, low byte first. Two consequences are easy to get
wrong and are worth stating explicitly:

* the key is computed from the **stored** word, before any XOR, so a port that descrambles first and then
  derives the key produces a different (and wrong) stream;
* the signature is checked against the **stored** bytes — that is what the registry gate matches — and is
  never re-checked after descrambling. The descrambled header's first four bytes are therefore *not* `MSF `,
  which is expected: the reference only reads fields from `0x18` onward. The test asserts both halves of
  this, that the stored bytes begin with `MSF ` while the stored field area does not decrypt to itself.

The port exposes the resource as a single entry:

* detection matches the signature and requires the header to be present. The reference performs no further
  validation — it does not even check the format tag — and the port stays equally permissive so that files
  GARbro accepts are not rejected here;
* the declared PCM size is **clamped** to the bytes actually available, because GARbro builds its region
  with a length and lets the stream end shorten it; a header claiming more data than the file holds
  therefore extracts what is there rather than failing. The length is honoured in the other direction too:
  trailing bytes beyond the declared size are ignored. Both cases are tested;
* the entry is named after the source file with a `wav` extension, covers the PCM region, and sets
  `sizeKnown: false` because a RIFF header is prepended;
* extraction writes a 44 byte RIFF/WAVE header with the format block copied verbatim from the descrambled
  header, so the test's deliberately inconsistent values (two channels, block align six, eight bits) survive;
* entry metadata carries `type: "audio"`, and the archive metadata records `audio: "pcm"`,
  `scrambledHeader: true` and the format fields. The descriptor declares `encryption: true`, since the
  header is obfuscated; the entry itself is not flagged, because the PCM is stored in the clear.

Encoding and archive creation are out of scope.
