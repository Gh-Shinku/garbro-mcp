# Mina bitmap archive (PAK/MINA/BMP)

## Reference and attribution

- GARbro reference: `Legacy/Mina/ArcPAK.cs`, class `BmpPakOpener`
- GARbro tag: `PAK/MINA/BMP`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Detection

The archive has to carry a `.PAK` extension. The first sixteen bytes are searched for a NUL terminator
with the constraint that the four bytes before it spell `.BMP`, which makes the header text double as the
first entry's name.

## Layout

Entries are laid out back to back with no index. Every entry is a NUL terminated name, five header bytes,
a payload size word and the payload.

```
+0            char[]  name, NUL terminated, at most 16 characters
+len(name) + 1 bytes[5]  entry header
+len(name) + 6 uint32    payload size
+len(name) + 10 byte[]   payload
```

An entry spans `size + 9` bytes: the five header bytes, the size word and the payload. Entries may not
leave the archive, and the walk ends exactly at the end of the file.

## Extraction

The nine byte header and the payload are returned verbatim. GARbro decodes the payload as a custom
bitmap; that image decoder is out of scope.

## References

- `GARbro/Legacy/Mina/ArcPAK.cs` - `BmpPakOpener.TryOpen`, `BmpPakOpener.OpenImage`
