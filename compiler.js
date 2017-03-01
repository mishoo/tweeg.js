var fs = require("fs");
var path = require("path");
var u2 = require("uglify-js");

require("./tweeg.js");
require("./runtime.js");

function compile(files, options) {
    var runtime = TWEEG_RUNTIME();
    var tweeg = TWEEG(runtime).init();

    var code = "";

    var compiled = {};
    files.forEach(compileFile);

    return TWEEG.wrap_code(code);

    function compileFile(filename, source) {
        var fullname = replacePaths(filename);
        if (source) {
            fullname = path.resolve(path.dirname(source), fullname);
        } else {
            fullname = path.resolve(fullname);
        }
        if (compiled[fullname]) {
            return;
        }
        compiled[fullname] = true;

        var template_name = options.base
            ? path.relative(options.base, fullname)
            : filename;
        var tmpl = fs.readFileSync(fullname, "utf8");
        var ast = tweeg.parse(tmpl);
        var result = tweeg.compile(ast, {
            autoescape: options.escape
        });

        result.dependencies.forEach(function(file){
            if (typeof file == "string") {
                compileFile(file, fullname);
            } else {
                warn(`Complex dependency in ${template_name}: ${JSON.stringify(file)}`);
            }
        });

        code += `$REGISTER(${JSON.stringify(template_name)}, ${result.code});`;
    }

    function replacePaths(filename) {
        return filename.replace(/@[a-z0-9_]+/ig, function(name){
            return options.paths[name.substr(1)];
        });
    }

    function warn(msg) {
        console.error(msg);
    }
}

exports.compile = compile;
