# Pochette bitmap container

Reference: `GARbro/Legacy/Pochette/ImageGDT.cs`, classes `GdtFormat` and `GdtMetaData` (Pochette bitmap
container). GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/pochette/gdt-image.ts` (`pochetteGdtImageDescriptor`,
`pochetteGdtImageFormat`, id `pochette-gdt-image`).

The reference registers **no** signature, so every file that reaches it is tried against the header walk: a
container head of sixteen bytes, then a Windows bitmap.

| offset | field |
|---|---|
| 0 | the place of the picture in its base, across |
| 2 | the same, down |
| 8 | the length of the name of a base picture, which has to be seven or nothing |
| 9 | that name, seven bytes at most |
| 16 | the bitmap itself |

The measurements of the entry are the measurements of that bitmap, and the two offsets and the name of the base
are carried along with them.

## Drawing the picture over its base

When the container names a base, the reference looks for that file **beside the one being read** — first under
the name it holds, and then with the extension of the format — and, if it is there, reads it as a container of
its own and copies this picture into the base's bitmap at the place the offsets name. The base becomes a bitmap
of thirty two bits to a pixel when its own depth is smaller than twenty four, and the picture follows the base's
format.

A base that is not there, or whose own header is not one, leaves the picture as it stands. A picture that does
not fit inside its base is `INVALID_ARCHIVE`; the reference writes past the end of its canvas there, which is
not something a port can do.

Two differences are worth naming: the entry reports the measurements of the **picture**, while the bitmap handed
back is the **base's** size whenever a base is drawn over, and the reference copies whole rows using the canvas's
own stride, which skews a twenty four bit base whose width is not a multiple of four; this port copies pixels
row by row.

Nothing here writes the format: `GdtFormat.Write` is not implemented in the reference either.

The tests cover the header walk and the two lengths a name may declare, the measurements and the name of the
entry, a container with no base at all, a picture drawn over its base at the place it names, the base found
under the extension of the format, a base that is not there, a base of thirty two bits that keeps its depth, and
a picture that does not fit over its base.
