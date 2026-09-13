# Mina audio archive (PAK/MINA/WAV)

## Reference and attribution

- GARbro reference: `Legacy/Mina/ArcPAK.cs`, class `WavPakOpener`
- GARbro tag: `PAK/MINA/WAV`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Detection

The archive has to carry a `.PAK` extension. A NUL terminator is searched for between offset four and
`0x14`, and the four bytes before it have to spell `.WAV`.

## Layout

Entries are laid out back to back with no index.

```
+0    uint32  payload size
+4    char[]  name, NUL terminated, at most 16 characters
+len   uint32  format chunk size, at least 0x10
+next  byte[]  format chunk
       byte[]  payload
```

The format chunk size word is the start of the entry, whose size covers that word, the format chunk and
the payload. Both sizes have to stay inside the archive.

## Extraction

Extraction rebuilds a RIFF container around the stored format chunk, so the format chunk keeps its own
size and the payload becomes the `data` chunk. The RIFF size field is written as the index size plus
`0x10`, which is what the total minus eight bytes works out to. The extraction is longer than the stored
entry, so entries report an unknown size until they are decoded.

## Port notes and deviations

- Archive creation is out of scope.

## References

- `GARbro/Legacy/Mina/ArcPAK.cs` - `WavPakOpener.TryOpen`, `WavPakOpener.OpenEntry`
