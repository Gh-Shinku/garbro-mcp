# Rit's resource archive (SAF)

## Reference and attribution

- GARbro reference: `ArcFormats/Rits/ArcSAF.cs`, classes `SafOpener`, `SafIndexReader5`, `SafIndexReader6`
- GARbro tag: `SAF`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

```
0x00  uint16    version id; the high byte selects the index layout
0x02  int16     record count
```

Version 5 (`0x5xx`) keeps a fixed size index of `0x20` bytes per record starting at offset four: a name
field of `0x14` bytes whose top bit marks a directory, an offset in units of `0x800` bytes at `0x14`, the
stored size at `0x18` and the unpacked size at `0x1C`. Directories reuse the offset and unpacked size fields
as the subdirectory index and its record count. Ids with the low bit set (`0x501`) obfuscate the index with a
per record XOR whose key counts up from `0xDF` and restarts for every record.

Version 6 (`0x6xx`) keeps a `int32` name blob length at offset four, an index of sixteen bytes per record at
offset eight followed by the name blob. A record holds the name blob offset (with the top bit marking a
directory), the offset in `0x800` byte units, the stored size and the unpacked size; directories use the
second and fourth fields as the subdirectory index and count. Ids with the low bit set (`0x601`) obfuscate
the index with a counting XOR from `0xEF` and the name blob with a descending XOR from `0xFF`.

Both layouts are walked as a directory tree. Record zero describes the root: when its top bit is clear the
whole index is a flat list and directory records are skipped, otherwise its name (with `root` mapped to the
empty string) and its index and count fields select the top level. A subdirectory is only followed when its
index lies at or behind the end of the current level, which keeps the walk acyclic. Entries are hierarchical:
paths are joined with `/`.

A non zero unpacked size marks a packed entry. Packed entries are zlib streams, or LZSS streams when bit one
of the version id is set.

## Port notes and deviations

- The reference clears the top bit of the first name byte while reading a name, which mutates its index
  buffer. The same behavior is reproduced, including its consequence: a root record that points at itself is
  listed as a plain file on the second visit.
- Name fields are decoded as CP932 and trailing whitespace and NUL padding are removed. The reference trims
  only whitespace, so it would keep NUL bytes of an underfilled name field.
- The walk carries a depth limit of 64 levels; the reference recurses without one.
- Directory entries report `sizeKnown: false`, because the declared size is the stored size while the
  unpacked size is only known from the record.
- The `STR` to `TXT` resource alias declared in the same file is a resource mapping, not an archive format,
  and is out of scope, as is archive creation.

## References

- `GARbro/ArcFormats/Rits/ArcSAF.cs` - `SafOpener.TryOpen`, `SafOpener.OpenEntry`, `DecryptIndex`,
  `DecryptIndexV6`, `DecryptNames`, `SafIndexReader5.Scan`, `SafIndexReader6.ReadName`
