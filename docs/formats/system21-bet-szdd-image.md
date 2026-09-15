# System21 compressed image format (BET/SZDD)

Reference: `GARbro/Legacy/System21/ImageBET.cs`, class `LzBetFormat`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/system21/bet-image.ts` (`lzBetImageDescriptor`, `lzBetImageFormat`, id
`system21-bet-szdd-image`).

This is the picture of `system21-bet-image` behind a stream of its own, and the body of it is read by the same
code: the measurements and the depth, the colour map of an eight bit picture, the pixels with their rows
bottom up and every byte of them turned over. What differs is where that body stands. The file begins with the
word `SZDD` and a header of fourteen bytes, and the stream behind those fourteen bytes is a stream of
**Microsoft LZSS**: a control byte whose bits are read least significant first, a bit of ones being a byte of
its own, and a bit of nothing two bytes — a place of twelve bits across them and a count of four, three longer
than the count — copying from the ring **by place in the ring** rather than from where the writing has come
to. The ring is `0x1000` bytes round, filled with **spaces**, and the writing starts **one short of its end**
at `0xFF0`, which is what the reference asks for by `FrameInitPos`. The reference reads the words at six to
ten of the header — the length the picture unfolds to — as nothing at all, and neither does this port.

The picture is unfolded for exactly as many bytes as its own header says it needs — the header itself first,
which is read to learn those lengths — so a stream that ends inside the picture is refused with
`INVALID_ARCHIVE`, as is one that does not unfold to a header this format reads. The name of the file must end
with `.bet` here as well. Nothing here writes the format.

The tests cover finding the picture behind the stream, declining a stream that does not unfold to one, the name
of the file the format is told apart by, what the picture behind the stream says about itself, the picture
being the same as the one in the file itself, a stream cut short of the picture, and a run that reaches to the
very start of the ring, where the first byte of the picture was written.
