var fs = require("fs");
var path = require("path");
var UglifyJS = require("uglify-js");

require("./tweeg.js");
require("./runtime.js");

function compile(files, options) {
    function option(name, def) {
        var val = options && options[name];
        return val === undefined ? def : val;
    }

    var paths = option("paths", {});
    var base = option("base", null);
    var beautify = option("beautify", false);
    var extend = option("extend", null);
    var runtime = option("runtime", TWEEG_RUNTIME());
    var tweeg = option("tweeg", TWEEG(runtime).init());
    var wrap_template = option("wrap_template", tmpl => tmpl);
    var nodeps = option("nodeps", false);
    var warnings = option("warnings", false);

    var code = "";

    var compiled = {};
    files.forEach(function(file){
        compileFile(file);
    });

    code = TWEEG.wrap_code(code);
    if (beautify) {
        var ast = UglifyJS.parse(code);
        return ast.print_to_string({ beautify: true });
    } else {
        var ugly = UglifyJS.minify([ code ], {
            fromString: true,
            warnings: warnings,
            compress: {
                pure_getters : true,
                unsafe       : true,
                unsafe_comps : true,
                hoist_vars   : true,
                pure_funcs   : ("$OUT,$ESC,$ESC_html,$ESC_js,$FILTER,$MERGE,$NUMBER,$STR,$EMPTY,$SLICE,$GLOBAL").split(/,/)
            }
        });
        return ugly.code;
    }

    function compileFile(template_name, source) {
        template_name = template_name.replace(/\\/g, "/").replace(/\/\/+/g, "/");
        var fullname = replacePaths(template_name);
        if (source) {
            fullname = path.resolve(path.dirname(source), fullname);
        } else {
            fullname = path.resolve(fullname);
        }
        if (compiled[fullname]) {
            return;
        }
        compiled[fullname] = true;

        var tmpl = fs.readFileSync(fullname, "utf8");
        var ast, result;

        if (base && !source) {
            template_name = path.relative(base, template_name);
        }

        try {
            ast = tweeg.parse(tmpl);
            result = tweeg.compile(ast, {
                autoescape: option("escape", "html")
            });
        } catch(ex) {
            throw new Error(`Template: ${template_name}\n${ex}`);
        }

        if (!nodeps) result.dependencies.forEach(function(file){
            if (typeof file == "string") {
                compileFile(file, fullname);
            } else {
                warn(`Complex dependency in ${template_name}: ${JSON.stringify(file)}`);
            }
        });

        code += wrap_template(`$REGISTER(${JSON.stringify(template_name)}, ${result.code});`, template_name);
    }

    function replacePaths(filename) {
        return filename.replace(/@[a-z0-9_]+/ig, function(name){
            return paths[name.substr(1)];
        });
    }

    function warn(msg) {
        if (warnings) {
            console.error(msg);
        }
    }
}

exports.compile = compile;
