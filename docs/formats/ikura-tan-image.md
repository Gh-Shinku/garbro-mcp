# D.O. animation image

Reference: `GARbro/ArcFormats/Ikura/ImageTAN.cs`, classes `TanFormat`, `TanReader` and `TanMetaData`. GARbro
commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/ikura/tan-image.ts` (`ikuraTanImageDescriptor`, `ikuraTanImageFormat`,
id `ikura-tan-image`, `readTanLayout`, `unpackTanFrame`).

The reference declares no signature and only looks at a file whose name carries the `.tan` extension. A count
of four byte records stands at the start, of which a count of nothing is refused, and the width and the height
are the words behind them; both must be non-zero. The depth is always reported as eight bits. The data of the
frames stands right behind the measurements, and it is a second, larger structure of its own:

* a colour map of two hundred and fifty six four byte entries, blue, green, red and nothing, which is already
  the order a bitmap wants;
* a count of frames, then one four byte offset per frame, measured from behind the table;
* the frames themselves.

`TanReader.UnpackFrame` unfolds the frame it is asked for into the same buffer, and `TanFormat.Read` asks for
the first one; a file whose table does not reach that frame is refused. The walk into a frame is a command
byte and its payload:

| byte | what it does |
| --- | --- |
| `0` | the byte behind it is a count and the one behind that a value, repeated that many times |
| `1` | the count is a byte and the distance a byte; that many bytes are copied from behind |
| `2` | the count is a byte and the distance a word; that many bytes are copied from behind |
| `3` | the byte behind it is a count of pixels to leave as they stand |
| `4` | the word behind it is a count of pixels to leave as they stand |
| above `4` | the byte less four is a count of pixels that stand in the stream themselves |

A copied run is written a byte at a time, so a run whose distance is one repeats the byte before it. A command
that reaches outside the picture is refused, which the reference's own array reads and writes answer with an
exception (a documented deviation in the message only). A stream that stops where a command or a payload is
wanted is refused as well, where the reference's own reader would take a byte of nothing from a region; the
reference's file backed reader answers that with an exception too.

The tests cover the head the reference reads, the extension gate, the declines of a count of no records and of
a picture of no size, the measurements of the first frame, the frame unfolded and written out with its colour
map, a file whose colour map is not all there, each of the six kinds of command, and the refusals of a repeat
and a copy that reach outside the frame and of a frame the table does not hold.
