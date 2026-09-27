# Palette PGA image

Reference: `GARbro/ArcFormats/Palette/ImagePGA.cs`, class `PgaFormat extends PngFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/palette/pga-image.ts` (`pgaImageDescriptor`, `pgaImageFormat`, id
`palette-pga-image`).

A PNG whose first eleven bytes were rewritten:

| field | offset |
|---|---|
| tag `PGA` | 0 |
| the PNG's bytes 8 to 15, exclusive orred with `PGAECODE` | 3 |
| the image body, which is the PNG from byte 16 onward, untouched | 11 |

The reference reads eleven bytes into positions five to fifteen of a sixteen byte buffer, overwrites the first eight
of those with the PNG signature and exclusive orrs the last eight with the key. The three tag bytes it just read are
**discarded** — they exist only so that GARbro's own signature check has something to match — so the restored file is
the eight byte PNG signature, the eight restored bytes and the body from offset eleven.

`PgaFormat` extends `PngFormat` and its `Read` decodes the restored PNG into pixels, so this port decodes it as well:
`openEntry` hands out a **bitmap** (24 or 32 bits per place of the file) rather than the portable network graphic it
was built from, which is what the reference hands out. The decode uses the PNG reader this project carries
(`shared/png-image.ts`), which is covered by its own tests against Pillow written files.

## The signature is `PGAP` and not `PGA`

The reference declares `'PGAP'`, which looks wrong for a format whose tag is three characters until the byte after
the tag is read. That byte is the first byte of the `IHDR` chunk length exclusive orred with `P`, and the length is
13, so its top byte is zero: `0x00 ^ 'P' == 'P'`. The fourth byte is therefore always `P` for an image written by the
reference's own writer, and a test asserts the relation rather than the constant — it checks
`stored[3] === 0x00 ^ 0x50` on a fixture built the way that writer builds one.

## Notes

* The metadata names the **bitmap** the extraction writes (`image: "bmp"`, the depth of the decoded picture) and
  carries the depth of the stored PNG beside it as `storedBitsPerPixel`, which is what the reference's own metadata
  reports as the depth of the picture.
* Eleven stored bytes become a sixteen byte PNG header, so the extraction is longer than the source and `sizeKnown`
  is **false**. The entry is marked `encrypted` because the bytes after the tag are masked.
* Detection is the registered `PGAP` signature plus the reference's own check: bytes 3 to 10, restored with the key,
  must be an `IHDR` chunk length of 13 followed by `IHDR`. Flipping any bit of the key makes that unreadable, which a
  test shows. Detection reads the header alone; a body that no PNG reader can walk is turned away when the entry is
  extracted, which another test shows.
