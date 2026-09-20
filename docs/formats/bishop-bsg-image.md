# Bishop image (`BSG`)

Reference: GARbro `ArcFormats/Bishop/ImageBSG.cs`, classes `BsgFormat` and `BsgReader` (GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License). Implemented as
`packages/formats/src/bishop/bsg-image.ts`, registered as `bishop-bsg-image`.

Three colour modes and three ways of storing a channel, with a header that may or may not be preceded by
another one.

## The header

The reference reads 0x60 bytes and looks for a null terminated mark: `BSS-Composition` moves the base to
0x20, and `BSS-Graphics` must stand at the base. Everything else is measured from there:

| offset in the base | field |
| --- | --- |
| 0x12 | the size the picture unpacks to |
| 0x16 | the width |
| 0x18 | the height |
| 0x20 | the picture's own horizontal offset |
| 0x22 | and its vertical one |
| 0x30 | the colour mode, which must be 0, 1 or 2 |
| 0x31 | the compression mode |
| 0x32 | where the channels start, as a distance from the base |
| 0x36 | how long they are |
| 0x3a | where the colour map starts, likewise from the base |

The two offset fields are reported and otherwise unused. A colour mode of 2 is the eight bit one and takes
a colour map of 256 four byte entries; the other two are four byte pixels, the first keeping an alpha
channel and the second leaving its fourth byte clear.

## The three ways a channel is stored

**Stored.** The channel of a mode without alpha is a run of three byte triplets, each expanded into a four
byte pixel whose fourth byte stays clear; every other mode copies its bytes as they stand.

**Run coded.** A length word opens the stream, and then signed counts follow: a count that is not negative
is `count + 1` literal bytes, and a negative one is `1 - count` copies of the byte after it. Every channel
is a stream of its own, one after another, so a four byte picture has four of them.

**Back referenced.** A control byte opens the channel, then a length word, and then the bytes themselves.
The control byte is an escape: the two bytes after it are an offset and a count, where an offset greater
than the control byte is reduced by one and the result is multiplied by the pixel size, and an escape whose
offset *is* the control byte stands for the control byte itself rather than a reference. When the channel
has been walked, every sample is added to the one before it **in its own channel**, so the bytes on the
disk are differences rather than values.

## The rows

`BsgFormat.Read` reaches the bitmap through `ImageData.CreateFlipped`, so the rows as written are bottom
up; the port's own writers record that with a positive height.

## Deviations from the reference

* Every read and every write is bounded, raising a `GarbroError`; the reference lets an array access throw.
* A stored channel is copied up to the frame's own size, where the reference hands the whole stored range
  over whatever the header declared.
* A compression mode above two raises `UNSUPPORTED_FEATURE`; the reference throws `NotSupportedException`
  from its reader's constructor.
* The run coder's repeat count is taken as written, where the reference reads it as `1 - count` off a signed
  byte; the two agree for every value the byte can hold.

## Verification

Nine fixtures in `tests/formats/bishop-bsg-image.test.ts` cover the header with and without the
composition in front of it, its rejections, the stored triplet expansion, a stored alpha channel with the
flipped rows, a colour mapped picture with the map it read, the run coder's literal and repeat forms, the
back referencing walk with its delta pass — where one sample and a reference to it become ten, twenty,
thirty and forty — an unknown compression mode, and detection, listing and extraction through the
registered format.
