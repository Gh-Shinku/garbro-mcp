# Artel ADVG engine image format

Reference: `GARbro/Legacy/Artel/ImageMRL.cs`, classes `MrlFormat`, `MrlMetaData` and the three static walks
`DecryptInput`, `MrlDecompress` and `RestoreOutput`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/artel/mrl-image.ts` (`artelMrlImageDescriptor`, `artelMrlImageFormat`,
id `artel-mrl-image`, `readMrlLayout`, `decryptMrl`, `mrlDecompress`, `restoreMrl`, `unpackMrl`).

The file is signed `MuMR` with an `L` behind it. The word at twelve is the depth **in bytes**, which the
reference turns into bits by multiplying by eight, and the flag at eight says whether an alpha channel is
there; a picture of twenty four bits with an alpha channel is reported as thirty two. The width and the height
stand at sixteen and twenty. The depth decides everything: eight bits carry a colour map of four byte entries
behind the head, twenty four bits three channels and thirty two bits four.

The bytes behind the head (or behind the colour map) are then walked three times:

* `DecryptInput` turns every byte over with a key that begins at **eight** and steps on by one;
* `MrlDecompress` unfolds a run length code in which a byte that is not nothing stands for itself, and a byte
  of nothing stands for a run of zeros whose length is one plus the bytes behind it — every byte of all ones
  asking for one more to be added;
* `RestoreOutput` leaves the first byte as it stands and turns every byte behind it over with the one before
  it, so the walk carries the last value it wrote.

The unfolded bytes stand as one plane a channel, which the reference reads into the interleaved pixels a
bitmap wants: channel by channel, one pixel at a time. The picture is handed out with its rows **bottom up**,
which is what `ImageData.CreateFlipped` means.

A picture of eight bits with an alpha channel would read its alpha channel from behind the end of the pixels
it holds — the reference allocates one plane and then reads a second from it — which the reference's own array
read answers with an exception; this port refuses such a picture for the same reason and does not offer it as
this format. A stream whose run length code is not ended is refused as well, where the reference's own byte
read would take nothing. The write path of the reference throws `NotImplementedException`, so this is a read
only format.

The tests cover the head of each depth, the signature, the tag and the depth and the size the reader turns
away, the three walks on their own and a run length code whose run is not ended, the measurements and the
encryption the entry carries, a picture of three channels read into interleaved pixels, an eight bit picture
read through its colour map, a thirty two bit picture with its alpha channel, the refusal of an eight bit
picture with an alpha channel, and a file that does not hold a picture.
