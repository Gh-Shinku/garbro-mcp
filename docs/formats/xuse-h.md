# Xuse bitmap archives (H/Xuse)

## Reference and attribution

- GARbro reference: `ArcFormats/Xuse/ArcNT.cs`, class `HOpener`
- GARbro tag: `H/Xuse`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

```
[record] [record] ...
```

Like its sibling `BG/Xuse`, this format has no header: the file is a sequence of equally sized records and the
file name carries the only metadata there is. The name has to start with `H`, without regard to case, and the
file size has to divide by the record size without a remainder.

The record size is 0x25480, or 0x2A700 when the whole file name, extension included, ends with an uppercase
`W`. Because the reference compares the whole name, `H001W` selects the larger record while `H001W.DAT` does
not.

Records are named `NAME#0000`, `NAME#0001` and so on, and every entry is typed as an image.

## Port notes and deviations

- Image decoding, an indexed bitmap with an alpha plane and a palette, is out of scope, as is archive creation.

## References

- `GARbro/ArcFormats/Xuse/ArcNT.cs` - `HOpener.TryOpen`, `HOpener.OpenImage`, `HImageDecoder`
