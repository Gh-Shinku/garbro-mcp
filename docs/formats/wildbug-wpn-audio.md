# Wild Bug WPN audio

Reference: `GARbro/ArcFormats/WildBug/AudioWPN.cs`, class `WpnAudio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/wildbug/wpn-audio.ts` (`wpnAudioDescriptor`, `wpnAudioFormat`, id
`wildbug-wpn-audio`).

A wave file whose **format chunk and payload live at declared offsets** rather than following the header — the
same shape as GARbro's `KOE` and the ScenePlayer readers, but here the two chunks can appear in either order.

| field | offset |
|---|---|
| signature `WBD` + `0x1A` | 0 |
| `WAV` marker | 4 |
| version, must be at least 2 | 8 |
| format chunk offset | 0x10 |
| format chunk size | 0x14 |
| data chunk offset | 0x1C |
| data chunk size | 0x20 |

`TryOpen` reassembles a wave around the two ranges — sixteen prefix bytes (`RIFF`, a length, `WAVE`, `fmt `),
the format chunk's size, its body copied from its own offset, then the `data` marker and size — and hands the
result to the wave reader. The port builds exactly that layout and parses it with the shared `readWave`, then
writes a **canonical** wave file with `writeWave`, the same shape as the WAZ, WRG, VZY, PMW and EZS audio
ports.

The first version of the port did the rebuild with a single eight byte buffer for the prefix, which silently
truncated most of it and made every fixture fail; the visible symptom was an "Invalid Wild Bug WPN audio" error
on files that were perfectly well formed. The port now builds the four pieces separately, which is also how the
reference lays them out.

Three tests cover the layout rules that matter:

* a fixture that puts the payload **before** the format chunk, since nothing requires the usual order and the
  reference follows the offsets rather than a fixed sequence;
* sixteen bytes of padding after the payload, which the declared size excludes — the canonical output carries
  exactly the declared payload and is twenty bytes shorter than the file;
* negative, oversized and undersized ranges, which the reference's `StreamRegion` rejects by throwing; the port
  declines them in detection instead, which is a documented deviation.

The port exposes the resource as a single entry: it is named after the source file with a `wav` extension,
covers the whole stored file, and keeps `sizeKnown: false` because the output is a rebuilt wave file. Entry and
archive metadata carry `type: "audio"`, `format: "wav"`, the format tag, channel count, sample rate, bit depth
and the payload size. A format chunk smaller than sixteen bytes is declined, since the wave reader cannot
describe a format from less than that.

GARbro's `Write` throws `NotImplementedException`, so encoding is out of scope.
