var express = require('express');
var app = express();
var testNo1 = require('./func/test-1/test-1.js');

console.log('Welcome to Mini Test');

const readFileText = testNo1.readFile();


module.exports = app;