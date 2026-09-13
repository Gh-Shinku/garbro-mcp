# NeXAS engine resource archives (PAC)

## Reference and attribution

- GARBro reference: `ArcFormats/Nexas/ArcPAC.cs`, classes `PacOpener` and `IndexReader`
- GARBro tag: `PAC`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The archive starts with `PAC` and a byte that must not be a `K`, which separates it from the older `PACK`
format. Behind a twelve byte header it keeps an entry count, a compression method and one of two index layouts.

## Layout

```
[u8 'PAC'] [u8 not 'K'] [u24 unused] [i32 entry count] [i32 method]
[index and payloads]
```

Both index layouts store the same records:

```
[name] [u32 offset] [u32 unpacked size] [u32 stored size]
```

Names are fixed length and cut at their first NUL. An offset that leaves the file fails the attempt, which is how
the reader decides between layouts: a blank name or an out of range offset makes it try the next one.

## Index layouts

**Old index.** The records start right behind the header at 0xC. The reader tries them first with thirty-two byte
names; when that attempt fails it tries again with sixty-four byte names. A file is only read with the longer
names when the shorter attempt fails, which happens for names that do not fit into thirty-two bytes.

**New index.** The records are huffman coded, complemented with `~` on every byte and stored at the end of the
file, followed by a word that holds the packed index size:

```
[huffman coded index] [u32 packed index size]
```

The packed size must stay below the file size and no larger than twice the unpacked index size, which is the
entry count times 0x4C. Decoding produces exactly that many bytes, and the tree lives in the same bit stream, so
a malformed tree or a stream that ends early declines the archive.

## Compression methods

| Method | Name | Behaviour |
| --- | --- | --- |
| 0 | None | Payloads are stored as they are |
| 1 | Lzss | GARbro LZSS stream, decoded to the unpacked size |
| 2 | Huffman | Huffman stream with its tree inside, decoded to the unpacked size |
| 3 | Deflate | zlib stream |
| 4 | DeflateOrNone | zlib stream, but a payload whose stored and unpacked sizes agree is stored |
| other | - | Treated as a zlib stream, as the reference's switch default does |

The method word decides whether an entry counts as compressed at all: for a stored archive nothing is compressed,
and for method four an entry is only compressed when its two sizes differ.

## Port notes and deviations

- The reference indexes its view with `MaxOffset - 4 - index_size` without checking for an underflow; the port
  declines a file whose packed index size would reach behind the start of the file instead.
- A malformed huffman index is reported as a plain failure, while GARbro lets the decoder's exception escape.
- The new index is complemented, so the format reports that it handles an obfuscated index; the reference writes
  nothing for it, so archive creation stays out of scope.

## References

- `GARbro/ArcFormats/Nexas/ArcPAC.cs` - `PacOpener`, `PacArchive`, `IndexReader` (`Read`, `ReadOld`, `ReadNew`,
  `ReadFromStream`), `HuffmanDecode`
