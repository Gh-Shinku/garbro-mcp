# U-Me Soft multi-frame image, the archive kind

Reference: `GARbro/ArcFormats/UMeSoft/ArcMGX.cs`, class `MgxOpener`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/umesoft/mgx.ts` (`umesoftMgxArchiveDescriptor`,
`umesoftMgxArchiveFormat`, id `umesoft-mgx-archive`, `readMgxFrames`).

The signature word the reference declares is `0x1A58474D`, the four bytes `MGX\x1A`, and the extensions it
declares are `grx`. The same four bytes and the same extensions belong to the picture the reference reads out
of the same file, which is ported in [the picture kind](umesoft-mgx-image.md); the archive is the fuller
reading of the file, so it carries the priority of ten and is tried before the picture.

The index is a count and then a place for every frame of it:

| offset | what it holds |
| --- | --- |
| `0x04` | how many frames the file holds, which has to stand between one and `0x40000` |
| `0x08` | the place of every frame, one long word each |

A frame runs to the place of the frame behind it, and the last of them to the end of the file. A count outside
the bound above, an index that does not stand wholly inside the file, a place past its end and a table whose
places do not stand in order are all turned away — the last of which the reference would turn into a frame of
whatever length the difference comes out at rather than refusing it, which is a deviation in that case only.
A frame is named after the file it stands in, with its own number behind a hash and four digits and the letters
`GRX` behind that, as the reference names them, and is listed as a picture; the frames themselves are handed
out as they stand, each of them being a picture of the U-Me Soft kind.

The tests cover the frames listed with their places and their lengths, the measurements of the picture the file
begins with read out of it, the frame handed out as it stands, the declines of a count of nothing, of a count
past the bound, of a place outside the file and of four bytes a byte away, and the priority that puts the
archive before the picture of the same four bytes.
