# Xuse/Eternal resource archive (WAG)

## Reference and attribution

- GARbro reference: `ArcFormats/Xuse/ArcWAG.cs`, classes `WagOpener`, `WagArchive` and `IndexReader`
- GARbro tag: `WAG`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

The archive starts with the `WAG@` signature, a version word, a title and the entry count.

```
+0    char[4] signature, WAG@
+4    uint16  version, 0x200 or 0x300
+6    char[0x40] title, NUL padded
+0x46 int32   entry count
```

The index is not stored at a fixed offset. It sits at an offset derived from the archive's own file name,
after the first 0x200 bytes.

1. the name is lowercased for version `0x300` archives only;
2. a key is generated from the CP932 bytes of the file name;
3. the offset starts at `0x200` plus the sum of the key bytes;
4. for every key byte the offset is XORed with that byte and rotated right by one bit, and the reference
   applies that whole loop twice;
5. the result is taken modulo `0x401` and biased by `0x4A`.

The index itself is `4 * count` bytes of little endian offsets, XOR encrypted with a key built from the
name key and the entry count, using the absolute index offset as the position. The offsets form a chain:
entry `i` starts at word `i` and ends where word `i + 1` says, and the last entry ends at the end of the
archive.

## Entry payloads

Every entry region is XOR encrypted with a key derived from the archive title, once again indexed by the
absolute archive offset of each byte. Both keys come from the same generator: a keyword hash picks a key
length between 0x40 and 0x13F, the first four bytes are fixed by the hash, and the rest of the key is a
running hash of the keyword bytes. The last byte of the key is always zero.

Two entry layouts exist.

| version | layout                                                                               |
| ------- | ------------------------------------------------------------------------------------ |
| `0x200` | 16 byte header holding the payload size and a name length, then the payload, then a name field |
| `0x300` | a `DSET` chunk whose `PICT` chunk provides the image payload and whose `FTAG` chunk provides the name |

For version `0x200` the payload size has to be smaller than the whole region, the name length is only
honoured when it is positive, and a trailing pipe character is stripped from the name. Version `0x300`
scans the chunk chain: `PICT` switches the entry to an image whose payload starts ten bytes into the
chunk plus six more, with the chunk size reduced by six, while the first `FTAG` chunk holds the file name
with two trailing bytes. The name has any drive prefix stripped, but keeps its first directory component.
Entries without a name get `{base}#{index:D4}`.

## Port notes and deviations

- The port reproduces the derivation exactly, including the reference's duplicated rotation loop and its
  off by one key period, which is one less than the key length.
- The title needed to rebuild the data key on extraction is carried in the entry metadata.
- Archive creation is out of scope.

## References

- `GARbro/ArcFormats/Xuse/ArcWAG.cs` - `WagOpener.TryOpen`, `WagOpener.GenerateKey`,
  `WagOpener.Decrypt`, `IndexReader.ReadIndex`, `IndexReader.ReadChunk`, `IndexReader.ParseEntryV2`,
  `IndexReader.ParseEntryV3`
