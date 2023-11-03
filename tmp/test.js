require("../tweeg.js");
require("../runtime.js");
let compile = require("../compiler.js").compile;

var runtime = TWEEG_RUNTIME();
var tweeg = TWEEG(runtime);
tweeg.init();

var fs = require("fs");

// var test = fs.readFileSync("base.html.twig", "utf8");
// var ast = tweeg.parse(test);
// //console.log(JSON.stringify(ast, null, 2));
// var result = tweeg.compile(ast);
// console.log(TWEEG.wrap_code(result.code));

let code = compile([
    //"base.html.twig",
    //"second.html.twig",
    //"altered.html.twig",
    //"include-extend.html.twig"
    "embed.html.twig"
], {
    runtime: runtime,
    tweeg: tweeg,
    beautify: true
});

console.log(code);

new Function("return " + code)()(runtime);
console.log(runtime.exec("embed.html.twig"));
