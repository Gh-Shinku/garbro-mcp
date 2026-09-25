# Silky's bitmap mask

Reference: `ArcFormats/Silky/ImageMSK.cs`, class `RmskFormat` with the `RmskReader` beside it. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`. Implemented as `silky-rmsk-image`
(`packages/formats/src/silky/rmsk-image.ts`).

## The head and the two ways

A mask of this engine opens with `Rmsk`. Its head is twelve bytes: the place the mask stands at on a larger
canvas at 4 and 6, then its width and height. A mask always holds **a byte to the pixel**, and the byte at 0xC
names the way it is stored with its lowest bit - clear for rows, set for columns - while the bit stream begins
behind the byte that follows. The reference reads the data as a picture of grey, which this port writes through
the project's own eight bit writer, the one that carries the grey ramp.

## The rows

The row walk begins at the **last** row of its own place and works upwards, writing every row left to right.
Every pixel is either a byte of its own or part of a copy, and a copy names a place and a length:

* the place is counted from the pixel the copy stands at, out of a table of eight or sixteen whole pixels -
  the wider table reaching from twenty pixels behind the cursor to sixteen in front of it - and may stand in
  the same row, in the row behind or in the row in front;
* the length is one of six ranges, each behind its own bit: two, four, eight, sixteen, eighty or three
  hundred and thirty six, plus as many bits as the range needs.

The copy is made **byte by byte**, walking forwards, so a copy whose place stands behind the cursor reads the
bytes it has just written - which the tests pin - and the whole picture is bounded: a copy that would reach
outside it is refused rather than reading past it.

## The columns

The same walk with the pixels standing in **columns**: it begins at the last column and runs **down** it, and
the copy's place is counted in the column behind, the column in front, or beside the cursor in the same row -
the four ways the reference names. A copy then walks **backwards** up the column, byte by byte, and a length
that reaches past the picture is refused.

## The place of the picture

The reference builds this picture with `CreateFlipped`, so the row its walk writes first - the last row of its
own place - is the row a reader shows at the **top**. This port keeps that: the array the walk fills is handed
to the bitmap writer marked bottom-up, which is what the project's other flipped readers do.

## Verification

Six tests over synthetic fixtures (`tests/formats/silky-rmsk-image.test.ts`), whose bits are built by a writer
mirroring the six length ranges and the two place tables: the row walk with the flip that decides which row a
reader shows, a copy that reads the bytes it has just written, a copy out of the row in front, the column walk,
a copy that reaches outside the mask with a file too short to hold one, and the way of the mask kept in the
entry it names.
