# hcsystem OPF image

Reference: `GARbro/ArcFormats/HCSystem/ImageOPF.cs`, class `OpfFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/hcsystem/opf-image.ts` (`opfImageDescriptor`, `opfImageFormat`, id
`hcsystem-opf-image`).

| field | offset |
|---|---|
| signature `OPF ` | 0 |
| width (`u32`) | 4 |
| height (`u32`) | 8 |
| bits a pixel (`i32`) | 0xC |
| stride (`i32`) | 0x10 |
| data offset (`i32`) | 0x14 |
| data length (`i32`) | 0x18 |
| pixels | data offset |

## Two checks, and everything else left to the decoder

`ReadMetaData` reads six signed or unsigned words and rejects exactly two situations: a depth **above** thirty
two, and a data offset inside the header. That is all. The port keeps the same two and no others, which has
visible consequences a test pins:

* a depth of **sixteen** lists successfully and fails when the pixels are asked for, which is where the
  reference's `switch` throws;
* a **negative** depth does the same, because `BPP > 32` is false for it and the depth check is an upper bound
  rather than a set;
* a width or height of zero is accepted, since neither is looked at;
* a data length that reaches past the end of the file lists and then fails, because the reference reads the
  pixels with `ReadBytes` and throws when they are not all there.

## The stored stride is authoritative

The reference hands the pixels to `ImageData.Create` with the header's **stride**, so the buffer's row spacing
is whatever the file says rather than whatever the depth implies. The port follows that in two ways:

* when the stored stride equals the stride a bitmap of this width and depth would use, the rows are carried
  **verbatim** — the header plus the stored bytes, the PlanTech PAC rule — so padding a producer wrote survives
  into the output, which a test checks with marker bytes in the padding;
* when the stride is wider, the rows are copied out `width * depth / 8` bytes at a time and the writer adds its
  own padding, since that is what a bitmap source does when it is told a stride;
* when the stride is **narrower** than one row of pixels, the port throws, because a bitmap source of that shape
  cannot be built and the reference fails there too.

The last two are the interesting ones: the same file with the same pixels produces different bytes depending on
one header word.

## Notes

* The depth check at extraction names only twenty four and thirty two bits, matching the reference's `switch`;
  anything else is an unsupported colour depth rather than a corrupt file.
* A stored length smaller than `stride * height` fails, because the bitmap would read past the pixels; a test
  uses twelve stored bytes against a stride of eight and a height of two.
* The output is a top-down bitmap (`ImageData.Create`, so a negative height), and the entry is longer than the
  stored data because of the header it gains, so `sizeKnown` is false.
* `Write` throws `NotImplementedException` in the reference, so encoding is out of scope.
