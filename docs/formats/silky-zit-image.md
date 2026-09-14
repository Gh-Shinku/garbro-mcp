# Silky's image (ZIT)

Reference: `GARbro/ArcFormats/Silky/ImageZIT.cs`, class `ZitFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/silky/zit-image.ts` (`silkyZitImageDescriptor`,
`silkyZitImageFormat`, id `silky-zit-image`).

An image behind one of three words, each of which is the marker `ZT` followed by a **type** word:

| word | type | storage |
|---|---|---|
| `0x1803545A` | 0x1803 | three bytes a pixel, blue, green, red |
| `0x2084545A` | 0x2084 | four bytes a pixel, blue, green, red, alpha |
| `0x8803545A` | 0x8803 | a palette and one index byte a pixel |

The header is `0x10` bytes and holds the type at 2, a **colour count** at 4, the width at 8 and the height at 10;
the pixels start at `0x10`. The type is the same word the format is registered by, so the three words the
reference lists cover every type it can meet and its reader's own failure branch is unreachable.

Every kind describes the image as **thirty two** bits and builds a `Bgra32` bitmap, top down, with tight rows:

* the **three byte** kind reads blue, green and red and adds a full alpha, but a pixel of pure **green** — red and
  blue zero, green `0xFF` — is a colour **key** rather than a colour, and is replaced by the whole word `0xFFFF`,
  which puts blue and green with **no alpha at all**;
* the **four byte** kind copies its pixels straight across. The reference ignores how much its read returned, so
  a body that stops short leaves the pixels it did not reach as the buffer was allocated, and the entry's size is
  not known ahead the way it is for the other two kinds;
* the **palette** kind reads `colours × 3` bytes of blue, green and red triples and then one index byte a pixel,
  and meets the same green key — but writes the word `0xFF00` in its place, which is the green alone with no
  alpha, so the two kinds leave a transparent pixel in two different colours. Both words are reproduced as the
  reference writes them.

Deviations from the reference, all for input it would fail on anyway:

* a zero width or height is refused here;
* the three byte and palette kinds fail with a message of their own where the reference runs off the end of its
  stream, and a palette index that is not in the palette is refused rather than indexing outside the array.

The tests cover the three words and the missing extension, the type word that is registered by nothing, the
measurements with the type and colour count, an ordinary pixel beside the green key of the three byte kind, a
four byte body that stops short with its unknown size, the palette with its **different** key word, an index
outside the palette, a body that stops in the middle of a pixel, and the entry name.
