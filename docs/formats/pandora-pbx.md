# Pandora.box resource archive (PBX)

## Reference and attribution

- GARBro reference: `ArcFormats/Pandora/ArcPBX.cs`, classes `PbxOpener` and `PandoraCompression`
- GARBro tag: `PBX`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The archive opens with the twelve byte string `Pandora.box\0`. Payload offsets are chained: the header holds the
offset of the first payload and every index record holds the offset of the next one, so a payload's size is the
difference between its own offset and its successor's.

## Layout

```
[0x00] "Pandora.box\0"
[0x0C] u32 first payload offset
[0x10] records of 0x10 bytes: [name 0x0C][u32 next payload offset]
[first payload offset] payloads, one after another
```

The record count is `(first payload offset - 0x10) / 0x10`, so the index has to end exactly where the first
payload begins. Names are CP932, NUL padded, and are kept verbatim. A payload that would leave the file, or a
chain that walks backwards and yields a size that wraps around the 32-bit limit, declines the archive.

## Packed payloads

A payload that is larger than sixteen bytes and opens with the little-endian word `0x6344764D` (`MvDc`) carries
a packed body. Bytes four to seven are skipped, bytes eight to eleven hold the unpacked size, and the compressed
stream starts at offset sixteen.

`PandoraCompression` decodes a byte stream that opens with one literal byte and then alternates between literal
runs and overlapping copies:

| control byte | meaning |
| --- | --- |
| `>= 0xC0` | copy three bytes from `distance = byte + 0x101 + ((control & 0x3F) << 8)` |
| `>= 0xB0` | copy `big-endian u16 + 0x813 + ((control & 7) << 16)` bytes from a two byte distance |
| `>= 0xA0` | copy `byte + 19 + ((control & 7) << 8)` bytes from a two byte distance |
| `>= 0x80` | copy `(control & 0xF) + 3` bytes from a one byte distance of `byte + 1` when `control & 0x10` is clear, and from a two byte distance of `u16 + 0x101` when it is set |
| `>= 0x60` | reads and discards a big-endian word, then falls through to the `>= 0x40` case |
| `>= 0x40` | append `byte + 0x41 + ((control & 0x1F) << 8)` literal bytes |
| else | append `control + 1` literal bytes |

Two byte distances are big-endian and are biased by `0x101`, one byte distances by one. A copy runs byte by
byte, so it can overlap the bytes it just produced. The discarded word of the `>= 0x60` case is reproduced
because it still consumes input. A stream that runs out of input, that copies from before the start of the
output, or that would write past the declared size declines the payload.

## Listing and extraction

Entries are listed with their stored size, unless the payload carries the packing magic with a positive
unpacked size, in which case the entry is marked as compressed and the declared unpacked size is listed. GARbro
makes that decision while opening an entry rather than while listing, so its listing always shows the stored
size; this port probes the payload header at list time so that the listed size and the extracted bytes agree.

Extraction returns packed payloads decoded, and falls back to the stored bytes whenever the header or the stream
cannot be decoded, which mirrors the reference's error handling.

## Deviations from GARbro

- The packed probe happens at list time, as described above.
- GARbro reads through bounds-checking views and lets an out-of-range read throw while an entry that fails the
  placement check declines the archive. This port bounds-checks the same reads and declines the archive on a
  table that runs past the index region, which the reference would read as zeroes or throw on.

## Tests

`tests/formats/pandora-pbx.test.ts` builds chained indexes in memory and covers stored and packed payloads,
literal runs that span several control bytes, overlapping copies, the fallback to stored bytes for a payload
that does not decode, CP932 names, and the rejections of a wrong signature, an index outside the file, an index
that starts inside the header and a payload chain that walks backwards.
