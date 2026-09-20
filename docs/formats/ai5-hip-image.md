# elf composite image format (HIP)

Reference: `GARbro/ArcFormats/elf/ImageHIZ.cs`, class `HipFormat`, which **inherits** the plain kind of the same
file (GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/elf/hiz-image.ts` (`ai5HipImageDescriptor`, `ai5HipImageFormat`, id
`ai5-hip-image`). It shares its header reader and its pixel reader with `ai5-hiz-image`, which is what makes the
two formats one reader around two headers.

A file that carries pictures of the plain kind inside itself:

| offset | field |
|---|---|
| 0 | `hip` |
| 12 | the offset of the first picture |
| 16 | the offset of the second, or of the first when the word at twelve is nought |
| 20 | the offset of the second, when the first was named at sixteen |
| 24 | the picture of the plain kind, and whatever follows it |

The reference looks at the word at twelve and, finding nought, at the word behind it; two words of nought are no
index at all. The picture the index names runs to the second picture, or to the end of the file when there is no
second one, and a second picture in front of the first is no file of this kind. The region the two offsets name
has to hold the header of a picture of the plain kind, which is the real gate: the word at twelve only decides
where the reference starts looking.

## Where the pixels come from

The reference reads the measurements of the picture from the **region** the index words name, and then moves the
offset of the pixels on by the length of its own header, which leaves that offset measured from the **file**
rather than from the picture the index words name. It therefore reads the pixels of every composite file at the
same place — two hundred and fifty two bytes in — whatever offset the header gave. The port keeps that as it
stands: the measurements come from the region, and the pixels from the file.

For a file whose first picture begins at twenty four — the length of the header itself — the two readings agree,
which is what the reference's own files must look like.

The tests cover the index word at twelve and the one behind it, two words of nought, a second picture in front of
the first, a region that is not a picture of the plain kind, a file too short for a header, the measurements
coming from the region while the pixels come from the file — with a decoy stream where a reader measuring from the
region would look — a picture that runs to the end of the file, and a stream that carries less than the whole
picture.
