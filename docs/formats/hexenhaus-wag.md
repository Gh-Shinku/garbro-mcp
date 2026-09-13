# Hexenhaus resource archives (WAG)

## Reference and attribution

- GARbro reference: `ArcFormats/Hexenhaus/ArcWAG.cs`, classes `WagOpener` and `Ror4EncryptedStream`
- GARbro tag: `WAG/IAF`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The archive opens with `IAF_` and keeps its whole index behind a per-byte nibble rotation. Only the first
0x4A bytes stay readable: the count is read from the plain view while every offset, name and section behind
that point is read through the decrypting stream.

## Layout

```
[u8 'IAF_'] [u16 type] [i32 entry count] ... [index at 0x4A]
```

The type field is read but never used. The count must be sane, which means it is greater than zero and below
0x40000.

## Index

Behind the header sits a plain table of `entry count` 32-bit offsets. Each offset points at a record:

```
[u8 'DATA'] [i32 section count] [u16 unused] [section]...
```

A record whose first four bytes are not `DATA` is skipped, and so is a record that does not end up with both a
name and a payload. Sections are walked in order and each one advances the cursor by its own size plus two
bytes, except for the name section which counts two of its own bytes in the stored length:

| Section | Layout | Effect |
| --- | --- | --- |
| `FNNE` | `[u32 name length + 2] [u16 unused] [name] [u16 unused]` | Gives the entry its name |
| `IMGD` | `[u32 size] [payload]` | Gives the entry its offset and a size of `size + 0x10` |
| other | `[u32 size] [payload]` | Skipped |

`MOZA` is a known section that is not supported, and every other section is reported as unknown; both are
skipped the same way.

The payload size is six bytes longer than the section itself, which matches how `IMGD/WAG` images are read:
the PNG behind an `IMGD` section starts at 0x10 from the entry and the extra bytes belong to it.

## Encryption

`Ror4EncryptedStream` rotates every byte it reads right by four bits, which is a nibble swap and therefore its
own inverse. The index offsets and sizes are stored in plain form inside that stream, so they can be used as
positions in the file as they are. Extraction reads the stored region and rotates it back, which turns an
`IMGD` payload into the same bytes the reference hands to its image reader.

## Port notes and deviations

- Rather than wrapping the source in a decoding stream, the port rotates only the ranges it reads.
- The reference seeks to each record offset without bounds checking and lets an out of range read fail; the
  port skips a record whose offset or section walk leaves the file.
- An `IMGD` section whose reported size leaves the file declines the archive.
- `IMGD/WAG` image decoding and archive creation stay out of scope.

## References

- `GARbro/ArcFormats/Hexenhaus/ArcWAG.cs` - `WagOpener.TryOpen`, `WagOpener.OpenEntry`,
  `Ror4EncryptedStream.Read`, `ImgdFormat`
