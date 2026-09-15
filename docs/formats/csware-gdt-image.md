# AGS engine image

Reference: `GARbro/ArcFormats/CsWare/ImageGDT.cs`, classes `GdtFormat`, `GdtMetaData` and `GdtReader` (AGS
engine image format). GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/csware/gdt-image.ts` (`cswareGdtImageDescriptor`,
`cswareGdtImageFormat`, id `csware-gdt-image`, `readGdtLayout`).

A file carries the three bytes `DA1` and a sixteen byte header behind them. The header names two places, two
lengths and a word of flags; the picture itself is four planes of one bit, four bits to a pixel.

| Offset | Meaning                                                       |
| ------ | ------------------------------------------------------------- |
| 8      | the horizontal place, counted in eights                       |
| 0xA    | the vertical place, a word                                    |
| 9      | the width, counted in eights                                  |
| 0xC    | the height, a word                                            |
| 0xF    | the flags                                                     |

The flags name two things: bit `0x80` says a colour map is stored, and bit `0x40` **clear** says the planes are
unpacked two rows at a time rather than one row at a time. Every picture is four bits to a pixel.

## The planes

The stream behind the header holds the colour map when there is one, sixteen colours read as four bits to a
channel and doubled into a byte: blue first, then red, then green. When there is no colour map the port hands
out the ramp of greys the reference builds. Four word lengths follow, one for each plane, and then the four
plane streams, each read from the place the sum of the lengths before it names.

A plane is as long as the width counted in eights times the height, and it is written one **column** at a time
rather than one row: the row walk writes a byte and moves on by the height. A row runs until its stream ends or
until the `0xFF` opcode, so a stream of its own is how a picture tells its rows apart.

### The row walk

| Opcode           | Meaning                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `0x00–0x3F`      | a run of zeroes, or of ones from `0x20` up, `& 0x1F` bytes long                          |
| `0x40–0x9F`      | a run taken from another plane, named by the bits above `0x40`                            |
| `0xA0–0xEF`      | a run repeating what the plane already holds, 16, 8, 4, 2 or twice the height bytes back  |
| `0xF0–0xF8`      | as many bytes as the opcode names, carried by the stream                                  |
| `0xF9`           | a gap, which is however many zeroes the byte behind the opcode names                      |
| `0xFA`           | a run of one value, which the two bytes behind the opcode name                            |
| `0xFB`           | the complement of another plane, named by the highest bit of the byte behind the opcode   |
| `0xFC`           | the complement of the third plane, or a run of words built out of one nibble              |
| `0xFD`           | a run of long words, or of words the stream carries                                       |
| `0xFE`           | the meeting of two planes, or a run of long words the stream carries                      |
| `0xFF`           | the end of the row                                                                        |

A run whose length byte is zero is as long as the next byte says, in every family where the opcode only names
the kind of run.

### The two row walk

The scheme the flags name unpacks a pair of rows at once, and it has opcodes of its own: runs of words, long
words or bytes written into both rows, runs repeating what the pair already holds at one of thirty two named
places, runs copied out of another plane, the complement of a plane, and the meeting of two of them. `0xFF`
closes a pair of rows and moves on by the height again.

Two quirks of the reference are kept. A run of **literals** — the opcodes whose second byte is `0xD0` or
`0xD1` — reads a byte for each of the two rows and **forgets to move the place on**, so the run behind it
writes over it rather than beside it. And a picture whose width is one byte when the scheme starts is read with
the single row walk instead.

## The picture

The four planes are flattened into a packed bitmap of four bits to a pixel: the byte of the picture carries two
pixels, the higher of them in its high nibble, and the bit a pixel carries comes from the plane whose number it
is. The fourth plane is the highest bit of a pixel and the first the lowest.

Nothing here writes the format: `GdtFormat.Write` is not implemented in the reference either.

Where the reference writes outside the plane it built — a run longer than the plane, a run repeating from
before its start, a plane named that is not there, a stream that ends inside an opcode — the port refuses the
file with `INVALID_ARCHIVE`. A plane larger than 256 MB is refused with `LIMIT_EXCEEDED`, and a picture of no
width or no height is refused with `UNSUPPORTED_FEATURE`.

The tests cover the word and the header, the measurements and the flags, an empty picture and its ramp of
greys, a run of ones in the first plane and in the fourth, a run repeating what the plane holds, a run copied
out of another plane, a colour map read four bits to a channel, a row reaching past its plane, a stream ending
inside an opcode, both arms of the two row scheme, and the place its literals leave behind.
