# ADVIZ engine compressed image (BIZ/2)

One LZSS stream behind a two word header: a colour plane of three bytes a pixel and, when the stream holds one, an
alpha plane of the same size. [000225][Sorciere] Karei, [011012][Ange] Nyuunyuu.

## Reference

| Element | Value |
| --- | --- |
| Tag | `BIZ/2` |
| Class | `Biz2Format` (`Legacy/Adviz/ImageBIZ2.cs`) |
| Signature | `BIZ2` |
| Header | `8` bytes |
| Extensions | None declared |

## Header

| Offset | Size | Meaning |
| --- | --- | --- |
| `0x00` | 4 | `BIZ2` |
| `0x04` | 2 | Width |
| `0x06` | 2 | Height |

The depth is always twenty four and is not stored; the metadata reports twenty four bits whether or not the stream
carries an alpha plane.

## Decoding

The stream begins at `0x08` and is LZSS with GARbro's default framing — a `0x1000` byte frame filled with zero and
starting at `0xFEE`, with a set control bit meaning a literal. It inflates to the colour plane of `width * height * 3`
bytes and, when anything follows it, an alpha plane of **the same size**, because the reference peeks the stream and
then reads as many bytes as the colour plane holds.

Both planes must be whole. A stream that holds less colour than the image needs fails, and so does one that holds
less than a whole alpha plane once the colour plane is complete — a partial alpha plane is an error rather than a
short plane. Anything behind the two planes is ignored, as the reference never reads it.

The alpha is taken at the **colour plane's** pace: the loop reads `alpha[src]` while `src` steps three bytes at a
time, so only every third byte of the plane is used. That matches the reference's own comment that the alpha is
presumably grayscale, and the tests pin it with a plane whose other bytes are noise.

The pixels become `Bgr24` or, with alpha, `Bgra32`, handed over flipped, so the bitmap's height is positive.

## Process notes

The alpha branch of the port was first written with a stray empty slice on its output, which the tests would have
caught as an empty bitmap; it is worth noting because the mistake came from editing a long heredoc rather than the
format itself.
