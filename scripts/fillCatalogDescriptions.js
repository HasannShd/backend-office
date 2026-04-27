#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const Category = require('../models/category');
const Product = require('../models/product');

const apply = process.argv.includes('--apply');
const onlyMissing = process.argv.includes('--only-missing');

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const lower = (value) => clean(value).toLowerCase();
const sentence = (value) => {
  const text = clean(value);
  if (!text) return '';
  return /[.!?]$/.test(text) ? text : `${text}.`;
};

const categoryDescriptions = new Map([
  ['ANESTHESIA & RESPIRATORY', 'Airway, oxygen, nebulization, resuscitation, breathing-circuit, and anesthesia support products for clinics, emergency care, procedure rooms, and patient respiratory management.'],
  ['CSSD', 'Sterilization, decontamination, and CSSD workflow supplies including indicator products, sterilization packaging, biohazard handling, brushes, and cleaning support items.'],
  ['Consumables & Disposables', 'Fast-moving clinical consumables and disposable supplies used across examination rooms, wards, procedure areas, infection-control workflows, and daily patient care.'],
  ['Dental', 'Dental consumables, endodontic files, burs, matrix systems, suction tips, dams, and chairside accessories for general and specialist dental practice.'],
  ['Diagnostics & Recording', 'Diagnostic recording papers, measurement aids, gels, thermometry, stethoscope, and examination accessories used in routine patient assessment and monitoring.'],
  ['Examination & General Disposable', 'General examination-room disposable items for patient identification, sample handling, procedure preparation, and single-use clinical support.'],
  ['Hospital Furniture & Utilities', 'Hospital furniture, beds, trolleys, cabinets, scales, screens, footstools, and mobility-support utility items for clinical rooms and patient-care areas.'],
  ['Industrial & Safety', 'Safety and workplace-protection products for controlled environments, staff protection, and operational safety in healthcare or industrial settings.'],
  ['Injection & IV Disposable', 'Injection, infusion, IV access, epidural, syringe, needle, and fluid-administration disposables for medication delivery and vascular-access workflows.'],
  ['Lab Consumables', 'Laboratory consumables for sample collection, specimen storage, slides, pipettes, sharps handling, and routine diagnostic support.'],
  ['Laboratory', 'Laboratory and diagnostic support products used for testing, recording, sampling, specimen handling, and day-to-day clinical-lab workflows.'],
  ['Medical Equipment', 'Clinical equipment for monitoring, suction, oxygen support, examination lighting, mobility support, patient measurement, and routine healthcare operations.'],
  ['Orthopedic & Rehabilitation', 'Orthopedic supports, braces, collars, splints, casting materials, bandages, padding, and rehabilitation products for recovery and musculoskeletal care.'],
  ['PPE & Non-Woven Disposable', 'Protective apparel and non-woven disposables for hygiene, infection control, staff safety, patient protection, and barrier use in clinical environments.'],
  ['Surgical Instruments', 'Reusable and disposable surgical and examination instruments including blades, handles, scissors, forceps, markers, specula, and procedure-support tools.'],
  ['Sutures', 'Suture materials for wound closure and surgical procedures, including absorbable and non-absorbable options for different tissue and closure requirements.'],
  ['Urology', 'Urology and drainage products including catheters, urine bags, urine containers, feeding tubes, suction catheters, and patient fluid-management supplies.'],
  ['Wound Care, Dressing & First Aid', 'Dressings, gauze, bandages, tapes, swabs, wound plaster, cotton products, ice packs, and first-aid supplies for wound protection and recovery.'],
]);

const categoryFallback = (category) => {
  const parentName = category.parent?.name ? `${category.parent.name} ` : '';
  return `${category.name} products for ${parentName}clinical use, selected to support safe handling, reliable daily workflows, and professional healthcare supply needs.`;
};

const productRules = [
  [/3 way stop cock.*ext/i, '3 way stop cock with extension tubing for IV line control, medication administration, and flexible access management during infusion workflows.'],
  [/3 way stop cock/i, '3 way stop cock for controlling IV fluid paths, medication delivery, and line access in infusion and injection procedures.'],
  [/absorbent paper point/i, 'Absorbent dental paper points for drying prepared root canals during endodontic treatment and helping maintain a clean working field.'],
  [/air water syringe tips/i, 'Disposable air water syringe tips for dental chairside rinsing, drying, and controlled air or water delivery during procedures.'],
  [/nebulizer machine|air compressing nebulizer/i, 'Air-compressing nebulizer machine for converting liquid medication into inhalable mist for respiratory therapy and breathing support.'],
  [/alcohol swab/i, 'Alcohol swab pads for skin preparation, injection-site cleaning, and quick surface antisepsis before minor clinical procedures.'],
  [/forceps/i, 'Forceps for grasping, holding, or handling tissue, dressing material, and clinical items during examination or procedure workflows.'],
  [/anesthesia masks/i, 'Anesthesia masks for delivering oxygen or anesthetic gases during airway support, induction, and respiratory care procedures.'],
  [/anti-embolism/i, 'Anti-embolism stockings for graduated leg compression to support venous return and help reduce immobility-related clotting risk.'],
  [/arm support/i, 'Arm support for immobilization, comfort, and controlled positioning during orthopedic recovery or soft-tissue injury management.'],
  [/articulating paper/i, 'Dental articulating paper for checking bite contact points, occlusal balance, and restoration adjustment during dental treatment.'],
  [/bp machine/i, 'Blood-pressure machine for routine non-invasive blood pressure monitoring in clinics, wards, and examination rooms.'],
  [/baby bed/i, 'Baby bed for safe infant positioning and care in maternity, pediatric, and clinical observation areas.'],
  [/back & spine/i, 'Back and spine support for posture stabilization, lower-back comfort, and rehabilitation support during recovery or daily use.'],
  [/bandage scissors/i, 'Bandage scissors for cutting dressings, gauze, tapes, and bandage layers while helping protect the patient during removal or dressing changes.'],
  [/simple scissors/i, 'Simple clinical scissors for general cutting tasks, trimming light procedural materials, and supporting routine examination-room workflows.'],
  [/scissors/i, 'Clinical scissors for cutting dressings, bandages, gauze, sutures, or procedural materials during routine care.'],
  [/barbed broaches/i, 'Barbed broaches with plastic handle for removing pulp tissue and debris from root canals during endodontic procedures.'],
  [/bedside cabinet/i, 'Bedside cabinet for organized patient-room storage of personal items, clinical supplies, and everyday care essentials.'],
  [/biohazard bags/i, 'Biohazard bags for segregating and disposing contaminated clinical waste in CSSD, laboratory, and treatment-area workflows.'],
  [/blood lancet/i, 'Blood lancet for capillary blood sampling, finger-prick testing, and point-of-care diagnostic collection.'],
  [/breathing circuits/i, 'Breathing circuit with catheter mount for connecting patients to anesthesia or ventilatory equipment while supporting flexible airway positioning.'],
  [/francy reflex hammer/i, 'Francy reflex hammer for neurological examination and controlled tendon reflex assessment during routine clinical checks.'],
  [/buck reflex hammer/i, 'Buck reflex hammer for percussion-based reflex testing and basic neurological assessment in examination rooms.'],
  [/reflex hammer/i, 'Reflex hammer for neurological examination, tendon reflex checks, and basic clinical assessment.'],
  [/carbide burs/i, 'Carbide FG dental burs for cutting, shaping, and finishing tooth structure or restorative materials in high-speed handpieces.'],
  [/cervical collars/i, 'Cervical collars for neck immobilization, cervical support, and injury-management workflows where controlled positioning is required.'],
  [/chemical indicator/i, 'Chemical indicator strips for verifying exposure conditions inside sterilization packs during CSSD quality-control workflows.'],
  [/enema/i, 'Cleaning enema set for bowel evacuation support and patient preparation under clinical direction.'],
  [/closed wound drainage/i, 'Closed wound drainage reservoir for collecting post-operative drainage while helping maintain a closed drainage pathway.'],
  [/commode chair/i, 'Commode chair for bedside toileting support, mobility-limited patient care, and safer hygiene assistance.'],
  [/cotton gloves/i, 'Cotton gloves for light hand protection, liner use, and comfort where breathable reusable coverage is needed.'],
  [/cotton roll/i, 'Cotton roll for absorption, padding, wound care support, and routine clinical dressing preparation.'],
  [/daclon|nylon/i, 'Daclon nylon suture for non-absorbable wound closure where durable tensile support is required.'],
  [/matrix bands/i, 'Dental matrix bands for forming proximal walls and shaping restorative material during cavity restoration procedures.'],
  [/dental needle/i, 'Dental needles for local anesthetic delivery in dental procedures, compatible with standard dental injection workflows.'],
  [/denture box/i, 'Denture box for clean storage, transport, and protection of dentures or removable dental appliances.'],
  [/diamond burs/i, 'Diamond FG dental burs for precise tooth preparation, contouring, trimming, and finishing in restorative dentistry.'],
  [/baby scale/i, 'Mechanical baby scale for weighing infants during maternity, pediatric, and routine growth-monitoring checks.'],
  [/weight \+ height/i, 'Digital weight and height machine for recording adult patient measurements during assessment, screening, and clinical intake.'],
  [/scale/i, 'Patient measurement equipment for recording body weight, height, or infant weight during routine clinical assessment.'],
  [/hypodermic needle/i, 'Disposable hypodermic needles for injection, aspiration, and medication administration in clinical practice.'],
  [/infusion administration|iv set|iV set/i, 'Disposable IV infusion administration set for controlled fluid and medication delivery through vascular access lines.'],
  [/kidney dish/i, 'Disposable kidney dish for collecting fluids, holding instruments, and supporting bedside or procedure-room workflows.'],
  [/pediatric infusion set|burette/i, 'Pediatric infusion set with burette for controlled small-volume fluid or medication administration in pediatric care.'],
  [/razors/i, 'Disposable razors for pre-procedure hair removal and patient preparation before dressing, surgery, or clinical treatment.'],
  [/syringes/i, 'Disposable syringes for medication preparation, injection, aspiration, and accurate fluid measurement in clinical use.'],
  [/reusable laryngeal masks/i, 'Reusable laryngeal masks for supraglottic airway management where facilities need cleanable airway devices for repeated clinical use.'],
  [/disposable laryngeal masks/i, 'Disposable laryngeal masks for single-use supraglottic airway support during anesthesia, resuscitation, and respiratory care.'],
  [/laryngeal masks/i, 'Laryngeal masks for supraglottic airway management during anesthesia, resuscitation, and respiratory support workflows.'],
  [/surgeon cap|doctor.*cap/i, 'Doctor and surgeon caps for hair coverage, hygiene control, and contamination reduction in clinical and procedure areas.'],
  [/dressing set/i, 'Dressing set containing essential tools for wound cleaning, dressing changes, and routine first-aid care.'],
  [/dust proof face mask/i, 'Dust-proof face mask for basic respiratory barrier protection in healthcare support and controlled work environments.'],
  [/ecg paper/i, 'ECG paper roll for recording electrocardiograph traces and supporting routine cardiac monitoring documentation.'],
  [/crepe bandage/i, 'Elastic crepe bandage for compression, sprain support, swelling control, and secure dressing retention in orthopedic or first-aid care.'],
  [/pbt|conforming bandage/i, 'PBT conforming bandage for flexible dressing retention over joints, contours, and wound-care sites without restricting normal movement.'],
  [/elastic cloth adhesive tape/i, 'Elastic cloth adhesive tape for securing dressings and providing flexible support where movement or contour coverage is needed.'],
  [/crepe bandage|conforming bandage|elastic cloth|pbt/i, 'Elastic bandage for compression, support, dressing retention, and orthopedic or wound-care applications.'],
  [/electric bed/i, 'Electric hospital bed for adjustable patient positioning, comfort, and safer nursing care in clinical rooms.'],
  [/sputum suction/i, 'Electrical sputum suction device for clearing mucus, sputum, and airway secretions during respiratory care and bedside support.'],
  [/suction machine/i, 'Suction machine for removing fluids and secretions during procedures, airway care, and routine clinical suction workflows.'],
  [/nasal preformed tracheal/i, 'Nasal preformed tracheal tube shaped for nasal intubation while keeping the airway tube positioned away from the working field.'],
  [/oral preformed tracheal/i, 'Oral preformed tracheal tube designed for oral intubation where a shaped tube helps maintain access around the mouth and face.'],
  [/reinforced endotracheal/i, 'Reinforced endotracheal tube with kink-resistant support for airway management when tube flexibility and patency are important.'],
  [/endotracheal|tracheal tubes/i, 'Endotracheal tubes for airway intubation, ventilation support, and anesthesia or emergency airway management.'],
  [/epidural/i, 'Epidural mini pack or kit for epidural access preparation and regional anesthesia workflows.'],
  [/examination couch/i, 'Examination couch for patient assessment, minor procedures, and routine clinical consultations.'],
  [/examination lamps/i, 'Examination lamp for focused illumination during assessment, wound care, minor procedures, and clinical examination.'],
  [/face mask with eye|eye shield/i, 'Face mask with eye shield for combined splash, droplet, and facial barrier protection during clinical tasks.'],
  [/face mask|n95 mask/i, 'Face mask for respiratory barrier protection, infection-control support, and routine clinical or patient-care use.'],
  [/finger splints/i, 'Finger splints for immobilizing and supporting finger injuries during recovery or orthopedic care.'],
  [/first aid|wound plaster|saniplast/i, 'Adhesive wound plaster for covering minor cuts, protecting small wounds, and supporting first-aid treatment.'],
  [/sterilization pouches/i, 'Flat sterilization pouches for packing individual instruments before processing and preserving sterile presentation until use.'],
  [/sterilizations reels/i, 'Flat sterilization reels for creating custom-length packs for instruments and supplies before steam sterilization.'],
  [/folding screen/i, 'Folding screen for privacy, patient separation, and flexible space management in clinical rooms.'],
  [/stretcher|strecher/i, 'Foldable stretcher for patient transport, emergency handling, and temporary transfer support.'],
  [/footstool/i, 'Clinical footstool for safer patient access to beds, couches, and examination furniture.'],
  [/gate drills|pesso/i, 'Gate drills and Peeso reamers for endodontic canal enlargement, post-space preparation, and root-canal shaping workflows.'],
  [/gauze rolls/i, 'Gauze rolls for wound coverage, dressing support, absorption, and secure wrapping in clinical care.'],
  [/gauze swab|gauze sponge/i, 'Gauze swabs or sponges for absorption, wound cleaning, dressing preparation, and procedural use.'],
  [/cotton balls|gauze\/cotton/i, 'Gauze and cotton balls for cleaning, absorption, antiseptic application, and general clinical preparation.'],
  [/gutta percha cutter/i, 'Gutta-percha cutter for trimming and managing gutta-percha during root-canal obturation.'],
  [/gutta percha points/i, 'Gutta-percha points for root-canal obturation and sealing after endodontic preparation.'],
  [/h-files|k- files|reamers|files/i, 'Endodontic files and reamers for cleaning, shaping, and preparing root canals during dental treatment.'],
  [/head immobilizer/i, 'Head immobilizer for stabilizing the head during emergency transport, trauma handling, or patient transfer.'],
  [/head rest sleeve/i, 'Disposable head-rest sleeve for dental or clinical chair hygiene and patient-contact surface protection.'],
  [/hmef|heat & moisture/i, 'Heat and moisture exchange filter for conserving airway humidity and supporting filtration in breathing circuits.'],
  [/heparin cap|iv stopper/i, 'Heparin cap or IV stopper for closing IV access ports and supporting intermittent vascular access workflows.'],
  [/i\.v cannula|iv cannula/i, 'IV cannula for peripheral venous access, infusion therapy, medication delivery, and fluid administration.'],
  [/iv stand/i, 'IV stand for holding infusion bags and supporting fluid administration beside beds, chairs, or procedure areas.'],
  [/earthermometer|thermometer/i, 'Infra-red ear thermometer for quick non-contact or ear temperature measurement in routine clinical assessment.'],
  [/instant ice/i, 'Instant ice pack for cold therapy, swelling control, and first-aid support after minor injury.'],
  [/intubation stylet/i, 'Intubation stylet for shaping and guiding endotracheal tubes during airway placement.'],
  [/isolation gowns/i, 'Isolation gowns for staff barrier protection during patient care, infection-control workflows, and contact precaution use.'],
  [/surgeons gown/i, 'SMS surgeon gowns for procedure-room barrier protection, fluid resistance, and sterile surgical coverage.'],
  [/patient gown/i, 'Patient gown for examination, treatment, and clinical care where modesty, access, and disposable hygiene are needed.'],
  [/j-cloth/i, 'J-cloth for cleaning, wiping, and surface-preparation support in CSSD or healthcare cleaning workflows.'],
  [/neck & shoulder|neck support|knee support|back|spine/i, 'Orthopedic support product for stabilization, comfort, and controlled movement during recovery or rehabilitation.'],
  [/latex surgical gloves/i, 'Latex surgical gloves for sterile hand protection, tactile control, and barrier use during surgical or procedure workflows.'],
  [/dental dam/i, 'Latex dental dam for tooth isolation, moisture control, and improved working-field protection during dental procedures.'],
  [/latex examination gloves/i, 'Latex examination gloves for single-use hand protection with close fit and tactile control during patient care.'],
  [/nitrile gloves/i, 'Nitrile gloves for latex-free examination protection with strong puncture resistance and broad clinical barrier use.'],
  [/vinyl|pvc gloves/i, 'Vinyl PVC gloves for latex-free, cost-effective hand protection during low-risk examination and hygiene tasks.'],
  [/examination gloves/i, 'Examination gloves for single-use hand protection, hygiene control, and barrier protection during patient care.'],
  [/foley.*coated/i, 'Coated latex Foley catheter for urinary drainage with a surface finish intended to support smoother catheter placement.'],
  [/foley.*silicon 2 way/i, 'Two-way 100% silicone Foley catheter for bladder drainage where latex-free catheterization and balloon retention are required.'],
  [/foley.*silicon 3 way/i, 'Three-way 100% silicone Foley catheter for bladder drainage with an added irrigation channel for urology care.'],
  [/foley/i, 'Foley catheter for urinary drainage and bladder management, available for clinical catheterization workflows.'],
  [/microbrush/i, 'Microbrush applicator for precise placement of bonding agents, etchants, medicaments, or dental materials.'],
  [/microporous/i, 'Microporous non-woven surgical tape for securing dressings and devices while allowing breathable skin contact.'],
  [/microscope slides/i, 'Microscope slides for preparing, holding, and examining specimens under laboratory microscopy.'],
  [/nail brushes/i, 'Nail brushes for hand and nail scrubbing in decontamination, CSSD, and hygiene-preparation workflows.'],
  [/nasal preformed|oral preformed/i, 'Preformed tracheal tubes designed to support airway access while keeping tubing positioned away from the surgical field.'],
  [/nebulizer masks/i, 'Nebulizer masks for delivering aerosol medication during respiratory therapy and patient breathing treatments.'],
  [/non-woven bed sheet/i, 'Non-woven disposable bed sheet for patient-surface coverage, hygiene protection, and quick turnover in examination or treatment rooms.'],
  [/underpad/i, 'Disposable underpad for absorbing fluids, protecting beds and chairs, and supporting patient hygiene during care.'],
  [/cotton padding/i, 'Orthopaedic cotton padding for cushioning skin under casts, splints, and compression layers during immobilization care.'],
  [/plaster of paris|pop bandage/i, 'Plaster of Paris bandage for rigid cast formation, fracture immobilization, and orthopedic support after wet molding.'],
  [/fiber glass casting/i, 'Orthopaedic fiberglass casting tape for lightweight rigid immobilization and durable fracture-support casts.'],
  [/casting|plaster|pop bandage|cotton padding/i, 'Orthopedic casting and padding product for immobilization, fracture support, and protective orthopedic care.'],
  [/oxygen masks/i, 'Oxygen mask for delivering supplemental oxygen in emergency, ward, clinic, or respiratory-care settings.'],
  [/venturi/i, 'Venturi oxygen mask for controlled oxygen concentration delivery during respiratory support.'],
  [/oxygen recovery/i, 'Oxygen recovery kit for respiratory support where controlled oxygen delivery is required.'],
  [/apron/i, 'Disposable PE apron for splash protection, hygiene support, and barrier use during clinical or cleaning tasks.'],
  [/transparent wound dressing|pu transparent/i, 'Transparent wound dressing for protecting wounds or IV sites while allowing visual inspection.'],
  [/feeding tube|ryles/i, 'PVC feeding or Ryles tube for enteral feeding, gastric decompression, or clinical tube-placement workflows.'],
  [/nelaton catheter/i, 'Nelaton catheter for intermittent urinary catheterization and short-term bladder drainage.'],
  [/paste carriers|lentula/i, 'Lentulo paste carriers for placing endodontic sealers or medicaments inside prepared root canals.'],
  [/pipette/i, 'Pasteur pipette for transferring small liquid volumes in laboratory sampling and diagnostic workflows.'],
  [/patient id/i, 'Patient ID band for reliable patient identification, wrist labeling, and clinical tracking.'],
  [/urine collector/i, 'Pediatric urine collector for non-invasive urine sample collection from infants or young children.'],
  [/penlight/i, 'Penlight for pupil checks, oral examination, throat assessment, and quick bedside inspection.'],
  [/polishing disc/i, 'Dental polishing disc for contouring, smoothing, and finishing restorations or tooth surfaces.'],
  [/mixing pad/i, 'Poly-coated mixing pad for preparing dental materials, cements, liners, and restorative mixes.'],
  [/polypropylene/i, 'Polypropylene blue suture for non-absorbable closure where monofilament strength and tissue support are required.'],
  [/probe cover/i, 'Probe cover for protecting diagnostic probes and supporting hygiene during examination workflows.'],
  [/pulse oximeter/i, 'Pulse oximeter for non-invasive oxygen saturation and pulse-rate monitoring in clinical or point-of-care settings.'],
  [/resuscitator/i, 'Silicone manual resuscitator for hand-operated ventilation support during emergency care and airway management.'],
  [/saliva ejector/i, 'Saliva ejector for removing saliva and fluids from the oral cavity during dental procedures.'],
  [/scalp vein/i, 'Scalp vein set for venous access, infusion, and blood collection where butterfly needle handling is preferred.'],
  [/surgical blades/i, 'Surgical blades for sterile precision cutting, incision work, and controlled tissue or material trimming during procedures.'],
  [/scalpel handle/i, 'Scalpel handle for securely holding compatible surgical blades and supporting controlled incision technique.'],
  [/sharp containers/i, 'Sharps container for safe disposal of needles, blades, and other sharp clinical waste.'],
  [/shoe cover/i, 'Disposable shoe cover for footwear hygiene and contamination control in clinical or controlled environments.'],
  [/silk braided/i, 'Silk braided suture for non-absorbable wound closure where secure knot handling is required.'],
  [/spinal needle/i, 'Spinal needle for lumbar puncture, spinal anesthesia, and controlled spinal access procedures.'],
  [/dressing roll/i, 'Spunlace non-woven dressing roll for covering, padding, and protecting wounds or treatment areas.'],
  [/medical trolley|trolley/i, 'Stainless-steel medical trolley for moving supplies, instruments, and clinical items between care areas.'],
  [/pluggers/i, 'Stainless-steel dental pluggers for compacting restorative or endodontic materials during treatment.'],
  [/spreaders/i, 'Stainless-steel dental spreaders for lateral condensation and gutta-percha placement in root-canal therapy.'],
  [/indicator tape/i, 'Steam sterilization indicator tape for securing packs and confirming exposure to steam sterilization conditions.'],
  [/sterile gauze/i, 'Sterile gauze swab for wound cleaning, dressing, absorption, and sterile procedure support.'],
  [/stethoscope/i, 'Stethoscope for auscultation of heart, lung, and body sounds during routine clinical assessment.'],
  [/stitch cutter/i, 'Stitch cutter for safe removal of sutures during wound follow-up and post-procedure care.'],
  [/stool container/i, 'Stool container for hygienic collection, storage, and transport of stool specimens for laboratory testing.'],
  [/suction cath/i, 'Suction catheter for airway secretion removal and respiratory suctioning under clinical direction.'],
  [/suction connecting/i, 'Suction connecting tubing for linking suction catheters or devices to suction equipment during fluid removal.'],
  [/taper|shaper|recip|aurora/i, 'Dental shaping files for endodontic canal preparation, shaping efficiency, and controlled root-canal instrumentation.'],
  [/skin marker/i, 'Surgical skin marker for marking incision sites, procedural points, and pre-operative reference lines.'],
  [/surgicryl|pga|monofast|monofilament|rapid/i, 'Absorbable surgical suture for soft-tissue approximation and wound closure in procedural or surgical settings.'],
  [/tongue depressor/i, 'Tongue depressor for oral and throat examination, specimen assistance, and routine clinical assessment.'],
  [/torniquets|tourniquets/i, 'Tourniquet for venipuncture support, blood draw preparation, and temporary venous occlusion.'],
  [/tracheostomy/i, 'Tracheostomy mask for oxygen delivery and humidification support for patients with tracheostomy airways.'],
  [/transparent surgical tape/i, 'Transparent PE surgical tape for securing dressings or tubing while allowing visibility of the covered area.'],
  [/tubular elastic/i, 'Tubular elastic net bandage for dressing retention and flexible coverage over limbs or body contours.'],
  [/ultrasound.*gel/i, 'Ultrasound transmission gel for coupling ultrasound probes to the skin and supporting clear diagnostic imaging.'],
  [/urine bottle/i, 'Urine bottle for bedside urine collection and patient toileting support where mobility is limited.'],
  [/urine container/i, 'Urine container for clean urine sample collection, storage, and transport to laboratory testing.'],
  [/urine bags/i, 'Urine bag for urinary drainage collection and patient fluid-output monitoring during catheter use.'],
  [/vaginal speculam|speculum/i, 'Vaginal speculum for gynecological examination, visualization, and clinical assessment.'],
  [/wheel chair/i, 'Wheelchair for patient mobility, transfer support, and transport within clinical or care environments.'],
  [/wooden applicator/i, 'Wooden applicator for sample handling, topical application, oral examination, or general clinical use.'],
  [/wound dressings/i, 'Wound dressing for covering, protecting, and supporting healing of wounds in routine clinical care.'],
  [/yankauer/i, 'Yankauer handle for oral and airway suctioning during procedures, anesthesia, and emergency care.'],
];

const categoryPurpose = {
  'ANESTHESIA & RESPIRATORY': 'airway, oxygen delivery, breathing support, anesthesia, or respiratory-care workflows',
  CSSD: 'sterilization, decontamination, instrument processing, and safe clinical waste handling',
  Dental: 'dental treatment, endodontic care, restorative procedures, and chairside workflow',
  'Diagnostics & Recording': 'diagnostic examination, measurement, recording, and patient monitoring',
  'Examination & General Disposable': 'routine examination, single-use clinical handling, and patient-care preparation',
  'Hospital Furniture & Utilities': 'patient-room setup, transfer, storage, and clinical facility support',
  'Industrial & Safety': 'staff protection, workplace safety, and controlled-environment support',
  'Injection & IV Disposable': 'injection, vascular access, infusion, and medication administration',
  'Lab Consumables': 'sample collection, specimen handling, laboratory testing, and diagnostic support',
  Laboratory: 'laboratory testing, diagnostic support, sample handling, and clinical recording',
  'Medical Equipment': 'patient assessment, monitoring, mobility, suction, oxygen support, or clinical equipment needs',
  'Orthopedic & Rehabilitation': 'support, immobilization, compression, recovery, and rehabilitation care',
  'PPE & Non-Woven Disposable': 'infection control, barrier protection, hygiene, and single-use clinical coverage',
  'Surgical Instruments': 'procedure support, surgical handling, examination, cutting, or clinical instrument use',
  Sutures: 'wound closure, tissue approximation, and surgical procedure support',
  Urology: 'urinary drainage, catheterization, urine collection, and patient fluid management',
  'Wound Care, Dressing & First Aid': 'wound cleaning, dressing, protection, compression, and first-aid care',
};

const buildCategoryDescription = (category) =>
  categoryDescriptions.get(category.name) || categoryFallback(category);

const findRuleDescription = (productName) => {
  const match = productRules.find(([pattern]) => pattern.test(productName));
  return match?.[1] || '';
};

const formatSpecs = (specs = []) =>
  specs
    .filter((spec) => clean(spec.label) || clean(spec.value))
    .slice(0, 3)
    .map((spec) => [clean(spec.label), clean(spec.value)].filter(Boolean).join(': '))
    .join(', ');

const formatVariantSummary = (variants = []) => {
  const names = Array.from(
    new Set(
      variants
        .map((variant) => clean(variant.name || variant.type))
        .filter(Boolean)
    )
  ).slice(0, 4);
  if (!names.length) return '';
  return `Available options include ${names.join(', ')}.`;
};

const duplicateListingNotes = [
  'Use this listing for routine stock requests and general facility replenishment.',
  'Use this listing when the same item is maintained as a separate stock line for ordering.',
  'Use this listing for alternate catalog handling when the facility keeps multiple entries for the same item.',
];

const buildProductDescription = (product, duplicateIndex = 0, duplicateTotal = 1) => {
  const productName = clean(product.name);
  const categoryName = product.categorySlug?.name || 'medical supplies';
  const parentName = product.categorySlug?.parent?.name || '';
  const brand = clean(product.brand);
  const ruleDescription = findRuleDescription(productName);
  const purpose = categoryPurpose[categoryName] || categoryPurpose[parentName] || 'routine clinical, healthcare, and professional supply workflows';
  const intro = ruleDescription || `${productName} for ${purpose}, selected for professional supply and repeat ordering.`;
  const brandLine = brand ? `${brand} option for facilities that need consistent sourcing of ${lower(productName)}.` : '';
  const specsLine = formatSpecs(product.specs) ? `Key specifications: ${formatSpecs(product.specs)}.` : '';
  const variantsLine = formatVariantSummary(product.variants);
  const duplicateLine =
    duplicateTotal > 1
      ? duplicateListingNotes[duplicateIndex] || duplicateListingNotes[duplicateListingNotes.length - 1]
      : '';
  return [sentence(intro), brandLine, specsLine, variantsLine, duplicateLine]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
};

async function run() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('Missing MONGO_URI or MONGODB_URI');

  await mongoose.connect(mongoUri);

  const categories = await Category.find({})
    .select('name description parent')
    .populate('parent', 'name')
    .sort({ name: 1 });

  const categoryOps = [];
  const categoryPlanned = [];

  for (const category of categories) {
    const nextDescription = buildCategoryDescription(category);
    if (!nextDescription) continue;
    if (onlyMissing && clean(category.description)) continue;
    if (clean(category.description) === nextDescription) continue;

    categoryPlanned.push({
      name: category.name,
      before: clean(category.description),
      after: nextDescription,
    });

    if (apply) {
      categoryOps.push({
        updateOne: {
          filter: { _id: category._id },
          update: { $set: { description: nextDescription } },
        },
      });
    }
  }

  const products = await Product.find({})
    .select('name brand categorySlug description specs variants')
    .populate({
      path: 'categorySlug',
      select: 'name parent',
      populate: { path: 'parent', select: 'name' },
    })
    .sort({ name: 1 });

  const productOps = [];
  const productPlanned = [];
  const duplicateNameCounts = products.reduce((counts, product) => {
    const key = lower(product.name);
    if (!key) return counts;
    counts.set(key, (counts.get(key) || 0) + 1);
    return counts;
  }, new Map());
  const duplicateNameIndexes = new Map();

  for (const product of products) {
    const duplicateKey = lower(product.name);
    const duplicateTotal = duplicateNameCounts.get(duplicateKey) || 1;
    const duplicateIndex = duplicateNameIndexes.get(duplicateKey) || 0;
    duplicateNameIndexes.set(duplicateKey, duplicateIndex + 1);
    const nextDescription = buildProductDescription(product, duplicateIndex, duplicateTotal);
    if (!nextDescription) continue;
    if (onlyMissing && clean(product.description)) continue;
    if (clean(product.description) === nextDescription) continue;

    productPlanned.push({
      name: clean(product.name),
      category: product.categorySlug?.name || '-',
      before: clean(product.description),
      after: nextDescription,
    });

    if (apply) {
      productOps.push({
        updateOne: {
          filter: { _id: product._id },
          update: { $set: { description: nextDescription } },
        },
      });
    }
  }

  if (apply && categoryOps.length) {
    await Category.bulkWrite(categoryOps, { ordered: false });
  }
  if (apply && productOps.length) {
    await Product.bulkWrite(productOps, { ordered: false });
  }

  console.log(apply ? '[APPLY]' : '[DRY RUN]');
  console.log(`Mode: ${onlyMissing ? 'only missing descriptions' : 'update all generated descriptions'}`);
  console.log(`Categories scanned: ${categories.length}`);
  console.log(`Categories to update: ${categoryPlanned.length}`);
  console.log(`Products scanned: ${products.length}`);
  console.log(`Products to update: ${productPlanned.length}`);
  console.log('');

  categoryPlanned.slice(0, 30).forEach((entry) => {
    console.log(`CATEGORY: ${entry.name}`);
    console.log(`  ${entry.after}`);
  });

  if (categoryPlanned.length > 30) {
    console.log(`... ${categoryPlanned.length - 30} more categories`);
  }

  console.log('');
  productPlanned.slice(0, 60).forEach((entry) => {
    console.log(`PRODUCT: ${entry.name} [${entry.category}]`);
    console.log(`  ${entry.after}`);
  });

  if (productPlanned.length > 60) {
    console.log(`... ${productPlanned.length - 60} more products`);
  }

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore disconnect errors on failure path
  }
  process.exit(1);
});
