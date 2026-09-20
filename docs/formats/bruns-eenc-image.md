# Bruns system encrypted image

Reference: `GARbro/ArcFormats/Bruns/ImageEENC.cs`, classes `EencFormat`, `EencMetaData` and `EencStream`.
GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/bruns/eenc-image.ts` (`brunsEencImageDescriptor`,
`brunsEencImageFormat`, id `bruns-eenc-image`, `readEencLayout`, `decryptEenc`, `unpackEenc`,
`readEencPicture`), with the bitmap and portable network graphic header readers of
`packages/formats/src/shared/`.

The reference registers the two words `EENC` and `EENZ`, and the three names `brs`, `png` and `bmp`.

## The head and the walk of bytes

The four bytes at the beginning of the file are the word of the format; where the fourth of them is a `Z` the
picture behind the walk of bytes is packed by a walk of the zlib kind. The word behind the word of the format
stands over a key of the reference (`0xDEADBEEF`), which is the key the walk of bytes stands over: every byte
behind the head stands over a byte of the key, the four bytes of the key standing over and over from the

What is handed out is the picture as it stands — a bitmap or a portable network graphic — with the name of the
file changed to the kind of the picture behind.

## Deviations from the reference

- The reference looks the picture behind the walk of bytes up in the whole catalog of the formats it knows;
  the port reads a bitmap or a portable network graphic, which are the kinds the name of the format points at,
  and turns a picture of any other kind away.
- The port hands the picture out as it stands, where the reference hands it to the reader of the kind it found
  and writes it out again; the head of the picture is read for the measurements of the entry.
- A file of eight bytes or fewer, a file whose word is neither `EENC` nor `EENZ`, a picture that runs out or is
  packed beyond what this project will hold, and a walk of bytes that gives no picture this project reads are
  turned away; the reference would throw while reading its head or wherever its own reader refused the picture.

## Tests

`tests/formats/bruns-eenc-image.test.ts` covers the word and the key of the head, the two words and their
`Z`, the walk of bytes over the key and its undoing itself, the head of a bitmap and of a portable network
graphic, a bitmap unwrapped from a plain file, a bitmap unwrapped from a packet of the zlib kind, a portable
network graphic unwrapped, a file that holds no picture this project reads and a file whose word is not that
of the format.
