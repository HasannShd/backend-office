#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/user');

const username = process.argv[2];
if (!username) {
  console.error('Usage: node scripts/promoteAdmin.js <username>');
  process.exit(1);
}

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const user = await User.findOne({ username });
    if (!user) {
      console.error('User not found:', username);
      process.exit(1);
    }
    await User.updateOne({ _id: user._id }, { $set: { role: 'admin' } });
    console.log(`User ${username} promoted to admin`);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
