# LZ-compressed Crowd bitmap

Reference: `GARbro/ArcFormats/Crowd/ImageCWL.cs`, class `CwlFormat`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/crowd/cwl-image.ts` (`crowdCwlImageDescriptor`, `crowdCwlImageFormat`, id
`crowd-cwl-image`, `readCwlLayout`, `readCwlPrefix`, `unfoldCwl`).

The picture of this format is the picture of [the plain Crowd format](crowd-cwd-image.md), whole header and all,
kept in a packed stream of the Microsoft kind. The signature word the reference declares is `0x44445A53`, the
letters `SZDD`, and behind them stand fourteen bytes of header, of which the port uses the length the pack
unfolds to: the reference reads it ten bytes into the header, where the plain Microsoft variant keeps it six
bytes in.

The pack is unfolded with the walk the reference uses everywhere else: a ring of four thousand and ninety six
bytes filled with spaces and started sixteen bytes short of its end, the control bits read least significant bit
first with a set bit standing for a byte of its own. Behind the pack stands the header of the plain format,
which is what the measurements of the picture are read from; the reference gives the walk only the first hundred
bytes of the pack to find that header with, which is what the port does as well, so a pack that does not give
the whole header up out of those hundred bytes is turned away.

A stream that unfolds to fewer bytes than its header asked for leaves the picture short, which is refused where
the reference would throw while reading it, and the reference's write path throws `NotImplementedException`, so
this is a read only format. A picture whose pixels would take more than 256 megabytes is refused.

The tests cover the four bytes of the packed signature, the declines of a file that is not packed, of one whose
pack does not unfold to a whole header and of one too short to hold the header, the measurements read out of the
unfolded picture, the picture unfolded out of the pack, the pixels read out of it, the measurements and the
depth reported for a packed picture, the bitmap written for it with its padded rows, and the refusal of a packed
picture the stream is short of, as well as a picture too large to hold.
