# BasiL image (NG3)

A twenty four bit image whose colours are stored as indices into a palette behind the header, written with two
kinds of run and a raw path that has no control byte at all.

## Reference

| Element | Value |
| --- | --- |
| Tag | `NG3` |
| Class | `Ng3Format` (`ArcFormats/Basil/ImageNG3.cs`) |
| Signature | `0x33474E`, three characters that the reference still compares as a whole word |
| Extensions | None declared |

GARbro baseline `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License: an independent TypeScript rewrite based on
GARbro behavior.

## Header

| Offset | Size | Meaning |
| --- | --- | --- |
| `0x00` | 4 | `NG3` and a null |
| `0x04` | 4 | Width |
| `0x08` | 4 | Height |

The signature is worth a note: GARbro reads the first four bytes of a file as one little endian word and compares
it with the format's constant, so a constant of `0x33474E` matches only a file whose fourth byte is **zero**. The
probe therefore asks for `NG3` and a null rather than for the three characters alone, and a file with anything else
behind them is some other format.

Nothing else in the header is checked, so a zero width or height describes an image the reader cannot produce; the
port refuses it there, which is where the reference fails.

## Palette and pixels

A palette of 256 blue, green, red triples sits directly behind the header, 768 bytes of it, and the pixel stream
follows. The reference fills a fresh buffer, so whatever the stream never reaches stays black.

Each token begins with a byte the reader **peeks** at, and the byte decides the token:

| First byte | Token |
| --- | --- |
| `0x01` | One palette colour: the index byte follows |
| `0x02` | A run: the index byte and a count byte follow |
| Anything else, or end of file | A raw triple that **starts with this byte** |

The last row of that table is the format's sharp edge. A raw triple has no control byte in front of it: the peeked
byte is the first colour byte itself, and the reader decides which case it is looking at by the byte's value alone.
A colour whose first byte happens to be `0x01` or `0x02` therefore cannot be stored raw, and the port reproduces
that, taking such a byte as a token instead. A stream that ends anywhere simply stops: the reader stops peeking,
the image keeps whatever it had, and a raw triple that is cut short leaves the bytes it never read black, since the
reference does not check how much of it arrived. A run that would leave the image, on the other hand, is an error
in the reference and in the port.

The reference hands this image over **flipped**, so the bitmap's height is positive and its rows are bottom up.
