# Ai5 engine stored image mask (MSK/G16)

Reference: `GARbro/ArcFormats/elf/ImageG24.cs`, class `Msk16Format` (GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/elf/g24-image.ts` (`ai5Msk16ImageDescriptor`, `ai5Msk16ImageFormat`, id
`ai5-msk16-image`).

A mask of eight levels, stored rather than compressed: four bytes of measurements and **one byte per pixel**.

| offset | field |
|---|---|
| 0 | width, signed |
| 2 | height, signed |
| 4 | the pixels, one byte each |

The reference reads its measurements from a file of any name and then asks for the extension `msk`, so a mask of
another name is none of its own however well it holds together. Both measurements have to lie between one and
four thousand and ninety six, and the file's own length has to be **exactly** the pixels and those four bytes —
one byte more or less is one too many or too few.

The mask carries no position of its own, which is the difference the reference's measurements show against the
two other masks of this engine.

## The levels

The eight levels of the mask are scaled to the two hundred and fifty six of a grey bitmap in **whole numbers**:

```text
level = pixel * 0xFF / 8
```

The reference computes that in a whole number and then casts the result to a byte, so a level above the eighth —
which a mask should never carry — **wraps around** instead of reaching white: a level of nine becomes thirty
rather than two hundred and eighty six. The port keeps the wrap, and a test pins it.

The picture is built with `ImageData.Create`, which keeps its rows top down; the port writes a bitmap with a
**negative height** at the same place, of eight bits with the palette of grey levels that `PixelFormats.Gray8`
stands for, padding its rows itself.

The tests cover the extension, the exact length the file has to have, the wrap of a level above the eighth, and
the row padding of a bitmap.
