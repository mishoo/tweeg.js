#! /usr/bin/env node

var fs = require("fs");

require("../tweeg.js");
var t = TWEEG().init();

// var tmpl = fs.readFileSync("./set.html.twig", "utf8");
// var ast = t.parse(tmpl);
// console.log(JSON.stringify(ast, null, 2));


var tmpl = "<p>{{ maka starts with 'crap' ? 'Yaaaasss' : 'no crap' }}</p>";
var ast = t.parse(tmpl);
var code = t.compile(ast);

console.log(code);
