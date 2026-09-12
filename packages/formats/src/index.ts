import { FormatRegistry } from "@garbro-mcp/core";
import { advSysFpkFormat } from "./advsys/fpk.js";
import { Adpack32Format } from "./active-soft/adpack32.js";
import { bananaPkFormat } from "./banana/pk.js";
import { ailDatFormat, lnk2Format } from "./ail/dat.js";
import { AmiFormat } from "./amaterasu/ami.js";
import { mjaFormat } from "./artemis/mja.js";
import { mifFormat } from "./basil/mif.js";
import { bishopBscFormat } from "./bishop/bsc.js";
import { bishopPkFormat } from "./bishop/pk.js";
import { dpfFormat } from "./mutation/dpf.js";
import { ccfFormat } from "./black-rainbow/ccf.js";
import { circusPckFormat } from "./circus/pck.js";
import { GspFormat } from "./black-rainbow/gsp.js";
import { abelBinFormat } from "./abel/bin.js";
import { antiqueDatFormat } from "./antique/dat.js";
import { gpk2Format } from "./gpk2/gpk2.js";
import { kaasPbFormat } from "./kaas/pb.js";
import { kpcFormat } from "./kscript/kpc.js";
import { clioPacFormat } from "./clio/pac.js";
import { IntFormat } from "./cat-system/int.js";
import { AfsFormat } from "./cri/afs.js";
import { CpkFormat } from "./cri/cpk.js";
import { spcFormat } from "./cri/spc.js";
import { BgiArcFormat, BurikoArcFormat } from "./ethornell/arc.js";
import { EscudeBinFormat } from "./escude/bin.js";
import { AcpxFormat } from "./favorite/acpx.js";
import { FavoriteBinFormat } from "./favorite/bin.js";
import { mrg0Format } from "./fc01/mrg0.js";
import { fpk2Format } from "./interheart/fpk2.js";
import { irrlichtPackFormat } from "./irrlicht/pack.js";
import { HyPackFormat } from "./hypatia/hypack.js";
import { dallPelFormat } from "./dall/pel.js";
import { DrsFormat } from "./ikura/drs.js";
import { MpxFormat } from "./ikura/mpx.js";
import { ivorySgFormat } from "./ivory/sg.js";
import { k5Format } from "./gsx/k5.js";
import { flkFormat } from "./liddell/flk.js";
import { leafPxFormat } from "./leaf/px.js";
import { leafTexFormat } from "./leaf/tex.js";
import { museDatFormat } from "./muse/dat.js";
import { MajiroArcFormat } from "./majiro/arc.js";
import { shaFormat } from "./mg/sha.js";
import { gsdFormat } from "./microvision/gsd.js";
import { NekoPack1Format } from "./nekopack/v1.js";
import { NekoPack2Format } from "./nekopack/v2.js";
import { NekoPack3Format } from "./nekopack/v3.js";
import { LstFormat } from "./nexton/lst.js";
import { oneUpArcFormat } from "./oneup/arc.js";
import { unaDatFormat } from "./myharvest/dat.js";
import { mpkFormat } from "./nitroplus/mpk.js";
import { nppFormat } from "./nitroplus/npp.js";
import { parsleyScnFormat } from "./parsley/scn.js";
import { plantechPacFormat } from "./plantech/pac.js";
import { phsFormat } from "./uran/phs.js";
import { redzonePakFormat } from "./redzone/pak.js";
import { pinesoftVoiceFormat } from "./pinesoft/voice.js";
import { parsleyPacFormat } from "./parsley/pac.js";
import { kissArcFormat } from "./kiss/arc.js";
import { KcapFormat } from "./selene/kcap.js";
import { seraphimMcFormat } from "./seraphim/mc.js";
import { ivoryPxFormat } from "./ivory/px.js";
import { silkyArcFormat } from "./silky/arc.js";
import { silkyMfgFormat } from "./silky/mfg.js";
import { vsdFormat } from "./silky/vsd.js";
import { succubusArcFormat } from "./succubus/arc.js";
import { tailPkgFormat } from "./tail/pkg.js";
import { tanakaArc0Format } from "./tanaka/arc0.js";
import { tanakaWvxFormat } from "./tanaka/wvx.js";
import { dpkFormat } from "./sysd/dpk.js";
import { PackDatFormat } from "./system-epsilon/packdat.js";
import { sudFormat } from "./triangle/sud.js";
import { p8Format } from "./tinkerbell/p8.js";
import { ukFormat } from "./ucom/uk.js";
import { valkyriaAm2Format } from "./valkyria/am2.js";
import { valkyriaDatFormat } from "./valkyria/dat.js";
import { ifxFormat } from "./winters/ifx.js";
import { pkdFormat } from "./zone/pkd.js";
import { Xp3Format } from "./xp3/format.js";
import { alkFormat } from "./alicesoft/alk.js";
import { cdpaPackFormat } from "./cdpa/pack.js";
import { hyperworksPakFormat } from "./hyperworks/pak.js";
import { nafFormat } from "./brownie/naf.js";
import { cpaFormat } from "./aquarium/cpa.js";
import { sceplayPakFormat } from "./sceplay/pak.js";
import { tigermanPacFormat } from "./tigerman/pac.js";
import { irisFpackFormat } from "./iris/fpack.js";
import { herbPakFormat } from "./herb/pak.js";
import { applePieArcFormat } from "./applepie/arc.js";
import { pfdFormat } from "./artel/pfd.js";
import { radFormat } from "./rsystem/rad.js";
import { k3Format } from "./gsx/k3.js";
import { aqaFormat } from "./unknown/aqa.js";
import { weaponVoiceFormat } from "./weapon/voice.js";
import { palettePakFormat } from "./palette/pak.js";
import { ml2Format } from "./mina/ml2.js";
import { vbdFormat } from "./witch/vbd.js";
import { lpkFormat } from "./hypatia/lpk.js";
import { ipacFormat } from "./ipac/pak.js";
import { bldFormat } from "./bellda/dat.js";
import { nscFormat } from "./nekotaro/nsc.js";
import { taskforceDatFormat } from "./taskforce/dat.js";
import { alphaSystemPakFormat } from "./alpha-system/pak.js";
import { szsFormat } from "./slg/szs.js";
import { capybaraDatFormat } from "./winters/capybara.js";
import { mykFormat } from "./cherry/myk.js";
import { arcxFormat } from "./arcx/arc.js";
import { sdaFormat } from "./mmfass/sda.js";
import { bmxFormat } from "./tanaka/bmx.js";
import { dnsFormat } from "./marble/dns.js";
import { panFormat } from "./pan/pan.js";
import { dsvFormat } from "./desire/dsv.js";
import { karFormat } from "./cadath/kar.js";
import { asuraPakFormat } from "./asura/pak.js";
import { pak2Format } from "./palette/pak2.js";
import { snnFormat } from "./blue-gale/snn.js";
import { vpkFormat } from "./black-cyc/vpk.js";
import { bndFormat } from "./tetratech/bnd.js";
import { aosDatFormat } from "./aos/dat.js";
import { keroqDatFormat } from "./keroq/dat.js";
import { bcdFormat } from "./ransel/bcd.js";
import { zipFormat } from "./pkware/zip.js";
import { aimsPackFormat } from "./aims/pack.js";
import { cfpFormat } from "./winters/cfp.js";
import { aryFormat } from "./pearl/ary.js";
import { akatomboXFormat } from "./akatombo/x.js";
import { crgFormat } from "./rhss/crg.js";
import { abelFpkFormat } from "./abel/fpk.js";
import { clsFormat } from "./lambda/cls.js";
import { ffaFormat } from "./ffa/arc.js";
import { pogFormat } from "./ads/pog.js";
import { irrlichtArkFormat } from "./irrlicht/ark.js";
import { fl2Format } from "./aaru/fl2.js";

export * from "./advsys/index.js";
export * from "./active-soft/index.js";
export * from "./ail/index.js";
export * from "./amaterasu/index.js";
export * from "./artemis/index.js";
export * from "./basil/index.js";
export * from "./bishop/index.js";
export * from "./banana/index.js";
export * from "./black-rainbow/index.js";
export * from "./clio/index.js";
export * from "./circus/index.js";
export * from "./cat-system/index.js";
export * from "./cri/index.js";
export * from "./abel/index.js";
export * from "./antique/index.js";
export * from "./dall/index.js";
export * from "./ethornell/index.js";
export * from "./escude/index.js";
export * from "./favorite/index.js";
export * from "./fc01/index.js";
export * from "./gsx/index.js";
export * from "./gpk2/index.js";
export * from "./interheart/index.js";
export * from "./irrlicht/index.js";
export * from "./hypatia/index.js";
export * from "./kaas/index.js";
export * from "./kscript/index.js";
export * from "./kiss/index.js";
export * from "./ikura/index.js";
export * from "./ivory/index.js";
export * from "./liddell/index.js";
export * from "./leaf/index.js";
export * from "./muse/index.js";
export * from "./myharvest/index.js";
export * from "./mutation/index.js";
export * from "./majiro/index.js";
export * from "./mg/index.js";
export * from "./microvision/index.js";
export * from "./nekopack/index.js";
export * from "./nexton/index.js";
export * from "./oneup/index.js";
export * from "./nitroplus/index.js";
export * from "./plantech/index.js";
export * from "./pinesoft/index.js";
export * from "./parsley/index.js";
export * from "./seraphim/index.js";
export * from "./succubus/index.js";
export * from "./selene/index.js";
export * from "./silky/index.js";
export * from "./sysd/index.js";
export * from "./redzone/index.js";
export * from "./uran/index.js";
export * from "./triangle/index.js";
export * from "./tail/index.js";
export * from "./tanaka/index.js";
export * from "./system-epsilon/index.js";
export * from "./tinkerbell/index.js";
export * from "./ucom/index.js";
export * from "./winters/index.js";
export * from "./valkyria/index.js";
export * from "./zone/index.js";
export * from "./xp3/index.js";
export * from "./alicesoft/index.js";
export * from "./cdpa/index.js";
export * from "./hyperworks/index.js";
export * from "./brownie/index.js";
export * from "./aquarium/index.js";
export * from "./sceplay/index.js";
export * from "./tigerman/index.js";
export * from "./iris/index.js";
export * from "./herb/index.js";
export * from "./applepie/index.js";
export * from "./artel/index.js";
export * from "./rsystem/index.js";
export * from "./unknown/index.js";
export * from "./weapon/index.js";
export * from "./palette/index.js";
export * from "./mina/index.js";
export * from "./witch/index.js";
export * from "./ipac/index.js";
export * from "./bellda/index.js";
export * from "./nekotaro/index.js";
export * from "./taskforce/index.js";
export * from "./alpha-system/index.js";
export * from "./slg/index.js";
export * from "./cherry/index.js";
export * from "./arcx/index.js";
export * from "./mmfass/index.js";
export * from "./marble/index.js";
export * from "./pan/index.js";
export * from "./desire/index.js";
export * from "./cadath/index.js";
export * from "./asura/index.js";
export * from "./blue-gale/index.js";
export * from "./black-cyc/index.js";
export * from "./tetratech/index.js";
export * from "./aos/index.js";
export * from "./keroq/index.js";
export * from "./ransel/index.js";
export * from "./pkware/index.js";
export * from "./aims/index.js";
export * from "./pearl/index.js";
export * from "./akatombo/index.js";
export * from "./rhss/index.js";
export * from "./lambda/index.js";
export * from "./ffa/index.js";
export * from "./ads/index.js";
export * from "./aaru/index.js";

export function createDefaultRegistry(): FormatRegistry {
	return new FormatRegistry([
		new Xp3Format(),
		new Adpack32Format(),
		bananaPkFormat,
		spcFormat,
		ailDatFormat,
		advSysFpkFormat,
		bishopBscFormat,
		ccfFormat,
		circusPckFormat,
		flkFormat,
		fpk2Format,
		irrlichtPackFormat,
		kissArcFormat,
		pinesoftVoiceFormat,
		sudFormat,
		lnk2Format,
		nppFormat,
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
		tanakaArc0Format,
		tanakaWvxFormat,
		mrg0Format,
		clioPacFormat,
		dallPelFormat,
		dpfFormat,
		ifxFormat,
		unaDatFormat,
		museDatFormat,
		parsleyScnFormat,
		plantechPacFormat,
		phsFormat,
		redzonePakFormat,
		k5Format,
		pkdFormat,
		dpkFormat,
		gsdFormat,
		mjaFormat,
		mifFormat,
		bishopPkFormat,
		ivorySgFormat,
		ivoryPxFormat,
		vsdFormat,
		silkyArcFormat,
		silkyMfgFormat,
		ukFormat,
		shaFormat,
		mpkFormat,
		parsleyPacFormat,
		valkyriaDatFormat,
		valkyriaAm2Format,
		p8Format,
		alkFormat,
		cdpaPackFormat,
		hyperworksPakFormat,
		nafFormat,
		cpaFormat,
		sceplayPakFormat,
		tigermanPacFormat,
		irisFpackFormat,
		herbPakFormat,
		applePieArcFormat,
		pfdFormat,
		radFormat,
		k3Format,
		aqaFormat,
		weaponVoiceFormat,
		palettePakFormat,
		ml2Format,
		vbdFormat,
		lpkFormat,
		ipacFormat,
		bldFormat,
		nscFormat,
		taskforceDatFormat,
		alphaSystemPakFormat,
		szsFormat,
		capybaraDatFormat,
		mykFormat,
		arcxFormat,
		sdaFormat,
		bmxFormat,
		dnsFormat,
		panFormat,
		dsvFormat,
		karFormat,
		asuraPakFormat,
		pak2Format,
		snnFormat,
		vpkFormat,
		bndFormat,
		aosDatFormat,
		keroqDatFormat,
		bcdFormat,
		zipFormat,
		aimsPackFormat,
		cfpFormat,
		aryFormat,
		akatomboXFormat,
		crgFormat,
		abelFpkFormat,
		clsFormat,
		ffaFormat,
		pogFormat,
		irrlichtArkFormat,
		fl2Format,
	]);
}
