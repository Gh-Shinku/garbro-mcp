# GSX engine picture (`K4`)

Reference: GARbro `Legacy/Gsx/ImageK4.cs`, class `K4Format` with the `K4Reader` that unpacks through it
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License). Implemented as
`packages/formats/src/gsx/k4-image.ts`, registered as `gsx-k4-image`.

## The two headers

The file opens with `K4` and two version bytes, and a first header carries the width, the height, the alpha
mode and the frame count that decide whether it is one of these at all. A **second header at 0x30 carries
what the reader really unpacks with** -- the width and height again, the bit depth, the flag that lets a
pixel stand as a difference, the place the alpha section begins and the length of the control plane. Where
the two headers disagree the second one wins, which is how the reference reads them.

## The control plane and the stream

Both are read **most significant bit first**. The control plane holds one bit to a step of the picture and
the stream holds the steps themselves; a control plane that ends leaves the rest of the picture as it was.

A bit of ones is a pixel:

* when the picture is not a difference one, a byte as it stands;
* otherwise a **nine bit step added to the byte one pixel behind it in the row above**, with the one both
  sides of a step count adding as well. The only guard is the start of the picture, so the first
  `pixel_size` bytes are stored whole and the bytes behind *those* take their "row above" from the first
  row itself -- the reference does not check that a row has begun, and neither does this port.

A bit of nothing is a run, and the bit behind it decides how its place and its length are written: a place
of fourteen bits and a length of four, three longer than the count, or a place of nine and a length of three,
two longer. A run **copies** its bytes out of the picture, and a place of *n* names the byte *n+1* behind the
one being written, so a run can take what it has just written.

In a difference picture a run is not copied but **rebuilt**: every byte of it is the byte it names, plus the
one above and to the right of that by the width of its own place, less the one above the byte itself. That
two dimension prediction reaches outside the picture easily, and the reference would throw where this port
refuses the picture.

## The rows and the alpha channel

The pixels are unpacked from the bottom row up, which the reference says with `CreateFlipped`. A picture with
no alpha section is handed over that way, and the bitmap written for it says so with a positive height.

With an alpha section the pixels are turned over while the alpha channel is joined to them, so that result is
from the top down and gets a bitmap with a negative height. Two modes are stored:

* `0xFF`: a place to a row, counted from the start of the section, and behind each place runs of a value and
  a count of pixels to hand it to. The value is **six bits scaled to eight** by `*0xFF/128`, and a value of
  nothing leaves the pixels it covers fully transparent.
* `0xFE`: one bit to a pixel, eight to a byte and the **lowest bit first**, where a set bit is opaque.

Any other mode is refused, as the reference refuses it.

## Deviations from the reference

* A bit depth other than twenty four or thirty two is refused, as is a picture larger than 256 MiB.
* A section whose range leaves the file, a control length below its own header or a negative one is refused.
* A run that reaches before the start of the picture, or a rebuilt run that reaches above it, is refused
  with `INVALID_ARCHIVE` where the reference's own copy or index would throw.
* A stream that has ended reads as ones, which is what the reference's cast writes down, and the control
  plane ending is the one thing that stops the unpacking.

## Verification

Twelve fixtures in `tests/formats/gsx-k4-image.test.ts` cover a picture without differences, the nine bit
step against a stored byte and its wrap at the end of one, both widths of run, a run that reaches into what
it has just written, a rebuilt run worked out by hand, both alpha modes with their scaling and bit order, the
bottom up and top down bitmaps with the height each records, the listing and its metadata, and the header
shapes, the unknown alpha mode and the runs that leave the picture that are turned away.
