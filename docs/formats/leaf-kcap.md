# Leaf resource archive (PAK/KCAP)

## Reference and attribution

- GARbro reference: `ArcFormats/Leaf/ArcPAK.cs`, class `KcapOpener` and its entry structures
- GARbro tag: `PAK/KCAP`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

The header starts with `KCAP` followed by an entry count, and the index directly follows the count fields.
The reference recognises four arrangements by probing them in order, each requiring that the first payload
offset equals the end of the index:

```
count at 0x04, index at 0x08, records of 0x20, first offset at 0x20
count at 0x04, index at 0x08, records of 0x24, first offset at 0x24
count at 0x08, index at 0x0C, records of 0x24, first offset at 0x28
count at 0x0C, index at 0x10, records of 0x2C, first offset at 0x34
```

Record fields:

```
version 0  name[0x18], uint32 payload offset, uint32 stored size; payloads are always packed
version 1  int32 packed flag, name[0x18], uint32 payload offset, uint32 stored size
version 2  int32 packed flag, name[0x18], uint32 crc, uint32 unpacked size, uint32 offset, uint32 size
```

Records with a zero stored size are skipped, and every remaining payload has to fit inside the file. Names
are NUL padded CP932 strings of at most 0x18 bytes.

Packed payloads carry an eight byte header in front of an LZSS stream; its second word holds the unpacked
size, while extraction decodes the stream from behind the header to its end. Stored payloads are extracted
verbatim. The version two crc and unpacked size fields are informational, exactly as in the reference.

## Port notes and deviations

- Packed entries report an unknown size because their unpacked size lives inside the payload header.
- An index in which every record has a zero size is rejected; the reference would return an empty archive.
- Image and audio decoding are out of scope, as is archive creation.

## References

- `GARbro/ArcFormats/Leaf/ArcPAK.cs` - `KcapOpener.TryOpen`, `KcapOpener.ReadIndex`,
  `KcapOpener.OpenEntry`, `EntryDefV0`, `EntryDefV1`, `EntryDefV2`
