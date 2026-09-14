# Kurumi encrypted image (GRA/KURUMI)

Reference: `GARbro/Legacy/Kurumi/ImageGRA.cs`, class `GraFormat` — the encrypted picture, **not** the `GRA/VS`
format of the same file name under `ArcFormats/Kurumi`, which is ported separately as
`kurumi-gra-image`. (GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT.)

Implementation: `packages/formats/src/kurumi/gra-legacy-image.ts` (`kurumiGraLegacyImageDescriptor`,
kurumiGraLegacyImageFormat`, id `kurumi-gra-legacy-image`).

A picture the whole of which is behind a cipher: a header of twenty bytes whose width and height are hidden by
it, and then two bytes per pixel.

## The cipher

A congruential sequence, seeded with `34567`, whose **second byte** is the keystream:

```text
key = (seed >> 8) & 0xFF
seed = 5 * seed - 1        // an unchecked thirty-two bit multiplication
```

The reference's reader walks the file with this and **subtracts** each key byte, which is the same as the file
being the plaintext with the keys **added**. The multiplication is an unchecked `int` one, so the sequence wraps
around and its whole long trail depends on that; the port keeps the wrapping with `Math.imul`.

The word the reference finds its files by, `0xEE2FA397`, is what the cipher makes of the plaintext word `0x10`
that its reader expects to find behind it — so the file's own bytes and the plaintext behind them are two checks
of the same thing, made in the two places the reference makes them. The port checks both; they cannot disagree,
but they are what the reference does.

## The header

| offset | field |
|---|---|
| 0 | `0x10`, behind the cipher |
| 12 | x offset, signed |
| 14 | y offset, signed |
| 16 | width |
| 18 | height |

The depth is sixteen bits, five to a channel, whatever the file says — the reference declares it rather than
reading it.

## The pixels

Every two bytes behind the cipher carry fifteen bits of a pixel, woven so that a **gap** is left between the
lowest two bits and the rest:

```text
byte0 = ((p1 >> 2) & 0x1F) | (p0 & 0xE0)
byte1 = ((p0 & 0x1F) << 2) | (p1 & 3)
```

The port keeps the weaving as it stands. The pair is written as it is, so the bitmap's little endian word takes
the first byte as its low half.

A stream that ends in the middle of a pixel stops with an error, which is what the reference's own reads do: it
walks a counter over the pixels and takes every byte straight out of the file.

The picture is built with `ImageData.Create`, which stores its rows top down; the port writes a bitmap with a
**negative height** at the same place, naming the five-bit masks the reference's own five-bit pixels ask for.

The tests cover the word against the cipher's own first steps, the weaving of a fifteen bit pixel, the offsets
the header carries, the padding of a row of an odd number of pixels, the sequence held to thirty-two bits over a
picture whose bytes run far past its first wrap — checked against a second writing of the cipher in `BigInt`
arithmetic — and a stream that ends in the middle of a pixel.
