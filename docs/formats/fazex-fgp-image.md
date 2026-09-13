# FazeX ADV System image (FGP)

A thirty two bit image whose four channels are stored one after another rather than interleaved, with the alpha
channel inverted and the whole thing behind an LZSS stream. [011130][Malt] Emblem.

## Reference

| Element | Value |
| --- | --- |
| Tag | `FGP` |
| Class | `FgpFormat` (`Legacy/FazeX/ImageFGP.cs`) |
| Signature | `FAZEX_GRAPHIC_FILE` — the signature field is only `FAZE`, but the reader checks all sixteen bytes |
| Header | `0x1B` bytes |
| Extensions | None declared |

## Header

| Offset | Size | Meaning |
| --- | --- | --- |
| `0x00` | 16 | `FAZEX_GRAPHIC_FILE` |
| `0x13` | 4 | Width, at an unaligned offset in the middle of the bitmap header the format half reuses |
| `0x17` | 4 | Height, likewise |

The bit depth is always thirty two and is not stored.

## Decoding

The pixel data begins at `0x1B` and is one LZSS stream with GARbro's default framing — a frame of `0x1000` bytes
filled with zero and starting at `0xFEE`, with a set control bit meaning a literal. The stream holds four planes
of `width * height` bytes: blue, green and red, and then an alpha plane whose values are **inverted**, so a stored
zero is fully opaque. The planes become interleaved `BGRA` pixels, and the image is handed over flipped, which
makes the bitmap's height positive.

GARbro reads the planes with `Read` and does not check the result, so a stream that stops early leaves the
remaining channels zeroed instead of failing; the port does the same, and caps the decoded image at 256 MiB on
its own account.

## Process notes

Two things the port had to look up rather than assume:

* `ByteSignature.offset` is a `bigint`, and omitting it is how a signature at the start of the file is written;
* `writeBmp32` copies the pixels verbatim and only the header's height sign carries the row order, which is what
  a flipped reference image needs and why the test asserts a positive height rather than reversed rows.
