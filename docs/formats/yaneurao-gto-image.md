# Yaneurao obfuscated bitmap (GTO)

A whole bitmap with a single key subtracted from every byte, which is why its marker reads `NY`: adding the key
back turns those two bytes into `BM`.

## Reference

| Element | Value |
| --- | --- |
| Tag | `GTO` |
| Class | `GtoFormat` (`Legacy/Yaneurao/ImageGTO.cs`) |
| Signature | None; the reader asks for `NY` and then for a bitmap behind it |
| Extensions | None declared |

GARbro baseline `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License: an independent TypeScript rewrite based on
GARbro behavior.

## The key

The reference wraps the file in its own `SubFilterStream`, whose key is `0x0C` and which **subtracts** that value
from every byte it hands out, wrapping around as a byte does. `BM` (0x42, 0x4D) therefore reads as `NY` (0x4E,
0x59) until the key comes off, and the marker is nothing more than the first two bytes of a keyed bitmap. The port
does the same subtraction over the whole file once.

## Detection and contents

The reader asks for two bytes and compares them with `NY`, and then, with the position back at the start, it decodes
the file and lets the bitmap reader have a look at the header. A file that carries the marker but no bitmap behind
it is **not** this format, so the probe runs the shared bitmap header reader over the decoded bytes rather than
trusting the marker alone.

Everything else comes from the bitmap: the width, the height and the depth of its DIB header, in the same way the
Regrips readers work (see `regrips-prg-image.md` and `regrips-brg-image.md`, which likewise decode and pass the
result through). Only the header is read during detection, so a bitmap that is cut short still detects, still
lists, and is handed over as truncated as it was found.

This port's screenshot is the same one the shared bitmap reader gives every format: a header whose own size word is
zero, or a DIB header older than forty bytes, is refused here while the reference tolerates it.
