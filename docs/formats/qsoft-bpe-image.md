# Qsoft image format

Reference: `GARbro/Legacy/QSoft/ImageBPE.cs`, class `BpeFormat`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/qsoft/bpe-image.ts` (`qsoftBpeImageDescriptor`, `qsoftBpeImageFormat`, id
`qsoft-bpe-image`, `decompressBpe`, `readBpePrefix`, `readBpeFields`).

The reference declares no signature for this format and reads it only out of files named `.bpe`, which the port
does the same way: the descriptor advertises no extensions, as the reference does, and detection turns away
anything whose name does not end in `.bpe`. The first four bytes of the file hold how long the picture unfolds
to, which the reference reads as the file's own signature and insists is at least as long as a bitmap header
(`0x36` bytes); behind them the stream begins.

The stream is a run of chunks. A chunk begins with a table of two hundred and fifty six tokens, laid out by
control bytes: a control byte of `0x7F` or below lays out that many tokens plus one, and one above `0x7F` steps
over that many tokens less one hundred and twenty seven, leaving the tokens stepped over standing for
themselves. A token that stands for itself is a byte of the picture; a token that stands for something else is
made of two tokens, and taking it up puts the second of them behind the first on the stack, so the first comes
out before the second, and a token can stand for a whole run of bytes of the picture with nothing behind it in
the stream. Behind the table stands the count of the tokens of the chunk, two bytes highest byte first, and
then the tokens themselves; the chunk ends when its count runs out or when the picture is full.

A byte wanted past the end of the stream comes out as `0xFF`, which is what the reference's own reader returns
for a byte it cannot read, so a stream that runs out inside a token leaves the token standing for itself; a
count wanted past the end of the stream is where the reference's reader throws, and the port refuses there as
well. A token that would run past the two hundred and fifty six the table holds, or a table that nests deeper
than the stack of a thousand and twenty four tokens, is refused. The picture comes back as long as the header
said it would, with whatever the stream did not live up to standing at nothing.

Behind the stream stands a bitmap, which is what the measurements and the depth are read from: the reference
reads the header of that bitmap with the whole file size check it makes everywhere, which cannot be made on the
prefix it unfolds for this, so the port reads the header alone. The picture is handed out by taking the bitmap
apart and writing it out again, which is what `Bmp.Read` does. The reference's write path throws
`NotImplementedException`, so this is a read only format, and a picture that would unfold to more than 256
megabytes is refused.

The tests cover the extension the reference reads the format out of, the declines of a file whose four bytes
promise less than a bitmap header, of one whose stream does not unfold to a bitmap and of one too short to hold
the four bytes, the measurements and the depth of the bitmap behind the stream, a picture the tokens of which
stand for themselves, a token that stands for two others, a token that stands for a run of bytes through the
tokens behind it, the count of a chunk read highest byte first, the rest of a picture the stream does not fill
left standing at nothing, the refusals of a stream that runs out where a count is wanted and of a table that
nests deeper than the stack, and a picture too large to hold.
