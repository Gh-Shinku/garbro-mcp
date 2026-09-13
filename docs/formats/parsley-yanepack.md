# YaneSDK resource archive (DAT/yanepack)

## Reference and attribution

- GARbro reference: `ArcFormats/Software House Parsley/ArcCG.cs`, class `CgOpener`
- GARbro tag: `DAT/yanepack`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

```
0x00  4 bytes   'yane', optional; when present the next four bytes must read 'pack'
0x08  int32     entry count
0x0C  records   entry count records of 0x28 bytes
0x2C  int32     first payload offset, also the first record's offset field
```

Every record holds a NUL padded CP932 name in its first 0x20 bytes, the payload offset as a 32 bit
integer at +0x20 and the payload size at +0x24.

The index is validated before it is used: the count has to be plausible, the first payload offset must
equal `12 + count * 0x28`, each entry has to fit inside the file, every name has to contain something
other than whitespace.

## Port notes and deviations

- An empty name is treated as an invalid index, matching the reference's whitespace check.
- Signature `0` makes this format a candidate for every file; the structural checks above are the
  actual gate.
- Image decoding is out of scope, as is archive creation.

## References

- `GARbro/ArcFormats/Software House Parsley/ArcCG.cs` - `CgOpener.TryOpen`
