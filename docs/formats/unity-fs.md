# Unity asset archive (`UNITY/FS`)

Format reference: GARbro `ArcFormats/Unity/ArcUnityFS.cs` (`UnityFSOpener`, `BundleSegment`, `BundleEntry`,
`AssetEntry`, `AssetDeserializer`) over `ArcFormats/Unity/BundleStream.cs`, `ArcFormats/Unity/Asset.cs`
(`Asset`, `UnityObject`, `TypeTree`, `UnityTypeData`), `ArcFormats/Unity/AssetReader.cs` and the type name
table `ArcFormats/Unity/strings.dat`, GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

## The head of the file

| place | field |
| --- | --- |
| 0 | the word `UnityFS` behind a place of no name |
| 8 | the count of the head of the kind (`i32`, of the places of the other way of the engine), of the kind six alone |
| 0xc | the count of the engine (`utf8`) and the count of the walk of it (`utf8`), every one of them behind a place of no name |
| — | the count of the places of the file (`i64`), the count of the index of it as it stands (`i32`), the count of the index of it (`i32`), and the flags of the file (`i32`) |

The low six places of the flags name the walk of the index: nothing (the index stands as it stands), the
walk of the blocks of the format (`codecs/lz4.ts`) and the walk of the LZMA kind. The highest place of the
flags names the index standing at the **end** of the file rather than at the head of it, of the streams of
the places of the file in front of it.

## The index

| place | field |
| --- | --- |
| 0 | sixteen places the reference stands over |
| 0x10 | the count of the streams of the file (`i32`) |
| — | for a stream: the count of the places of it (`u32`), the count of the places of it as they stand (`u32`) and the walk of it (`u16`) |
| — | the count of the bundles (`i32`) |
| — | for a bundle: the places of it within the streams (`i64`), the count of the places of it (`i64`), the flags of it (`u32`) and the name of it (`utf8`, of a place of no name behind it) |

Every count and every place of the index stands of the **other way of the engine**. The walk of a stream is
of the same kinds as the walk of the index. The places of the streams stand of each other, one behind the
other, of the places of the file of every stream behind the places of the stream in front of it.

## The bundles

Every bundle of the archive stands of a serialized asset of the engine (`asset-file.ts`): the places of the
head of it, the table of the kinds of the places of the walk of it (`TypeTree`, of the walk of a name in
front of the places of it for the kinds ten and twelve and up, and of a run of the places of the walk itself
for the kinds behind them) and the table of the objects of it. The name of an object of the table of the
bundles of the asset stands of it where the asset carries one (the kind `AssetBundle`), and of the places of
the walk of the object itself (the first place of the kind `string` named `m_Name`) where it does not.

| kind of an object | the walk of it |
| --- | --- |
| `AssetBundle` | the names of the objects of the asset alone, of no place of the file of the asset at all |
| `TextAsset` | the places of the script of the object: the places of it behind the count of them, of a walk of the count of the places of the format where the flags of the kind of it name one |
| `Texture2D` | the head of the picture of the object and the places of the picture behind it, of the kinds of picture the walk of this project reads (`unity/texture2d.ts`) |
| `AudioClip` | the reference reads the places of a sound of the engine of a walk of its own, of a table of the places of the sound of it: this port stands of no object of that kind at all |
| every other kind | the places of the object itself, of the kind of it as the name of it |

## The pictures of the objects of the kind `Texture2D`

The head of a picture of the engine stands of the name of the picture, of the places of it, of the kind of
the places of the picture, of the counts of the walks and of the pictures of it, and of the count of the
places of the picture, which stand behind the head. The reference stands of three shapes of that head, of
the places of the walk of the asset itself: the shape of the versions `2017.3.1f1`, `2019.3.0f1` and
`2017.4.3f1`, the shape of the version `2021.1.3f1`, and the shape of every other walk. A walk of a file of
an older kind stands of no count of the places of the picture, and the reference reads eight places of the
file behind the head of such a picture where the count of the places of the picture stands at nought; this
port stands of them as well.

| kind of the places of a picture | the walk of it |
| --- | --- |
| one place of grey (`1`) | the places of the picture, one place of grey each, as a picture of grey |
| four places of a colour of half a place (`2`) | every place of half a place of the file stands of two places of a colour, of the low places of it first |
| three places of a colour (`3`) | the places of the picture, blue, green then red, as a bitmap of this project stands of them |
| four places of a colour, the covering place last (`4`) | the places of the picture, of red and blue the other way round |
| four places of a colour, the covering place first (`5`) | every place of four of the file stands the other way round |
| a red place of sixteen places (`6`) | the high places of every place of the file, as a picture of grey of one place |
| five places of a colour and six of green (`7`) | the places of the picture, as a picture of the places of a colour of two places of the file |
| the blocks of the third kind (`10`) | the blocks of the format, of four places of a colour and a covering place each (`shared/dxt.ts`) |
| the blocks of the fifth kind (`12`) | the blocks of the format, of four places of a colour and a covering place each (`shared/dxt.ts`) |
| blue, green, red then the covering place (`14`) | the places of the picture, as a bitmap of this project stands of them |
| every other kind | the walk stands of no picture: the object stands turned away (`UNSUPPORTED_FEATURE`) |

The rows of a picture of the engine stand from its foot up, and the reference hands the places of a picture
over of a walk that stands of them the other way round; this port turns the rows of every picture over as
well, so that a bitmap of this project stands of the picture the right way up.

## Deviations

* The places of an object of the engine stand of the places of the **stream** of the file of the archive
  rather than of the places of the bundle of it: the reference names the places of an object within the
  stream of its own bundle, which stands of the places of the file behind the first bundle where the file
  holds more than one.
* A stream, and an index, standing of the **LZMA** walk stands refused (`UNSUPPORTED_FEATURE`), where the
  reference reaches a library of its own for it; a stream standing of a walk of no name stands refused as
  well, as the reference refuses it.
* An object of the kind `AudioClip` stands of no place of the walk at all, where the reference stands of it
  where the sound of it stands in a stream of the file and turns it away where it does not.
* A picture of the kind of the places of a colour of **seven places** (`25`), which the reference reads of a
  walk of its own, stands turned away; so do the kinds of the places of a colour of **four places of a place**
  (`13`) and the kinds of a fruit (`28`, `29`), which the reference turns away as well.
* A picture of a **red place of sixteen places** (`6`) stands as a picture of grey of one place of the file,
  of the high places of it, where the reference hands out a picture of grey of sixteen places: a bitmap of
  this project stands of no such depth of a colour.
* The names of the kinds of the walk of a newer asset stand of the file of the reference
  (`ArcFormats/Unity/strings.dat`, of a place of the walk of a name behind the places of the file itself),
  which this port carries as the run of the places of that file. A place of a name standing past the places
  of the file stands of no name at all.
* The whole of the streams of the file stand of one buffer rather than of a walk over the places of the
  file block by block, which is what a walk of the places of a stream of the reference does; the places of a
  stream that stands short of the file stand refused rather than read past it.

## Tests

`tests/formats/unity-fs.test.ts` builds an archive of the kind six of one stream and one bundle, of a
serialized asset of the kind eleven of one `TextAsset` of one script: the head of the file stands pinned
(the counts of the engine, the places of the index at the head of the file and behind the places of the file),
the walk of the index stands pinned (the streams and the bundles over them), the walk of the asset of the
bundle stands pinned (the count of the kind, the table of the kinds of it and the object of it) and the
places of the script of the object stand handed over. An index standing of the walk of the blocks of the
format stands beside it, and a word of another kind, a file that stands short of a head and a file of no
index of its own stand turned away.
