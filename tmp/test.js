#! /usr/bin/env node

var fs = require("fs");

require("../twig.js");

var tmpl = fs.readFileSync("./set.html.twig", "utf8");

var t = TWIG().init();
var ast = t.parse(tmpl);
console.log(JSON.stringify(ast, null, 2));
