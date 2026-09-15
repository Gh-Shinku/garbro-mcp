# Rina engine image format

Reference: `GARbro/Legacy/Rina/ImageRAD.cs`, classes `RadFormat` and `RadMetaData` (used by the Gipsy title
*Angel Gather*). GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/rina/rad-image.ts` (`rinaRadImageDescriptor`, `rinaRadImageFormat`, id
`rina-rad-image`, `readRadLayout`, `unpackRadRgb`, `unpackRadAlpha`).

The reference registers two words, `'RA0\0'` and `'RAD\0'`, and declares no extension. Every picture of the
engine has **one size**: 640 by 480, twenty four bits a pixel — the metadata writes those down without looking
at the file at all — and the signature says how the picture is kept: `'RA0'` holds both of its planes packed,
`'RAD'` holds them as they are. Behind the four bytes of the signature stand the planes.

The plane of colour is three bytes a pixel, either as they stand or packed as follows: every triple is read
into the picture, and where that triple is **all nothing**, the byte behind it says how many further pixels of
nothing follow, which the reader skips forward by. A stream that stops in the middle of a triple is taken as
far as it goes and gives up, and one that gives up early leaves the rest of the picture at nothing, because the
reference reads into a buffer of its own.

Behind the picture the reference **peeks** at the stream: where it stands at the end of the file the picture
has no transparency at all and is handed out as one of three bytes a pixel; otherwise a plane of transparency
follows, of one byte a pixel, which is packed as a byte and the number of pixels it covers — the count held to
what is left of the plane, a count of nothing carrying the stream on to the next pair without covering
anything, and a pair the stream stops inside of dropped. The two planes are then woven into four bytes a pixel
of blue, green, red and transparency. Both kinds of picture are handed out with their rows **the other way
up**, because the reference builds them with `CreateFlipped`.

The tests cover the two signatures — and the nothing that must stand in the fourth byte of either — the one
size the pictures have, a picture that stands as it is, a packed picture whose counts skip pixels, the plane of
transparency of both kinds, a packed stream that gives up early, a stream that stops in the middle of a triple,
a count that runs past the end of the transparency plane and a pair the stream stops inside of.
