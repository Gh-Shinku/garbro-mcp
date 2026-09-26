# CatSystem engine HG-3 image format

Reference: `GARbro/ArcFormats/CatSystem/ImageHG3.cs`, classes `Hg3Format`, `HgMetaData` and `Hg3Reader` with
the reader it shares with HG-2, `HgReader`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/cat-system/hg3-image.ts` (`catSystemHg3ImageDescriptor`,
`catSystemHg3ImageFormat`, id `cat-system-hg3-image`, `readHg3Layout`, `unpackHg3Plain`) with the shared
reader in `packages/formats/src/cat-system/hg-core.ts`.

## The head

Behind the mark `HG-3` stands the word `0x0C` at four and the mark `stdinfo` at `0x14`; the head size stands
as a word at `0x1C`, the width and the height at `0x24` and `0x28`, the depth at `0x2C`, the offsets behind
it, and the canvas at `0x44` and `0x48`. The stream of the reader runs from the `stdinfo` mark, so every place
inside it is measured from there.

## The section

The head size past the `stdinfo` mark begins a section that names one of three kinds of picture:

| section | what it holds |
| --- | --- |
| `img0000` | two zlib streams: the packed and the unpacked size of the data at `0x18` and `0x1C`, and of the control bits at `0x20` and `0x24`, with the streams themselves `0x28` in |
| `img_jpg` | a JPEG whose length stands twelve bytes into the section, and, in the sections behind it, an alpha channel and a flag that swaps the first and the third byte of every pixel |
| `img_wbp` | a WebP, which the reference itself does not decode |

The plain picture is unfolded exactly as the HG-2 reader unfolds its own — the same run walk over two zlib
streams and the same four planes with the step of every byte (see `cat-system-hg2-image.md`), which is why the
two share `hg-core.ts`. Its rows are stored **bottom up**, which is what `CreateFlipped` means.

### A picture behind a JPEG

The sections of such a picture stand one behind the other from the head size on, every one of them named by
eight bytes that stop at the first nought, followed by the length of the section; the last one carries a
length of nought and ends the table. `UnpackJpeg` looks up `img_jpg`, reads the length of the JPEG twelve
bytes into that section, and hands the JPEG behind it to the platform's decoder. The fourth byte of every
pixel comes from the section `img_al`, a zlib stream whose packed and unpacked lengths stand at `0x10` and
`0x14` and whose bytes follow at `0x18`, or is `0xFF` where that section stands absent; a section `imgmode`
swaps the first and the third byte of every pixel.

This port decodes the JPEG with its own reader of the JPEG interchange format. It reads the frame with the row
length of the head of the picture, exactly as the reference does through `CopyPixels`, so a frame larger than
the head keeps the places of the picture itself alone, and it refuses a frame smaller than the head, where the
reference's copy would fail too. A frame of fewer than three samples a pixel, which the reference turns away,
is widened here instead, since the reader of this project hands out four bytes a pixel for every JPEG.

This port reads a plain picture and a picture behind a JPEG. The WebP section is recognised and listed, and
its extraction is refused with a message of this project's own; the reference itself throws
`NotImplementedException` for it. The write path throws `NotImplementedException`, so this is a read only
format.

The tests cover the head, the two kinds of section, the fields the reader is turned away for, a plain picture
of two zlib streams, a picture behind a JPEG with its alpha channel and with the swap of its colours, the
refusal of a section that holds no JPEG, the refusal of the WebP section, and a file that is not signed.
