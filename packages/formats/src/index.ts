import { FormatRegistry } from "@garbro-mcp/core";
import { Adpack32Format } from "./active-soft/adpack32.js";
import { AmiFormat } from "./amaterasu/ami.js";
import { mjaFormat } from "./artemis/mja.js";
import { mifFormat } from "./basil/mif.js";
import { bishopPkFormat } from "./bishop/pk.js";
import { GspFormat } from "./black-rainbow/gsp.js";
import { abelBinFormat } from "./abel/bin.js";
import { antiqueDatFormat } from "./antique/dat.js";
import { gpk2Format } from "./gpk2/gpk2.js";
import { kaasPbFormat } from "./kaas/pb.js";
import { kpcFormat } from "./kscript/kpc.js";
import { IntFormat } from "./cat-system/int.js";
import { AfsFormat } from "./cri/afs.js";
import { CpkFormat } from "./cri/cpk.js";
import { BgiArcFormat, BurikoArcFormat } from "./ethornell/arc.js";
import { EscudeBinFormat } from "./escude/bin.js";
import { AcpxFormat } from "./favorite/acpx.js";
import { FavoriteBinFormat } from "./favorite/bin.js";
import { mrg0Format } from "./fc01/mrg0.js";
import { HyPackFormat } from "./hypatia/hypack.js";
import { DrsFormat } from "./ikura/drs.js";
import { MpxFormat } from "./ikura/mpx.js";
import { ivorySgFormat } from "./ivory/sg.js";
import { leafPxFormat } from "./leaf/px.js";
import { leafTexFormat } from "./leaf/tex.js";
import { MajiroArcFormat } from "./majiro/arc.js";
import { shaFormat } from "./mg/sha.js";
import { gsdFormat } from "./microvision/gsd.js";
import { NekoPack1Format } from "./nekopack/v1.js";
import { NekoPack2Format } from "./nekopack/v2.js";
import { NekoPack3Format } from "./nekopack/v3.js";
import { LstFormat } from "./nexton/lst.js";
import { oneUpArcFormat } from "./oneup/arc.js";
import { mpkFormat } from "./nitroplus/mpk.js";
import { parsleyPacFormat } from "./parsley/pac.js";
import { KcapFormat } from "./selene/kcap.js";
import { seraphimMcFormat } from "./seraphim/mc.js";
import { vsdFormat } from "./silky/vsd.js";
import { succubusArcFormat } from "./succubus/arc.js";
import { tailPkgFormat } from "./tail/pkg.js";
import { dpkFormat } from "./sysd/dpk.js";
import { PackDatFormat } from "./system-epsilon/packdat.js";
import { p8Format } from "./tinkerbell/p8.js";
import { ukFormat } from "./ucom/uk.js";
import { valkyriaAm2Format } from "./valkyria/am2.js";
import { valkyriaDatFormat } from "./valkyria/dat.js";
import { Xp3Format } from "./xp3/format.js";

export * from "./active-soft/index.js";
export * from "./amaterasu/index.js";
export * from "./artemis/index.js";
export * from "./basil/index.js";
export * from "./bishop/index.js";
export * from "./black-rainbow/index.js";
export * from "./cat-system/index.js";
export * from "./cri/index.js";
export * from "./abel/index.js";
export * from "./antique/index.js";
export * from "./ethornell/index.js";
export * from "./escude/index.js";
export * from "./favorite/index.js";
export * from "./fc01/index.js";
export * from "./gpk2/index.js";
export * from "./hypatia/index.js";
export * from "./kaas/index.js";
export * from "./kscript/index.js";
export * from "./ikura/index.js";
export * from "./ivory/index.js";
export * from "./leaf/index.js";
export * from "./majiro/index.js";
export * from "./mg/index.js";
export * from "./microvision/index.js";
export * from "./nekopack/index.js";
export * from "./nexton/index.js";
export * from "./oneup/index.js";
export * from "./nitroplus/index.js";
export * from "./parsley/index.js";
export * from "./seraphim/index.js";
export * from "./succubus/index.js";
export * from "./selene/index.js";
export * from "./silky/index.js";
export * from "./sysd/index.js";
export * from "./tail/index.js";
export * from "./system-epsilon/index.js";
export * from "./tinkerbell/index.js";
export * from "./ucom/index.js";
export * from "./valkyria/index.js";
export * from "./xp3/index.js";

export function createDefaultRegistry(): FormatRegistry {
	return new FormatRegistry([
		new Xp3Format(),
		new Adpack32Format(),
		new AfsFormat(),
		new CpkFormat(),
		new AmiFormat(),
		new BgiArcFormat(),
		new BurikoArcFormat(),
		new DrsFormat(),
		new MpxFormat(),
		new EscudeBinFormat(),
		new GspFormat(),
		new IntFormat(),
		new PackDatFormat(),
		new KcapFormat(),
		new HyPackFormat(),
		new LstFormat(),
		new MajiroArcFormat(),
		new NekoPack3Format(),
		new NekoPack2Format(),
		new NekoPack1Format(),
		new AcpxFormat(),
		new FavoriteBinFormat(),
		abelBinFormat,
		antiqueDatFormat,
		gpk2Format,
		kaasPbFormat,
		kpcFormat,
		leafPxFormat,
		leafTexFormat,
		oneUpArcFormat,
		seraphimMcFormat,
		succubusArcFormat,
		tailPkgFormat,
		mrg0Format,
		dpkFormat,
		gsdFormat,
		mjaFormat,
		mifFormat,
		bishopPkFormat,
		ivorySgFormat,
		vsdFormat,
		ukFormat,
		shaFormat,
		mpkFormat,
		parsleyPacFormat,
		valkyriaDatFormat,
		valkyriaAm2Format,
		p8Format,
	]);
}
