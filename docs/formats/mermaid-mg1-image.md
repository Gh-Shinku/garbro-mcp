# Mermaid obfuscated bitmap (MG1)

Reference: `GARbro/Legacy/Mermaid/ImageMG1.cs`, class `MgFormat` (GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/mermaid/mg1-image.ts` (`mermaidMg1ImageDescriptor`,
`mermaidMg1ImageFormat`, id `mermaid-mg1-image`).

An image of the Mermaid engine, a bitmap whose rows have been cut apart and stored in another order. Its header is
shaped like a bitmap's — the word `BM`, the offset the pixels begin at, the width, the height and the depth — but
it is read as fields of its own rather than through a bitmap reader.

There is **no word to find**: the reference asks for one of the extensions `mg1` and `mg2` and then for the `BM`
marker, so the port's own detection is that name and that marker. The depth is only **checked** when the image is
read: a file naming a depth that is neither twenty four nor thirty two bits is found and then refused, with the
same error the reference's own `InvalidFormatException` stands for.

## Names and pieces

Which extension a file came under decides how many pieces its rows were cut into:

| extension | pieces |
|---|---|
| `mg1` | always five |
| `mg2` | one for every **thirty two pixels of the width** — not of the row |

A piece is as wide as the row divided by that number, with the division cutting off the remainder, and as tall as
the height divided by the number of pieces rounded up. The last piece of a row is therefore as wide as the
remainder only by accident, and the second kind of file divides the row of a thirty two bit image — four bytes a
pixel — by the same number of pixels it counted.

An `mg2` narrower than thirty two pixels asks for no pieces at all, which the reference divides by and the port
refuses; a piece that comes out with no width is a loop the reference would never leave, so the port refuses that
as well.

## Reading

The pixels are read from the offset the header gives, in blocks as wide as a piece and as tall as a piece is with
one row to a block, and put back into the rows they belong to:

* the rows are walked from the **last** one up, one block of rows at a time;
* within a block of rows the pieces are walked from the **last** one down;
* within a piece the block's rows are walked from the first one down.

A piece whose place in the image would run past the end of it is **skipped over in the file**: the reference
seeks past those bytes without looking at them, which happens whenever the pieces do not divide a row evenly. A
file that ends before its image does leaves the pixels it could not fill at nothing, because the reference's own
reads are not checked; a piece that is skipped over runs no risk of that, since seeking past the end of a file is
allowed.

The tests cover both extensions, a file under another name and one whose marker is not `BM`, the measurements,
the offset and the number of pieces the port reports, a five by five image whose columns are put back into its
rows, a thirty two pixel wide image of the second kind read as a single piece, an eleven pixel wide image whose
pieces do not divide its row evenly and whose last three bytes are never written, a depth the reference refuses,
and a second kind of image too narrow to have a piece at all.
