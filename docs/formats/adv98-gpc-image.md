# Adv98 engine picture (`GPC/PC98`)

Reference: GARbro `Legacy/Adv98/ImageGPC.cs`, class `GpcFormat` with the `GpcReader` that unpacks through it
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License). Implemented as
`packages/formats/src/adv98/gpc-image.ts`, registered as `adv98-gpc-image`.

## The header

The file opens with `PC98` and the engine's own name, `)GPCFILE   ` and a NUL, behind it. Then come the step
the rows of the packed picture are laid into the picture by, the place the palette stands at, and the place a
block stands at that carries the width, the height and the two places the picture hangs at. The picture is
**four bits a pixel in four planes**, which the reference states rather than reads.

## The packed walk

The packed picture is read in groups of eight bytes. A control byte, taken one bit at a time from its
highest, says of each group whether it is described at all: a bit of ones is followed by a command byte whose
own bits, again from the highest, say of each of the eight bytes whether it is stored, and a bit of nothing
leaves the whole group as nothing. A stream that ends leaves the rest of the picture as it was, which is how
the reference stops.

## The restore

Every row of the packed picture opens with **the step its own bytes are woven by**, and the bytes behind it
are then accumulated with an exclusive or along each of that many threads -- the first byte with itself, the
third with the first, and so on for every step's worth of threads. Every row behind the first is then
accumulated the same way with the row **above** it, byte for byte, over as many bytes as the reference rounds
down to a whole word. Since a row of this format is always one byte longer than a multiple of four, that
rounding never leaves a byte out; the reference writes it that way all the same.

## The weave

The four planes of a row are woven into pixels of four bits: a pair of pixels to a byte, the one from the
seventh bit of each plane in the high nibble and the one from the sixth in the low, and the pairs behind them
from the bits below those in turn. **The first plane is the lowest bit of a pixel and the fourth the
highest.** A byte of a plane becomes four bytes of the picture, eight pixels.

The rows of the packed picture land `interleaving` rows apart in the picture, and a walk that runs past the
end of the picture starts again **one row further down** rather than wrapping by arithmetic -- which is what
the reference does, and what the port copies.

## Deviations from the reference

* A group whose command byte promises more bytes than the picture holds, a stream that ends inside a group,
  and a palette whose size is not two bytes an entry or which names no colour or more than sixteen are all
  refused with `INVALID_ARCHIVE`, where the reference lets its own array accesses throw.
* A picture larger than 256 MiB, and a header whose places lie outside the file, are refused.
* The palette colours are four bits to a part, which the reference widens by seventeen; a bitmap keeps
  sixteen of them, blue first.

## Verification

Six fixtures in `tests/formats/adv98-gpc-image.test.ts` cover the four planes woven into pixels with the
values worked out by hand from the reference's own expressions, the threads of a row, the accumulate of a row
with the one above it, the listing and its metadata, the header shapes that are turned away, and a group that
stores more than the picture holds.

**Not pinned down yet**: the row step and the wrap it takes when it runs past the picture. The reference's own
wrap is copied faithfully -- its placement is the one the port reproduces -- but no fixture here fixes the
bytes that land in each row of the picture once the step is not one, so that part stands on the reference
alone.
