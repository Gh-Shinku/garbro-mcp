# HDL HOT image

Reference: `GARbro/Legacy/Hdl/ImageHOT.cs`, class `HotFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/hdl/hot-image.ts` (`hotImageDescriptor`, `hotImageFormat`, id
`hdl-hot-image`).

A fifteen bit image with a run length step, and the same `HOT` signature as the archive of the same name
(`hdl-hot`, from `Legacy/Hdl/ArcHOT.cs`, whose entries these images are):

| field | offset |
|---|---|
| signature `HOT` and a null | 0 |
| flag byte (bits 0 and 5 must be set) | 7 |
| width (`u16`) | 0x0C |
| height (`u16`) | 0x0E |
| run length stream | 0x20 |

`ReadMetaData` reads thirty two bytes and accepts the file when `(header[7] & 0x21) == 0x21`. The depth is
**fifteen**, not sixteen: the words are 555 with no sixth green bit, so the bitmap the port writes is a sixteen
bit bitmap whose masks say 555 (`0x7C00`, `0x03E0`, `0x001F`, a test reads them back) rather than 565.

## The stream and its three edges

A word whose top bit is clear is one pixel; a word whose top bit is set carries a colour in its low fifteen bits
and is followed by a byte saying how many pixels of that colour to write. Three details of the reference's loop
are preserved, and each has a test:

* the outer loop stops at the end of the image **or** at the end of the stream, so a file with two of its four
  pixels stored simply leaves the other two zero — no error, no padding rule;
* the inner repeat loop has no such check, so a run that would pass the end of the image throws, exactly as
  indexing the pixel array does in the reference. Note that a run starting when there is *no* room left cannot
  happen, because the outer loop guards it; the failure needs a run that begins inside the image and overruns
  it, which is why the test stores a literal and then four more pixels in a two by two image;
* the loop only asks whether **one** byte remains before reading a sixteen bit word, so a single trailing byte
  makes the read throw.

## Notes

* Detection is the registered `HOT` signature plus the reference's flag bit test, which the format re-checks
  itself: `0x20` alone, `0x01` alone, neither and `0x41` (bit 6 set instead of bit 5) are all declined, while
  `0x31` with the two required bits set is accepted.
* The signature is the reference's **four byte word** `0x00544F48`, so the marker is `HOT` followed by a null
  and the port compares all four bytes; a file whose fourth byte differs never reaches the format in GARbro.
* The entry is named after the source file with a `bmp` extension, covers the whole stored file and keeps
  `sizeKnown: false`; it is marked `compressed`. Metadata carries the dimensions and the fifteen bit depth, and
  the archive metadata names the `hot-rle` step. The reference declares no extensions and the port matches.
* A short file (under thirty two bytes), a wrong signature and zero dimensions are declined, the last as a
  documented deviation.
* `Write` throws `NotImplementedException` in the reference, so encoding is out of scope.

## A process note

The first version of the decoder started its walk at `0x20`, the pixel offset from the header, but the function
is handed the file **from** that offset, so the walk began past the end of a small stream and every test decoded
all zeros. The same class of mistake — keeping an absolute offset after rebasing a buffer — was made once before
in the opposite direction. The parameter is now documented as starting at the pixel data, and a comment says so
at the walk itself.
