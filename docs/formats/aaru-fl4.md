# Aaru resource archives (FL4)

## Reference and attribution

- GARbro reference: `Legacy/Aaru/ArcFL4.cs`, classes `Fl4Opener` and `RleDecompressor`
- GARbro tag: `FL4/AARU`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The archive opens with the string `FL4.0`. Behind a fixed header it keeps an index of named payloads whose
storage is decided by the payload's own header.

## Layout

```
[u8 'FL4.0'] [u24 unused] [u16 data offset] [u32 index size] [u32 index offset] [u32 unused] [u16 key] [u16 flags]
[index and payloads]
```

The header occupies 0x1A bytes. Only three fields are used: the data offset the index offsets are relative to,
the index size and the index offset. The key and the flags are read but never used, and the version byte behind
`FL4.` must be `0`. An index that would reach behind the end of the file declines the archive.

## Index

The index opens with the position of its first record; a position of zero or less declines the archive.

```
[i32 first record position]
[i32 record position] [u32 offset] [u32 size] [u8 name length] [name]
... [u32 0xffffffff] (terminator)
```

Names are CP932 and cut at their stored length. Record offsets are relative to the data offset and an offset plus
size that leaves the file declines the archive. The terminator ends the list early, and an archive without a
single record declines.

## Payload headers

An entry is stored as it is unless its payload starts with one of three markers. The markers are only compared,
they are not parsed for their own sake.

| Marker | Header | Payload |
| --- | --- | --- |
| `PD2A` | 0x10 bytes, unpacked size at 0xC | LZSS stream from 0x10 to the end of the entry |
| `PD` | 0x0A bytes, unpacked size at 0x6 | LZSS stream from 0x0A to the end of the entry |
| `RD1.0` | 0x10 bytes, stream offset at 0x6, chunk count at 0xA | Aaru RLE stream from the stored offset |

Both LZSS variants are the GARbro LZSS stream with its default window settings and decode until their input ends,
so their reported size comes from the header rather than from the decoded length. The RLE payload has no declared
size at all and is reported with an unknown size; its chunk count bounds how many chunks are read, and a chunk
whose literal run leaves the input stops the decoding.

The RLE control bytes are:

| Control | Meaning |
| --- | --- |
| 0 | raw run, length in the next byte |
| 1 | raw run of 0x100 bytes |
| 2 | repeat the next byte twice |
| 3 | repeat the next byte, length in the next word |
| other | repeat the next byte that many times |

## Port notes and deviations

- GARbro decides between stored and packed when an entry is opened; the port resolves the payload header while
  listing, which keeps the listed sizes and the extracted payload in agreement.
- The reference reads the payload fields through its view, so a short entry reads into the bytes behind it; the
  port bounds that probe by the file and only accepts a marker when the whole header is present.
- An `RD1.0` payload whose stored stream offset starts behind the entry is reported as an invalid archive instead
  of letting an out of range read fail.
- Archive creation stays out of scope, as the reference cannot write this format either.

## References

- `GARbro/Legacy/Aaru/ArcFL4.cs` - `Fl4Opener.TryOpen`, `Fl4Opener.OpenEntry`, `RlePackedStream`,
  `RleDecompressor.Unpack`
- `packages/formats/src/aaru/rle.ts` - `inflateAaruRle`, shared with the FL2 archive
