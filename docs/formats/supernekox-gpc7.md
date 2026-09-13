# Super NekoX engine resource archive (GPC7)

## Reference and attribution

- GARbro reference: `ArcFormats/SuperNekoX/ArcGPC.cs`, class `GpcOpener`
- GARbro tag: `GPC7`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

```
0x00  bytes     'Gpc7'
0x04  int32     record count
0x08  uint32[]  one file offset per record
data            per entry: uint32 packed size, uint32 unpacked size, payload
```

The span of a record runs up to the next offset, or to the end of the file for the last one, and every
offset has to stay behind the offset table. Names are generated as `{base}#{index}` with a four digit record
number.

The per entry header selects the outer layer: a zero packed size means the payload is stored and the second
word is the stored length, otherwise the payload is compressed and the second word is its unpacked size.
Compressed payloads are unpacked with a byte oriented LZ that uses command bytes below `0x1D` for literal
runs, `0x1D` to `0x1F` for longer runs and everything above for matches selected by the two top bits of the
command byte.

Independently of that, a payload between five bytes and `0x10000` bytes whose four byte header declares
`packed size == stored size - 4` is unpacked a second time by an LZ77 layer: a control byte read most
significant bit first, a set bit marking a match whose two bytes hold a twelve bit offset in the high nibble
of the first byte and a count minus three in its low nibble.

Entry types are detected from the first four bytes of the unpacked payload: the two TGA header signatures are
typed as images and everything else goes through the shared signature table.

## Port notes and deviations

- The literal and match helpers of both codecs clamp to the output length and treat reads past the end of the
  stream as zeroes. The reference reads out of range or throws in those cases.
- Both codecs are specific to this format: their command and bit packing differ from GARbro's shared
  `LzssStream`, so they live with the format port instead of `@garbro-mcp/codecs`.
- Type detection covers the TGA signatures and the shared Ogg, RIFF and bitmap table; GARbro's catalog wide
  signature lookup is not reproduced, so other payloads stay untyped.
- The inner layer only applies when the declared packed size covers the whole remaining stream, matching the
  reference. Entries whose declared size is the stored size keep `sizeKnown` set, because the extracted size
  is either the stored size or the unpacked size recorded in one of the two headers.
- Archive creation is out of scope.

## References

- `GARbro/ArcFormats/SuperNekoX/ArcGPC.cs` - `GpcOpener.TryOpen`, `GpcOpener.OpenEntry`,
  `GpcOpener.DetectFileTypes`, `GpcOpener.UnpackEntry`, `GpcOpener.UnpackLz77`
