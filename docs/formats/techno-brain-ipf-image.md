# TechnoBrain Inteligent Picture Format (`IPF`)

Reference: GARbro `ArcFormats/TechnoBrain/ImageIPF.cs`, class `IpfFormat` with the `IpfReader` that unpacks
through it (GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License). Implemented as
`packages/formats/src/techno-brain/ipf-image.ts`, registered as `techno-brain-ipf-image`.

## The header

The file opens with **`RIFF`**, which the reference deliberately leaves out of its signature so that it is not
offered every wave file as well: what tells an IPF apart is the `fmt ` chunk at 0x0C and the string that chunk
carries. That string, read as eight bytes at 0x1C, must be `IPF fmt `, and the four byte word behind it says
whether a bitmap follows at all; another says whether a palette comes first.

The chunks behind the format chunk are found **twenty bytes past the end of that chunk** — the reference reads
the first twenty bytes of the file and then reads `0x14 + fmt_size` more from there, and the port keeps the
place that lands on rather than the chunk's own end, because that is where the palette and the bitmap are.

## The palette

Read four bytes into the palette chunk, a bitmap of thirty two bytes says which of the two hundred and fifty
six colours are stored, **the highest bit of each byte first**. Every stored colour takes three bytes of red,
green and blue. The first ten colours and the last nine are never stored, and every colour the file does not
carry stands as black. A stored colour beyond the last one still takes its three bytes, which is how the
reference walks the data.

## The bitmap

After the palette comes the `bmp ` chunk: its dimensions, a word, the two places the picture hangs at, six
bytes, and then a byte whose lowest bit says whether the pixels are packed. The pixels themselves begin
0x20 bytes into the chunk. A picture with no palette is shown in **one byte of grey each**, climbing from
nothing to white.

The packed walk, which the reference calls `IPF_12`, is driven by a control byte:

| control | what follows |
| --- | --- |
| `0xF` | the end of the picture; whatever is left of it stands as it was |
| `0xE` | the escape byte itself, stored as it stands |
| below `0x10` | a run of one byte, its length twelve bits wide and **one longer** than the number written, then the byte to fill with |
| below `0x20` | a copy of one to two hundred and fifty six bytes from one to four thousand and ninety six back |
| anything else | the byte itself, sixteen below its own value |

## Deviations from the reference

* A run that would outgrow the picture, a copy that reaches before its start, a packed stream that stops
  inside a control byte, and an uncompressed body that is short are all refused with `INVALID_ARCHIVE`,
  where the reference writes past its own array.
* The format string, the presence of the bitmap, the format chunk of at least 0x24 bytes, the palette chunk
  when the header claims one, its size of at least 0x24 bytes, the `bmp ` chunk and its size of at least
  0x1C bytes are all required, as the reference requires them.
* A picture larger than 256 MiB is refused rather than allocated.

## Verification

Seven fixtures in `tests/formats/techno-brain-ipf-image.test.ts` cover a picture with no palette and the grey
ramp it is shown in, a palette whose colours land at the indices the presence bitmap names while the ones
below the tenth and beyond the last stay black, a packed picture exercising every control byte, a run whose
length needs both halves of its twelve bits, the listing and its metadata, the header shapes that are turned
away including the wave file the format string is there to exclude, and the streams whose pixels do not hold.
