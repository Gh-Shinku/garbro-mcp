# Pajamas Adventure System image (`EPA`)

Reference: GARbro `ArcFormats/Pajamas/ImageEPA.cs`, classes `EpaFormat` and its `Reader` (GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License). Implemented as
`packages/formats/src/pajamas/epa-image.ts`, registered as `pajamas-epa-image`.

Five kinds of pixel, each stored as one or more channels that a flag byte walks, and one of them also
carrying a colour map and a second channel for alpha.

## The header

| offset | field |
| --- | --- |
| 0 | `EP` followed by a byte the reference reads as the mode, so the two signatures differ in that byte |
| 4 | the colour type |
| 8 | the width |
| 12 | the height |
| 16 | a mode two file carries its own offset here |

A mode of two puts the picture's offset in front of the pixels, which moves the first channel from 0x10 to
0x18; the reference reads those two words after the header and the port reports them as `offsetX` and
`offsetY`.

## The colour types

| colour type | bytes to a pixel | bitmap written |
| --- | --- | --- |
| 0 | 1 | eight bits with a colour map |
| 1 | 3 | twenty four bits, the channels stored as planes |
| 2 | 4 | thirty two bits, the channels stored as planes |
| 3 | 2 | sixteen bits, the two channels woven together |
| 4 | 1 | thirty two bits: a colour map index with a second channel for alpha |

Any other colour type is refused, as the reference's own `default` arm does. The two one-byte kinds read a
colour map first: 256 entries of three bytes, `PaletteFormat.Bgr`, which a bitmap needs as four byte quads,
so the port pads each entry.

## The channel walk

Every channel is a sequence of a flag byte and what it asks for:

* a flag whose high nibble is clear is a literal run of `flag` bytes, so at most fifteen at a time;
* any other flag is a back reference. Its **high nibble** indexes a table of sixteen distances that the
  reference builds from the width, and its count is `flag & 7`, or `next byte + ((flag & 7) << 8)` when bit
  three is set.

The distance table is worth writing down, since every reference is measured against it and the small
entries are not monotone:

| index | distance | index | distance |
| --- | --- | --- | --- |
| 0 | 0 | 8 | `(width + 1) * 2` |
| 1 | 1 | 9 | `width + 2` |
| 2 | `width` | 10 | `width * 2 + 1` |
| 3 | `width + 1` | 11 | `width * 2 - 1` |
| 4 | 2 | 12 | `(width - 1) * 2` |
| 5 | `width - 1` | 13 | `width - 2` |
| 6 | `width * 2` | 14 | `width * 3` |
| 7 | 3 | 15 | 4 |

A reference is copied with the overlapping rule the engine's other unpackers use, so a distance of one
repeats the byte that was just written.

The alpha colour type reads a second channel of the same size, continuing where the first left off, and
weaves the two with the colour map into four byte pixels. The three and four byte kinds store their
channels as separate planes, which the port interleaves; the two byte kind instead weaves its two channels
with the reference's own expression, whose shift binds tighter than its ors.

## Deviations from the reference

* Every read is bounded and a stream that ends inside a run raises a `GarbroError`; the reference lets the
  stream throw.
* A flag that asks for an empty back reference is refused. The reference reads nothing and advances
  neither its output nor its stream, so it would read that stream to its end.
* A literal run of zero bytes is walked past, as the reference does, since its own loop advances the stream
  even when it writes nothing.
* A back reference that would leave the channel stops the channel, leaving the rest of it clear, which is
  what the reference's own `break` does.

## Verification

Twelve fixtures in `tests/formats/pajamas-epa-image.test.ts` cover the header and its rejections, the mode
two offsets, the five colour types, the distance table read against the reference, literal runs, a short
reference, a long one, a reference that does not fit, an empty one, a zero literal run, the eight bit
picture with its colour map, the planar three byte kind, the woven two byte kind, the alpha colour type,
a picture missing its colour map, and detection, listing and extraction through the registered format.

The woven two byte expectation is computed from the reference's expression by hand — with the channel bytes
`0x0f` and `0xe0` it gives `0x1c` and `0x39` — which is what corrected a first reading of it that took
`(c1 >> 1) & 0x1c` for a non-zero term.
