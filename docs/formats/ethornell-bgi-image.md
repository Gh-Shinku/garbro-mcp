# BGI/Ethornell image format

Reference: `GARbro/ArcFormats/Ethornell/ImageBGI.cs`, classes `BgiFormat` and `BgiMetaData`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/ethornell/bgi-image.ts` (`ethornellBgiImageDescriptor`,
`ethornellBgiImageFormat`, id `ethornell-bgi-image`, `readBgiLayout`, `restoreBgiPixels`).

The reference registers the word of nothing and leans on the extension list, which holds nothing, `bgi`, `_bg`
and `bg` for the pictures of the engine; the port declares the same list and falls back to it, so the header
below is what actually gates a file. The header is four words and eight bytes of nothing: the measurements —
both of which have to be greater than nothing — the depth, which has to be eight, twenty four or thirty two
bits, a flag that has to be nothing or one, and eight bytes the reference requires to be nothing. The pixels
begin at `0x10`. The smallest depth is a grey picture, and the port writes it out with the grey colour map the
shared writer gives it.

With the flag at nothing the pixels stand as they are, and a picture that is shorter than its measurements say
is refused, which is the reference's own length check. With the flag at one the pixels are running sums over a
walk that turns at every row: the planes of the picture stand one behind the other — the blue one first for
the depths of three and four bytes — and inside a plane a row is read forwards, the next one backwards, and
the sum runs on across the turn, never coming back to nothing until the plane is done. A stream that stops
before the pixels are all there is refused, since the .NET reader the reference uses throws there; a walk that
would reach outside the pixels of the picture is refused as well, again where the reference would throw (both
documented deviations in the message only). A picture whose pixels would take more than 256 megabytes is
refused rather than allocated.

The write path of the reference throws `NotImplementedException`, so this is a read only format.

The tests cover a picture found by the words of its header for every depth, the declines of a picture of no
width or height, of another depth, of another flag and of eight bytes that are not nothing, the measurements
and the two ways of storing the pixels, the pixels of a picture that stands as it is, the walk that turns at
every row with an even and with an odd number of rows, the walk of a picture of four channels, a grey picture
written out with the colour map of the writer, the refusal of a picture the stream is too short for and of one
too large to hold, and the planes added up one behind the other.
