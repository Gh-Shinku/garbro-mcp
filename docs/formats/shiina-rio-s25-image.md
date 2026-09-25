# ShiinaRio image (`S25`)

* Reference: `GARbro/ArcFormats/ShiinaRio/ImageS25.cs` (`S25Format`, `S25Format.Reader`)
* Port: `packages/formats/src/shiina-rio/s25-image.ts`, record `shiina-rio-s25-image`
* Tests: `tests/formats/shiina-rio-s25-image.test.ts`

Only the first frame of a file is handed over, as in the reference; per-frame access stands of the archive
of the same engine (`ArcFormats/ShiinaRio/ArcS25.cs`).

## Layout

The file opens with `S25\0`, a frame count at 4 (0 to 0xFFFFF) and that many frame offsets from 8. The
first offset that is not nought names the frame of the picture; the frames behind it stand of the same rows.

A frame stands of its width (u32), its height (u32), its place in the picture (two i32), a word of flags
whose highest place means the rows stand of one another, and then a table of one u32 per row naming where
the row stands. The place of the first row of the picture is that place, of which the places of the rows of
the file stand in turn.

## The walks of a row

A row stands of two bytes of a count and then the places of the walk: the highest three places of the count
name the kind of the walk, the places behind them how many places of the walk stand behind the count, and
the lowest eleven the count of places; a count of nought is followed by a count of four bytes. The kinds:

| kind | places |
| --- | --- |
| 2 | as they stand, three places to a place, of an alpha of 0xFF |
| 3 | one colour of three places, repeated |
| 4 | as they stand, four places to a place |
| 5 | one colour of four places, repeated |
| other | left as they stand (nought) |

A row stands of a place of its own where the places of it begin at a place of the file of an odd count: the
reference reads a place of the row there and stands of one place fewer. The walks of the rows of a picture
whose rows stand as they stand ask after the place behind the count of the row; the walks of the rows of a
picture whose rows stand of one another ask after the place of the row itself.

## Rows standing of one another

Where the highest place of the frame's flags stands, the rows of the picture are delta coded: the kind 2
places of a row stand of the three places behind them and the kind 4 places of the four behind them, every
place being added to the place behind it in turn, and the walk stands of the count of the rows and frames
that name the row of the file: a row named by two rows (or by a row and by the rows of another frame of the
file) stands of two passes of that walk. A row named by more than one row of the picture is read once.

## Deviations

* **Places of the file that stand short.** A row standing past the end of the file is refused with
  `INVALID_ARCHIVE`; the reference reads it as noughts.
* **A picture of no places.** The reference reads the measurements of the frame without asking after them;
  the port refuses a frame of no width or height.
* **Kinds of walks this project reads none of.** Kind 0, 1, 6 and 7 leave the places of the walk as they
  stand, of nought, as in the reference.
