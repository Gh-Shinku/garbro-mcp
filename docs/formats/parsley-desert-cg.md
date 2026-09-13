# Software House Parsley CG archive (CG/DESERT)

## Reference and attribution

- GARbro reference: `ArcFormats/Software House Parsley/ArcCG3.cs`, class `DesertCgOpener`
- GARbro tag: `CG/DESERT`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

```
0x00  int32     entry count
0x04  offsets   count uint32 offsets of the payloads
...   padding
...   payloads  each entry runs from its offset to the next one
```

The archive has to be called `CG`, compared only against its last path component, and it carries no
signature: the entry count and a strictly increasing offset table are the whole structure. An offset of zero
ends the table early, and every offset has to lie behind the table and inside the file. Entry sizes come from
the following offset, and the last listed entry runs to the end of the file. All entries are typed as images.

Names are optional. When a `DTime.exe` exists in the parent directory, the reference reads an array of 0x104
byte names from the virtual address 0x49E348 of that image, which the shared executable helper translates into
a file offset. Without usable names this port falls back to `CG#0000`, `CG#0001` and so on; the reference
instead raises a formatting exception, so the executable is effectively required there.

## Port notes and deviations

- Address translation covers 32-bit PE images only, matching `ExeFile.GetAddressOffset`. A 16-bit or 64-bit
  image simply loses the names instead of aborting the lookup.
- Empty names fall back to the generated form.
- Image decoding and archive creation are out of scope.

## References

- `GARbro/ArcFormats/Software House Parsley/ArcCG3.cs` - `DesertCgOpener.TryOpen`,
  `DesertCgOpener.LookupFileNameTable`
- `GARbro/ArcFormats/ExeFile.cs` - `ExeFile.GetAddressOffset`, `ExeFile.GetAddressSection`
