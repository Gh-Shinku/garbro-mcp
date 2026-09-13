# Tail resource archive (CAF)

## Reference and attribution

- GARbro reference: `ArcFormats/Tail/ArcCAF.cs`, class `CafOpener`
- GARbro tag: `CAF`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

```
0x00  char[4]   'CAF0'
0x08  int32     entry count
0x0C  uint32    index offset
0x10  uint32    index size
0x14  uint32    names offset
0x18  uint32    names size
index           count records of 0x14 bytes
                int32 directory name offset at +4, int32 name offset at +8
                uint32 data offset at +0xC, uint32 stored size at +0x10
names           NUL-terminated CP932 strings shared by all records
data            payloads, starting right behind the name blob
```

Data offsets are relative to the end of the name blob. A negative directory offset means the entry sits at
the archive root, otherwise the directory string is prefixed to the file name, and the directory name of a
given offset is resolved once and reused. The reference rewrites forward slashes in directory names for
Windows; this port leaves the name alone and normalises it on the way out.

Payloads are unpacked in chains: as long as the current bytes start with a known signature the corresponding
unpacker runs again on its output.

| Signature | Layout |
| --- | --- |
| `PREN` or `RP` | int32 unpacked size at 8, escape byte at 0xC, data at 0x10 |
| `CFP0` | int32 unpacked size at 8, commands at 0xC |
| `HP` | int32 unpacked size at 8, root token at 0xC, node count at 0x10, packed count at 0x14 |

`PREN` and `RP` are a run length scheme: the escape byte introduces a count and, when the count exceeds two,
the repeated value. `CFP0` is command driven, where zero and one read a byte and a 32-bit raw run, two and
three read a byte and a 32-bit repetition count, and six reads a 16-bit offset and count of an overlapping
copy. `HP` stores a bit walked tree whose node count is biased by `root_token - 0xFF` and whose leaves are
marked with a leading `-1` child.

## Port notes and deviations

- An unknown `CFP0` command ends decoding instead of looping forever, which is what the reference does when
  its switch falls through with a zero count.
- The `HP` walk and `CFP0` copies are bounds checked; the reference relies on array bounds and exceptions.
- Entry sizes are reported as unverified, since extraction unpacks the stored bytes.
- Image and audio decoding are out of scope, as is archive creation.

## References

- `GARbro/ArcFormats/Tail/ArcCAF.cs` - `CafOpener.TryOpen`, `CafOpener.OpenEntry`, `UnpackPren`, `UnpackCfp0`,
  `UnpackHp`
