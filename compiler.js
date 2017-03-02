var fs = require("fs");
var path = require("path");
var UglifyJS = require("uglify-js");

require("./tweeg.js");
require("./runtime.js");

function compile(files, options) {
    function option(name, def) {
        var val = options[name];
        return val === undefined ? def : val;
    }

    var paths = option("paths", {});
    var base = option("base", null);
    var runtime = TWEEG_RUNTIME();
    var tweeg = TWEEG(runtime).init();

    var code = "";

    var compiled = {};
    files.forEach(compileFile);

    code = TWEEG.wrap_code(code);
    var ugly = UglifyJS.minify([ code ], {
        fromString: true,
        warnings: false,
        compress: {
            pure_getters : true,
            unsafe       : true,
            unsafe_comps : true,
            hoist_vars   : true,
            pure_funcs   : ("$OUT,$ESC,$ESC_html,$ESC_js,$FILTER,$HASH,$MERGE,$NUMBER,$STR,$EMPTY,$SLICE").split(/,/)
        }
    });
    return ugly.code;

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

        var template_name = base ? path.relative(base, fullname) : filename;
        var tmpl = fs.readFileSync(fullname, "utf8");
        var ast = tweeg.parse(tmpl);
        var result = tweeg.compile(ast, {
            autoescape: option("escape", "html")
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
            return paths[name.substr(1)];
        });
    }

    function warn(msg) {
        console.error(msg);
    }
}

exports.compile = compile;
