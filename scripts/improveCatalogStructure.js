#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const Category = require('../models/category');
const Product = require('../models/product');

const apply = process.argv.includes('--apply');

const slugify = (value) =>
  String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

const normalize = (value) =>
  String(value || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const topCategories = [
  { name: 'Medical Equipment', sortOrder: 10, description: 'Clinical devices and room equipment for diagnostics, monitoring, suction, mobility support, and daily care delivery.' },
  { name: 'Anesthesia & Respiratory', aliases: ['ANESTHESIA & RESPIRATORY'], sortOrder: 20, description: 'Airway, oxygen therapy, breathing circuit, suction, nebulization, and resuscitation products for respiratory care.' },
  { name: 'Laboratory', sortOrder: 30, description: 'Laboratory consumables and diagnostic support products for sample collection, testing, recording, and routine clinical checks.' },
  { name: 'CSSD', sortOrder: 35, description: 'Sterilization packaging, process indicators, cleaning consumables, and clinical waste handling products for CSSD workflows.' },
  { name: 'Surgical Instruments', sortOrder: 40, description: 'Reusable and disposable surgical, examination, cutting, marking, and procedure-support instruments.' },
  { name: 'Consumables & Disposables', sortOrder: 50, description: 'Daily-use disposable clinical supplies including PPE, IV accessories, dressings, sutures, and examination items.' },
  { name: 'Orthopedic & Rehabilitation', sortOrder: 60, description: 'Orthopedic supports, braces, casting materials, bandages, and rehabilitation products for mobility and recovery support.' },
  { name: 'Hospital Furniture & Utilities', sortOrder: 70, description: 'Beds, couches, trolleys, bedside furniture, screens, stools, chairs, and transfer utilities for clinical spaces.' },
  { name: 'Urology', sortOrder: 80, description: 'Urology drainage, catheter, urine collection, feeding tube, and enema products for clinical and patient-care use.' },
  { name: 'Dental', sortOrder: 90, description: 'Dental consumables, endodontic products, burs, restorative accessories, and chairside supplies for dental clinics.' },
  { name: 'Industrial & Safety', sortOrder: 100, description: 'Workplace safety products for staff protection and operational safety in healthcare and industrial environments.' },
];

const subcategories = [
  ['Laboratory', 'Diagnostics & Recording', 31, 'Diagnostic support products including ECG paper, stethoscopes, penlights, probe covers, and ultrasound gel for clinical checks and recording.'],
  ['Laboratory', 'Lab Consumables', 32, 'Laboratory consumables for sample collection, handling, slides, pipettes, lancets, and routine specimen workflows.'],
  ['Anesthesia & Respiratory', 'Airway Management', 21, 'Endotracheal tubes, laryngeal masks, stylets, and airway products used for intubation and airway support.'],
  ['Anesthesia & Respiratory', 'Oxygen & Aerosol Therapy', 22, 'Oxygen masks, nebulizer products, breathing circuits, filters, and respiratory exercise products for oxygen and aerosol delivery.'],
  ['Anesthesia & Respiratory', 'Suction & Resuscitation', 23, 'Suction catheters, Yankauer handles, suction tubing, and manual resuscitation items for airway clearance and emergency support.'],
  ['CSSD', 'Sterilization Packaging', 36, 'Sterilization pouches and reels for packing instruments before steam sterilization and sterile storage.'],
  ['CSSD', 'Sterilization Indicators', 37, 'Indicator strips and tapes used to monitor and identify sterilization processing.'],
  ['CSSD', 'Cleaning & Decontamination', 38, 'Cleaning cloths and brushes used during instrument cleaning and decontamination workflows.'],
  ['CSSD', 'Waste & Sharps Disposal', 39, 'Biohazard bags and sharps containers for clinical waste segregation and disposal.'],
  ['Surgical Instruments', 'Blades, Handles & Cutters', 41, 'Scalpels, handles, stitch cutters, and cutting tools for surgical and minor procedure support.'],
  ['Surgical Instruments', 'Scissors & Forceps', 42, 'Scissors and forceps for dressing, grasping, cutting, and routine surgical handling.'],
  ['Surgical Instruments', 'Procedure & Examination Instruments', 43, 'Specula, procedure markers, and examination support instruments used in clinical procedures.'],
  ['Consumables & Disposables', 'Examination & General Disposable', 51, 'General examination disposables including kidney dishes, razors, patient ID bands, tongue depressors, and wooden applicators.'],
  ['Consumables & Disposables', 'Injection & IV Disposable', 52, 'Syringes, needles, IV sets, cannulas, stopcocks, tourniquets, and injection or infusion accessories.'],
  ['Consumables & Disposables', 'PPE Masks & Shields', 53, 'Face masks, N95 masks, dust masks, and eye-shield masks for staff and patient protection.'],
  ['Consumables & Disposables', 'PPE Gloves', 54, 'Examination, surgical, nitrile, vinyl, PVC, latex, and cotton gloves for protective clinical handling.'],
  ['Consumables & Disposables', 'Gowns, Drapes & Covers', 55, 'Caps, gowns, aprons, shoe covers, bed sheets, underpads, and non-woven protective covers.'],
  ['Consumables & Disposables', 'Wound Dressings & Gauze', 56, 'Gauze, cotton rolls, dressing sets, wound dressings, laparotomy sponges, and wound-contact dressing materials.'],
  ['Consumables & Disposables', 'Medical Tapes & Bandages', 57, 'Clinical tapes, adhesive bandages, crepe bandages, elastic net bandages, and conforming bandages.'],
  ['Consumables & Disposables', 'Skin Prep & First Aid', 58, 'Alcohol swabs, wound plasters, ice packs, and first-aid accessories for quick treatment support.'],
  ['Consumables & Disposables', 'Sutures', 59, 'Absorbable and non-absorbable sutures for wound closure, tissue approximation, and surgical procedures.'],
  ['Urology', 'Catheters & Tubes', 81, 'Foley catheters, Nelaton catheters, feeding tubes, and related tube products for urology and drainage use.'],
  ['Urology', 'Urine Collection & Drainage', 82, 'Urine bags, urine bottles, containers, pediatric collectors, and drainage accessories.'],
  ['Urology', 'Enema & Urology Accessories', 83, 'Enema sets and accessory products used in urology and patient-care support.'],
  ['Medical Equipment', 'Vital Signs & Diagnostics', 11, 'Blood pressure, pulse oximetry, thermometer, scale, and height-measurement devices for routine monitoring.'],
  ['Medical Equipment', 'Clinical Suction & Support Devices', 12, 'Suction devices, IV stands, immobilizers, and clinical support equipment for care delivery.'],
  ['Medical Equipment', 'Examination Room Equipment', 13, 'Examination lamps and room devices used to support assessment and treatment spaces.'],
  ['Hospital Furniture & Utilities', 'Beds & Examination Furniture', 71, 'Hospital beds, baby beds, examination couches, and clinical furniture for patient positioning.'],
  ['Hospital Furniture & Utilities', 'Mobility & Transfer Utilities', 72, 'Wheelchairs, commode chairs, stretchers, and transfer utilities for patient movement and support.'],
  ['Hospital Furniture & Utilities', 'Room Utility Furniture', 73, 'Bedside cabinets, folding screens, footstools, and trolleys used around clinical rooms.'],
  ['Orthopedic & Rehabilitation', 'Supports & Braces', 61, 'Neck, shoulder, back, arm, knee, finger, and spine supports for orthopedic and rehabilitation use.'],
  ['Orthopedic & Rehabilitation', 'Casting & Padding', 62, 'Fiberglass casting, POP bandages, orthopedic padding, and casting support materials.'],
  ['Orthopedic & Rehabilitation', 'Compression & Rehab Bandages', 63, 'Anti-embolism stockings, crepe bandages, flex bandages, PBT bandages, and tubular elastic net bandages.'],
];

const renames = new Map([
  ['3 way stop cock', '3-Way Stopcock'],
  ['3 way stop cock with extention', '3-Way Stopcock with Extension'],
  ['Absorbent Paper point', 'Absorbent Paper Points'],
  ['Air compressing nebulizer machine', 'Compressor Nebulizer Machine'],
  ['All Types Of Forceps', 'All Types of Forceps'],
  ['BP Machine ', 'Blood Pressure Machine'],
  ['Chemical Indicator Strips ', 'Chemical Indicator Strips'],
  ['Cotton Roll ', 'Cotton Roll'],
  ['Dental needle', 'Dental Needle'],
  ['Disp. Hypodermic needle', 'Disposable Hypodermic Needle'],
  ['Disp. Infusion administration set (iV set)', 'Disposable IV Infusion Set'],
  ['Disp. Kidney Dish', 'Disposable Kidney Dish'],
  ['Disp. Pediatric infusion set with burette', 'Disposable Pediatric Burette IV Set'],
  ['Disp. Razors', 'Disposable Razors'],
  ['Disp. Syringes (normal,tuberculin, insulin)', 'Disposable Syringes'],
  ['Doctor / surgeon cap', 'Doctor / Surgeon Cap'],
  ['Elastic cloth Adhesive tape', 'Elastic Cloth Adhesive Tape'],
  ['Face mask with eye sheild', 'Face Mask with Eye Shield'],
  ['First aid adhesve bandages/wound plaster/saniplast', 'First Aid Adhesive Bandages / Wound Plaster'],
  ['Flat sterilizations Reels', 'Flat Sterilization Reels'],
  ['Foldway strecher ', 'Foldaway Stretcher'],
  ['Footstool ', 'Footstool'],
  ['H-Files-Stainless Steel', 'H-Files Stainless Steel'],
  ['Infra-red EarThermometer', 'Infrared Ear Thermometer'],
  ['K- Files-Stainless Steel', 'K-Files Stainless Steel'],
  ['Latex dental dam', 'Latex Dental Dam'],
  ['Latex foley Cath. 100% silicon 2 way', '100% Silicone Foley Catheter 2-Way'],
  ['Latex foley Cath. 100% silicon 3 way', '100% Silicone Foley Catheter 3-Way'],
  ['Latex foley Cath. Coated', 'Coated Latex Foley Catheter'],
  ['Microbrush applicator ', 'Microbrush Applicator'],
  ['Microscope Slides ', 'Microscope Slides'],
  ['Orthopaedic Fiber glass casting', 'Orthopedic Fiberglass Casting'],
  ['Orthopaedic cotton padding', 'Orthopedic Cotton Padding'],
  ['Paste Carriers ( Lentula )', 'Paste Carriers (Lentulo)'],
  ['Pastuer Pipette', 'Pasteur Pipette'],
  ['PVC feeding tube/Ryles tube', 'PVC Feeding Tube / Ryles Tube'],
  ['PVC nelaton catheter', 'PVC Nelaton Catheter'],
  ['Scalp vein set', 'Scalp Vein Set'],
  ['Silicon manual resuscitator', 'Silicone Manual Resuscitator'],
  ['SMS surgeons Gown', 'SMS Surgeon Gown'],
  ['Suction Cath.', 'Suction Catheter'],
  ['Surgical skin marker', 'Surgical Skin Marker'],
  ['Torniquets', 'Tourniquets'],
  ['Urine Bottle ', 'Urine Bottle'],
  ['Urine Container ', 'Urine Container'],
  ['Urine bags', 'Urine Bags'],
  ['Vaginal Speculam', 'Vaginal Speculum'],
]);

const productTargets = new Map([
  ['Heat & moisture exchanging filter (HMEF)', 'Oxygen & Aerosol Therapy'],
  ['Nebulizer Masks', 'Oxygen & Aerosol Therapy'],
  ['Oxygen Masks', 'Oxygen & Aerosol Therapy'],
  ['Oxygen Recovery Kit 40%', 'Oxygen & Aerosol Therapy'],
  ['Oxygen Venturi Masks', 'Oxygen & Aerosol Therapy'],
  ['Respiratory exercisers/spirometer', 'Oxygen & Aerosol Therapy'],
  ['Breathing circuits with catheter mount', 'Oxygen & Aerosol Therapy'],
  ['Compressor Nebulizer Machine', 'Oxygen & Aerosol Therapy'],
  ['Anesthesia Masks', 'Airway Management'],
  ['Disposable Laryngeal Masks', 'Airway Management'],
  ['Endotracheal tubes', 'Airway Management'],
  ['Intubation Stylet', 'Airway Management'],
  ['Nasal preformed tracheal tubes', 'Airway Management'],
  ['Oral preformed tracheal tubes', 'Airway Management'],
  ['Reinforced endotracheal tubes', 'Airway Management'],
  ['Reusable Laryngeal Masks', 'Airway Management'],
  ['Tracheostomy masks', 'Airway Management'],
  ['Silicone Manual Resuscitator', 'Suction & Resuscitation'],
  ['Suction Catheter', 'Suction & Resuscitation'],
  ['Suction connecting tubes', 'Suction & Resuscitation'],
  ['Yankauer Handle', 'Suction & Resuscitation'],
  ['Flat Sterilization Pouches', 'Sterilization Packaging'],
  ['Flat Sterilization Reels', 'Sterilization Packaging'],
  ['Chemical Indicator Strips', 'Sterilization Indicators'],
  ['Steam Sterilization Indicator Tape', 'Sterilization Indicators'],
  ['J-Cloth', 'Cleaning & Decontamination'],
  ['Nail Brushes', 'Cleaning & Decontamination'],
  ['Biohazard Bags', 'Waste & Sharps Disposal'],
  ['Sharp Containers', 'Waste & Sharps Disposal'],
  ['Surgical Blades', 'Blades, Handles & Cutters'],
  ['Scalpel Handle', 'Blades, Handles & Cutters'],
  ['Stitch Cutter', 'Blades, Handles & Cutters'],
  ['All Types of Forceps', 'Scissors & Forceps'],
  ['Bandage Scissors', 'Scissors & Forceps'],
  ['Simple Scissors', 'Scissors & Forceps'],
  ['Surgical Skin Marker', 'Procedure & Examination Instruments'],
  ['Vaginal Speculum', 'Procedure & Examination Instruments'],
  ['Buck Reflex Hammer', 'Diagnostics & Recording'],
  ['Francy Reflex Hammer', 'Diagnostics & Recording'],
  ['Dust proof face mask', 'PPE Masks & Shields'],
  ['Face Mask', 'PPE Masks & Shields'],
  ['Face Mask with Eye Shield', 'PPE Masks & Shields'],
  ['N95 mask', 'PPE Masks & Shields'],
  ['Cotton Gloves', 'PPE Gloves'],
  ['Latex Surgical Gloves Powdered/Powder Free', 'PPE Gloves'],
  ['Latex examination gloves', 'PPE Gloves'],
  ['Nitrile gloves', 'PPE Gloves'],
  ['Vinyl / PVC gloves', 'PPE Gloves'],
  ['Doctor / Surgeon Cap', 'Gowns, Drapes & Covers'],
  ['Isolation gowns', 'Gowns, Drapes & Covers'],
  ['Non-woven bed sheet', 'Gowns, Drapes & Covers'],
  ['PE Apron', 'Gowns, Drapes & Covers'],
  ['Patient gown', 'Gowns, Drapes & Covers'],
  ['Shoe cover', 'Gowns, Drapes & Covers'],
  ['SMS Surgeon Gown', 'Gowns, Drapes & Covers'],
  ['Underpad 60 x 90', 'Gowns, Drapes & Covers'],
  ['Closed wound drainage reservoir', 'Wound Dressings & Gauze'],
  ['Cotton Roll', 'Wound Dressings & Gauze'],
  ['Dressing Set', 'Wound Dressings & Gauze'],
  ['Gauze Rolls', 'Wound Dressings & Gauze'],
  ['Gauze swab / Gauze sponge', 'Wound Dressings & Gauze'],
  ['Gauze/Cotton Balls', 'Wound Dressings & Gauze'],
  ['Laparotomy sponge', 'Wound Dressings & Gauze'],
  ['PU transparent wound dressing', 'Wound Dressings & Gauze'],
  ['Spunlace Non-woven Dressing Roll', 'Wound Dressings & Gauze'],
  ['Sterile Gauze Swab', 'Wound Dressings & Gauze'],
  ['Wound Dressings', 'Wound Dressings & Gauze'],
  ['Elastic Cloth Adhesive Tape', 'Medical Tapes & Bandages'],
  ['Microporous Surgical Tape Non-Woven', 'Medical Tapes & Bandages'],
  ['Transparent surgical tape PE', 'Medical Tapes & Bandages'],
  ['Alcohol Swab Pad', 'Skin Prep & First Aid'],
  ['First Aid Adhesive Bandages / Wound Plaster', 'Skin Prep & First Aid'],
  ['Instant Ice pack', 'Skin Prep & First Aid'],
  ['100% Silicone Foley Catheter 2-Way', 'Catheters & Tubes'],
  ['100% Silicone Foley Catheter 3-Way', 'Catheters & Tubes'],
  ['Coated Latex Foley Catheter', 'Catheters & Tubes'],
  ['PVC Feeding Tube / Ryles Tube', 'Catheters & Tubes'],
  ['PVC Nelaton Catheter', 'Catheters & Tubes'],
  ['Pediatric urine collector', 'Urine Collection & Drainage'],
  ['Urine Bags', 'Urine Collection & Drainage'],
  ['Urine Bottle', 'Urine Collection & Drainage'],
  ['Urine Container', 'Urine Collection & Drainage'],
  ['Cleaning enema set', 'Enema & Urology Accessories'],
  ['Blood Pressure Machine', 'Vital Signs & Diagnostics'],
  ['Digital Weight + Height Machine ', 'Vital Signs & Diagnostics'],
  ['Infrared Ear Thermometer', 'Vital Signs & Diagnostics'],
  ['Mechanical Baby Scale', 'Vital Signs & Diagnostics'],
  ['Pulse Oximeter', 'Vital Signs & Diagnostics'],
  ['Electrical Sputum Suction Device ', 'Clinical Suction & Support Devices'],
  ['Head Immobilizer', 'Clinical Suction & Support Devices'],
  ['IV Stand', 'Clinical Suction & Support Devices'],
  ['Suction Machine', 'Clinical Suction & Support Devices'],
  ['Examination lamps', 'Examination Room Equipment'],
  ['Baby Bed', 'Beds & Examination Furniture'],
  ['Electric Bed ', 'Beds & Examination Furniture'],
  ['Examination Couch ', 'Beds & Examination Furniture'],
  ['Commode Chair ', 'Mobility & Transfer Utilities'],
  ['Foldaway Stretcher', 'Mobility & Transfer Utilities'],
  ['Wheel Chair', 'Mobility & Transfer Utilities'],
  ['Bedside Cabinet ', 'Room Utility Furniture'],
  ['Folding Screen', 'Room Utility Furniture'],
  ['Footstool', 'Room Utility Furniture'],
  ['Stainless Steel Medical Trolley', 'Room Utility Furniture'],
  ['Anti-Embolism Stockings', 'Compression & Rehab Bandages'],
  ['Elastic Crepe Bandage', 'Compression & Rehab Bandages'],
  ['Flex Bandage ', 'Compression & Rehab Bandages'],
  ['PBT conforming bandage', 'Compression & Rehab Bandages'],
  ['Tubular Elastic Net bandages', 'Compression & Rehab Bandages'],
  ['Orthopedic Fiberglass Casting', 'Casting & Padding'],
  ['Orthopedic Cotton Padding', 'Casting & Padding'],
  ['Plaster of Paris / POP bandage', 'Casting & Padding'],
  ['Arm Support', 'Supports & Braces'],
  ['Back & Spine', 'Supports & Braces'],
  ['Cervical Collars', 'Supports & Braces'],
  ['Finger Splints', 'Supports & Braces'],
  ['Kids Neck & Shoulder Supports', 'Supports & Braces'],
  ['Knee Support', 'Supports & Braces'],
  ['Neck Support', 'Supports & Braces'],
]);

const retiredEmptyCategories = [
  'PPE & Non-Woven Disposable',
  'Wound Care, Dressing & First Aid',
];

const orderGroups = [
  ...Array.from(productTargets.keys()),
  'Absorbent Paper Points',
  'Gutta Percha Points',
  'H-Files Stainless Steel',
  'K-Files Stainless Steel',
  'Reamers-Stainless Steel',
  'Recip-One Files',
  'Retreatment Files',
  'Sup Taper Files Aurora',
  'Sup-Taper Files Hand Use',
  'Super Flexi Files',
  'Gate Drills & Pesso Reamers',
  'Paste Carriers (Lentulo)',
  'Barbed Broaches with Plastic Handle',
  'Gutta Percha Cutter',
  'Stainless Steel Pluggers',
  'Stainless Steel Spreaders',
  'Diamond Burs FG',
  'Carbide Burs FG',
  'Polishing Disc',
  'Air Water Syringe Tips',
  'Dental Needle',
  'Microbrush Applicator',
  'Surgical Aspirator Tips',
  'Saliva Ejector',
  'Head Rest Sleeve',
  'Denture Box',
  'Articulating Paper Straight',
  'Dental Matrix Bands',
  'Latex Dental Dam',
  'Poly Coated Mixing Pad',
  'Safety Goggles',
  'Safety Shoes',
];

const findCategory = async (name) =>
  Category.findOne({ name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' } });

const ensureCategory = async ({ name, aliases = [], parent = null, sortOrder, description }) => {
  let category = await findCategory(name);
  for (const alias of aliases) {
    if (!category) category = await findCategory(alias);
  }

  const update = {
    name,
    slug: slugify(name),
    parent: parent?._id || null,
    sortOrder,
    description,
  };

  if (!category) {
    if (apply) category = await Category.create(update);
    return { action: 'create', category: category || { _id: `planned-${slugify(name)}`, name } };
  }

  const needsUpdate =
    category.name !== name ||
    category.slug !== update.slug ||
    String(category.parent || '') !== String(update.parent || '') ||
    Number(category.sortOrder || 0) !== Number(sortOrder || 0) ||
    String(category.description || '') !== String(description || '');

  if (apply && needsUpdate) {
    category = await Category.findByIdAndUpdate(category._id, update, { new: true });
  }

  return { action: needsUpdate ? 'update' : 'keep', category };
};

const findProductsByName = (name) =>
  Product.find({ name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' } }).populate('categorySlug', 'name');

const renameAliasesByTarget = Array.from(renames.entries()).reduce((map, [from, to]) => {
  if (!map.has(normalize(to))) map.set(normalize(to), []);
  map.get(normalize(to)).push(from);
  return map;
}, new Map());

const findProductsByCatalogName = async (name) => {
  const names = [name, ...(renameAliasesByTarget.get(normalize(name)) || [])];
  const patterns = names.map((entry) => `^${escapeRegex(entry)}$`);
  return Product.find({ name: { $in: patterns.map((pattern) => new RegExp(pattern, 'i')) } }).populate('categorySlug', 'name');
};

async function run() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('Missing MONGO_URI or MONGODB_URI');
  await mongoose.connect(mongoUri);

  const categoryMap = new Map();
  const categoryResults = [];

  for (const entry of topCategories) {
    const result = await ensureCategory(entry);
    categoryMap.set(normalize(entry.name), result.category);
    categoryResults.push({ name: entry.name, action: result.action });
  }

  for (const [parentName, name, sortOrder, description] of subcategories) {
    const parent = categoryMap.get(normalize(parentName)) || await findCategory(parentName);
    if (!parent) throw new Error(`Missing parent category: ${parentName}`);
    const result = await ensureCategory({ name, parent, sortOrder, description });
    categoryMap.set(normalize(name), result.category);
    categoryResults.push({ name: `${parentName} > ${name}`, action: result.action });
  }

  const renameResults = [];
  for (const [from, to] of renames.entries()) {
    const products = await findProductsByName(from);
    if (!products.length) continue;
    for (const product of products) {
      if (apply && product.name !== to) {
        product.name = to;
        await product.save();
      }
      renameResults.push({ from, to, action: product.name === to ? 'keep' : 'rename' });
    }
  }

  const moveResults = [];
  for (const [productName, categoryName] of productTargets.entries()) {
    const target = categoryMap.get(normalize(categoryName)) || await findCategory(categoryName);
    if (!target?._id) throw new Error(`Missing target category: ${categoryName}`);
    const products = await findProductsByCatalogName(productName);
    if (!products.length) {
      moveResults.push({ productName, categoryName, action: 'missing-product' });
      continue;
    }

    for (const product of products) {
      const currentName = product.categorySlug?.name || '-';
      const alreadyThere = String(product.categorySlug?._id || product.categorySlug || '') === String(target._id);
      if (apply && !alreadyThere) {
        product.categorySlug = target._id;
        await product.save();
      }
      moveResults.push({ productName, from: currentName, to: target.name, action: alreadyThere ? 'keep' : 'move' });
    }
  }

  const priorityByProductName = new Map(orderGroups.map((name, index) => [normalize(name), (index + 1) * 10]));
  const sortableProducts = await Product.find({ isActive: { $ne: false } })
    .select('name categorySlug sortOrder')
    .populate('categorySlug', 'sortOrder name')
    .sort({ name: 1 });
  const sortResults = [];
  for (const [index, product] of sortableProducts.entries()) {
    const categorySort = Number(product.categorySlug?.sortOrder || 999);
    const productPriority = priorityByProductName.get(normalize(product.name)) || 900 + index;
    const nextSortOrder = (categorySort * 1000) + productPriority;
    const needsSortUpdate = product.sortOrder !== nextSortOrder;
    if (apply && needsSortUpdate) {
      product.sortOrder = nextSortOrder;
      await product.save();
    }
    sortResults.push({ productName: product.name, sortOrder: nextSortOrder, action: needsSortUpdate ? 'update' : 'keep' });
  }

  const duplicateGroups = await Product.aggregate([
    { $group: { _id: { name: { $toLower: { $trim: { input: '$name' } } }, categorySlug: '$categorySlug' }, ids: { $push: '$_id' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]);

  const duplicateResults = [];
  for (const group of duplicateGroups) {
    const products = await Product.find({ _id: { $in: group.ids } }).select('name categorySlug image images isActive createdAt').sort({ createdAt: 1 });
    const sorted = [...products].sort((a, b) => {
      const aScore = Number(Boolean(a.image)) + Number((a.images || []).length > 0) + Number(a.isActive !== false);
      const bScore = Number(Boolean(b.image)) + Number((b.images || []).length > 0) + Number(b.isActive !== false);
      return bScore - aScore || new Date(a.createdAt) - new Date(b.createdAt);
    });
    const [keeper, ...duplicates] = sorted;
    for (const product of duplicates) {
      if (apply && product.isActive !== false) {
        product.isActive = false;
        await product.save();
      }
      duplicateResults.push({ name: product.name, kept: String(keeper._id), inactive: String(product._id), action: product.isActive === false ? 'keep-inactive' : 'deactivate' });
    }
  }

  const retiredResults = [];
  for (const name of retiredEmptyCategories) {
    const category = await findCategory(name);
    if (!category) continue;
    const [productCount, childCount] = await Promise.all([
      Product.countDocuments({ categorySlug: category._id }),
      Category.countDocuments({ parent: category._id }),
    ]);

    if (productCount || childCount) {
      retiredResults.push({ name, action: 'keep', productCount, childCount });
      continue;
    }

    if (apply) {
      await Category.findByIdAndDelete(category._id);
    }
    retiredResults.push({ name, action: 'delete-empty' });
  }

  const counts = await Product.aggregate([
    { $match: { isActive: { $ne: false } } },
    { $group: { _id: '$categorySlug', count: { $sum: 1 } } },
    { $lookup: { from: 'categories', localField: '_id', foreignField: '_id', as: 'category' } },
    { $unwind: '$category' },
    { $lookup: { from: 'categories', localField: 'category.parent', foreignField: '_id', as: 'parent' } },
    { $unwind: { path: '$parent', preserveNullAndEmptyArrays: true } },
    { $project: { _id: 0, category: '$category.name', parent: '$parent.name', count: 1, sortOrder: '$category.sortOrder' } },
    { $sort: { sortOrder: 1, category: 1 } },
  ]);

  console.log(apply ? '[APPLY]' : '[DRY RUN]');
  console.log(`Categories checked: ${categoryResults.length}`);
  console.log(`Category changes: ${categoryResults.filter((entry) => entry.action !== 'keep').length}`);
  console.log(`Product renames: ${renameResults.filter((entry) => entry.action === 'rename').length}`);
  console.log(`Product moves: ${moveResults.filter((entry) => entry.action === 'move').length}`);
  console.log(`Product sort updates: ${sortResults.filter((entry) => entry.action === 'update').length}`);
  console.log(`Duplicate products to deactivate: ${duplicateResults.filter((entry) => entry.action === 'deactivate').length}`);
  console.log(`Empty legacy categories to retire: ${retiredResults.filter((entry) => entry.action === 'delete-empty').length}`);
  console.log('Move issues:', moveResults.filter((entry) => entry.action.startsWith('missing')));
  console.log('Active product counts:');
  console.log(JSON.stringify(counts, null, 2));

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
