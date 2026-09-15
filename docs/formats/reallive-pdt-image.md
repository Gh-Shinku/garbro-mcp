# AVG32 engine image

Reference: `GARbro/ArcFormats/RealLive/ImagePDT.cs`, classes `PdtFormat`, `PdtMetaData` and `PdtReader`
(AVG32 engine image format). GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/reallive/pdt-image.ts` (`reallivePdtImageDescriptor`,
`reallivePdtImageFormat`, id `reallive-pdt-image`, `readPdtLayout`).

A file carries the four bytes `PDT1`, of which the fourth is a **digit** naming the version of the picture
behind it: `0` for the plain one and `1` for the one with a colour map. Any other digit declines the file,
which is what the reference does when the digit it reads is not a version it knows. The measurements and the
place of the transparency follow in a thirty two byte header:

| Offset | Meaning                                    |
| ------ | ------------------------------------------ |
| 4      | the version, a digit                       |
| 0xC    | the width, a long                          |
| 0x10   | the height, a long                         |
| 0x1C   | the place the transparency is stored at    |

The pixels are read from offset `0x20` on. What the reference hands out depends on the header rather than on
the version alone: a picture with transparency is thirty two bits to a pixel, a picture without one is eight
bits to a pixel when its version is one, and thirty two bits otherwise. A version one picture carries its
colour map either way, so its place moves on by the map even when the map is not used.

Nothing here writes the format: `PdtFormat.Write` is not implemented in the reference either.

## The plain picture

The stream of a plain picture carries a pixel either as three bytes of its own or as a run repeating what the
picture already holds, and the two are told apart a bit at a time from a control byte read **from its highest
bit down**. A run names its length and the place it repeats from in one word, both counted in pixels less
one; the place is a distance back from where the picture is being written. Every pixel takes **four** bytes,
so the fourth byte of a pixel the stream carries stays zero until the transparency of the picture is filled
in behind it.

The transparency is a second stream at the place the header names, read a byte to a pixel: a set bit reads a
byte, a clear bit names a run two bytes long — the length and the place, both counted from one.

## The picture with a colour map

A version one picture opens with a colour map of two hundred and fifty six entries of four bytes, and a table
of **sixteen** places, four bytes each. Its stream works like the transparency's, a bit at a time, but the
places its runs name are not distances: they are the places the table holds, and a run that names a place the
picture has not reached yet **skips** the bytes between them, leaving them at zero.

The transparency of this version is carried by the stream itself, as the fourth byte of a pixel. A picture
with transparency is handed out thirty two bits to a pixel and its colour map is left alone.

The reference reads the transparency stream of a version one picture as well and then drops it, because the
stream it has already unpacked carries the transparency. The port keeps that read, so a picture whose
transparency cannot be read is refused.

Where the reference writes outside the picture it built — a run reaching back before its start, a run past its
end, a stream that ends inside a pixel or a run — the port refuses the file with `INVALID_ARCHIVE`. A picture
larger than 256 MB is refused with `LIMIT_EXCEEDED`, and a picture of no width or no height is refused with
`UNSUPPORTED_FEATURE`.

The tests cover the digit, the header and its name, a plain picture of pixels the stream carries, a run
repeating what the picture holds, the transparency of a plain picture, a run reaching before its picture, a
picture with a colour map and one with transparency as well, a run counted back from a place in the table, a
run naming a place the picture has not reached, a run reaching outside the transparency, a picture with no
colour map behind its header, a stream ending inside a pixel, and a picture of nothing.
