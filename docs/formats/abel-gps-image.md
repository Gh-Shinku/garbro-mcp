# ADVEngine compressed bitmap

Reference: `GARbro/ArcFormats/Abel/ImageGPS.cs`, class `GpsFormat`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/abel/gps-image.ts` (`abelGpsImageDescriptor`, `abelGpsImageFormat`, id
`abel-gps-image`, `readGpsHeader`, `unpackGpsRle`).

The file is signed `GPS`, or `GP2` for the second kind, and carries a head of forty one bytes. A `GPS` file
whose word at four is `0xCCCCCCCC` keeps a shorter head of twenty five bytes instead, where the size of the
unpacked bitmap stands at nine and its packed size at thirteen, and its packing is always the plain LZSS
stream. Every other file carries the kind of packing at `0x10`, the unpacked size at `0x11`, the packed size at
`0x15` and the measurements at `0x19` and `0x1D`. A `GP2` file holds its unpacked size negated, so the
reference turns it back over with `-1 - size`, which this port does as well.

Behind the head stands a Windows bitmap, packed in one of four ways:

| kind | what it is |
| --- | --- |
| `0` | the bitmap as it stands |
| `1` | a run length code of whole three byte units |
| `2` | the plain LZSS stream |
| `3` | the LZSS stream, then the run length code |

The run length code reads a unit of three bytes that stand in the stream themselves and then a control byte; a
control above one says that many more units, less one, are a copy of the whole unit just read. The copy is
written a byte at a time, so the unit repeats itself as it goes, and a stream that stops inside a unit ends the
walk. The LZSS stream is the plain twelve bit variant with a four kilobyte frame the shared codec reads; for
kind three it is unfolded first and the run length walk is then made over its whole output.

The measurements and the depth the port reports are the **bitmap's own**, read from the head behind the
packing, exactly as the reference reads them through its own bitmap reader; the word at `0x19` of the head is
not trusted for them. Kind two, and the two kinds that stand behind it, are unfolded with a cap of 256
megabytes where the reference would run out of memory. The bitmap is read with the shared bitmap reader and
written out again at the depth it was stored in, as the other bitmap ports here do; a bitmap that is run
length compressed is not something the shared reader takes, while the reference's own framework decoder does,
which the status record carries as a limitation. The write path of the reference throws
`NotImplementedException`, so this is a read only format.

The tests cover the two heads and the negated size of the second kind, the five ways a picture can be packed,
a file that is not signed and one whose packed stream does not hold a bitmap, the measurements of the bitmap
behind the packing, the bitmap unfolded again for every kind, the run length unit and the copy behind it and a
stream that stops inside one, and a file whose bitmap is not a bitmap.
