# RealLive engine audio archive (KOE)

## Reference and attribution

- GARbro reference: `ArcFormats/RealLive/ArcKOE.cs`, classes `KoeOpener`, `KoeEntry` and `KoeArchive`
- GARbro tag: `KOE`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

The archive starts with the seven byte signature `KOEPAC\0`, which is the `KOEP` signature word followed
by `AC\0`, then a header holding the entry count and the sample rate.

```
+0    char[7] signature, KOEPAC\0
+0x10 int32   entry count
+0x14 uint32  data offset, unused by the reader
+0x18 uint32  sample rate, defaults to 22050 when zero
+0x20 index   eight bytes per entry
```

An index entry names a chunked audio stream.

```
+0  uint16  identifier, used in the generated name
+2  uint16  chunk count
+4  uint32  offset of the chunk table
```

Names are generated from the archive base name: `{base}#{id:D4}.wav`, for example `VOICE#0003.wav`.

## Decoding

The entry payload is a table of little endian 16 bit chunk lengths, one per chunk, followed by the chunk
data that those lengths describe. Every chunk expands to exactly 4096 bytes of PCM regardless of its
stored size, which is why the extracted size is `44 + chunkCount * 4096`.

PCM is signed 16 bit stereo at the archive's sample rate with a block alignment of four bytes. Every
decoded 16 bit value is written twice, once per channel. Three chunk encodings exist.

| chunk length | encoding                                                                       |
| ------------ | ------------------------------------------------------------------------------ |
| `0`          | silence, 4096 zero bytes without consuming any input                            |
| `0x400`      | one byte per sample, used as an index into a 256 entry lookup table             |
| other        | four bit differential PCM, two samples per byte with a nibble escape            |

In the differential encoding each nibble is a signed delta. A nibble of `0xF` is an escape and reads a
full byte for the delta instead; the low nibble is decoded first, then the high nibble. The running index
wraps inside a byte and indexes a 256 entry table of exponentially spaced sample values.

Extraction writes a 44 byte RIFF/WAVE header in front of the decoded PCM, with 16 bits per sample, two
channels and a byte rate of four times the sample rate.

## Port notes and deviations

- The reference reads the chunk data through a stream bounded by the summed chunk lengths and stops at
  the end of the archive. The port reads the same bounded region and clamps it the same way; a chunk
  table that does not fit inside the archive rejects it.
- The `data offset` header field is read by the reference but never used, and the port ignores it too.
- Archive creation is out of scope.

## References

- `GARbro/ArcFormats/RealLive/ArcKOE.cs` - `KoeOpener.TryOpen`, `KoeOpener.OpenEntry`
- `GARbro/GameRes/AudioWAV.cs` - `WaveAudio.WriteRiffHeader`
