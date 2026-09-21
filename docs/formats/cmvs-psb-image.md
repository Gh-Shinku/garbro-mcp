# PVNS engine PSB image

Reference: `ArcFormats/Cmvs/ImagePSB.cs`, classes `PsbFormat` (tag `PSB`) and the `PsbReader` behind it.
GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`. Implemented as `cmvs-psb-image`
(`packages/formats/src/cmvs/psb-image.ts`), beside the ported PB3 pictures of the same engine family.

## The head

The file opens with the word `PSBP`, and that word is the only part of its head the file keeps as it stands.
Every field behind it is keyed with the file's own **last nineteen bytes**: each byte is exclusive-or'ed with
one of two bytes near the end of that tail and then has a byte of the tail subtracted from it. The fields so
recovered are the way the picture is packed, its width, its height and the depth it is stored in, and the two
places its tables stand. A picture therefore cannot be read from its head alone, and a file whose tail has
been cut comes out as nothing.

Three bytes to a pixel is a picture of blue, green and red, and four is one with an alpha channel as well;
any other depth is refused.

## The two ways a picture is packed

* the **second** way keeps each channel as a plane of differences, packed away with the walk below. The plane
  is added up a byte at a time, and each of its bytes is written into the picture with nothing between its
  own channel's bytes: the first pixel's differences are its own colours, and every later one is the step
  from the pixel before it in the same row-major order. The channel's sizes stand in a row in front of its
  packed planes, and the places they are read from stand in a second table whose sizes begin where the packed
  planes end;
* the **third** way cuts the picture into blocks of eight by eight. Each channel keeps a byte of flags for its
  blocks, a plane of the bytes the blocks hold, and a block of bytes to fill a whole block with. A set bit
  fills its block with the next byte of that block; a clear one takes the next byte of the plane. The three
  lengths - of the flags, of the filling bytes and of the plane - stand in front of each channel's record,
  and the tables of this way are named by the head's two places rather than chained as the second way's are.

## The walk

The reader of this engine unpacks with a walk of its own: a control byte read from its highest bit down,
where a **set** bit stands for a copy and a clear one for a byte that stands as it is. A copy is a pair of
bytes whose lower four bits name how long the run is - three at the least - and whose rest names a place in a
frame of four thousand and ninety-six bytes, which is read back from and written to as the picture is walked.
The frame begins as nothing and its cursor starts near its end.

That walk differs from the PB3 pictures' own walk in this project in **two** ways, so the two are kept
apart: the PB3 walk takes five bits of a pair for the run and reads back from a frame of two thousand and
forty-eight bytes, where this one takes four and reads back from one of four thousand and ninety-six.

## Deviations from the reference

* Every read is bounded: a table that reaches past the file, a block record that stops short, a plane larger
  than the picture, and a picture whose size would be larger than this project will hold, are all refused.
  The reference would throw an end of stream error or read past the end of its own buffer.
* A picture of no width or no height is refused, and so is a depth the engine never writes.
* The ways a picture may be packed that the reference names but this port does not read - there are only the
  second and the third - are refused with `UNSUPPORTED_FEATURE`, and the message names the way the head
  asked for.

## Verification

Four tests build files with a mirror writer: a head keyed with a tail that is not zero, which comes back as
it was written while the same head with its tail cleared comes out as nothing; a picture of the second way
whose three channels of differences are added up, checked byte for byte; a picture of the third way whose one
block is filled with a byte of its own, checked both in the decoded bytes and in the bitmap the format
extracts; and the refusals - another word, no width, a depth of sixteen, a way the reference does not name,
a table reaching past the file, and a head that stops short.

What stands on the reference alone: no fixture here reads a copy of this walk, since every byte of the ones
built is written as it stands, so the copy branch - and the pair of bytes it reads - rests on the reference;
and no real picture is on hand to compare against GARbro's output.
