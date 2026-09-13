# MyHarvest BGM audio

Reference: `GARbro/Legacy/Harvest/AudioBGM.cs`, class `BgmAudio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/myharvest/bgm-audio.ts` (`harvestBgmAudioDescriptor`,
`harvestBgmAudioFormat`, id `myharvest-bgm-audio`).

A **wave format block with a marker followed by raw PCM**. The signature is `BMG0` (`0x304D4742`) and the
header is 28 bytes:

| field | offset |
|---|---|
| signature `BMG0` | 0 |
| format tag (`u16`) | 4 |
| channels (`u16`) | 6 |
| samples per second (`u32`) | 8 |
| average bytes per second (`u32`) | 0xC |
| block align (`u16`) | 0x10 |
| bits per sample (`u16`) | 0x12 |
| marker `dar\0` | 0x14 |
| PCM size (`u32`) | 0x18 |
| PCM | 0x1C |

The port exposes the resource as a single entry:

* the only check the reference performs is the `dar\0` marker — it does not validate the format tag, the
  channel count or the size against the file length. The port keeps that permissiveness, and a header whose
  payload is empty is accepted, which is tested;
* the declared PCM size behaves like a region: one reaching past the end of the file is **shortened**
  rather than rejected, and trailing bytes beyond the declared size are ignored. Both directions are
  covered by tests;
* extraction prepends a canonical 44 byte RIFF header and copies the format block **verbatim**, so the
  output preserves whatever the file said — including values that are internally inconsistent. The test
  fixture deliberately stores two channels with a six byte block align and eight bit samples and then
  asserts those values survive, which is what distinguishes a verbatim copy from a recomputed header;
* the entry is named after the source file with a `wav` extension, covers the PCM region from `0x1C`, and
  sets `sizeKnown: false` because the RIFF header is added;
* entry metadata carries `type: "audio"`, and the archive metadata records `audio: "pcm"`, the format tag,
  the channel count, the sample rate and the bit depth.

The engine has a second audio format in the same directory, `Legacy/Harvest/AudioSED.cs`, already ported as
`myharvest-sed-audio`; the two layouts are unrelated apart from belonging to the same family.

The reference class declares no extension list, so the descriptor registers none.

Encoding and archive creation are out of scope.
