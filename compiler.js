var fs = require("fs");
var path = require("path");
var UglifyJS = require("uglify-js");

var TWEEG = require("./tweeg.js");
var TWEEG_RUNTIME = require("./runtime.js");

function compile(files, options) {
    function option(name, def) {
        var val = options && options[name];
        return val === undefined ? def : val;
    }

    var paths = option("paths", {});
    var base = option("base", null);
    var strip_base = option("strip_base", null);
    var beautify = option("beautify", false);
    var runtime = option("runtime", TWEEG_RUNTIME());
    var tweeg = option("tweeg", TWEEG(runtime).init());
    var wrap_template = option("wrap_template", tmpl => tmpl);
    var nodeps = option("nodeps", false);
    var warnings = option("warnings", false);
    var hook = option("hook", null);

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

    function compileFile(template_name, parent_fullname, plain) {
        template_name = template_name.replace(/\\/g, "/").replace(/\/\/+/g, "/");
        let fullname = replacePaths(template_name);
        if (!/^\.?\//.test(fullname) && base) {
            fullname = path.resolve(path.join(base, fullname));
        } else if (parent_fullname) {
            fullname = path.resolve(path.dirname(parent_fullname), fullname);
        } else {
            fullname = path.resolve(fullname);
        }
        if (compiled[fullname]) {
            return;
        }
        compiled[fullname] = true;

        let tmpl = fs.readFileSync(fullname, "utf8");
        let result;

        if (strip_base && !parent_fullname) {
            template_name = path.relative(strip_base, template_name);
        }

        if (plain) {
            result = { code: JSON.stringify(tmpl) };
            template_name += "/source";
        } else try {
            let ast = tweeg.parse(tmpl);
            result = tweeg.compile(ast, {
                autoescape: option("escape", "html")
            });
        } catch(ex) {
            throw new Error(`Template: ${template_name}\n${ex}`);
        }

        if (!nodeps && !plain) result.dependencies.forEach(function(node){
            if (node.type == "string") {
                compileFile(node.value, fullname, node.plain);
            } else {
                warn(`Complex dependency in ${template_name}: ${JSON.stringify(node)}`);
            }
        });

        let newcode = `$REGISTER(${JSON.stringify(template_name)}, ${result.code});`;
        if (!plain) {
            newcode = wrap_template(newcode, template_name);
        }

        if (hook && !plain) {
            hook(template_name, fullname, newcode);
        }

        code += newcode;
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

module.exports = { compile: compile };
