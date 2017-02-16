#! /usr/bin/env node

var fs = require("fs");

require("../tweeg.js");
var t = TWEEG().init();

// var tmpl = fs.readFileSync("./set.html.twig", "utf8");
// var ast = t.parse(tmpl);
// console.log(JSON.stringify(ast, null, 2));


var tmpl = '<p>  {{- maka starts with "foo #{bar+baz}" ? \'Yaaaasss\' : no_crap(true)|raw -}}  </p>';
var ast = t.parse(tmpl);
var code = t.compile(ast);

console.log(code);



// var l = t.Lexer('{{ 1 + "foo #{crap} wak #{" foo "} bar" + 2 }}');
// while (!l.eof()) {
//     console.log(l.next());
// }

// var ast = t.parse('{{ 1 + "foo #{crap + X} wak #{" foo "} bar" + 2 }}');
// console.log(JSON.stringify(ast, null, 2));
