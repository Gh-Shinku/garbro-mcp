# Amaterasu Translations GRP image

Reference: `GARbro/ArcFormats/Amaterasu/ImageGRP.cs`, class `GrpFormat` (GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/amaterasu/grp-image.ts` (`amaterasuGrpImageDescriptor`,
`amaterasuGrpImageFormat`, id `amaterasu-grp-image`).

The pictures the AMI archive of the same engine carries (see `ami.md`), each of them a header and a stored
picture of whole pixels:

| offset | field |
|---|---|
| 0 | `GRP` and a nought |
| 4 | the offset of the picture, signed |
| 6 | its offset down, signed |
| 8 | width |
| 10 | height |
| 12 | the picture, four bytes to the pixel, blue first |

The reference reads the header **without looking at a single one of its measurements** — only the signature is a
gate — so the port's reader is the same: any file whose first four bytes are those is this format's, and a
measurement of nought is a picture that cannot be built rather than one that cannot be found. The port refuses
it where the reference hands it to the framework, which in turn refuses a bitmap of no pixels
(`UNSUPPORTED_FEATURE`); a picture larger than the port will hold is refused with `LIMIT_EXCEEDED` where the
reference would try to allocate it.

The picture is read one row at a time, the rows of the file running **from the bottom up**. The reference reads
them from the last one to the first and creates the picture with the order that leaves, so the port writes a
bitmap with a **negative height** at the same place. A file whose picture is not all there is the failure the
reference raises `InvalidFormatException` for, and the port answers with `INVALID_ARCHIVE`; bytes behind the
picture are never read.

The format declares no extension list in the reference, and its files live inside the archive of its engine
rather than beside it, so the port declares none either. The reference's writer is not part of this port, which
extracts.

The tests cover the signature and a file that is not this format's, a picture read bottom up into a top down
bitmap, a file whose picture is not all there, bytes behind the picture that are never read, a picture of no
pixels and one larger than the port will hold.
