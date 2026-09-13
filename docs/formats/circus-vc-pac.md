# Valkyrie Complex resource archive (PAC/VC)

## Reference and attribution

- GARbro reference: `ArcFormats/Circus/ArcValkyrieComplex.cs`, class `VcPacOpener`
- GARbro tag: `PAC/VC`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Detection

The first four bytes are the version word `01 00 00 00`, which GARbro declares as the format signature.
The opener itself does not verify those bytes, but the registry only offers the format as a candidate when
they match, so the port reproduces both behaviours.

The entry count at offset four has to be sane, the base offset at offset eight has to stay in front of the
file, and the size word at offset twelve has to equal the real file size exactly. Every entry has to stay
inside the file.

## Layout

```
+0x00 uint32  version, always 1
+0x04 int32   entry count
+0x08 uint32  base offset of the payload area
+0x0C uint32  file size
+0x10 byte[0x10] unused
+0x20 record[count]
```

A record is thirty eight bytes long, of which the trailing twenty bytes are unused by the reader:

```
+0x00 char[0x20] NUL terminated name, padded to the full field
+0x20 uint32     stored size
+0x24 uint32     stored offset, relative to the base offset
```

## Extraction

Entries are stored verbatim behind the base offset, so extraction reads the declared span from the
archive without any transformation.

## Port notes and deviations

- Archive creation is out of scope.
- The sibling `PAK/VC` archive of the same engine is implemented separately, with its own encrypted index
  and image decoder.

## References

- `GARbro/ArcFormats/Circus/ArcValkyrieComplex.cs` - `VcPacOpener.TryOpen`
