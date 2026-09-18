# Digital Monkey image format

Reference: `GARbro/Legacy/DigitalMonkey/ImagePKT.cs`, classes `PktFormat`, `PktMetaData` and `PktReader`.
GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/digital-monkey/pkt-image.ts` (`digitalMonkeyPktImageDescriptor`,
`digitalMonkeyPktImageFormat`, id `digital-monkey-pkt-image`, `readPktLayout`, `readPktPalette`,
`unpackPktRle`, `unpackPkt`).

The head carries `PKT10`, `PKT20` or `PKT99` — the three words the reference registers — a word of nought at
five, the width and the height at `0x14` and `0x18`, the place of the pixels at `0x20`, the place of a plane
of fourth bytes at `0x24`, a word at `0x28` that says whether that plane is there at all, and the count of
its runs at `0x2C`. The letters behind the mark are the version: ten times the first plus the second, less
five hundred and twenty eight — which is ten, twenty or ninety nine, and the depth is twenty four bits for
the twentieth and eight for the other two.

The ninety ninth version is nothing but grey: its runs stand **eight bytes** behind the place the head gives
and unfold straight into the picture. The other two read their pixels as they stand behind the place the head
gives — an eight bit picture behind its colour map of two hundred and fifty six entries of three bytes — and,
where the head says there is one, weave a plane of fourth bytes taken from its own runs into every pixel: an
eight bit picture goes through its colour map to reach its three bytes, a twenty four bit one carries them
itself.

`PktReader.RleUnpack` is as many runs as the head says, every one of them a count and the byte that stands
for it, with the whole of a picture's alpha plane (or of the grey kind) as what they write.

The rows are handed out top down, which is what `ImageData.Create` means. The write path of the reference
throws `NotImplementedException`, so this is a read only format.

Deviations from the reference, in the message only: a word at five that is not nought, a version other than
the three, a picture with nothing for a width or a height, and pixels or runs that reach past the file are
refused, where the reference would return nothing or read past its own array.

The tests cover the head of every version, the marks, the word at five and the places it is turned away for,
the runs of a count and a value, the eight and twenty four bit pictures written out, the plane of fourth
bytes woven into each of them, the grey kind written out of its own runs, and a file that does not hold a
picture.
