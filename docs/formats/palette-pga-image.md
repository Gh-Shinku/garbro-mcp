# Palette PGA image

Reference: `GARbro/ArcFormats/Palette/ImagePGA.cs`, class `PgaFormat extends PngFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/palette/pga-image.ts` (`pgaImageDescriptor`, `pgaImageFormat`, id
`palette-pga-image`).

A PNG with its first eleven bytes rewritten:

| field | offset |
|---|---|
| tag `PGA` | 0 |
| the PNG's bytes 8 to 15, exclusive orred with `PGAECODE` | 3 |
| the image body, which is the PNG from byte 16 onward, untouched | 11 |

The reference reads eleven bytes into positions five to fifteen of a sixteen byte buffer, overwrites the first
eight of those with the PNG signature and exclusive orrs the last eight with the key. The three tag bytes it
just read are **discarded** — they exist only so that GARbro's own signature check has something to match — and
the reconstruction is the eight byte signature, the eight restored bytes and the body from offset eleven.

## Why the signature is `PGAP` and not `PGA`

The reference declares `'PGAP'`, which looks wrong for a format whose tag is three characters until the byte
after the tag is read. That byte is the first byte of the `IHDR` chunk length exclusive orred with `P`, and the
length is 13, so its top byte is zero: `0x00 ^ 'P' == 'P'`. The fourth byte is therefore always `P` for an
image written by the reference's own writer, and a test asserts the relation rather than the constant — it
checks `stored[3] === 0x00 ^ 0x50` on a fixture built the way that writer builds one.

## Notes

* Extraction is a **pass-through with a prefix restore**, like the Malie MGF reader: no PNG decoder is needed,
  and the tests compare the whole output with a structurally well formed PNG. Eleven stored bytes become a
  sixteen byte header, so the entry is five bytes longer than the source and `sizeKnown` is **false** — the
  opposite of MGF, where eight bytes replaced eight. The entry is marked `encrypted` because the bytes after the
  tag are masked.
* Detection is the registered `PGAP` signature plus the reference's own check: bytes 8 to 15, restored with the
  key, must be an `IHDR` chunk length of 13 followed by `IHDR`. Flipping any bit of the key makes that
  unreadable, which a test shows.
* Metadata carries the dimensions, the optional pixel depth (one channel for greys and palettes, two for grey
  with alpha, three for colour, four for colour with alpha) and names the obfuscation key. The reference
  declares no extensions and the port matches.
* A short file, a wrong tag and zero dimensions are declined, the last as a documented deviation.
* The reference can write, but only by encoding a PNG first; detection, listing and extraction are what the port
  implements.

## A process note

The same constant was used for two different lengths: the twenty six byte window needed to parse an `IHDR`, and
the sixteen byte PNG header the image is reassembled from. The extracted file came out ten bytes too long, which
the whole-output comparison caught immediately. The two sizes now have separate names, and the comment on each
says what it is for.
