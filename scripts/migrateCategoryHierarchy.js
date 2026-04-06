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

const hasValue = (value) => String(value || '').trim().length > 0;

const MAIN_CATEGORIES = [
  { name: 'Medical Equipment', sortOrder: 10 },
  { name: 'Anesthesia & Respiratory', sortOrder: 20 },
  { name: 'Laboratory', sortOrder: 30 },
  { name: 'Surgical Instruments', sortOrder: 40 },
  { name: 'Consumables & Disposables', sortOrder: 50 },
  { name: 'Orthopedic & Rehabilitation', sortOrder: 60 },
  { name: 'Hospital Furniture & Utilities', sortOrder: 70 },
  { name: 'Urology', sortOrder: 80 },
  { name: 'Dental', sortOrder: 90 },
  { name: 'Industrial & Safety', sortOrder: 100 },
];

const CATEGORY_PLAN = [
  {
    target: 'Medical Equipment',
    parent: null,
    sources: ['Medical Equipment'],
    aliases: ['Medical Equipment'],
  },
  {
    target: 'Anesthesia & Respiratory',
    parent: null,
    sources: ['ANESTHESIA & RESPIRATORY', 'Anesthesia & Respiratory'],
    aliases: ['Anesthesia & Respiratory'],
  },
  {
    target: 'Laboratory',
    parent: null,
    sources: ['Lab Devices & Consumables', 'Laboratory'],
    aliases: ['Laboratory'],
  },
  {
    target: 'Surgical Instruments',
    parent: null,
    sources: ['Surgical Instruments'],
    aliases: ['Surgical Instruments'],
  },
  {
    target: 'Consumables & Disposables',
    parent: null,
    sources: ['Consumables & Disposables'],
    aliases: ['Consumables & Disposables'],
  },
  {
    target: 'Orthopedic & Rehabilitation',
    parent: null,
    sources: ['Orthopedic', 'Orthopedic & Rehabilitation'],
    aliases: ['Orthopedic & Rehabilitation'],
  },
  {
    target: 'Hospital Furniture & Utilities',
    parent: null,
    sources: ['Medical Furniture', 'Hospital Furniture & Utilities'],
    aliases: ['Hospital Furniture & Utilities'],
  },
  {
    target: 'Urology',
    parent: null,
    sources: ['Urology'],
    aliases: ['Urology'],
  },
  {
    target: 'Dental',
    parent: null,
    sources: ['Dental'],
    aliases: ['Dental'],
  },
  {
    target: 'Industrial & Safety',
    parent: null,
    sources: ['Industrial Supplies', 'Industrial & Safety'],
    aliases: ['Industrial & Safety'],
  },
  {
    target: 'Lab Consumables',
    parent: 'Laboratory',
    sources: [],
    aliases: ['Lab Consumables'],
  },
  {
    target: 'Lab Equipment',
    parent: 'Laboratory',
    sources: [],
    aliases: ['Lab Equipment'],
  },
  {
    target: 'Diagnostics & Recording',
    parent: 'Laboratory',
    sources: [],
    aliases: ['Diagnostics & Recording'],
  },
  {
    target: 'Injection & IV Disposable',
    parent: 'Consumables & Disposables',
    sources: ['Hypodermic Disposable'],
    aliases: ['Injection & IV Disposable', 'Injection & IV'],
  },
  {
    target: 'Wound Care, Dressing & First Aid',
    parent: 'Consumables & Disposables',
    sources: ['Medical Dressing & First Aid'],
    aliases: ['Wound Care, Dressing & First Aid'],
  },
  {
    target: 'PPE & Non-Woven Disposable',
    parent: 'Consumables & Disposables',
    sources: ['Non Woven Surgical Disposables'],
    aliases: ['PPE & Non-Woven Disposable'],
  },
  {
    target: 'Sutures',
    parent: 'Consumables & Disposables',
    sources: ['Sutures'],
    aliases: ['Sutures'],
  },
  {
    target: 'Examination & General Disposable',
    parent: 'Consumables & Disposables',
    sources: ['Examination Disposable'],
    aliases: ['Examination & General Disposable', 'General Disposable'],
  },
];

const productCategoryMoves = [
  ['Absorbent Paper point', 'Dental'],
  ['Air Water Syringe Tips', 'Dental'],
  ['Articulating Paper Straight', 'Dental'],
  ['Barbed Broaches with Plastic Handle', 'Dental'],
  ['Carbide Burs FG', 'Dental'],
  ['Cotton Role Dispenser', 'Dental'],
  ['Dental Matrix Bands', 'Dental'],
  ['Denture Box', 'Dental'],
  ['Diamond Burs FG', 'Dental'],
  ['Evacuator Ejector', 'Dental'],
  ['Gate Drills & Pesso Reamers', 'Dental'],
  ['Gutta Percha Cutter', 'Dental'],
  ['Gutta Percha Points', 'Dental'],
  ['H-Files-Stainless Steel', 'Dental'],
  ['INO-Shaper', 'Dental'],
  ['K-Files-Stainless Steel', 'Dental'],
  ['Latex dental dam', 'Dental'],
  ['Paste Carriers ( Lentula )', 'Dental'],
  ['Polishing Disc', 'Dental'],
  ['Reamers-Stainless Steel', 'Dental'],
  ['Recip-One Files', 'Dental'],
  ['Retreatment Files', 'Dental'],
  ['Saliva Ejector', 'Dental'],
  ['Stainless Steel Pluggers', 'Dental'],
  ['Stainless Steel Spreaders', 'Dental'],
  ['Sup Taper Files Aurora', 'Dental'],
  ['Sup-Taper Files Hand Use', 'Dental'],
  ['Super Flexi Files', 'Dental'],
  ['Surgical Aspirator Tips', 'Dental'],
  ['Dental needle', 'Dental'],
  ['Heat & moisture exchanging filter (HMEF)', 'Anesthesia & Respiratory'],
  ['Breathing circuits with catheter mount', 'Anesthesia & Respiratory'],
  ['Oxygen Masks', 'Anesthesia & Respiratory'],
  ['Nebulizer Masks', 'Anesthesia & Respiratory'],
  ['Oxygen Venturi Masks', 'Anesthesia & Respiratory'],
  ['Oxygen Recovery Kit 40%', 'Anesthesia & Respiratory'],
  ['Tracheostomy masks', 'Anesthesia & Respiratory'],
  ['Anesthesia Masks', 'Anesthesia & Respiratory'],
  ['Endotracheal tubes', 'Anesthesia & Respiratory'],
  ['Nasal preformed tracheal tubes', 'Anesthesia & Respiratory'],
  ['Oral preformed tracheal tubes', 'Anesthesia & Respiratory'],
  ['Reinforced endotracheal tubes', 'Anesthesia & Respiratory'],
  ['Suction connecting tubes', 'Anesthesia & Respiratory'],
  ['Reuseable laryngeal masks', 'Anesthesia & Respiratory'],
  ['Disp. Laryngeal masks', 'Anesthesia & Respiratory'],
  ['Yankuer Handle', 'Anesthesia & Respiratory'],
  ['Intubation Stylet', 'Anesthesia & Respiratory'],
  ['Respiratory exercisers/spirometer', 'Anesthesia & Respiratory'],
  ['Silicon manual resuscitator', 'Anesthesia & Respiratory'],
  ['Air cimpressing nebulizer machine', 'Anesthesia & Respiratory'],
  ['Examination lamps', 'Medical Equipment'],
  ['Machenical Baby scale', 'Medical Equipment'],
  ['IV Stand', 'Hospital Furniture & Utilities'],
  ['Stainless Steel Medical Trolley', 'Hospital Furniture & Utilities'],
  ['Wheel Chair', 'Hospital Furniture & Utilities'],
  ['Foldway strecher two parts and four parts', 'Hospital Furniture & Utilities'],
  ['Stainless Steel collecting tanks', 'Hospital Furniture & Utilities'],
  ['Anti-Embolism Stockings', 'Orthopedic & Rehabilitation'],
  ['Arm Support', 'Orthopedic & Rehabilitation'],
  ['Back & Spine', 'Orthopedic & Rehabilitation'],
  ['Finger Splints', 'Orthopedic & Rehabilitation'],
  ['Kids Neck & Shoulder Supports', 'Orthopedic & Rehabilitation'],
  ['Knee Support', 'Orthopedic & Rehabilitation'],
  ['Neck Support', 'Orthopedic & Rehabilitation'],
  ['Curvical collars', 'Orthopedic & Rehabilitation'],
  ['Elastic Crepe Bandage', 'Orthopedic & Rehabilitation'],
  ['PBT conforming bandage', 'Orthopedic & Rehabilitation'],
  ['Orthopaedic cotton padding', 'Orthopedic & Rehabilitation'],
  ['Tubular Elastic Net bandages', 'Orthopedic & Rehabilitation'],
  ['Plaster of Paris / POP bandage', 'Orthopedic & Rehabilitation'],
  ['Orthopaedic Fiber glass casting', 'Orthopedic & Rehabilitation'],
  ['surgical blades', 'Surgical Instruments'],
  ['Stitch cutter', 'Surgical Instruments'],
  ['Scalpal blades', 'Surgical Instruments'],
  ['All types of forceps', 'Surgical Instruments'],
  ['Dressind set', 'Surgical Instruments'],
  ['Surgical skin marker', 'Surgical Instruments'],
  ['Nail brushes', 'Surgical Instruments'],
  ['Bandage Scissors', 'Surgical Instruments'],
  ['Simple scissors', 'Surgical Instruments'],
  ['Vaginal speculams', 'Surgical Instruments'],
  ['PVC nelaton catheter', 'Urology'],
  ['Latex foley Cath. Coated', 'Urology'],
  ['Latex foley Cath. 100% silicon 2 way', 'Urology'],
  ['Latex foley Cath. 100% silicon 3 way', 'Urology'],
  ['Suction Cath.', 'Urology'],
  ['PVC feeding tube/Ryles tube', 'Urology'],
  ['Urine bags', 'Urology'],
  ['Cleaning enema set', 'Urology'],
  ['Pediatric urine collector', 'Urology'],
  ['Blood collection tubes', 'Lab Consumables'],
  ['Pastuer Pipette', 'Lab Consumables'],
  ['Blood Lancet', 'Lab Consumables'],
  ['Test Strips', 'Lab Consumables'],
  ['ECG paper Roll', 'Diagnostics & Recording'],
  ['ECG Gel', 'Diagnostics & Recording'],
  ['Ultrasoung transmission coupling gel', 'Diagnostics & Recording'],
  ['Daclon Nylon', 'Sutures'],
  ['Silk Braided', 'Sutures'],
  ['Surgicryl 910', 'Sutures'],
  ['Surgicryl Monofast', 'Sutures'],
  ['Surgicryl Monofilament', 'Sutures'],
  ['Surgicryl PGA', 'Sutures'],
  ['Surgicryl Rapid', 'Sutures'],
  ['Disp. Syringes (normal,tuberculin, insulin)', 'Injection & IV Disposable'],
  ['Scalp vein set', 'Injection & IV Disposable'],
  ['Disp. Hypodermic needle', 'Injection & IV Disposable'],
  ['Disp. Infusion administration set (iV set)', 'Injection & IV Disposable'],
  ['Disp. Pediatric infusion set with burette', 'Injection & IV Disposable'],
  ['I.V cannula', 'Injection & IV Disposable'],
  ['Spinal needle', 'Injection & IV Disposable'],
  ['3 way stop cock', 'Injection & IV Disposable'],
  ['3 way stop cock with extention', 'Injection & IV Disposable'],
  ['Heparin cap/IV stopper', 'Injection & IV Disposable'],
  ['Epidural minipack/kit', 'Injection & IV Disposable'],
  ['Torniquets', 'Injection & IV Disposable'],
  ['Sterile Gauze Swab', 'Wound Care, Dressing & First Aid'],
  ['Gauze Rolls', 'Wound Care, Dressing & First Aid'],
  ['Gauze swab / Gauze sponge', 'Wound Care, Dressing & First Aid'],
  ['Sterile gauze swab', 'Wound Care, Dressing & First Aid'],
  ['Laparotomy sponge', 'Wound Care, Dressing & First Aid'],
  ['Gauze balls', 'Wound Care, Dressing & First Aid'],
  ['Cotton Balls', 'Wound Care, Dressing & First Aid'],
  ['Alcohal swab pad', 'Wound Care, Dressing & First Aid'],
  ['Microporoes surgical tape non-woven', 'Wound Care, Dressing & First Aid'],
  ['Transparent surgical tape PE', 'Wound Care, Dressing & First Aid'],
  ['Spunlace Non-woven Dressing Roll', 'Wound Care, Dressing & First Aid'],
  ['PU transparent wound dressing', 'Wound Care, Dressing & First Aid'],
  ['Elastic cloth Adhesive tape', 'Wound Care, Dressing & First Aid'],
  ['First aid adhesve bandages/wound plaster/saniplast', 'Wound Care, Dressing & First Aid'],
  ['Wound Dressings', 'Wound Care, Dressing & First Aid'],
  ['Instant Ice pack', 'Wound Care, Dressing & First Aid'],
  ['Face Mask', 'PPE & Non-Woven Disposable'],
  ['Head Rest Sleeve', 'PPE & Non-Woven Disposable'],
  ['Isolation gowns', 'PPE & Non-Woven Disposable'],
  ['SMS surgeons Gown', 'PPE & Non-Woven Disposable'],
  ['Patient gown', 'PPE & Non-Woven Disposable'],
  ['PE Apron', 'PPE & Non-Woven Disposable'],
  ['Face mask with eye sheild', 'PPE & Non-Woven Disposable'],
  ['N95 mask', 'PPE & Non-Woven Disposable'],
  ['Dust proof face mask', 'PPE & Non-Woven Disposable'],
  ['Doctor / surgeon cap', 'PPE & Non-Woven Disposable'],
  ['Shoe cover', 'PPE & Non-Woven Disposable'],
  ['Non-woven bed sheet', 'PPE & Non-Woven Disposable'],
  ['Underpad 60 x 90', 'PPE & Non-Woven Disposable'],
  ['Cotton Gloves', 'PPE & Non-Woven Disposable'],
  ['Latex examination gloves', 'PPE & Non-Woven Disposable'],
  ['Latex surgical gloves with powdered & powder free', 'PPE & Non-Woven Disposable'],
  ['Vinyl / PVC gloves', 'PPE & Non-Woven Disposable'],
  ['Nitrile gloves', 'PPE & Non-Woven Disposable'],
  ['Disp. Razors', 'Examination & General Disposable'],
  ['Disp. Kidney Dish', 'Examination & General Disposable'],
  ['Tongue depressor sterile and nonsterile', 'Examination & General Disposable'],
  ['Wooden applicator sterile and non sterile', 'Examination & General Disposable'],
  ['Wooden Applicator', 'Examination & General Disposable'],
  ['Patient D bracelet', 'Examination & General Disposable'],
  ['Poly Coated Mixing Pad', 'Examination & General Disposable'],
  ['J-Cloth', 'Industrial & Safety'],
  ['Polypropylene Blue', 'Industrial & Safety'],
  ['Safety Goggless', 'Industrial & Safety'],
  ['Safety Shoes', 'Industrial & Safety'],
  ['Safety Googles', 'Industrial & Safety'],
  ['Sharp Containers', 'Industrial & Safety'],
  ['Steam sterilization indicatot tape', 'Industrial & Safety'],
  ['Flat sterilizations Reels', 'Industrial & Safety'],
  ['Biohazard Bags', 'Industrial & Safety'],
  ['Flat sterilization pouchs', 'Industrial & Safety'],
];

const normalizeMap = new Map(productCategoryMoves.map(([productName, targetCategory]) => [normalize(productName), targetCategory]));
const manualReviewProducts = new Set([
  normalize('Doctor / surgeon cap'),
  normalize('ECG Gel'),
  normalize('Ultrasoung transmission coupling gel'),
  normalize('Closed wound drainage reservoir'),
]);

const uniqueDocs = (docs) => {
  const seen = new Set();
  return docs.filter((doc) => {
    const id = String(doc._id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

const pickPreferredCategory = (docs, targetName) => {
  const exact = docs.find((doc) => normalize(doc.name) === normalize(targetName));
  if (exact) return exact;

  return [...docs].sort((a, b) => {
    const aScore = Number(hasValue(a.image)) + Number(hasValue(a.description));
    const bScore = Number(hasValue(b.image)) + Number(hasValue(b.description));
    return bScore - aScore;
  })[0];
};

async function buildUniqueSlug(base, excludeId) {
  let slug = base;
  let counter = 2;
  while (await Category.findOne({ slug, _id: { $ne: excludeId } })) {
    slug = `${base}-${counter}`;
    counter += 1;
  }
  return slug;
}

async function ensureCategory({ name, parent = null, sortOrder = 0 }) {
  if (!apply && parent && !mongoose.isValidObjectId(parent)) {
    return { _id: `planned:${slugify(`${parent}-${name}`)}`, name, parent, sortOrder };
  }

  const existing = await Category.findOne({ name, parent: parent || null });
  if (existing) {
    return existing;
  }

  const existingByName = await Category.findOne({ name });
  if (existingByName) {
    if (!apply) {
      return {
        _id: existingByName._id,
        name: existingByName.name,
        slug: existingByName.slug,
        parent: parent || null,
        sortOrder,
      };
    }

    return Category.findByIdAndUpdate(
      existingByName._id,
      {
        parent: parent || null,
        sortOrder,
      },
      { new: true }
    );
  }

  if (!apply) {
    return { _id: `planned:${slugify(`${parent || 'root'}-${name}`)}`, name, parent: parent || null, sortOrder };
  }

  const slug = await buildUniqueSlug(slugify(name));
  return Category.create({ name, slug, parent: parent || null, sortOrder });
}

async function run() {
  if (!process.env.MONGO_URI && !process.env.MONGODB_URI) {
    throw new Error('Missing MONGO_URI or MONGODB_URI');
  }

  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);

  const existingCategories = await Category.find({}).lean();
  const categoriesByNormalizedName = new Map();
  const registerCategory = (category) => {
    const key = normalize(category.name);
    if (!categoriesByNormalizedName.has(key)) categoriesByNormalizedName.set(key, []);
    const bucket = categoriesByNormalizedName.get(key);
    const existingIndex = bucket.findIndex((entry) => String(entry._id) === String(category._id));
    if (existingIndex >= 0) {
      bucket[existingIndex] = category;
    } else {
      bucket.push(category);
    }
  };
  existingCategories.forEach(registerCategory);

  const plannedActions = [];
  const plannedActionSet = new Set();
  const pushPlannedAction = (message) => {
    if (plannedActionSet.has(message)) return;
    plannedActionSet.add(message);
    plannedActions.push(message);
  };

  const moveSummaryCounts = new Map();
  const addMoveSummary = (message) => {
    moveSummaryCounts.set(message, (moveSummaryCounts.get(message) || 0) + 1);
  };

  const categoryLabelMap = new Map(
    CATEGORY_PLAN.map((entry) => [entry.target, entry.parent ? `${entry.parent} / ${entry.target}` : entry.target])
  );
  const targetCategoryIds = new Map();

  for (const main of MAIN_CATEGORIES) {
    const mainPlan = CATEGORY_PLAN.find((entry) => entry.target === main.name && !entry.parent);
    const candidateDocs = uniqueDocs([
      ...(categoriesByNormalizedName.get(normalize(main.name)) || []),
      ...((mainPlan?.sources || []).flatMap((sourceName) => categoriesByNormalizedName.get(normalize(sourceName)) || [])),
    ]);

    if (candidateDocs.length) {
      const keeper = pickPreferredCategory(candidateDocs, main.name);
      targetCategoryIds.set(main.name, String(keeper._id));
      continue;
    }

    const doc = await ensureCategory(main);
    targetCategoryIds.set(main.name, String(doc._id));
    registerCategory(doc);
    pushPlannedAction(`create main category: ${main.name}`);
  }

  for (const plan of CATEGORY_PLAN.filter((entry) => entry.parent)) {
    const parentId = targetCategoryIds.get(plan.parent);
    const doc = await ensureCategory({
      name: plan.target,
      parent: parentId,
      sortOrder: 0,
    });
    targetCategoryIds.set(plan.target, String(doc._id));
    registerCategory(doc);
    if (!existingCategories.some((category) => String(category._id) === String(doc._id))) {
      pushPlannedAction(`create subcategory: ${plan.parent} -> ${plan.target}`);
    }
  }

  const deleteCategoryIds = new Set();

  for (const plan of CATEGORY_PLAN) {
    const sourceDocs = uniqueDocs(plan.sources.flatMap((sourceName) => categoriesByNormalizedName.get(normalize(sourceName)) || []));
    const targetParentId = plan.parent ? targetCategoryIds.get(plan.parent) : null;
    const targetExistingDocs = (categoriesByNormalizedName.get(normalize(plan.target)) || [])
      .filter((doc) => String(doc.parent || '') === String(targetParentId || ''));

    let targetDoc = targetExistingDocs[0] || null;

    if (!targetDoc && sourceDocs.length) {
      const keeper = pickPreferredCategory(sourceDocs, plan.target);
      if (apply) {
        targetDoc = await Category.findByIdAndUpdate(
          keeper._id,
          {
            name: plan.target,
            slug: await buildUniqueSlug(slugify(plan.target), keeper._id),
            parent: targetParentId,
            sortOrder: MAIN_CATEGORIES.find((entry) => entry.name === plan.target)?.sortOrder || 0,
          },
          { new: true }
        ).lean();
      } else {
        targetDoc = {
          ...keeper,
          name: plan.target,
          parent: targetParentId,
          sortOrder: MAIN_CATEGORIES.find((entry) => entry.name === plan.target)?.sortOrder || 0,
        };
      }
      registerCategory(targetDoc);
      pushPlannedAction(
        normalize(keeper.name) === normalize(plan.target)
          ? `move category: ${keeper.name} under ${plan.parent || 'top level'}`
          : `rename category: ${keeper.name} -> ${plan.target}`
      );
      targetCategoryIds.set(plan.target, String(targetDoc._id));
    }

    if (!targetDoc) {
      targetDoc = await ensureCategory({
        name: plan.target,
        parent: targetParentId,
        sortOrder: MAIN_CATEGORIES.find((entry) => entry.name === plan.target)?.sortOrder || 0,
      });
      registerCategory(targetDoc);
      pushPlannedAction(`create category: ${plan.target}`);
      targetCategoryIds.set(plan.target, String(targetDoc._id));
    }

    const mergedSourceDocs = sourceDocs.filter((doc) => String(doc._id) !== String(targetDoc._id));
    for (const source of mergedSourceDocs) {
      const affectedProducts = await Product.countDocuments({ categorySlug: source._id });
      if (affectedProducts > 0) {
        addMoveSummary(`move ${affectedProducts} products: ${source.name} -> ${categoryLabelMap.get(plan.target) || plan.target}`);
        if (apply) {
          await Product.updateMany({ categorySlug: source._id }, { $set: { categorySlug: targetDoc._id } });
        }
      }
      deleteCategoryIds.add(String(source._id));
    }
  }

  for (const product of await Product.find({}).select('_id name categorySlug').lean()) {
    const normalizedName = normalize(product.name);
    if (manualReviewProducts.has(normalizedName)) continue;
    const targetCategoryName = normalizeMap.get(normalizedName);
    if (!targetCategoryName) continue;
    const targetCategoryId = targetCategoryIds.get(targetCategoryName);
    if (!targetCategoryId) continue;
    if (String(product.categorySlug || '') === String(targetCategoryId)) continue;
    addMoveSummary(`reassign product: ${product.name} -> ${categoryLabelMap.get(targetCategoryName) || targetCategoryName}`);
    if (apply) {
      await Product.updateOne({ _id: product._id }, { $set: { categorySlug: targetCategoryId } });
    }
  }

  if (apply && deleteCategoryIds.size) {
    await Category.deleteMany({ _id: { $in: Array.from(deleteCategoryIds) } });
  }

  console.log(apply ? '[APPLY]' : '[DRY RUN]');
  console.log('Planned category actions:');
  plannedActions.forEach((action) => console.log(`- ${action}`));
  console.log('Planned product/category moves:');
  Array.from(moveSummaryCounts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([message, count]) => {
      if (count > 1 && message.startsWith('reassign product: ')) {
        console.log(`- ${message} (${count} matching products)`);
        return;
      }
      console.log(`- ${message}`);
    });
  console.log(`Redundant categories to delete: ${deleteCategoryIds.size}`);

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
