# AI5WIN engine image (`GCC`)

* Reference: `GARbro/ArcFormats/elf/ImageGCC.cs` (`GccFormat`, `GccFormat.Reader`)
* Port: `packages/formats/src/elf/gcc-image.ts`, record `elf-gcc-image`
* Tests: `tests/formats/elf-gcc-image.test.ts`

An image of the engine of AI5WIN, of the family of `G24` and `GPH`. The four walks of it stand of the words
of the head of the picture: `G24n`, `G24m`, `R24n` and `R24m`, of which the `m` stands of a picture of a mask
and the `G` and the `R` of the walk of the places of the colours of it.

## Layout

The file opens with the mark of the walk of the picture (four places), the places X and Y of it at 4 and 6
(two places each, of a signed count) and the width and height of it at 8 and 10. The places `0x0C` to `0x20`
of the head stand of the walks of a picture of a mask: the place of the walk of the alpha of it, the place
of the walk of the places of its colours of an `R24` picture, two words the walk of the colours reads and
lets stand, the width and height of the alpha of the picture and the place of the places of the alpha.

The walk of the places of the colours of a picture of no mask stands at `0x14`; of a picture of a mask at
`0x20`. The places of a picture of no mask stand of three places of the file to a place of the picture, of a
picture of a mask of four.

## The walk of the places of the colours

The walk of a picture of the walk of the LZSS engine stands of the words of the walk of `ImageG24`
(`ArcFormats/elf/ImageG24.cs`) themselves: the frame of `0x1000` places, the places of the file read of the
lowest place of a control place first, of a place of a colour of a place of the file.

The walk of an `R24` picture stands of a walk of its own. The bits of it stand at the place the head names
(0x14 of a picture of no mask, 0x20 of a picture of a mask), of the lowest place of a place of the file
first, and the places of the file the walk reads stand at the place behind the bits, named by the word at
0x10 of the file, counted from the same place of the head.

The walk stands of chunks of the places of the picture, of no more than `0xFFFF` places of the file to a
chunk. One place of the bits stands before every chunk:

* A place standing clear names a chunk of the places of the file itself: a place of the bits standing clear
  stands of three places of the file, one place of the three to a place of the pixel (`blue`, then `green`,
  then `red`); a place standing of one stands of a count of the pixels of a run of its own and then of the
  three places of a pixel the run stands of. The count of a run of the places of a chunk is a count of the
  pixels of it, so a place of the file beyond the places of the picture stands of the last run of it.
* A place standing of one names a chunk of the table of the walk itself, which stands of two runs of
  sixteen values of the places of the file, of which the one at the front of a run stands first.

The places of a chunk of the second kind stand of the count of the places of the file behind the runs of
sixteen: every place of the value of the file to a place of the chunk stands of a count of the places of the
file of it (of a place of the run behind it) or of a place of the file itself, and the counts of the places
of the file of a place of the run stand of the walk of a value of its own, of the value of the file behind
the place the walk stood at before, taken of the places of the count in either way.

The places of a chunk of the second kind stand of the places of the chunk alone: every place of the chunk
stands behind the place taking the place of the byte before it, and the place the chunk opens with (the two
places of the file of it, of the lowest place of the first of them first) names the place of that table the
walk of it stands at. Where the place of the table names a place of the chunk of a value, the places of the
chunk of the value behind the place named stand of the places of the chunk of the value before it, so the
walk of a chunk of one value names a place of that value in every place of it.

A place of the run of sixteen values the walk stands at stands at the front of its run, the places of the
run before it behind it. Where the place of the value of the file stands in no place of the run of sixteen,
the reference names the place of the last place of the run (the count of the places of the file of the value
of the file of it stand of the last place of the run of sixteen).

## The walk of the alpha

The alpha of a picture stands of a walk of the bits of its own, at the place the head names, and of the
places of the file of it at the place behind that place. A place of the walk of the file of the alpha stands
of the lowest place of a place of the file first.

* A place of the walk standing of one stands of a count of the places of the alpha behind it (the count of
  the places of the file of it: a count of the bits of it, of a place of one first and of the places of the
  count behind it, of a place of the run of the places of one) and then of a place of the file: the count of
  the places of the alpha of the place of the file.
* A place of the walk standing of nought stands of one place of the file.

The alpha of the picture stands of the places of the picture where the width and height of it stand of the
places X and Y of the picture and of its own width and height; where they stand short of them, the picture
stands of the places of its colours alone.

## Deviations

* **A picture of a walk of the places of the colours standing of a count of places of its own.** The walk of
  the LZSS engine stands of the places of the picture alone, as the walk of the reference stands of them.
* **A picture of the walk of the second kind standing short of the file, of a count of the places of it, or
  of a place of the table of the walk of it standing beyond the places of the chunk.** Refused with
  `INVALID_ARCHIVE`; the reference reads the places of the file behind the walk (the places of a place of
  the file of it stand of noughts where they stand beyond the file of it) and stands of the places of the
  table of the walk beyond the places of the chunk of it (the places of it stand of noughts there).
* **A run of the places of a chunk of the file or of the table of the walk of it beyond the places of the
  picture or of the chunk.** Refused with `INVALID_ARCHIVE`; the reference writes the places of the run of
  the places of the picture of it beyond the places of the chunk, which the walk of the chunk behind it
  then stands of.
* **A walk of the alpha standing short of the file, and a place of the alpha beyond the places of it.**
  Refused with `INVALID_ARCHIVE`; the reference reads the places of the file behind the walk as noughts and
  stands of the places of the alpha beyond the picture of it.
* **A count of the places of the alpha of a run beyond the places of the alpha of the picture.** The run
  stands of the places of the alpha alone; the reference stands of the places of the alpha beyond the
  picture of it (its own count of the places of the walk of the alpha stands of the count of the places of
  the picture).
* **A picture of a place X and Y of it standing short of the places of the file.** The places of the alpha
  of the picture stand of the places of the file of it alone where the place of them stands of a count of
  the places of the file of the picture; the reference stands of the places of the file behind the picture
  (it stands of them of no guard of its own).
* **Packing a picture.** The reference stands of a format of its own, standing of no packer.
