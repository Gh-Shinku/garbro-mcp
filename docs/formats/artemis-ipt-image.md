# Artemis composite picture (IPT)

* Reference: `Experimental/Artemis/ImageIPT.cs` with the language of `IPT.Language.grammar.y` and
  `IPT.Language.analyzer.lex` (class `IptFormat`), GARbro commit
  `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.
* Local id: `artemis-ipt-image`; tag `IPT`; extension `.ipt`.

The picture is a descriptor: it names a canvas and the pictures standing beside it, and the pictures are
drawn over the canvas one after another. The reference tells the picture by the name of the file alone and
then by the words of it.

## The language of the descriptor

```text
input: IDENTIFIER '=' object
object: '{' (statement (',' statement)*)? ','? '}'
statement: IDENTIFIER '=' value | value
value: object | STRING_LITERAL | NUMBER
```

A place of a colour stands of the places of one byte or of the strings of a picture, and the places of a
picture of them stand of the letters of a word alone (a number stands of its places and of no sign). A string
keeps the places behind its backslash as they stand, which is the reading of the reference: the reference
takes the places between the marks of the string and nothing more.

The reference reads the language with a parser of its own making (Gplex and gpgen, standing of the
`IPT.Scanner.Generated.cs`, `IPT.Parser.Generated.cs` and `ShiftReduceParserCode.cs` of it). This port reads
the same language with a small reader of its own: the words of the picture and the places of it, one after
another, of the same reading - a word naming a place stands of a field, and every other place stands of its
own among the places of the object.

## The picture

The picture the descriptor names stands under the word `ipt`. It holds the kind of the picture (`mode`), the
canvas (`base`) and the places of the pictures standing over it, one object each:

| the kind | the canvas |
| --- | --- |
| `cut` | the places of the pictures standing over it, of the places of a picture of four places to a pixel |
| `diff` | the picture the canvas names drawn under them, and the places of the pictures of three colours behind it |

The canvas stands of its places (`w` and `h`), of its corner (`x` and `y`) and of the name of the picture it
stands on, which stands first among the places of the canvas object. Every picture standing over it stands of
its own name (`file`), of its place in the canvas (`x` and `y`) and of a number of its own (`id`).

A picture of the kind `cut` names at least one picture standing over it; a picture naming no picture at all
stands of no picture of this engine.

## How the pictures stand over the canvas

Every picture is read of the places of the PNG file its name points at, of the directory of the descriptor,
and stands over the canvas of the places it holds: a place standing to the right of the canvas or below it
stands of nothing, and one standing over the edge of the canvas stands of the places of it that stand over
the canvas.

A place of a picture of four places to a pixel stands over the places of the canvas where its alpha names it:
a place of no alpha stands of nothing, a place standing of every place of the alpha of it, or over a place of
the canvas standing of no alpha of its own, stands as it stands, and every other place stands of the two of
them, of the alpha as many times as it names. A picture of three places to a pixel stands as it stands,
without an alpha.

## Deviations

* The PNG files the pictures stand of are read by this project (`shared/png-image.ts`) where the reference
  hands them to the decoder of its own system. A picture of the kind `diff` stands of three colours, and the
  places of an alpha the pictures beside it may have left in the canvas stand of nothing, as the kind of the
  picture names.
* The places of a picture standing of more than one pass (an interlaced PNG file), of a colour map standing
  of an alpha of its own, and of a colour of its own standing for the places of no colour are read as the
  reader of the PNG files of this project reads them: the passes and the places of an alpha of a colour map
  stand of nothing.
* The places of a picture standing before the corner of the canvas are kept where they stand over it; the
  reference walks its own places from the corner it was given, which stands before the canvas where that
  corner stands outside it. The language as it stands writes no place of a colour with a sign, so no picture
  of it names a corner of that kind.
* A picture standing of a name that reaches outside the directory of the descriptor, and one whose picture
  beside it stands of nothing, are turned away.

## Verification

Six tests over synthetic fixtures (`tests/formats/artemis-ipt-image.test.ts`): the words of the language of
the picture, of a string keeping the places behind its backslash and of a picture naming no place of its own;
the canvas of a picture and the places standing over it, of the kinds this engine does not know and of the
pictures it turns away; a picture of the kind `cut` of two pictures standing over each other, of the alpha of
one of them; a picture of the kind `diff` standing on the picture it names; a picture standing over the edge
of the canvas and one standing past it; and the words the format tells a picture by, of a picture reaching
outside its own directory and of one standing of a picture that stands of nothing.

The reader of the PNG files the pictures stand of stands of its own tests (`tests/unit/png-image.test.ts`):
the places of a picture of every kind and depth, the five kinds of filter a row may stand of, a picture
turning about words of its own chunks, a picture standing of its places in more than one pass, and a picture
standing short of its own places.

The places of a picture of a colour map standing of an alpha of its own, and the places of a picture of
`diff` kind standing of a picture of the other kind, stand in the port as they stand in the reference but no
fixture of them was finished; they stand among the places still to be verified of the record of this format,
together with the differential against the reference on real files.
