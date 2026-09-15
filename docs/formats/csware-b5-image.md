# CsWare picture format

Reference: `GARbro/ArcFormats/CsWare/ImageB5.cs`, classes `B5Format`, `B5MetaData` and `B5Reader`. GARbro
commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/csware/b5-image.ts` (`cswareB5ImageDescriptor`, `cswareB5ImageFormat`,
id `csware-b5-image`, `readB5Layout`, `b5Offsets`, `unpackB5`).

The reference signs the format with the three letters `b5w`, and the header behind them holds a letter, two
bytes of nothing and the measurements. The letter says whether the red and the blue of every pixel are the
other way round — every letter but `w` does — which, since the signature itself holds the letter `w`, is a
question the reference never actually asks: a picture whose third letter is another one is not recognised at
all. The port keeps both the signature and the walk the reference would take, and asks the walk for the turn
directly in its tests. The depth is always sixteen bits, and the pixels are written out as a bitmap of fifteen
bit colour, with the masks the shared writer declares.

`B5Reader.Unpack` reads a stream of words. A word whose highest bit stands holds a pixel in the fifteen bits
behind it. A word whose highest bit is clear holds a run: the byte behind the bit is how many pixels stand
there, and the rest of the word is a place in a table of a hundred and twenty eight offsets. The table begins
with the eight pixels behind the one the run stands at, and then walks the rows above — the row above itself
at the eighth place of the table, the eighth row above at the end of it. A run copies one pixel at a time from
a fixed distance behind, so a run standing at the first place of the table fills the rest of its row with the
pixel before it and one standing at the fifteenth place copies the row above.

A run may reach past the end of its row: what it writes lands in the row below, which the reference allows as
long as it stays inside the picture, and which the row below then writes over, since every row begins where its
own pixels begin. A run that reaches outside the picture is refused, as is a stream that stops before its
pixels are all there — both where the reference's .NET reader would throw (documented deviations in the
message only). A picture whose pixels would take more than 256 megabytes is refused rather than allocated. The
write path of the reference throws `NotImplementedException`, so this is a read only format.

The tests cover the three letters of the signature, the declines of a picture of no width or height and of one
too short to hold a header, the measurements of the header, the bitmap of fifteen bit colour with its masks, the
turn of the red and the blue as the walk takes it, the places a run copies from, a run repeating the pixel
behind it, a run copying the row above, a run of no pixels, a run reaching past its row into the row below, the
refusal of a run that reaches outside the picture, of a stream that stops before its pixels are all there and of
a picture too large to hold, and a picture of one row handed to the walk.
