# May-Be Soft image format

Reference: `GARbro/Legacy/MayBeSoft/ImageHHP.cs`, classes `HhpFormat` and `HhpReader`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/maybesoft/hhp-image.ts` (`mayBeSoftHhpImageDescriptor`,
`mayBeSoftHhpImageFormat`, id `may-be-soft-hhp-image`, `readHhpLayout`, `unpackHhp`).

The reference declares no signature word: it gates on the `.HHP` extension and hands out a fixed picture of
**six hundred and forty by four hundred**, eight bits a pixel, without looking inside the file at all. The
port keeps the gate and asks for the colour map behind it, so a file that cannot even hold one is not offered.
The colour map is two hundred and fifty six entries of three bytes, red, green and blue, which the port turns
into the four byte entries a bitmap wants.

The stream behind the colour map is read from the **highest** bit of every byte down, and it is a walk of runs:
the place begins one behind the start of the picture, so the first count says how far the first pixel stands.
Two bits name how many bits that count is read with — four, six, eight or twenty — and a count of nothing ends
the walk. The pixel stands in the stream itself. Behind it stands a walk down the column it belongs to: three
bits name a place, of which nothing ends the walk and **six** reads a count that carries the place whole rows
down, while every other place steps the place one row down and as far aside as the table says — nothing,
nothing, one to the right, one to the left, two to the right, two to the left — and writes the same pixel
there.

When the walk is done, every pixel that was left at nothing takes the last value seen before it, and a value
that meets its own repeat turns to nothing and clears the one it carries. A stream that stops where a code or
a count is wanted is refused, where the reference's own bit reader would take nothing on the counts it reads
separately (a documented deviation in the message only); a place that reaches outside the picture is refused
as well, which the reference's own array write answers with an exception. The picture is handed out with its
rows **bottom up**, which is what `ImageData.CreateFlipped` means. The write path of the reference throws
`NotImplementedException`, so this is a read only format.

The tests cover the extension gate, the fixed size and a file that cannot hold a colour map, a run of one
pixel carried into every pixel left at nothing, the walk down a column with its aside step and the repeat that
clears itself, the picture written out with its colour map, a stream that stops where a code is wanted, and a
file that does not hold a picture.
