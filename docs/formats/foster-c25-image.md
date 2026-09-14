# BeF game engine image (C25)

Reference: `GARbro/ArcFormats/Foster/ImageC25.cs`, classes `C25Format` and `C25Decoder` (GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/foster/c25-image.ts` (`fosterC25ImageDescriptor`, `fosterC25ImageFormat`, id
`foster-c25-image`), sharing the frame layout and the table of rows with the `C24` image its reference class
descends from.

An image of the BeF engine, the thirty two bit successor of the `C24` image. Its twelve bytes, its frame, its
table of row offsets and the cursor that runs on across rows are all the same; what differs is the word — `C25`
rather than `C24` — the depth it describes, which is thirty two bits, and the way a row is packed.

## A row

A row is a series of runs, each one a single byte that says what kind it is and how many pixels it covers:

| count byte | run |
|---|---|
| above `0x7F` | pixels taken from the file as they stand: three bytes a pixel with an alpha byte of `0xFF` written behind each, or four bytes a pixel when the count was that much higher again |
| at or below `0x7F` | pixels **skipped**: nothing is read and nothing is written, so they stay at the nothing the buffer was given |

The count is what the byte is with the mark taken off it — `0x80` for the three byte kind and `0x70` more for the
four byte one — and a count that comes out as nothing means the real count is the word behind the byte. The two
kinds therefore reach their words at `0x80` and at `0xF0`, and every kind of run has one.

Two details of the reference carry over. A pixel written from three bytes is given an alpha byte of `0xFF`, so a
row of them comes out opaque, while a pixel written from four keeps whatever alpha byte it carried. And a
**skipped** run walks the cursor past the end of the image without writing anything, which is not an error by
itself: the reference only refuses a run when a pixel is **written** past the end, so an image whose last row
skips more pixels than it has is read quite happily, and the pixels it skipped are left transparent.

The tests cover the word, the word of the twenty four bit kind of image and a frame the reference would refuse, a
run of three byte pixels with the alpha byte each is given, a run of four byte pixels that keeps its own, a
skipped run whose pixels stay at nothing, all three kinds of run with the count in the word behind them, an image
whose last run skips past its end without an error, and a run of pixels written past the end of the image, a row
whose offset is past the end of the file, a marked count with no word behind it and a row that stops before its
width.
