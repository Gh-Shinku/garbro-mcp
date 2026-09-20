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
| `img_jpg` | a table of sections with a JPEG and, behind it, a fourth plane of its own |
| `img_wbp` | a WebP, which the reference itself does not decode |

The plain picture is unfolded exactly as the HG-2 reader unfolds its own — the same run walk over two zlib
streams and the same four planes with the step of every byte (see `cat-system-hg2-image.md`), which is why the
two share `hg-core.ts`. Its rows are stored **bottom up**, which is what `CreateFlipped` means.

This port reads a plain picture. The two sections whose own decoder the reference keeps in other formats are
throws `NotImplementedException` for the WebP section and would need the JPEG decoder for the other. The
write path throws `NotImplementedException`, so this is a read only format.

The tests cover the head, the two sections whose decoder is not carried, the fields the reader is turned away
for, a plain picture of two zlib streams, the refusal of the JPEG section, and a file that is not signed.
