# WAG archive PNG image

Reference: `GARbro/ArcFormats/Hexenhaus/ArcWAG.cs`, class `ImgdFormat`, which stands on `PngFormat`. GARbro
commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/hexenhaus/imgd-image.ts` (`hexenhausImgdImageDescriptor`,
`hexenhausImgdImageFormat`, id `hexenhaus-imgd-image`, `readImgdLayout`). The archive of the same engine stands
in `packages/formats/src/hexenhaus/wag.ts`.

## The head

The reference registers the words `IMGD`, which stand in the first four places of the file, and the places of
the picture stand sixteen places behind them: the reference hands those places to the reader of the pictures of
the portable network graphic kind and reads the words of the head of the picture itself from them. Fourteen
places behind the end of the file stand the words and the places that name where the picture stands within the
picture of the game it stands in, where they stand at all.

## Deviations from the reference

- The reference reads the words of the head of a picture of this kind through the reader of the pictures of the
  portable network graphic kind; this project reads the words of the head of such a picture itself and reads no
  places of the picture.
- The reference hands the places behind the words of its own head to the reader of the pictures of the kind
  this one stands as, which reads the places of the picture and hands them to the caller that writes them; this
  port hands those places out as they stand.
- A picture whose words stand short of the words of the kind it stands as, and a picture whose places stand
  short of the places of its own head, are turned away; the reference would throw while reading them.

## Tests

`tests/formats/hexenhaus-imgd-image.test.ts` covers the head of a picture, the words of the places that name
where a picture stands within a picture of the game and those that stand short of them, the heads it is turned
away for, the places of the picture handed out as they stand, a picture cut short of its places, and the words
the picture is told by. What the port hands out stands against the reader of the heads of such pictures, which
reads the places of the head of the picture.
