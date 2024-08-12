var express = require('express');
var app = express();
var testNo1 = require('./func/test-1/test-1.js');
var testNo1Fast = require('./func/test-1/test-1-v-Fast.js');

console.log('Welcome to Mini Test');

const readFileText = testNo1.readFile();
// const readFileText_fast = testNo1Fast.readFileFaster();


module.exports = app;