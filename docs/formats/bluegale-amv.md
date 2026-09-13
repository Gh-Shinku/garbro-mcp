# BlueGale AMPV animation format

## Reference and attribution

- GARBro reference: `ArcFormats/BlueGale/VideoAMV.cs`, class `AmvOpener`
- Shared payload decoder: `ZbmFormat.Unpack` in `ArcFormats/BlueGale/ImageZBM.cs`
- GARBro tag: `AMPV`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The `ampV` signature is followed by a version word that must be one. The header carries a frame-sized unpacked size at
0x16, the frame geometry at 0x1A and 0x1E, and a frame count at 0x2A. Frames begin at 0x32 and consist of a 32-bit
stored size followed by that many bytes of compressed image data; the walk advances by the size field plus the frame
size, and every frame must pass the placement check.

Frames are named `<base>#<index>.bmp` with a four-digit index, typed as images, and all share the same unpacked size —
the header's unpacked size plus one 0x36-byte bitmap header, which is what the synthesized bitmap reports as its total
length. The frame geometry is exposed through the entry metadata.

## Extraction

Each frame is decoded with the shared ZBM decoder into a buffer the size of one bitmap, starting behind the file header
at offset 0x0E. The decoder consumes a most-significant-bit-first stream whose first bit is discarded: an eight-bit
token above 0x7F introduces a match whose length is the token's low seven bits and whose distance follows in ten bits, a
zero token ends the stream, and anything else is a literal run of that many bytes. Matches expand byte by byte, so they
may overlap the output position.

The reference then writes the bitmap file header: the `BM` marker, the total buffer length at offset two, and the info
header size at offset ten — read back from the decoded data at 0x0E and increased by 0x0E, which is why the header is
patched after the body is in place. The synthesized bitmap is always the full buffer, so the reported size is exact.

## Support

| Capability | Status |
| --- | --- |
| `ampV` signature with the version check | Supported |
| Frame-sized unpacked size and frame geometry | Supported |
| Frame count and frame walk | Supported |
| ZBM compressed frames | Supported |
| Bitmap header synthesis | Supported |
| `<base>#<index>.bmp` naming | Supported |
| Image typing | Supported |
| Entry placement validation | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover literal ZBM decoding, the obfuscated first-hundred-bytes inversion, a frame with a synthesized
bitmap, a foreign signature, a version other than one and an out-of-range frame.
