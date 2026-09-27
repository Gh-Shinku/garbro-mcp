# The tagged image file format

* Reference: GARbro `GameRes/ImageTIFF.cs`, class `TifFormat`, `GameRes` namespace (tag `TIFF`, the two
  signatures `II*\0` and `MM\0*`, the names `tif` and `tiff`).
* GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.
* Port: `packages/formats/src/gameres/tiff-image.ts` (the descriptor) and
  `packages/formats/src/shared/tiff-image.ts` (the walk of the file).

## What the reference does

`TifFormat` reads the head of the file itself, and then hands the whole stream to the decoder of its platform:
`Read` stands of `TiffBitmapDecoder` of WPF, of the first frame of the file, of the places of the file the platform
keeps. The walk of the reference therefore reads every kind of tagged image file its platform reads, and names none of
them. What the class writes is the place of the picture on its platform as well.

## What this port does

The head of the file stands of this project: the descriptor reads the counts of the picture with the walk of the
tagged image file of this project (`shared/tiff-image.ts`) and hands a bitmap of its own over, of the counts of the
file. The walk reads:

* both byte orders of the head, and one or more strips of the places of the picture;
* the counts of a strip of nothing, of the pack of bytes, of the walk of the zlib kind and of the walk of the
  counts of twelve places of the file (LZW, of the kind of the early count that this format names);
* a picture of a grey place (of one, two, four, eight and sixteen places of the file a sample, of the kind the head
  names the brighter count of), of a list of colours, of the three or four places of a colour, and of the colour of
  the press, of the same counting of the places of a colour of its own as the walk of the jpeg of this project;
* the rows that stand of the difference of the row in front of them (the count of the predictor of two).

A picture whose places stand in tiles, whose places of a colour stand apart, whose strips stand of the kinds of the
fax family, of the walk of the counts of twelve places of the file (LZW) or of the walks of the jpeg and of the jpeg
of the two thousand, stands turned away with a message that names the kind: those are the kinds the platform of the
reference reads and this walk does not carry, and they stand named in the record as well.

## What stands of the head of the picture

The counts of a picture of this port stand of the places of the file of the samples themselves and of the count of the
places of the file of a sample, which is how a bitmap of this project stands of its own: a grey picture stands of one
place of a colour, a picture of a list of colours of the list of the head, and a picture of a colour of the three or
four places of a colour. A picture of sixteen places of the file a sample stands of the high place of the file, of the
order the file stands in.

## The fixtures

Every fixture of the tests was written by the Python imaging library (Pillow 11.1.0) during this port, together with
the places that library hands over for it, which stand as an oracle of another implementation:
`tests/helpers/tiff.ts`, and `tests/formats/gameres-tiff-image.test.ts` for the descriptor above them.

## The counts of the colour of the press

The counts of the places of the colour of the press of this format are the counts of the places of the colour of their
own: a count of nothing stands for no place of a colour at all, so a place of the picture stands of the place of its
colour times the place of the black of it, each of them counted of what the head of the file leaves of it. That is the
other way round from the streams of the jpeg of the same kind, whose counts stand turned over; the fixture of the
library (`PRESS_TIFF`, of `tests/helpers/tiff.ts`) stands of an oracle of another implementation for both of them.

## The places of a picture that stand in tiles

A picture whose places stand in tiles of their own (`TileWidth`, `TileLength`, `TileOffsets` and `TileByteCounts`)
carries its rows of places in as many rows of tiles as its counts name, of the count of the places of a tile itself, and
its right and lower tiles stand clipped where the picture ends. The walk reads the places of such a picture of the same
counts of a strip as every other picture, so the compressions stand of the same walk. The fixture of the tests
(`TILED_TIFF`) was built by this project and then read back by the python imaging library, whose places stand as the
oracle of another implementation for it.

## The rows that stand of a difference, of a sample of sixteen places of the file

The count of the predictor of two stands for every counting of the places of the file of a sample: a sample of sixteen
places of the file stands of the count of the sample itself, of the count of the sample in front of it of the same row,
of the count of the counts of that kind of sample, and of the order of the two places of the file the head names. The
fixture of that walk (`PREDICTOR_TIFF`) was built by this project, of the counts the builder wrote down: the python
imaging library reads the file itself but stands of the counts of the differences as they stand in the file rather than
of the places of the picture, so it stands as no oracle for that walk, and the counts of the picture stand of the rule of
the head of the format alone.

## The places of a picture whose strip holds the walk of the jpeg

A picture whose count of the compression stands of the walk of the jpeg (the count of seven) holds one whole jpeg stream
in its strip, of the counts of the picture itself, and the walk of the jpeg of this project stands over that strip: the
places of the picture then stand of the counts of that stream, of the four places a bitmap reads, and the counts of the
head of the file of the tile and of the strip stand of the walk of the stream rather than of the head. A stream of the
kind the reference names as its own — the old kind, whose tables stand in a table of their own, which is the kind the
library of the python imaging library writes — stands turned away with a message of its own, which is where the platform
of the reference fails as well. The fixture of that walk (`JPEG_TIFF`) was built by this project and read back by the
python imaging library through libtiff, and the places of the stream of it stand as the oracle of the walk of the jpeg of
that library.

## The places of a colour that stand apart

A picture whose count of the places of a colour stands apart (`PlanarConfiguration` of two) holds as many counts of
strips as it holds places of a colour, one count behind the other, and a strip of such a picture holds the places of one
place of a colour alone; the walk of this project stands those places into the places of the picture, one place of a
colour behind the other, of one place of the file a sample. A picture of such a kind whose samples stand of more than one
place of the file stands turned away, which the record names. The fixture of that walk (`PLANAR_TIFF`) was built by this
project and read back by the python imaging library through libtiff, whose places stand as an oracle of another
implementation for it.

## The colour of the two of them

A picture of the colour of the two of them (`PhotometricInterpretation` of six) holds the places of the colour of the
two of them, three of them a place of the picture, of the counts of the head of the format of the two of them, and the
walk of this project stands those places into the places of a bitmap of the counts of the two of them of the format of
the jpeg walk. The counts of the head of the format of the two of them of the picture stand of the counts of the head of
the format itself: a picture whose counts of the colour of the two of them (529) or whose counts of the black of the
picture and of the white of it (532) stand of a head of their own stands turned away, and so does a picture whose places
of the file of a place of a colour (530) stand in clumps of their own, which the walk of the counts of a clump of the
places of a colour of the format would read. A picture of such a kind whose samples stand of more than one place of the
file stands turned away as well. The fixture of that walk (`TWO_COLOUR_TIFF`) was built by this project of the counts of
the head of the format alone, since the python imaging library of this machine reads no such file of that counting, so
the places of that fixture stand of no oracle of another implementation.

## The counts of the head of the format of the fax

A picture whose count of the head of the picture stands for the counts of the head of the format of the fax of one
place of the file (group 3 of the format, T.4) holds its places in the counts of the places of the colour of the
picture of the head of the format of the fax: a count of the places of the file of a colour of the picture and a count
of the places of the file of the colour of the other stand one behind the other, and the first count of the head of a row
of the picture stands of the colour of the picture of the head of the format of the fax itself rather than of the count
of the head of the picture, which the library of the counts of the head of the format of the fax of this machine stands
of as well: the walk of this project hands the places of the file of a place of the colour of the picture back of the
count of one place of the file for the place of the colour of the picture of the head of the format of the fax, of the
count of the places of the file of the picture of the format itself. The counts of the head of the format of the fax of the two places of the file (group 4 of the
format, T.6) and the counts of the head of the format of the fax of the two places of the file of group 3 stand of the
counts of the head of the format of the fax of the row of the picture in front of the row of the picture as well: the
walk of this project follows the walk of the library of the counts of the head of the format of the fax of this machine
(libtiff, of the counts of the head of the format of the fax of the picture of Frank Cringle) for those counts of the
head of the format of the fax, of the counts of the head of the picture of the count of the head of the format. A
picture whose samples stand of more than one place of the file or whose places of the file stand of more than one
place of the file a place of the picture stands turned away. The fixtures of that walk (`FAX_THREE_TIFF`) were written by the python imaging library, which reads
them back through libtiff, so the counts of the places of the picture of those fixtures stand of an oracle of another
implementation.

The counts of the places of the file of the rows of the picture stand of the count of the places of the file of the head
of the picture, of the count of the places of the file of the head of the row of the picture of the fax itself, so the count of the head of the format of the fax of the end of the picture of the format stands away of the
walk of this project rather than of a stray row of the picture.
