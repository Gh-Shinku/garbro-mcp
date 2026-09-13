# Desire DES image

Reference: `GARbro/Legacy/Desire/ImageDES.cs`, class `DesFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/desire/des-image.ts` (`desImageDescriptor`, `desImageFormat`, id
`desire-des-image`). The pixels are decoded by `packages/formats/src/system98/gra-reader.ts`, the shared
`GraBaseReader` port, which the System98 `G` format uses as well.

| field | offset |
|---|---|
| width (`u16`, big endian) | 0 |
| height (`u16`, big endian) | 2 |
| sixteen RGB triples | 4 |
| bit packed stream | 0x34 |

The header is a strict prefix of the System98 one — same big endian dimensions, same screen bounds, same
"width must be a multiple of eight" rule — but it sits at offset zero and there is **no minimum file
length**. That difference matters for failure timing: `ReadMetaData` here never looks past the dimensions,
so a four byte file is a valid candidate that lists, and the reference then throws from `ReadPalette` when
the sixteen colours are missing. A test asserts both halves of that split, at twenty bytes: the file lists,
and extraction rejects.

The port exposes the resource as a single entry:

* the pixels come from the shared decoder and are written as a **four bit palette bitmap** by `writeBmp4`,
  keeping the source depth and converting the RGB triples into BGRX entries. The decode check reuses the
  byte sequence the decoder's own unit tests trace from a zero stream, so the two suites pin the same output;
* `Read` uses `ImageData.Create`, so rows stay top down and the bitmap takes a **negative** height;
* the entry is named after the source file with a `bmp` extension, covers the whole stored file and keeps
  `sizeKnown: false` because a bitmap header is written around the pixels;
* entry metadata carries `type: "image"`, width, height and `bitsPerPixel: 4`; the archive metadata records
  `image: "bmp"`, the dimensions, the bit depth and `colors: 16`.

Declines, all tested: a file too short for the dimensions, a zero width or height, a width that is not a
multiple of eight, and dimensions past the 640 by 400 bounds. The reference declares no signature and an
extension list of one empty string, so the descriptor registers neither a signature nor an extension.

GARbro's `Write` throws `NotImplementedException`, so encoding and archive creation are out of scope.
