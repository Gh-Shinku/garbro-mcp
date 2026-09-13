# Tiare GRA image

Reference: `GARbro/Legacy/Tiare/ImageGRA.cs`, class `GraFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/tiare/gra-image.ts` (`tiareGraImageDescriptor`,
`tiareGraImageFormat`, id `tiare-gra-image`). The pixels are decoded by
`packages/formats/src/system98/gra-reader.ts`, the shared `GraBaseReader` port. The symbols are prefixed with
the engine because the Kurumi `GRA` port already owns the unprefixed names for its own `GraFormat`.

This is the most involved of the five readers that share the decoder, because its header is scanned rather
than fixed:

1. `ReadMetaData` reads the first **48 bytes** and looks for the byte `0x1A` inside them. A file without it is
   declined;
2. the cursor moves one past the delimiter and then walks forward to the **zero terminator** of the
   description string. The reference's loop tests a byte and increments past it in the same step, so the
   terminator leaves the cursor one past itself; if no terminator appears, the cursor stops at the end of the
   window and the file is declined;
3. the byte three places past the cursor must be `4`, the bit depth, and the byte at the cursor is the flags
   byte;
4. the cursor then jumps **eight** bytes and reads a big endian `skip` word, which moves the cursor further
   when it is non-zero, followed by big endian width and height. All three reads come from the file, not from
   the 48 byte window, which matters whenever the description is long or the skip is non-zero — a test uses a
   0x40 skip so the fields land past the window and the palette and stream move with them;
5. whichever offset the cursor reaches is the data offset, and zero dimensions are declined.

The palette is optional and selected by the **high bit** of the flags byte: when it is set the file has none
and the output uses the reference's built in table, which is eight dim colours followed by eight bright ones
with the ninth entry repeating black. The port carries that table verbatim in the reference's RGB order, and a
test checks two of its entries. The archive metadata records which case applied as `hasPalette`.

The port exposes the resource as a single entry:

* a present palette is sixteen RGB triples read at the data offset, and the stream then starts after it;
* the pixels are written as a **four bit palette bitmap** by `writeBmp4`, keeping the source depth and
  converting RGB triples to BGRX entries. Because the stream is read from a fixed offset rather than
  overlapping the palette, the zero-stream decode matches the bytes the decoder's unit tests trace;
* `Read` uses `ImageData.Create`, so rows stay top down and the bitmap takes a **negative** height;
* the entry is named after the source file with a `bmp` extension, covers the whole stored file and keeps
  `sizeKnown: false`;
* entry metadata carries `type: "image"`, width, height and `bitsPerPixel: 4`.

Declines, all tested: a missing delimiter, a wrong depth marker, a description that runs to the end of the
window without a terminator, zero dimensions and a file shorter than the window. The reference declares no
signature and no extensions, so the descriptor registers neither, and the format is a candidate for every
file.

GARbro's `Write` throws `NotImplementedException`, so encoding and archive creation are out of scope.
