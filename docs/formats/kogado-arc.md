# Kogado engine resource archive (ARC)

## Reference and attribution

- GARbro reference: `ArcFormats/Kogado/ArcARC.cs`, classes `ArcOpener`, `ArcIndexReader`, `OvaEntry`,
  `DdsEntry` and `DdsInfo`
- GARbro tag: `ARC/KOGADO`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

The archive starts with the signature word `A8BCADBE`, which is `ARCW` inverted, and the payload base
offset at `+0xC`.

```
+0   uint32   signature, 0xA8BCADBE
+0xC uint32   payload base offset
+0x10 chunk    filenames
       chunk    index
```

A chunk is a twelve byte header followed by an XOR 0xFF masked LZSS stream whose output length is
declared in the header. The `size` field of the header covers the header itself.

```
+0  int32   chunk size, including this header
+4  int32   chunk type, unused by the reader
+8  int32   unpacked size
```

The first chunk is the name table, a run of NUL terminated UTF-16LE names. The second is the index.

## Index

The decoded index is a section count followed by that many sections. Each section has a sixteen byte
header and a body of `sectionSize` bytes, which covers the name offsets and the layout that follow.

```
+0   char[4]  section magic, `DDS\0`, `OVA\0` or zeros
+8   int32    entry count
+0xC int32    section size, excluding this header
+0x10 int32[]  name offsets, one per entry, into the filenames blob
       layout   entry records
```

An entry name is read as UTF-16LE from the given byte offset in the filename blob up to a two byte NUL
terminator. Names may contain directories, and the archive is treated as hierarchical.

Three layouts exist.

| section | records                                                                    |
| ------- | -------------------------------------------------------------------------- |
| plain   | 16 bytes: offset, stored size, unused word, unpacked size                   |
| `DDS`   | a 32 bit header count, then per header flags/width/height, then 20 byte records: offset, stored size, unused word, unpacked size, header id |
| `OVA`   | two words, then per header a 12 byte prefix holding a length and the header bytes, then 12 byte records: offset, unpacked size, header id |

Offsets are relative to the payload base offset. Every entry is an LZSS stream that is XOR 0xFF masked,
so the stored payload has to be unmasked first.

`DDS` entries carry their image metadata in the index; the port exposes it as `dds` metadata with 32 bits
per pixel. `OVA` entries carry an inline header in the index that is prepended to the decoded payload,
and the stored size is derived as `unpackedSize - headerLength` rather than read from the archive.

## Port notes and deviations

- The reference allows an entry to run up to `0x14` bytes past the end of the archive and rejects the
  archive otherwise. The port reproduces that relaxed bound, as well as the two different bounds for
  `OVA` entries, which are checked without the relaxation.
- The reference limits the decoded stream to the entry's unpacked size, which for `OVA` entries includes
  the inline header, so the decoded payload can be longer than the payload itself. The port keeps that
  behaviour and marks such entries as having an unknown size.
- The DDS image decoder and archive creation are out of scope.
- Entry types are taken from the format catalog in the reference. The port leaves the type unset and
  reports the DDS metadata instead.

## References

- `GARbro/ArcFormats/Kogado/ArcARC.cs` - `ArcOpener.TryOpen`, `ArcOpener.OpenEntry`,
  `ArcIndexReader.ReadIndex`, `ArcIndexReader.ReadChunk`, `ArcIndexReader.ReadFileName`,
  `ArcIndexReader.ReadDdsSection`, `ArcIndexReader.ReadOvaSection`
- `GARbro/ArcFormats/LzssStream.cs` - `LzssReader.Unpack`
