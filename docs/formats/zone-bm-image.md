# Zone compressed image

Reference: `GARbro/Legacy/Zone/ImageBM_.cs`, classes `Bm_Format` and `Bm_MetaData` (Zone compressed image).
GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/zone/bm-image.ts` (`zoneBmImageDescriptor`, `zoneBmImageFormat`, id
`zone-bm-image`, `readBmLayout`).

The format has no word of its own: the reference hands it a file only when its **name** ends with `.bm_`, and
tells the two kinds of picture it holds apart by the first long word of the header, which is zero for pixels
kept as they are and one for pixels kept as runs.

| Offset | Meaning                                            |
| ------ | -------------------------------------------------- |
| 0      | the kind of the picture, a long                    |
| 4      | the width, a long                                  |
| 8      | the height, a long                                 |
| 0x18   | two hundred and fifty six colours, four bytes each |
| 0x418  | the byte the runs are written with                 |
| 0x424  | the pixels, or the runs                            |

Every picture is eight bits to a pixel. Where the reference asks for the extension `bm_`, the port asks for it
in its `detect` as well, so a picture under any other name is left alone; opening it by name still works.

## The pixels

A picture kept as pixels is read from the bottom row up, and the reference hands it out the other way up. A
picture kept as runs is read from the top row down, and its runs are read a byte at a time:

* a byte that is not the one the runs are written with **is** a pixel of its own;
* the byte the runs are written with followed by **zero** stands for that very byte;
* otherwise the byte behind it is the length of a run, a length that begins with ones carrying on in the bytes
  behind them, of which the **last** one is followed by a byte the run leaves behind.

The length of a run is therefore `0x100` for every one in front of it, plus the byte that ends them, so a run
that begins with a one and ends with a zero is two hundred and fifty six bytes long.

Nothing here writes the format: `Bm_Format.Write` is not implemented in the reference either. Where the
reference writes past the picture it built, the port refuses the file with `INVALID_ARCHIVE`, as it does for a
stream that ends inside a run, a picture cut short of its pixels, and a file with no colour map. A picture of
no width or no height is refused with `UNSUPPORTED_FEATURE` and one larger than 256 MB with `LIMIT_EXCEEDED`.

The tests cover the name the format is found by, the byte the runs are written with, a picture kept as pixels
and turned the right way up, one kept as runs and its pixels, the escape and the lengths a run can carry, a run
reaching past its picture, a stream ending inside a run, a picture cut short of its pixels, and one of nothing.
