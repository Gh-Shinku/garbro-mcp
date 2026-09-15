# SAS5 engine compressed image format

Reference: `GARbro/ArcFormats/Sas5/ImageIAR.cs`, classes `IarFormat` and `IarMetaData`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/sas5/iar-image.ts` (`sas5IarImageDescriptor`, `sas5IarImageFormat`, id
`sas5-iar-image`, `readIarLayout`, `readIarPalette`, `packIarRows`).

The reference calls this format artificial: it is the picture the SAS5 engine hands around inside its own
archives rather than something a game ships, and the reference reads it so that such a picture can be looked
at. The port keeps it for the same reason. The header is forty bytes:

| offset | what it holds |
| --- | --- |
| `0x00` | the four letters `IAR\0`, which the reference packs into its signature word |
| `0x04` | the word `SAS5`, which the reference checks itself |
| `0x08` | the width |
| `0x0C` | the height |
| `0x10` | the place the picture stands at sideways, which the reference reports turned about |
| `0x14` | the place it stands at downwards, turned about the same way |
| `0x18` | the depth the file declares |
| `0x1C` | the length of a row of the stored pixels |
| `0x20` | the size of the colour map |
| `0x24` | the size of the pixels |

Behind the header stand the colour map, if the file brings one, and then the pixels. What the picture holds
follows from the depth and the colour map together, the way the reference decides it: thirty two bits is a
picture of four channels, twenty four a picture of three, and of everything else one with a colour map of
nothing is a grey picture and one with a colour map an indexed picture. The port reports the depth of the
bitmap it writes rather than the depth the header declares, which for a picture of an unusual declared depth
is the difference between a readable file and a wrong one.

The entries of a colour map are read the way the reference reads them: how long an entry is comes from the
size of the map itself, held to the largest map the reference takes entries out of, so a map of `0x300` bytes
gives three byte entries, one of `0x400` gives four, and one shorter than a full map of `0x100` entries gives
entries of no length at all, which makes every entry the first three bytes of the map. The first, second and
third byte of an entry are its blue, its green and its red — the order a bitmap wants them in, so the port
passes them through.

The rows of the stored pixels stand with the length the header declares, which the reference hands to its
bitmap reader as it is; the writers of this project take a row of exactly the width of the picture, so a
longer row has its end left behind and the rows are packed together. The pixels have to be at least as long
as the rows say, which the reference's bitmap reader insists on too; anything past that is left behind.

A picture of no width or height, of no length of a row, or with a colour map or a pixel size below nothing is
turned away, since the reader the reference hands those to would throw; so is a colour map the file does not
hold all of, a picture whose pixels are shorter than its rows, and one whose pixels would take more than 256
megabytes. The write path of the reference throws `NotImplementedException`, so this is a read only format.

The tests cover the four letters and the word behind them, the declines of a picture of no width or height, of
no length of a row, of a pixel size below nothing and of a word other than `SAS5`, the measurements and the
turned about place the picture stands at, a picture of three channels and one of four written out as they
stand, a grey picture and the ramp its colour map gets, a colour map of three byte entries and one of four
byte entries, a map so short that every entry is the same one, rows packed out of a longer row, pixels left
behind past the rows, the refusals of a picture whose pixels are shorter than its rows and of one whose colour
map is not all there, and a picture too large to hold.
