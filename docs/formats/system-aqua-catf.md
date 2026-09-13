# SystemAQUA engine resource archives (DAT/CATF)

## Reference and attribution

- GARBro reference: `Legacy/SystemAqua/ArcDAT.cs`, class `DatOpener`
- GARBro tag: `DAT/CATF`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The archive is a flat list of payloads behind a small header. It carries the signature `CATF` and an index of
eight byte records at an offset the header declares, and payloads whose first word is `LZe4` are compressed with
the engine's own windowed LZ scheme.

## Layout

```
[u32 'CATF'] [u32 unused] [u32 index offset] [u32 unused] [i32 entry count]
[entry payloads]
[i32 stored size] [u32 offset]  (per entry, at the index offset)
```

The entry count must be sane and the index must start before the end of the file. Every record is checked
against the file size before it is listed. Names are not stored: the reference derives them from the archive
name, so each entry is called `<archive base>#<index padded to four digits>`.

## Payload types

Every payload's first word is probed to type the entry. When it is not `LZe4`, the word is passed to the
catalog's signature lookup, which appends an extension for the two signatures the port knows (Ogg and RIFF) and
a `.bmp` extension for a bitmap signature. When it is `LZe4` and the stored size is larger than the 0x40 byte
packed header, the entry is compressed:

```
[u32 'LZe4'] [u32 unused] [u32 unpacked size] [3 encrypted type bytes]
```

The type bytes are complemented and nibble swapped. `000` marks audio and leaves the name alone, `BMP` and
`WAV` set the entry type and append an extension, and `MID` only appends a `.mid` extension, all as in the
reference.

## Packed payloads

The decoder reads the compressed payload after the 0x40 byte header. A packed bitmap stores four extra words
before its pixels; the reference rebuilds a fifty-four byte bitmap header out of the complements of three of
them and starts the pixel decoder after them. The rebuilt header keeps only the fields the reference fills in:
the `BM` signature, the buffer length, the header sizes, the byte swapped width and height, the plane count,
the bits per pixel, the rotated image size, the resolution words and the two rotated palette counts.

The pixel decoder is most significant bit first over a sixteen kilobyte window that starts at position one and
holds zeroes before the first literal:

| Control bit | Meaning |
| --- | --- |
| 1 | One literal byte, which is also written to the window |
| 0 | A copy: a fourteen bit window offset, then a four bit length biased by three |

Copies read the window byte by byte and write back into it, so a copy may overlap the bytes it is producing.
The reference stops when the output is full or the control bit cannot be read, and returns a partially filled
buffer when the stream ends early.

## Port notes and deviations

- A copy that would leave the unpacked payload raises `INVALID_ARCHIVE`; the reference lets its array access
  throw in that case. A stream that simply ends early returns the buffer as far as it was filled, matching the
  reference.
- The catalog-wide signature lookup of `AutoEntry.DetectFileType` is not reproduced, so a payload whose
  signature the port does not know keeps its plain name. This matches the reference for unknown signatures.
- The reference reads the payload header through its view, which truncates reads that leave the file; the port
  bounds the same reads by the stored size it already validated.

## References

- `GARbro/Legacy/SystemAqua/ArcDAT.cs` - `DatOpener`, `DetectFileTypes`, `DecryptType`, `OpenEntry`, `LzUnpack`,
  `PrepareBmpHeader`
