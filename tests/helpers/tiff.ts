// Recorded TIFF fixtures: streams written by the Python imaging library (Pillow 11.1.0), together with
// the places each of them stands for, which the library hands over as well; they stand as an oracle of
// another implementation for `packages/formats/src/shared/tiff-image.ts`.

import { Buffer } from "node:buffer";

/** four by three places, one place of a colour a place. */
export const GREY_TIFF = Buffer.from(
	"SUkqAAgAAAAJAAABBAABAAAABAAAAAEBBAABAAAAAwAAAAIBAwABAAAACAAAAAMBAwABAAAAAQAAAAYBAwABAAAAAQAAABEBBAABAAAAegAAABYBBAABAAAAAwAAABcBBAABAAAADAAAABwBAwABAAAAAQAAAAAAAAAFFic4SVprfI2er8A=",
	"base64",
);

/** The places of GREY_TIFF, blue first, of the four places a bitmap reads. */
export const GREY_TIFF_PLACES: readonly number[] = [
	5, 22, 39, 56, 73, 90, 107, 124, 141, 158, 175, 192,
];

/** four by three places, one place of the file a place. */
export const BILEVEL_TIFF = Buffer.from(
	"SUkqAAgAAAAIAAABBAABAAAABAAAAAEBBAABAAAAAwAAAAMBAwABAAAAAQAAAAYBAwABAAAAAQAAABEBBAABAAAAbgAAABYBBAABAAAAAwAAABcBBAABAAAAAwAAABwBAwABAAAAAQAAAAAAAACwQNA=",
	"base64",
);

/** The places of BILEVEL_TIFF, blue first, of the four places a bitmap reads. */
export const BILEVEL_TIFF_PLACES: readonly number[] = [
	255, 0, 255, 255, 0, 255, 0, 0, 255, 255, 0, 255,
];

/** four by two places of a list of colours. */
export const PALETTE_TIFF = Buffer.from(
	"SUkqAAgAAAAKAAABBAABAAAABAAAAAEBBAABAAAAAgAAAAIBAwABAAAACAAAAAMBAwABAAAAAQAAAAYBAwABAAAAAwAAABEBBAABAAAAhgYAABYBBAABAAAAAgAAABcBBAABAAAACAAAABwBAwABAAAAAQAAAEABAwAAAwAAhgAAAAAAAAAAAAAVACoAPwBUAGkAfgCTAKgAvQDSAOcA/AARACYAOwBQAGUAegCPAKQAuQDOAOMA+AANACIANwBMAGEAdgCLAKAAtQDKAN8A9AAJAB4AMwBIAF0AcgCHAJwAsQDGANsA8AAFABoALwBEAFkAbgCDAJgArQDCANcA7AABABYAKwBAAFUAagB/AJQAqQC+ANMA6AD9ABIAJwA8AFEAZgB7AJAApQC6AM8A5AD5ABYANwBYAHkAmgC7ANwA/QAeAD8AYACBAKIAwwDkAAUAJgBHAGgAiQCqAMsA7AANAC4ATwBwAJEAsgDTAPQAFQA2AFcAeACZALoA2wD8AB0APgBfAIAAoQDCAOMABAAlAEYAZwCIAKkAygDrAAwALQBOAG8AkACxANIA8wAUADUAVgB3AJgAuQDaAPsAHAA9AF4AfwCgAMEA4gADACQARQBmAIcAqADJAOoADQA0AFsAggCpANAA9wAeAEUAbACTALoA4QAIAC8AVgB9AKQAywDyABkAQABnAI4AtQDcAAMAKgBRAHgAnwDGAO0AFAA7AGIAiQCwANcA/gAlAEwAcwCaAMEA6AAPADYAXQCEAKsA0gD5ACAARwBuAJUAvADjAAoAMQBYAH8ApgDNAPQAGwBCAGkAkAC3AN4ABQAsAFMAegChAMgA7wAWAD0AZACLALIA2QAHABwAMQBGAFsAcACFAJoArwDEANkA7gADABgALQBCAFcAbACBAJYAqwDAANUA6gD/ABQAKQA+AFMAaAB9AJIApwC8ANEA5gD7ABAAJQA6AE8AZAB5AI4AowC4AM0A4gD3AAwAIQA2AEsAYAB1AIoAnwC0AMkA3gDzAAgAHQAyAEcAXABxAIYAmwCwAMUA2gDvAAQAGQAuAEMAWABtAIIAlwCsAMEA1gDrAAAAIQBCAGMAhAClAMYA5wAIACkASgBrAIwArQDOAO8AEAAxAFIAcwCUALUA1gD3ABgAOQBaAHsAnAC9AN4A/wAgAEEAYgCDAKQAxQDmAAcAKABJAGoAiwCsAM0A7gAPADAAUQByAJMAtADVAPYAFwA4AFkAegCbALwA3QD+AB8AQABhAIIAowDEAOUABgAnAEgAaQCKAKsAzADtAA4ALwBQAHEAkgCzANQA9QAaAEEAaACPALYA3QAEACsAUgB5AKAAxwDuABUAPABjAIoAsQDYAP8AJgBNAHQAmwDCAOkAEAA3AF4AhQCsANMA+gAhAEgAbwCWAL0A5AALADIAWQCAAKcAzgD1ABwAQwBqAJEAuADfAAYALQBUAHsAogDJAPAAFwA+AGUAjACzANoAAQAoAE8AdgCdAMQA6wASADkAYACHAK4A1QD8ACMASgBxAJgAvwDmAA4AIwA4AE0AYgB3AIwAoQC2AMsA4AD1AAoAHwA0AEkAXgBzAIgAnQCyAMcA3ADxAAYAGwAwAEUAWgBvAIQAmQCuAMMA2ADtAAIAFwAsAEEAVgBrAIAAlQCqAL8A1ADpAP4AEwAoAD0AUgBnAHwAkQCmALsA0ADlAPoADwAkADkATgBjAHgAjQCiALcAzADhAPYACwAgADUASgBfAHQAiQCeALMAyADdAPIACwAsAE0AbgCPALAA0QDyABMANABVAHYAlwC4ANkA+gAbADwAXQB+AJ8AwADhAAIAIwBEAGUAhgCnAMgA6QAKACsATABtAI4ArwDQAPEAEgAzAFQAdQCWALcA2AD5ABoAOwBcAH0AngC/AOAAAQAiAEMAZACFAKYAxwDoAAkAKgBLAGwAjQCuAM8A8AARADIAUwB0AJUAtgDXAPgAGQA6AFsAfACdAL4A3wAAACcATgB1AJwAwwDqABEAOABfAIYArQDUAPsAIgBJAHAAlwC+AOUADAAzAFoAgQCoAM8A9gAdAEQAawCSALkA4AAHAC4AVQB8AKMAygDxABgAPwBmAI0AtADbAAIAKQBQAHcAngDFAOwAEwA6AGEAiACvANYA/QAkAEsAcgCZAMAA5wAOADUAXACDAKoA0QD4AB8ARgBtAJQAuwDiAAkAMABXAH4ApQDMAPMAAQIDBAUGBw==",
	"base64",
);

/** The list of colours of PALETTE_TIFF, blue first, of the four places a list holds; the places of the picture stand of the eight counts 0 to 7. */
export const PALETTE_TIFF_PLACES: readonly number[] = [
	14, 7, 0, 255, 35, 28, 21, 255, 56, 49, 42, 255, 77, 70, 63, 255, 98, 91, 84,
	255, 119, 112, 105, 255, 140, 133, 126, 255, 161, 154, 147, 255, 182, 175,
	168, 255, 203, 196, 189, 255, 224, 217, 210, 255, 245, 238, 231, 255, 10, 3,
	252, 255, 31, 24, 17, 255, 52, 45, 38, 255, 73, 66, 59, 255, 94, 87, 80, 255,
	115, 108, 101, 255, 136, 129, 122, 255, 157, 150, 143, 255, 178, 171, 164,
	255, 199, 192, 185, 255, 220, 213, 206, 255, 241, 234, 227, 255, 6, 255, 248,
	255, 27, 20, 13, 255, 48, 41, 34, 255, 69, 62, 55, 255, 90, 83, 76, 255, 111,
	104, 97, 255, 132, 125, 118, 255, 153, 146, 139, 255, 174, 167, 160, 255, 195,
	188, 181, 255, 216, 209, 202, 255, 237, 230, 223, 255, 2, 251, 244, 255, 23,
	16, 9, 255, 44, 37, 30, 255, 65, 58, 51, 255, 86, 79, 72, 255, 107, 100, 93,
	255, 128, 121, 114, 255, 149, 142, 135, 255, 170, 163, 156, 255, 191, 184,
	177, 255, 212, 205, 198, 255, 233, 226, 219, 255, 254, 247, 240, 255, 19, 12,
	5, 255, 40, 33, 26, 255, 61, 54, 47, 255, 82, 75, 68, 255, 103, 96, 89, 255,
	124, 117, 110, 255, 145, 138, 131, 255, 166, 159, 152, 255, 187, 180, 173,
	255, 208, 201, 194, 255, 229, 222, 215, 255, 250, 243, 236, 255, 15, 8, 1,
	255, 36, 29, 22, 255, 57, 50, 43, 255, 78, 71, 64, 255, 99, 92, 85, 255, 120,
	113, 106, 255, 141, 134, 127, 255, 162, 155, 148, 255, 183, 176, 169, 255,
	204, 197, 190, 255, 225, 218, 211, 255, 246, 239, 232, 255, 11, 4, 253, 255,
	32, 25, 18, 255, 53, 46, 39, 255, 74, 67, 60, 255, 95, 88, 81, 255, 116, 109,
	102, 255, 137, 130, 123, 255, 158, 151, 144, 255, 179, 172, 165, 255, 200,
	193, 186, 255, 221, 214, 207, 255, 242, 235, 228, 255, 11, 0, 249, 255, 44,
	33, 22, 255, 77, 66, 55, 255, 110, 99, 88, 255, 143, 132, 121, 255, 176, 165,
	154, 255, 209, 198, 187, 255, 242, 231, 220, 255, 19, 8, 253, 255, 52, 41, 30,
	255, 85, 74, 63, 255, 118, 107, 96, 255, 151, 140, 129, 255, 184, 173, 162,
	255, 217, 206, 195, 255, 250, 239, 228, 255, 27, 16, 5, 255, 60, 49, 38, 255,
	93, 82, 71, 255, 126, 115, 104, 255, 159, 148, 137, 255, 192, 181, 170, 255,
	225, 214, 203, 255, 2, 247, 236, 255, 35, 24, 13, 255, 68, 57, 46, 255, 101,
	90, 79, 255, 134, 123, 112, 255, 167, 156, 145, 255, 200, 189, 178, 255, 233,
	222, 211, 255, 10, 255, 244, 255, 43, 32, 21, 255, 76, 65, 54, 255, 109, 98,
	87, 255, 142, 131, 120, 255, 175, 164, 153, 255, 208, 197, 186, 255, 241, 230,
	219, 255, 18, 7, 252, 255, 51, 40, 29, 255, 84, 73, 62, 255, 117, 106, 95,
	255, 150, 139, 128, 255, 183, 172, 161, 255, 216, 205, 194, 255, 249, 238,
	227, 255, 26, 15, 4, 255, 59, 48, 37, 255, 92, 81, 70, 255, 125, 114, 103,
	255, 158, 147, 136, 255, 191, 180, 169, 255, 224, 213, 202, 255, 1, 246, 235,
	255, 34, 23, 12, 255, 67, 56, 45, 255, 100, 89, 78, 255, 133, 122, 111, 255,
	166, 155, 144, 255, 199, 188, 177, 255, 232, 221, 210, 255, 9, 254, 243, 255,
	42, 31, 20, 255, 75, 64, 53, 255, 108, 97, 86, 255, 141, 130, 119, 255, 174,
	163, 152, 255, 207, 196, 185, 255, 240, 229, 218, 255, 17, 6, 251, 255, 50,
	39, 28, 255, 83, 72, 61, 255, 116, 105, 94, 255, 149, 138, 127, 255, 182, 171,
	160, 255, 215, 204, 193, 255, 248, 237, 226, 255, 25, 14, 3, 255, 58, 47, 36,
	255, 91, 80, 69, 255, 124, 113, 102, 255, 157, 146, 135, 255, 190, 179, 168,
	255, 223, 212, 201, 255, 0, 245, 234, 255, 39, 26, 13, 255, 78, 65, 52, 255,
	117, 104, 91, 255, 156, 143, 130, 255, 195, 182, 169, 255, 234, 221, 208, 255,
	17, 4, 247, 255, 56, 43, 30, 255, 95, 82, 69, 255, 134, 121, 108, 255, 173,
	160, 147, 255, 212, 199, 186, 255, 251, 238, 225, 255, 34, 21, 8, 255, 73, 60,
	47, 255, 112, 99, 86, 255, 151, 138, 125, 255, 190, 177, 164, 255, 229, 216,
	203, 255, 12, 255, 242, 255, 51, 38, 25, 255, 90, 77, 64, 255, 129, 116, 103,
	255, 168, 155, 142, 255, 207, 194, 181, 255, 246, 233, 220, 255, 29, 16, 3,
	255, 68, 55, 42, 255, 107, 94, 81, 255, 146, 133, 120, 255, 185, 172, 159,
	255, 224, 211, 198, 255, 7, 250, 237, 255, 46, 33, 20, 255, 85, 72, 59, 255,
	124, 111, 98, 255, 163, 150, 137, 255, 202, 189, 176, 255, 241, 228, 215, 255,
	24, 11, 254, 255, 63, 50, 37, 255, 102, 89, 76, 255, 141, 128, 115, 255, 180,
	167, 154, 255, 219, 206, 193, 255, 2, 245, 232, 255, 41, 28, 15, 255, 80, 67,
	54, 255, 119, 106, 93, 255, 158, 145, 132, 255, 197, 184, 171, 255, 236, 223,
	210, 255, 19, 6, 249, 255, 58, 45, 32, 255, 97, 84, 71, 255, 136, 123, 110,
	255, 175, 162, 149, 255, 214, 201, 188, 255, 253, 240, 227, 255, 36, 23, 10,
	255, 75, 62, 49, 255, 114, 101, 88, 255, 153, 140, 127, 255, 192, 179, 166,
	255, 231, 218, 205, 255, 14, 1, 244, 255, 53, 40, 27, 255, 92, 79, 66, 255,
	131, 118, 105, 255, 170, 157, 144, 255, 209, 196, 183, 255, 248, 235, 222,
	255, 31, 18, 5, 255, 70, 57, 44, 255, 109, 96, 83, 255, 148, 135, 122, 255,
	187, 174, 161, 255, 226, 213, 200, 255, 9, 252, 239, 255, 48, 35, 22, 255, 87,
	74, 61, 255, 126, 113, 100, 255, 165, 152, 139, 255, 204, 191, 178, 255, 243,
	230, 217, 255,
];

/** three by two places of a colour. */
export const COLOUR_TIFF = Buffer.from(
	"SUkqAAgAAAAKAAABBAABAAAAAwAAAAEBBAABAAAAAgAAAAIBAwADAAAAhgAAAAMBAwABAAAAAQAAAAYBAwABAAAAAgAAABEBBAABAAAAjAAAABUBAwABAAAAAwAAABYBBAABAAAAAgAAABcBBAABAAAAEgAAABwBAwABAAAAAQAAAAAAAAAIAAgACAAAAAAoCh5QFDwUMgU8PCNkRkE=",
	"base64",
);

/** The places of COLOUR_TIFF, blue first, of the four places a bitmap reads. */
export const COLOUR_TIFF_PLACES: readonly number[] = [
	0, 0, 0, 30, 10, 40, 60, 20, 80, 5, 50, 20, 35, 60, 60, 65, 70, 100,
];

/** three by two places of four. */
export const ALPHA_TIFF = Buffer.from(
	"SUkqAAgAAAALAAABBAABAAAAAwAAAAEBBAABAAAAAgAAAAIBAwAEAAAAkgAAAAMBAwABAAAAAQAAAAYBAwABAAAAAgAAABEBBAABAAAAmgAAABUBAwABAAAABAAAABYBBAABAAAAAgAAABcBBAABAAAAGAAAABwBAwABAAAAAQAAAFIBAwABAAAAAgAAAAAAAAAIAAgACAAIAAAAAAAoCh48UBQ8eBQyBR48PCNaZEZBlg==",
	"base64",
);

/** The places of ALPHA_TIFF, blue first, of the four places a bitmap reads. */
export const ALPHA_TIFF_PLACES: readonly number[] = [
	0, 0, 0, 0, 30, 10, 40, 60, 60, 20, 80, 120, 5, 50, 20, 30, 35, 60, 60, 90,
	65, 70, 100, 150,
];

/** the walk of the zlib kind over the places of a colour. */
export const DEFLATE_TIFF = Buffer.from(
	"SUkqACIAAAB4nGNgYNDgkgsQsRExYrWxUU5xcwQAEvACwgoAAAEDAAEAAAADAAAAAQEDAAEAAAACAAAAAgEDAAMAAACgAAAAAwEDAAEAAAAIAAAABgEDAAEAAAACAAAAEQEEAAEAAAAIAAAAFQEDAAEAAAADAAAAFgEDAAEAAAACAAAAFwEEAAEAAAAaAAAAHAEDAAEAAAABAAAAAAAAAAgACAAIAA==",
	"base64",
);

/** The places of DEFLATE_TIFF, blue first, of the four places a bitmap reads. */
export const DEFLATE_TIFF_PLACES: readonly number[] = [
	0, 0, 0, 30, 10, 40, 60, 20, 80, 5, 50, 20, 35, 60, 60, 65, 70, 100,
];

/** the pack of bytes over the places of a colour. */
export const PACKBITS_TIFF = Buffer.from(
	"SUkqABwAAAD+AAUoCh5QFDwIFDIFPDwjZEZBAAoAAAEDAAEAAAADAAAAAQEDAAEAAAACAAAAAgEDAAMAAACaAAAAAwEDAAEAAAAFgAAABgEDAAEAAAACAAAAEQEEAAEAAAAIAAAAFQEDAAEAAAADAAAAFgEDAAEAAAACAAAAFwEEAAEAAAATAAAAHAEDAAEAAAABAAAAAAAAAAgACAAIAA==",
	"base64",
);

/** The places of PACKBITS_TIFF, blue first, of the four places a bitmap reads. */
export const PACKBITS_TIFF_PLACES: readonly number[] = [
	0, 0, 0, 30, 10, 40, 60, 20, 80, 5, 50, 20, 35, 60, 60, 65, 70, 100,
];

/** sixteen places of the file a sample, of the high places of the file. */
export const SIXTEEN_TIFF = Buffer.from(
	"SUkqAAgAAAAJAAABBAABAAAAAwAAAAEBBAABAAAAAgAAAAIBAwABAAAAEAAAAAMBAwABAAAAAQAAAAYBAwABAAAAAQAAABEBBAABAAAAegAAABYBBAABAAAAAgAAABcBBAABAAAADAAAABwBAwABAAAAAQAAAAAAAAA0EnhWvJrw3hERIiI=",
	"base64",
);

/** The places of SIXTEEN_TIFF, blue first, of the four places a bitmap reads. */
export const SIXTEEN_TIFF_PLACES: readonly number[] = [
	18, 86, 154, 222, 17, 34,
];

/** Three by two places of a colour, of the walk of the counts of twelve places of the file. */
export const LZW_TIFF = Buffer.from(
	"SUkqAB4AAACAACBCgFB4oBQeBQZAUeDwRmQjEGAgCgAAAQMAAQAAAAMAAAABAQMAAQAAAAIAAAACAQMAAwAAAJwAAAADAQMAAQAAAAUAAAAGAQMAAQAAAAIAAAARAQQAAQAAAAgAAAAVAQMAAQAAAAMAAAAWAQMAAQAAAAIAAAAXAQQAAQAAABYAAAAcAQMAAQAAAAEAAAAAAAAACAAIAAgA",
	"base64",
);

/** The places of LZW_TIFF, blue first, of the four places a bitmap reads. */
export const LZW_TIFF_PLACES: readonly number[] = [
	0, 0, 0, 30, 10, 40, 60, 20, 80, 5, 50, 20, 35, 60, 60, 65, 70, 100,
];

/** Four by three places of the colour of the press, of the four places of a colour a place. */
export const PRESS_TIFF = Buffer.from(
	"SUkqAAgAAAAKAAABBAABAAAABAAAAAEBBAABAAAAAwAAAAIBAwAEAAAAhgAAAAMBAwABAAAAAQAAAAYBAwABAAAABQAAABEBBAABAAAAjgAAABUBAwABAAAABAAAABYBBAABAAAAAwAAABcBBAABAAAAMAAAABwBAwABAAAAAQAAAAAAAAAIAAgACAAIAAAAAAAfABEHPgAiDl0AMxUAHREFHx0iDD4dMxNdHUQaADoiCh86MxE+OkQYXTpVHw==",
	"base64",
);

/** The places of PRESS_TIFF, blue first, of the four places a bitmap reads. */
export const PRESS_TIFF_PLACES: readonly number[] = [
	255, 255, 255, 231, 248, 218, 209, 241, 182, 187, 234, 149, 233, 222, 250,
	211, 215, 213, 189, 209, 179, 168, 203, 145, 212, 189, 245, 190, 184, 209,
	169, 178, 175, 149, 173, 142,
];

/** Five by five places of a colour, whose places stand in four tiles of four by four, a colour a tile. */
export const TILED_TIFF = Buffer.from(
	"SUkqAAgAAAALAAABAwABAAAABQAAAAEBAwABAAAABQAAAAIBAwADAAAAkgAAAAMBAwABAAAAAQAAAAYBAwABAAAAAgAAABUBAwABAAAAAwAAABwBAwABAAAAAQAAAEIBAwABAAAABAAAAEMBAwABAAAABAAAAEQBBAAEAAAAmAAAAEUBBAAEAAAAqAAAAAAAAAAIAAgACAC4AAAA6AAAABgBAABIAQAAMAAAADAAAAAwAAAAMAAAAAoUHgoUHgoUHgoUHgoUHgoUHgoUHgoUHgoUHgoUHgoUHgoUHgoUHgoUHgoUHgoUHigyPCgyPCgyPCgyPCgyPCgyPCgyPCgyPCgyPCgyPCgyPCgyPCgyPCgyPCgyPCgyPEZQWkZQWkZQWkZQWkZQWkZQWkZQWkZQWkZQWkZQWkZQWkZQWkZQWkZQWkZQWkZQWmRueGRueGRueGRueGRueGRueGRueGRueGRueGRueGRueGRueGRueGRueGRueGRueA==",
	"base64",
);

/** The places of TILED_TIFF, blue first: a count of a colour a tile, of the right and the lower tile clipped. */
export const TILED_TIFF_PLACES: readonly number[] = [
	30, 20, 10, 30, 20, 10, 30, 20, 10, 30, 20, 10, 60, 50, 40, 30, 20, 10, 30,
	20, 10, 30, 20, 10, 30, 20, 10, 60, 50, 40, 30, 20, 10, 30, 20, 10, 30, 20,
	10, 30, 20, 10, 60, 50, 40, 30, 20, 10, 30, 20, 10, 30, 20, 10, 30, 20, 10,
	60, 50, 40, 90, 80, 70, 90, 80, 70, 90, 80, 70, 90, 80, 70, 120, 110, 100,
];

/** Four by three places of sixteen places of the file a sample, whose rows stand of the difference of the row in
 * front of them. The python imaging library reads no such file of this walk, so the counts of the places of the picture stand as the counts the builder wrote down, of the rule of the head of the format. */
export const PREDICTOR_TIFF = Buffer.from(
	"SUkqAAgAAAAKAAABBAABAAAABAAAAAEBBAABAAAAAwAAAAIBAwABAAAAEAAAAAMBAwABAAAAAQAAAAYBAwABAAAAAQAAABEBBAABAAAAiAAAABUBAwABAAAAAQAAABYBBAABAAAAAwAAABcBBAABAAAAGAAAAD0BAwABAAAAAgAAAAAAAAAQAAAABQIFAgUCFAgFAgUCBQIoEAUCBQIFAg==",
	"base64",
);

/** The places of PREDICTOR_TIFF, of the high place of the file of every sample. */
export const PREDICTOR_TIFF_PLACES: readonly number[] = [
	0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22,
];

/** Sixteen by eight places of a colour, whose places stand of the walk of the jpeg, in one strip of their own:
 * the file was built by this project, and the python imaging library reads it back through libtiff. */
export const JPEG_TIFF = Buffer.from(
	"SUkqAAgAAAAKAAABBAABAAAAEAAAAAEBBAABAAAACAAAAAIBAwADAAAAhgAAAAMBAwABAAAABwAAAAYBAwABAAAAAgAAABEBBAABAAAAjAAAABUBAwABAAAAAwAAABYBBAABAAAACAAAABcBBAABAAAAoAIAABwBAwABAAAAAQAAAAAAAAAIAAgACAD/2P/gABBKRklGAAEBAAABAAEAAP/bAEMAAgEBAQEBAgEBAQICAgICBAMCAgICBQQEAwQGBQYGBgUGBgYHCQgGBwkHBgYICwgJCgoKCgoGCAsMCwoMCQoKCv/bAEMBAgICAgICBQMDBQoHBgcKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCv/AABEIAAgAEAMBEQACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjQ1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj5OXm5+jp6vHy8/T19vf4+fr/xAAfAQADAQEBAQEBAQEBAAAAAAAAAQIDBAUGBwgJCgv/xAC1EQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEAAhEDEQA/APyH8Hfs/wD3P9B9P4arB4rY8TI+LtV7x6p4O/Z/4T/Quw/hr6vB4o/Y8k4u294//9k=",
	"base64",
);

/** The places the jpeg stream of JPEG_TIFF stands for, blue first, of the four places a bitmap reads: the library
 * decodes the stream of it, of the walk of the jpeg it stands of. */
export const JPEG_TIFF_PLACES: readonly number[] = [
	0, 0, 1, 5, 1, 7, 9, 0, 13, 15, 0, 21, 18, 1, 28, 22, 1, 34, 28, 0, 43, 35, 1,
	48, 39, 0, 55, 43, 0, 63, 48, 1, 70, 54, 0, 77, 60, 0, 84, 65, 1, 91, 69, 0,
	97, 74, 1, 104, 5, 10, 1, 10, 11, 9, 16, 10, 15, 20, 10, 22, 25, 11, 29, 29,
	10, 35, 35, 10, 44, 40, 11, 50, 45, 9, 56, 50, 11, 63, 55, 11, 72, 59, 10, 78,
	66, 10, 85, 72, 10, 92, 76, 10, 99, 79, 12, 104, 10, 22, 0, 15, 22, 7, 22, 23,
	14, 26, 22, 21, 30, 23, 28, 35, 23, 35, 41, 22, 43, 45, 23, 48, 50, 20, 55,
	56, 22, 63, 60, 22, 70, 64, 22, 77, 71, 22, 84, 77, 22, 91, 81, 22, 97, 84,
	23, 103, 14, 33, 0, 20, 33, 7, 26, 32, 13, 31, 33, 21, 36, 33, 28, 39, 33, 34,
	46, 32, 43, 51, 34, 48, 55, 31, 55, 59, 34, 62, 66, 33, 70, 69, 33, 77, 76,
	33, 84, 81, 33, 91, 85, 33, 97, 89, 34, 103, 19, 43, 1, 24, 45, 7, 30, 45, 14,
	34, 44, 21, 39, 45, 28, 44, 45, 36, 49, 44, 43, 56, 44, 50, 60, 43, 57, 65,
	45, 64, 69, 44, 70, 75, 44, 77, 79, 44, 84, 86, 44, 91, 90, 43, 99, 95, 44,
	104, 24, 54, 1, 29, 55, 7, 35, 55, 13, 39, 55, 21, 44, 56, 28, 48, 55, 34, 55,
	55, 43, 59, 55, 50, 64, 53, 56, 70, 55, 63, 74, 55, 70, 78, 55, 77, 85, 55,
	84, 91, 55, 91, 95, 55, 97, 98, 56, 104, 30, 66, 0, 34, 67, 6, 41, 67, 13, 45,
	67, 19, 49, 67, 26, 54, 67, 35, 60, 66, 41, 65, 67, 48, 70, 65, 56, 76, 67,
	63, 80, 67, 69, 83, 66, 75, 90, 67, 82, 96, 67, 90, 100, 66, 97, 103, 67, 103,
	35, 76, 1, 41, 77, 7, 48, 77, 14, 52, 77, 21, 55, 77, 28, 61, 78, 35, 65, 76,
	43, 72, 77, 50, 76, 75, 55, 80, 77, 63, 85, 77, 70, 90, 76, 77, 97, 76, 84,
	102, 77, 91, 105, 77, 97, 110, 77, 104,
];

/** Four by three places of a colour whose places of a colour stand apart, one count of strips for every place of a
 * colour. The file was built by this project and the python imaging library reads it back through libtiff, which
 * stands as an oracle of another implementation for it. */
export const PLANAR_TIFF = Buffer.from(
	"SUkqAAgAAAAKAAABBAABAAAABAAAAAEBBAABAAAAAwAAAAIBAwADAAAAhgAAAAMBAwABAAAAAQAAAAYBAwABAAAAAgAAABEBBAADAAAAjAAAABUBAwABAAAAAwAAABYBBAABAAAAAwAAABcBBAADAAAAmAAAABwBAwABAAAAAgAAAAAAAAAIAAgACACkAAAAsAAAALwAAAAMAAAADAAAAAwAAAAAKFB4By9Xfw42XoYABQoPPEFGS3h9gocAHjxaAyE/XQYkQmA=",
	"base64",
);

/** The places of PLANAR_TIFF, blue first, of the four places a bitmap reads. */
export const PLANAR_TIFF_PLACES: readonly number[] = [
	0, 0, 0, 30, 5, 40, 60, 10, 80, 90, 15, 120, 3, 60, 7, 33, 65, 47, 63, 70, 87,
	93, 75, 127, 6, 120, 14, 36, 125, 54, 66, 130, 94, 96, 135, 134,
];

/** Four by three places of the colour of the two of them, one place of the file a place: the file was built by this
 * project, of the counts of the head of the format of the two of them rather than of another implementation, since
 * the library of this machine reads no such file of that counting. */
export const TWO_COLOUR_TIFF = Buffer.from(
	"SUkqAAgAAAAKAAABBAABAAAABAAAAAEBBAABAAAAAwAAAAIBAwADAAAAhgAAAAMBAwABAAAAAQAAAAYBAwABAAAABgAAABEBBAABAAAAjAAAABUBAwABAAAAAwAAABYBBAABAAAAAwAAABcBBAABAAAAJAAAABICAwACAAAAAQABAAAAAAAIAAgACAAobnhGd3hkgHiCiXgoboNGd4NkgIOCiYMobo5Gd45kgI6CiY4=",
	"base64",
);

/** The places of TWO_COLOUR_TIFF, blue first, of the counts of the walk of the colour of the two of them. */
export const TWO_COLOUR_TIFF_PLACES: readonly number[] = [
	8, 52, 29, 54, 79, 59, 100, 106, 89, 146, 133, 119, 8, 44, 44, 54, 71, 74,
	100, 98, 104, 146, 125, 134, 8, 36, 60, 54, 63, 90, 100, 90, 120, 146, 117,
	150,
];

/** Sixteen by eight places of one place of the file whose count of the places of the file of the colour of the
 * picture (the dark place) stands of the counts of the head of the format of the fax of one place of the file
 * (group 3 of the format): the file was written by the python imaging library. */
export const FAX_THREE_TIFF = Buffer.from(
	"SUkqACgAAAAAGKBgAmtFDABigYAJrRQwAYoGACa0UMAGKBgAmtFDAAkAAAEDAAEAAAAQAAAAAQEDAAEAAAAIAAAAAgEDAAEAAAABAAAAAwEDAAEAAAADAAAABgEDAAEAAAABAAAAEQEEAAEAAAAIAAAAFgEDAAEAAAAIAAAAFwEEAAEAAAAfAAAAHAEDAAEAAAABAAAAAAAAAA==",
	"base64",
);

/** The same places of the file, of the counts of the head of the format of the fax of the two places of the file
 * (group 4 of the format), written by the python imaging library. */
export const FAX_FOUR_TIFF = Buffer.from(
	"SUkqACYAAAAxGBggQI0QYIFBAgRogwQKCBAjRBggUECBGiACACAJAAABAwABAAAAEAAAAAEBAwABAAAACAAAAAIBAwABAAAAAQAAAAMBAwABAAAABAAAAAYBAwABAAAAAQAAABEBBAABAAAACAAAABYBAwABAAAACAAAABcBBAABAAAAHgAAABwBAwABAAAAAQAAAAAAAAA=",
	"base64",
);

/** The places of the pictures of the fax, of one place of the file a place of the picture: the count of the file of
 * a place of the colour of the picture (the dark place) and the count of the places of the file of the colour of
 * the picture of the other, the counts the library hands back. */
export const FAX_TIFF_PLACES: readonly number[] = [
	0, 0, 0, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255,
	255, 0, 0, 0, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 255, 255,
	255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255,
	255, 255, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 0, 0, 0, 255,
	255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 0, 0, 0,
	255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255,
	255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255,
];

/** Sixteen by sixteen places of a colour, of the counts of the head of the walk of the jpeg of the picture of the
 * format itself: the stream of the strip carries no counts of the head of the color of the picture and of the walk
 * of the jpeg of it, which stand of the count of the head of the picture of the format (the counts of the head of
 * the format of the jpeg of the picture of the format, tag 347). The python imaging library wrote the file and
 * reads it back through libtiff, of the counts of the head of the walk of the jpeg of that library. */
export const TABLES_TIFF = Buffer.from(
	"SUkqAKoAAAD/2P/AABEIABAAEANSEQBHEQBCEQD/2gAMA1IARwBCAAA/APj/APZt/wCXX8K+P/8Ahm3/AKdf/Ha+P/ht8Nv9V+69O1fqr+zb/wAuv4Uf8M2/9Ov/AI7X1X8Nvht/qv3Xp2r8qv2bf+XX8K/VX/hm3/p1/wDHaPht8Nv9V+69O1fqr+zb/wAuv4Uf8M2/9Ov/AI7X1V8Nvht/qv3Xp2r/2QALAAABAwABAAAAEAAAAAEBAwABAAAAEAAAAAIBAwADAAAANAEAAAMBAwABAAAABwAAAAYBAwABAAAAAgAAABEBBAABAAAACAAAABUBAwABAAAAAwAAABYBAwABAAAAEAAAABcBBAABAAAAoQAAABwBAwABAAAAAQAAAFsBBwAhAQAAOgEAAAAAAAAIAAgACAD/2P/bAEMAAwICAwICAwMDAwQDAwQFCAUFBAQFCgcHBggMCgwMCwoLCw0OEhANDhEOCwsQFhARExQVFRUMDxcYFhQYEhQVFP/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/Z",
	"base64",
);

/** The places of TABLES_TIFF, blue first, of the counts of the head of the walk of the jpeg of the python imaging
 * library: the counts of the head of the picture of the format stand of the names of the places of the file of the
 * colours of the picture (R, G, B), which the walk of this project reads as well. */
export const TABLES_TIFF_PLACES: readonly number[] = [
	0, 0, 0, 255, 8, 0, 16, 255, 16, 0, 32, 255, 23, 0, 48, 255, 33, 0, 64, 255,
	40, 0, 80, 255, 48, 0, 96, 255, 56, 0, 112, 255, 64, 0, 128, 255, 73, 0, 143,
	255, 80, 0, 160, 255, 87, 0, 176, 255, 97, 0, 192, 255, 104, 0, 208, 255, 112,
	0, 224, 255, 120, 0, 240, 255, 8, 16, 0, 255, 16, 16, 16, 255, 24, 16, 32,
	255, 31, 16, 48, 255, 41, 16, 64, 255, 48, 16, 80, 255, 55, 16, 96, 255, 64,
	16, 112, 255, 72, 16, 128, 255, 81, 16, 143, 255, 88, 16, 160, 255, 95, 16,
	176, 255, 105, 16, 192, 255, 112, 16, 208, 255, 120, 16, 224, 255, 128, 16,
	240, 255, 16, 32, 0, 255, 25, 32, 16, 255, 32, 32, 32, 255, 39, 32, 48, 255,
	49, 32, 64, 255, 56, 32, 80, 255, 64, 32, 96, 255, 72, 32, 112, 255, 80, 32,
	128, 255, 89, 32, 143, 255, 96, 32, 160, 255, 103, 32, 176, 255, 113, 32, 192,
	255, 120, 32, 208, 255, 128, 32, 224, 255, 137, 32, 240, 255, 23, 47, 0, 255,
	32, 47, 16, 255, 40, 47, 32, 255, 47, 47, 48, 255, 56, 47, 64, 255, 64, 47,
	80, 255, 71, 47, 96, 255, 80, 47, 112, 255, 88, 47, 128, 255, 96, 47, 143,
	255, 104, 47, 160, 255, 111, 47, 176, 255, 121, 47, 192, 255, 128, 47, 208,
	255, 135, 47, 224, 255, 144, 47, 240, 255, 32, 65, 0, 255, 41, 65, 16, 255,
	48, 65, 32, 255, 56, 65, 48, 255, 65, 65, 64, 255, 72, 65, 80, 255, 80, 65,
	96, 255, 89, 65, 112, 255, 96, 65, 128, 255, 105, 65, 143, 255, 112, 65, 160,
	255, 120, 65, 176, 255, 129, 65, 192, 255, 136, 65, 208, 255, 144, 65, 224,
	255, 153, 65, 240, 255, 40, 80, 0, 255, 48, 80, 16, 255, 56, 80, 32, 255, 63,
	80, 48, 255, 73, 80, 64, 255, 80, 80, 80, 255, 87, 80, 96, 255, 96, 80, 112,
	255, 104, 80, 128, 255, 112, 80, 143, 255, 120, 80, 160, 255, 127, 80, 176,
	255, 137, 80, 192, 255, 144, 80, 208, 255, 152, 80, 224, 255, 160, 80, 240,
	255, 48, 96, 0, 255, 57, 96, 16, 255, 64, 96, 32, 255, 71, 96, 48, 255, 81,
	96, 64, 255, 88, 96, 80, 255, 96, 96, 96, 255, 104, 96, 112, 255, 112, 96,
	128, 255, 121, 96, 143, 255, 128, 96, 160, 255, 135, 96, 176, 255, 145, 96,
	192, 255, 152, 96, 208, 255, 160, 96, 224, 255, 168, 96, 240, 255, 56, 112, 0,
	255, 64, 112, 16, 255, 72, 112, 32, 255, 79, 112, 48, 255, 89, 112, 64, 255,
	96, 112, 80, 255, 104, 112, 96, 255, 112, 112, 112, 255, 120, 112, 128, 255,
	129, 112, 143, 255, 136, 112, 160, 255, 143, 112, 176, 255, 153, 112, 192,
	255, 160, 112, 208, 255, 168, 112, 224, 255, 176, 112, 240, 255, 64, 128, 0,
	255, 73, 128, 16, 255, 80, 128, 32, 255, 87, 128, 48, 255, 97, 128, 64, 255,
	104, 128, 80, 255, 112, 128, 96, 255, 120, 128, 112, 255, 128, 128, 128, 255,
	136, 128, 143, 255, 144, 128, 160, 255, 151, 128, 176, 255, 161, 128, 192,
	255, 168, 128, 208, 255, 175, 128, 224, 255, 184, 128, 240, 255, 72, 144, 0,
	255, 81, 144, 16, 255, 88, 144, 32, 255, 95, 144, 48, 255, 105, 144, 64, 255,
	112, 144, 80, 255, 120, 144, 96, 255, 128, 144, 112, 255, 136, 144, 128, 255,
	144, 144, 143, 255, 152, 144, 160, 255, 159, 144, 176, 255, 169, 144, 192,
	255, 176, 144, 208, 255, 183, 144, 224, 255, 192, 144, 240, 255, 80, 160, 0,
	255, 89, 160, 16, 255, 96, 160, 32, 255, 103, 160, 48, 255, 113, 160, 64, 255,
	120, 160, 80, 255, 128, 160, 96, 255, 137, 160, 112, 255, 144, 160, 128, 255,
	152, 160, 143, 255, 160, 160, 160, 255, 167, 160, 176, 255, 177, 160, 192,
	255, 184, 160, 208, 255, 192, 160, 224, 255, 200, 160, 240, 255, 88, 175, 0,
	255, 96, 175, 16, 255, 104, 175, 32, 255, 111, 175, 48, 255, 121, 175, 64,
	255, 128, 175, 80, 255, 135, 175, 96, 255, 144, 175, 112, 255, 151, 175, 128,
	255, 160, 175, 143, 255, 168, 175, 160, 255, 175, 175, 176, 255, 184, 175,
	192, 255, 192, 175, 208, 255, 199, 175, 224, 255, 208, 175, 240, 255, 96, 192,
	0, 255, 105, 192, 16, 255, 112, 192, 32, 255, 120, 192, 48, 255, 129, 192, 64,
	255, 136, 192, 80, 255, 144, 192, 96, 255, 153, 192, 112, 255, 160, 192, 128,
	255, 169, 192, 143, 255, 176, 192, 160, 255, 183, 192, 176, 255, 193, 192,
	192, 255, 200, 192, 208, 255, 208, 192, 224, 255, 216, 192, 240, 255, 104,
	208, 0, 255, 112, 208, 16, 255, 120, 208, 32, 255, 127, 208, 48, 255, 137,
	208, 64, 255, 144, 208, 80, 255, 152, 208, 96, 255, 160, 208, 112, 255, 167,
	208, 128, 255, 176, 208, 143, 255, 184, 208, 160, 255, 191, 208, 176, 255,
	201, 208, 192, 255, 208, 208, 208, 255, 215, 208, 224, 255, 224, 208, 240,
	255, 112, 224, 0, 255, 121, 224, 16, 255, 128, 224, 32, 255, 135, 224, 48,
	255, 145, 224, 64, 255, 152, 224, 80, 255, 160, 224, 96, 255, 168, 224, 112,
	255, 176, 224, 128, 255, 184, 224, 143, 255, 192, 224, 160, 255, 199, 224,
	176, 255, 209, 224, 192, 255, 216, 224, 208, 255, 223, 224, 224, 255, 232,
	224, 240, 255, 120, 240, 0, 255, 129, 240, 16, 255, 136, 240, 32, 255, 143,
	240, 48, 255, 153, 240, 64, 255, 160, 240, 80, 255, 168, 240, 96, 255, 176,
	240, 112, 255, 184, 240, 128, 255, 192, 240, 143, 255, 200, 240, 160, 255,
	207, 240, 176, 255, 217, 240, 192, 255, 224, 240, 208, 255, 231, 240, 224,
	255, 240, 240, 240, 255,
];
