# Studio Ebisu EP1 resource archive

## Reference and attribution

- GARBro reference: `Legacy/StudioEbisu/ArcEP1.cs`, class `Ep1Opener`
- GARBro tag: `EP1`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The `EP1` signature starts the file and eight bytes later the record chain begins. There is no count and no terminator:
each record is a 0x30-byte header followed immediately by its payload, and the walk advances by the header plus the
payload size until it reaches the end of the file.

A header holds a 0x20-byte CP932 name, the image width and height, the compression method and the payload size. An empty
name rejects the archive, as does a payload that does not fit inside the file or a trailing header that does not fit
before the end of the file — the latter mirrors the bounds-checked reads the reference performs through its file view.

Records are typed as images and their metadata carries the width, height, compression method and the 32 bits per pixel
the reference assumes.

## Extraction

The archive layer emits each stored payload as a plain byte range, which is what the reference's base `OpenEntry` does.
Pixel decoding lives in the reference's `OpenImage`: it reads `width * height * 4` bytes as 32-bit BGRA rows, inflating
them with GARbro's LZSS stream — with a frame start of 0xFF0 — when the method is between four and seven and copying them
verbatim otherwise. That image-layer behaviour is not part of this port and is recorded as an unsupported capability.

## Support

| Capability | Status |
| --- | --- |
| `EP1` signature | Supported |
| Record chain walked to the end of the file | Supported |
| 0x30-byte headers with 0x20-byte CP932 names | Supported |
| Image width, height and method metadata | Supported |
| Payload size and placement validation | Supported |
| Image typing | Supported |
| Verbatim extraction | Supported |
| GUI bitmap decoding (32bpp BGRA rows, LZSS for methods 4–7) | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover a two-record chain, the image geometry metadata, a single-record archive, a foreign signature, a
nameless record, a payload that runs past the end of the file and a trailing header that does not fit.
