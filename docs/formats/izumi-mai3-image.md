# Izumi engine image (MI3)

* Reference: `Legacy/Izumi/ImageMAI3.cs` (classes `Mai3Format` and the `Mai3Reader` beside it), GARbro commit
  `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.
* Local id: `izumi-mai3-image`; tag `MI3`; extension `.mi3`.

## Head

The picture opens with the word `MAI03\x1a` and a head of its own behind it: the places of the picture as
words of eight places (the head stands of the places of the picture counted by eight), the places of the
picture, where its places stand, and a place of an own whose highest place names whether a colour map of its
own stands in front of the places.

The colour map stands of sixteen colours of four places to a colour, red first, every colour standing of the
four places as many times as make a place of it (four and a half of them make the places of a colour). A
picture whose head names no colour map stands of sixteen greys.

## The bits

The places of the picture stand of words of two places, of the **lowest** place of every word first; as a
word runs out the word behind it is read, and the places behind the end of the picture stand of nothing.

The reference asks the file for a word of two places wherever a word behind it stands, so a picture whose
places end between the two places of a word stands of the one place that stands there: the reference asks
for a word of two places where one stands, which its own reader holds against it, or reads the places of the
next picture. This port reads the one place that stands there and nothing behind it.

## The buffer and its planes

The places of the picture are read into a buffer of its own, of four planes standing over each other: the
places of a line of the picture stand of the places of the buffer itself, and the places of the three planes
over it. Before every pair of lines of the picture, the middle of the buffer moves onto the places at its
end (`m_buffer[0x10..0x370)` onto `m_buffer[0x370..0x6D0)`), which is how a line of the picture stands of the
lines before it.

## The lines of the picture

Every group of eight places of the picture stands of four lines of the buffer: the two lines of the places
and the two lines of the places after them. A line of the picture stands of either

* the places behind it: the bits name one of the four planes of the buffer, then a place before or behind
  the line, and then how many places the line stands of (a run of the bits, of the count behind it, standing
  as the count of the places and one of it); or
* the places of a colour: the bits name four places of a colour, of the place of the line above it, and the
  four places stand of the places of the picture of their own (every place of a colour spreads over the four
  planes of the buffer).

The reference reads the words naming the place a run stands of as chains of places standing clear in front of
the place that stands; this port reads the same count of places and takes the word of the chains off the
places behind it, which is the same reading of the bits.

## Deviations

* Every read is bounded: a picture whose places stand outside the buffer of it, and a picture whose places
  stand short of the file, are turned away rather than walking outside their own places.
* The places of the picture stand as the reference states them: a picture of four places to a pixel, handed
  over as a bitmap, of the colour map of the picture or of the greys of the engine.
* The places behind the end of a word stand of nothing where the reference reads the word behind it.

## Verification

Six tests over synthetic fixtures (`tests/formats/izumi-mai3-image.test.ts`): the head of a picture and the
ones it turns away; the colour map of a picture, of four places to a colour; a picture of no places of its
own, of the greys of the engine; a picture of a colour map of its own; a picture of three groups of eight
places, whose last group stands of the places of its own group; and the word the format tells a picture by.

A picture standing of the places of a colour (the lines of the picture the pattern of the places stands of)
stands in the port as it stands in the reference but no fixture of it was finished, because the places of
such a line stand of the places the line itself writes; they stand among the places still to be verified of
the record of this format, together with the differential against the reference on real files.
