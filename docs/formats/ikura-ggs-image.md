# D.O. image format, the GGS kind

Reference: `GARbro/ArcFormats/Ikura/ImageGGS.cs`, classes `GgsFormat` and `GgsReader`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/ikura/ggs-image.ts` (`ikuraGgsImageDescriptor`, `ikuraGgsImageFormat`, id
`ikura-ggs-image`, `readGgsLayout`, `unpackGgs`).

The reference declares no signature for this format and reads it only out of files named `.ggs`, which the port
does the same way: the descriptor advertises no extensions, as the reference does, and detection turns away
anything whose name does not end in `.ggs`. The header is eight bytes and begins with no letters at all — it is
the place the picture stands at, then its measurements:

| offset | what it holds |
| --- | --- |
| `0x00` | the place the picture stands at sideways, which this format reports as it stands |
| `0x02` | the place it stands at downwards, likewise |
| `0x04` | the width |
| `0x06` | the height |

The measurements have to stand above nothing and no further than `0x4000`, and the place may not stand below
nothing, or the picture is turned away. Where the sibling format of the same engine turns the place about, this
one reports it as the file holds it.

The pixels are the three colour channels walked one after another through the same stream, each of them writing
every third byte of the picture and starting at its own channel, so the first walk writes the blue channel, the
second the green and the third the red. A step of a walk starts with a control byte:

| control | what it does |
| --- | --- |
| `0` | fills the next pixels with the byte that stands behind the count |
| `1` | copies the next pixels from a place behind, the place a byte long |
| `2` | the same, the place two bytes long |
| `3` | steps over that many bytes |
| `4` | the same, the count two bytes long |
| five and above | that many bytes minus five stand in the stream themselves |

The counts of the steps and their places are counted in the stream of bytes rather than in pixels, which is why
a step over one byte lands the next byte written on the green channel of the pixel it stepped into, and why a
copy with a place that is not a multiple of three reads a byte of another channel. A copy from no place at all
reads the byte it is about to write, which stands at nothing, and a copy whose place reaches before the start
of the picture is refused; a run that writes past the end of the picture is refused too, where the reference's
own reader would throw. A walk that reaches the end of the picture ends there, and the channels behind it walk
the same picture again from wherever the stream stands, so a step that leaves a channel's walk beyond the
picture leaves the channels behind it to walk a picture that is already whole.

The write path of the reference throws `NotImplementedException`, so this is a read only format. A picture
whose pixels would take more than 256 megabytes is refused at extraction; the header of such a picture is still
read, so reading its measurements and listing it stay possible.

The tests cover the extension the reference reads the format out of — including the upper case spelling of it —
the declines of a picture of no width or height, of one wider or taller than `0x4000`, of one whose place stands
below nothing and of one too short to hold a header, the measurements and the place as it stands, the walks of
the three colour channels, a fill, a copy from a place a byte long and one from a place two bytes long, steps
over a count a byte long and two bytes long with the byte they land on and the channel alignment they shift,
a copy from no place at all, the refusals of a copy from before the start of the picture, of a run past its end
and of a stream that runs out inside it, a picture too large to hold, and the walk of a picture of one pixel.
