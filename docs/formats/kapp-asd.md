# KApp engine resource archives (ASD/KTOOL)

## Reference and attribution

- GARbro reference: `Legacy/KApp/ArcASD.cs`, classes `AsdKToolOpener` and `AsdArchive`
- GARbro tag: `ASD/KTOOL`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

```
[u8 'ktool210'] [i32 count at 0x08] [offsets from 0x10] [payloads]
```

The signature is checked on its first four bytes. The offset table holds one entry more than the count, so each
payload runs from its own offset to the next one. Names are generated from the archive name as `NAME#0000`,
`NAME#0001` and so on.

The word at 0x0C of a payload selects its type: `0xB713E4` is audio, `0xB29EA4` and `0x973768` are images, and
everything else stays untyped.

## Audio payloads

An audio payload starts with a 0x20 byte header:

| Offset | Field |
| --- | --- |
| 0x00 | unpacked size |
| 0x08 | compression method |
| 0x0A | header size |
| 0x0C | the audio marker |
| 0x10 | wave format: tag, channels, sample rate, average bytes, block align, bits |

The packed data starts at `header size + 0x10`. The extractor unpacks it and writes a 44 byte RIFF header in
front of it, so the entry is a playable wave file. `GameRes/AudioWAV.cs` writes that header as `RIFF`, a size of
`0x24 + pcm size`, `WAVE`, a `fmt ` chunk of sixteen bytes, the six format fields, and a `data` chunk with the
pcm size.

## Compression

`KTool.Unpack` dispatches on the method byte:

- `0` copies the payload as it is;
- `1` to `4` run the interleaved rle decoder with that step;
- `0x10` runs the huffman decoder.

The rle decoder reads one control byte per lane and walks the output with a fixed step. A negative control is a
literal run of `-control` bytes, a positive one repeats the next byte that many times, and a zero ends the lane.

The huffman decoder reads a 256 byte weight dictionary that is itself rle compressed with a step of one, adds a
weight of one for the end token 0x100, and builds a tree by repeatedly merging the two lightest nodes. Bits are
read most significant bit first; a clear bit takes the left child and a set bit the right one. A token of 0x100
or less is written out as a byte.

## Port notes and deviations

- Image decoding of the payloads, the `CGD` format, is out of scope, as is archive creation.
- Out of range writes and reads are bounded instead of failing, and the huffman walk stops at the last node.

## References

- `GARbro/Legacy/KApp/ArcASD.cs` - `AsdKToolOpener.TryOpen`, `AsdKToolOpener.DetectFileTypes`,
  `AsdKToolOpener.OpenAudio`
- `GARbro/Legacy/KApp/ImageCGD.cs` - `KTool.Unpack`, `KTool.DecompressRle`, `KTool.HuffmanDecoder`
- `GARbro/GameRes/AudioWAV.cs` - `WaveAudio.WriteRiffHeader`
