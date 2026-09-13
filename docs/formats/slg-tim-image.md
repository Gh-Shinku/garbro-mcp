# SLG system encrypted image (TIM)

A thousand and twenty four byte header with an image behind it, both keyed by one sequence from a small
congruential generator.

## Reference

| Element | Value |
| --- | --- |
| Tag | `TIM/SLG` |
| Class | `TimFormat` (`ArcFormats/Slg/ImageTIM.cs`) |
| Signature | None; the file's own extension is the gate |
| Extensions | `.tim` |

GARbro baseline `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License: an independent TypeScript rewrite based on
GARbro behavior.

## Header

The probe needs the file's own `.tim` extension and at least `1024` bytes. The seed is then folded from four bytes
spread through the header's first, unscrambled half:

```text
seed = byte[18] | byte[42] << 8 | byte[98] << 16 | byte[118] << 24
```

The second half — bytes `512` to `1023` — has the low byte of each draw subtracted from it, and the version string
is looked for in the result:

| Offset | Size | Meaning |
| --- | --- | --- |
| `0x2DE` | 18 | `TIM Data Ver 1.00` and a null |
| `0x248` | 4 | Width |
| `0x29C` | 4 | Height |
| `0x2BA` | 4 | Stored row size, signed |

Every image is twenty four bits, whatever the header might hold elsewhere. The reference does not check the
dimensions, the stride or the file's length against the fields it just read, so the port adds its own ceiling and
refuses a stride of zero or less before it allocates anything.

## The generator behind both keys

The reference's own `RandomGenerator` is the Microsoft C runtime's congruential step:

```text
state = state * 0x343FD + 0x269EC3     (thirty two bits)
draw  = state >> 16
```

Its `Seed` property hands back the **moved** state, not the seed it was given, and the header scrambling is what
moves it: five hundred and twelve draws go into the header, and the key table for the pixels is built from exactly
where those draws left the state. The port keeps one generator across both uses for that reason — reseeding it
before the table would produce a table that decrypts nothing. The table is `0x1000` bytes of low bytes and
repeats, so the pixel at offset `i` takes `table[i & 0xFFF]`.

The generator itself lives in `packages/codecs`, because the sibling encrypted PNG format from the same reference
file uses it too.

## Extraction

The pixels begin at `1024` and run for `stride * height` bytes, each with its key byte subtracted modulo two
hundred and fifty six. What the file does not hold is left blank, which is what the reference's own reader does
with a short read.

Stored rows may be wider than the pixels in them, and the extra bytes are dropped: the port repacks each row to
`width * 3` bytes and hands the result to the shared bitmap writer, which pads rows itself. The reference hands
this image over flipped, so the bitmap's height is positive and its rows are bottom up.
