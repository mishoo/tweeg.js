TWEEG_RUNTIME = function(){
    "use strict";

    var REGISTRY = {};
    var PATHS = {};

    // runtime information
    var CURRENT = null;         // currently running template
    var BLOCKS = [];            // currently available blocks

    function findBlock(name) {
        for (var i = 0; i < BLOCKS.length; ++i) {
            var b = BLOCKS[i];
            if (b[name]) return b;
        }
    }

    function withShadowBlock(name, func) {
        var b = findBlock(name);
        if (!b) return func();
        var save_handler = b[name];
        try {
            delete b[name];
            return func();
        } finally {
            b[name] = save_handler;
        }
    }

    function Template(main, blocks, macros) {
        this.$main = main;
        TR.merge(this, macros);
        this.$macros = macros;
        this.$blocks = blocks;
    }

    function replace_paths(filename) {
        return filename.replace(/@[a-z0-9_]+/ig, function(name){
            return PATHS[name.substr(1)];
        });
    }

    function RawString(str) {
        this.value = str;
    }
    RawString.prototype = {
        toString: function() {
            return this.value + "";
        }
    };

    var HOP = Object.prototype.hasOwnProperty;

    function safeString(str) {
        return new RawString(str);
    }

    function html_escape(str) {
        return safeString(str.replace(/&/g, "&amp;")
                          .replace(/\x22/g, "&quot;")
                          .replace(/\x27/g, "&#x27;")
                          .replace(/</g, "&lt;")
                          .replace(/>/g, "&gt;")
                          .replace(/\u00A0/g, "&#xa0;"));
    }

    function js_escape(str) {
        return safeString(str.replace(/[^a-zA-Z0-9,._]/g, function(ch){
            var code = ch.charCodeAt(0);
            if (code <= 255) {
                return "\\x" + ("0" + code.toString(16)).substr(-2);
            }
            return "\\U" + ("00" + code.toString(16)).substr(-4);
        }));
    }

    function rx_escape(str) {
        return str.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
    }

    function escape(str, strategy) {
        if (typeof str == "string") {
            switch (strategy) {
              case "html":
              case undefined:
              case null:
                return html_escape(str);
              case "js":
                return js_escape(str);
              case false:
                return str;
            }
            throw new Error("Unknown escape strategy: " + strategy);
        }
        return str;
    }

    function string(thing) {
        // let's mimic PHP behavior as best as we can
        if (thing instanceof String || typeof thing == "string") {
            return thing + "";
        }
        if (thing === true) {
            return "1";
        }
        if (thing instanceof RawString) {
            return thing.value;
        }
        if (thing instanceof Function || typeof thing == "function") {
            return string(thing());
        }
        if (thing != null && thing !== false) {
            if (typeof thing == "object") {
                return "Array";
            } else {
                return thing + "";
            }
        }
        return "";
    }

    function spaceless(html) {
        return string(html).replace(/^\s+|\s+$/g, "")
            .replace(/>\s+</g, "><");
    }

    function slice(thing, start, end) {
        if (end != null && end >= 0) {
            end += start;
        }
        return thing.slice(start, end);
    }

    function length(thing) {
        if (thing == null)
            return 0;
        if (Array.isArray(thing))
            return thing.length;
        if (typeof thing == "object")
            return Object.keys(thing).length;
        return string(thing).length;
    }

    function empty(val) {
        if (val === "" || val == null || val === false) {
            return true;
        }
        if (Array.isArray(val)) {
            return !val.length;
        }
        if (typeof val == "object") {
            for (var i in val) {
                if (HOP.call(val, i))
                    return false;
            }
            return true;
        }
        return false;
    }

    function bool(val) {
        if (Array.isArray(val)) {
            return !!val.length;
        }
        if (val === "0") {
            return false;
        }
        if (val instanceof RawString) {
            return !!val.value;
        }
        return !!val;
    }

    var merge = Object.assign || function(a) {
        for (var i = 1; i < arguments.length; ++i) {
            var b = arguments[i];
            if (b != null) {
                for (var j in b) {
                    if (HOP.call(b, j)) {
                        a[j] = b[j];
                    }
                }
            }
        }
        return a;
    };

    // NOTE: this is taken from Esrever, MIT-licensed.  Turns out
    // reversing strings is a phenomenally complex task in this year
    // and age.  I doubt PHP Twig does it properly anyway, but we can.
    // https://github.com/mathiasbynens/esrever
    var reverseString = (function(){
        var regexSymbolWithCombiningMarks = /([\0-\u02FF\u0370-\u1AAF\u1B00-\u1DBF\u1E00-\u20CF\u2100-\uD7FF\uE000-\uFE1F\uFE30-\uFFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF])([\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]+)/g;
	var regexSurrogatePair = /([\uD800-\uDBFF])([\uDC00-\uDFFF])/g;
	return function reverse(string) {
	    // Step 1: deal with combining marks and astral symbols (surrogate pairs)
	    string = string
	        // Swap symbols with their combining marks so the combining marks go first
		.replace(regexSymbolWithCombiningMarks, function($0, $1, $2) {
		    // Reverse the combining marks so they will end up in the same order
		    // later on (after another round of reversing)
		    return reverse($2) + $1;
		})
	        // Swap high and low surrogates so the low surrogates go first
		.replace(regexSurrogatePair, '$2$1');
	    // Step 2: reverse the code units in the string
	    var result = '';
	    var index = string.length;
	    while (index--) {
		result += string.charAt(index);
	    }
	    return result;
	};
    })();

    function reverse(thing, preserveKeys) {
        if (Array.isArray(thing)) return thing.slice().reverse();
        if (thing === "" || thing == null || thing === false) return "";
        if (typeof thing == "number") thing = String(thing);
        if (typeof thing == "string") return reverseString(thing);

        // assume it's a mapping.  here comes PHP madness
        // (https://www.php.net/manual/en/function.array-reverse.php).
        // by default, numeric keys (that is, keys that can be
        // converted to numbers) will be renumbered from zero, unless
        // preserveKeys is true, in which case they will be preserved.
        var output = {}, numCount = 0;
        Object.keys(thing).reverse().forEach(function(key){
            if (preserveKeys) {
                output[key] = thing[key];
            } else {
                if (key == parseFloat(key)) {
                    output[numCount++] = thing[key];
                } else {
                    output[key] = thing[key];
                }
            }
        });
        return output;
    }

    function batch(array, size, fill) {
        var result = [];
        for (var i = 0; i < array.length; i += size) {
            var part = array.slice(i, size);
            if (fill != null) {
                while (part.length < size)
                    part.push(fill);
            }
            result.push(part);
        }
        return result;
    }

    function first(thing) {
        if (thing == null) return null;
        if (Array.isArray(thing)) return thing[0];
        if (typeof thing == "string") return thing.charAt(0);
        for (var i in thing) if (HOP.call(thing, i)) return thing[i];
    }

    function last(thing) {
        if (thing == null) return null;
        if (Array.isArray(thing)) return thing[thing.length - 1];
        if (typeof thing == "string") return thing.charAt(thing.length - 1);
        var keys = Object.keys(thing);
        if (keys.length) return thing[keys.length - 1];
    }

    function keys(thing) {
        return Object.keys(thing);
    }

    function trim(thing, char, side) {
        thing = string(thing);
        if (char == null && side == null) {
            return thing.trim();
        }
        if (char == null) char = " ";
        for (var i = 0, j = thing.length - 1; i <= j;) {
            var left = thing.charAt(i) == char;
            var right = thing.charAt(j) == char;
            if (!left && !right) break;
            if (left) i++;
            if (right) j--;
        }
        return side == "left" ? thing.substr(i)
            :  side == "right" ? thing.substring(0, j + 1)
            :  thing.substring(i, j + 1);
    }

    function sort(thing, comp) {
        if (comp == null) comp = function(a, b){
            return a < b ? -1 : a > b ? 1 : 0;
        };
        if (Array.isArray(thing))
            return thing.slice().sort(comp);
        var result = {};
        Object.keys(thing).map(function(key){
            return { key: key, val: thing[key] };
        }).sort(function(a, b){
            return comp(a.val, b.val);
        }).forEach(function(x){
            result[x.key] = x.val;
        });
        return result;
    }

    function filter(thing, predicate) {
        if (Array.isArray(thing))
            return thing.filter(predicate);
        var result = {};
        Object.keys(thing).map(function(key){
            return { key: key, val: thing[key] };
        }).filter(function(el){
            return predicate(el.val, el.key);
        }).forEach(function(x){
            result[x.key] = x.val;
        });
        return result;
    }

    function map(thing, func) {
        if (Array.isArray(thing))
            return thing.map(func);
        return Object.keys(thing).map(function(key){
            return func(thing[key], key);
        });
    }

    function reduce(thing, func, init) {
        if (init == null) init = 0;
        if (Array.isArray(thing))
            return thing.reduce(func, init);
        return Object.keys(thing).map(function(key){
            return thing[key];
        }).reduce(func, init);
    }

    function range(beg, end, step) {
        if (step == null) step = 1;
        else if (step < 0) step = -step;
        else step = parseFloat(step);
        var i, a;
        if (typeof beg != "string" || typeof end != "string") {
            beg = parseFloat(beg);
            end = parseFloat(end);
            if (isNaN(beg) || isNaN(end) || isNaN(step)) {
                throw new Error("Invalid range arguments");
            }
            if (end >= beg) {
                for (i = beg, a = []; i <= end; i += step) {
                    a.push(i);
                }
            } else {
                for (i = beg, a = []; i >= end; i -= step) {
                    a.push(i);
                }
            }
        } else if (beg.length != 1 || end.length != 1) {
            throw new Error("Invalid range arguments");
        } else {
            beg = beg.charCodeAt(0);
            end = end.charCodeAt(0);
            if (end >= beg) {
                for (i = beg, a = []; i <= end; i += step) {
                    a.push(String.fromCharCode(i));
                }
            } else {
                for (i = beg, a = []; i >= end; i -= step) {
                    a.push(String.fromCharCode(i));
                }
            }
        }
        return a;
    }

    function url_encode(arg) {
        var ret;
        if (typeof arg == "string") {
            ret = encodeURIComponent(arg);
        } else {
            ret = Object.keys(arg).map(function(key){
                return encodeURIComponent(key) + "=" + encodeURIComponent(arg[key]);
            }).join("&");
        }
        return new RawString(ret);
    }

    function striptags(str, exceptions) {
        str = string(str);
        if (exceptions) {
            exceptions = exceptions.split(/[<>]+/).filter(function(tag){
                return tag.length > 0;
            }).map(function(tag){
                return "/?" + tag;
            }).join("|");
        }
        if (exceptions) {
            var rx = new RegExp("<(?!(?:" + exceptions + ")).*?>", "ig");
            return safeString(str.replace(rx, ""));
        } else {
            return safeString(str.replace(/<.*?>/g, ""));
        }
    }

    function attribute(obj, item, args) {
        var val = obj[item];
        if (args != null) {
            val = val.apply(obj, args);
        }
        return val;
    }

    function collectArgs(args) {
        var res = [];
        (function loop(a){
            for (var i = a.length; --i >= 0;) {
                var el = a[i];
                if (el != null) {
                    if (Array.isArray(el)) {
                        loop(el);
                    } else if (typeof el == "object") {
                        loop(Object.keys(el).map(function(key){
                            return el[key];
                        }));
                    } else {
                        res.push(el);
                    }
                }
            }
        })(args);
        return res;
    }

    function max() {
        return Math.max.apply(Math, collectArgs(arguments));
    }

    function min() {
        return Math.min.apply(Math, collectArgs(arguments));
    }

    function random(val) {
        if (typeof val == 'number') {
            return Math.floor(Math.random() * (val + 1));
        }
        if (typeof val == 'string' || Array.isArray(val)) {
            return val[Math.floor(Math.random() * val.length)];
        }
        return Math.floor(Math.random() * (2147483647 + 1));
    }

    function round(val, precision, type) {
        if (precision == null) precision = 0;
        if (type == null) type = "common";
        var f = Math.pow(10, precision);
        val *= f;
        val = type == "common" ? Math.round(val)
            : type == "ceil" ? Math.ceil(val)
            : Math.floor(val);
        val /= f;
        return val;
    }

    function toArray(thing) {
        if (thing == null) return [];
        if (Array.isArray(thing)) return thing;
        if (typeof thing == 'string') return thing.split("");
        return Object.keys(thing).map(function(key){
            return thing[key];
        });
    }

    function NamedArg(name, val) {
        this.name = name;
        this.value = val;
    }

    function readMacroArgs(func, names) {
        return function() {
            var data = Object.create(null);
            var hasNamed = false;
            var n = Math.min(names.length, arguments.length);
            for (var i = 0; i < n; ++i) {
                var key = names[i];
                var val = arguments[i];
                if (val instanceof NamedArg) {
                    key = val.name;
                    val = val.value;
                    hasNamed = true;
                } else if (hasNamed) {
                    throw new Error("Unnamed argument present after named argument");
                }
                data[key] = val;
            }
            return func.call(null, data, [].slice.call(arguments, names.length));
        };
    }

    var globals = {};

    var TR = {
        t: function(main, blocks, macros) {
            return new Template(main, blocks, macros);
        },

        env_ext: function(env, locked) {
            if (env["%break"]) return env;
            return Object.create(env, locked ? {
                "%break": {
                    value: true
                }
            } : void 0);
        },

        env_set: function(env, name, val) {
            var dest = env;
            if (name in env) {
                while (dest && !dest["%break"] && !HOP.call(dest, name))
                    dest = Object.getPrototypeOf(dest);
            }
            return (dest || env)[name] = val;
        },

        func: {
            cycle: function(array, index) {
                return array[index % array.length];
            },
            range: range,
            slice: slice,
            max: max,
            min: min,
            attribute: attribute,
            random: random
        },

        filter: {
            json_encode: function(val, indent) {
                if (val === void 0) val = null;
                return JSON.stringify(val, null, indent);
            },
            e: function(val, strategy) {
                return escape(string(val), strategy);
            },
            escape: function(val, strategy) {
                return escape(string(val), strategy);
            },
            raw: function(val) {
                return safeString("" + val);
            },
            "default": function(val, def) {
                return empty(val) ? def : val;
            },
            join: function(thing, separator, lastSep) {
                var a = toArray(thing);
                if (!lastSep || a.length < 2)
                    return a.join(separator);
                return a.slice(0, -1).join(separator) + lastSep + a[a.length - 1];
            },
            split: function(thing, separator) {
                return string(thing).split(separator);
            },
            upper: function(thing) {
                return string(thing).toUpperCase();
            },
            lower: function(thing) {
                return string(thing).toLowerCase();
            },
            merge: function(a, b) {
                if (Array.isArray(a) && Array.isArray(b))
                    return a.concat(b);
                return merge(a, b);
            },
            replace: function(str, parts) {
                str = string(str);
                var rx = parts.__tweeg_js_rx_cache__;
                if (!rx) {
                    rx = new RegExp("(" + Object.keys(parts).map(rx_escape).join("|") + ")", "g");
                    parts.__tweeg_js_rx_cache__ = rx;
                }
                return str.replace(rx, function(match) {
                    return parts[match];
                });
            },
            capitalize: function(str) {
                return (str = string(str)).charAt(0).toUpperCase() + str.substr(1);
            },
            column: function(array, field) {
                return array.map(function(obj) {
                    return obj[field];
                });
            },
            keys: keys,
            batch: batch,
            first: first,
            last: last,
            trim: trim,
            abs: Math.abs,
            round: round,
            slice: slice,
            sort: sort,
            filter: filter,
            map: map,
            reduce: reduce,
            length: length,
            url_encode: url_encode,
            striptags: striptags,
            reverse: reverse,
            spaceless: spaceless
        },

        operator: {
            "matches": function(str, rx) {
                var m = /^\/(.*)\/([igmsy])?$/.exec(rx);
                if (m) {
                    try {
                        return new RegExp(m[1], m[2]).exec(str);
                    } catch(ex) {};
                }
                throw new Error("Invalid regular expression: " + rx);
            },
            "starts with": function(str, x) {
                str = string(str);
                x = string(x);
                return str.substr(0, x.length) == x;
            },
            "ends with": function(str, x) {
                str = string(str);
                x = string(x);
                var pos = str.lastIndexOf(x);
                return pos + x.length == str.length;
            },
            "..": range,
            "in": function(thing, data) {
                if (data == null) return false;
                if (Array.isArray(data) || typeof data == "string") {
                    return data.indexOf(thing) >= 0;
                }
                return HOP.call(data, thing);
            }
        },

        bool: bool,

        number: function(val) {
            if (typeof val == "number") {
                return val;
            }
            // PHP “semantics” below.
            val = parseFloat(val);
            return isNaN(val) ? 0 : val;
        },

        hash: function(data) {
            for (var i = 0, obj = {}; i < data.length;) {
                obj[data[i++]] = data[i++];
            }
            return obj;
        },

        out: function(data) {
            var ret = "";
            for (var i = 0; i < data.length; ++i) {
                ret += string(data[i]);
            }
            return safeString(ret);
        },

        for: function($DATA, valsym, keysym, data, f) {
            $DATA = TR.env_ext($DATA);
            if (data == null) data = [];
            var is_array = Array.isArray(data);
            var keys = is_array ? null : Object.keys(data);
            var n = keys ? keys.length : data.length;
            var loop = {
                index     : 1,
                index0    : 0,
                revindex  : n,
                revindex0 : n - 1,
                length    : n,
                first     : true
            };
            var result = [];
            function add(el, i) {
                loop.last = !loop.revindex0;
                $DATA[valsym] = el;
                if (keysym) {
                    $DATA[keysym] = i;
                }
                $DATA["loop"] = loop;
                var val = f($DATA);
                if (val !== TR) {
                    // for `for`-s that define a condition, the
                    // compiled code returns TR by convention when the
                    // condition is false.
                    result.push(val);
                    loop.first = false;
                    ++loop.index;
                    ++loop.index0;
                    --loop.revindex;
                    --loop.revindex0;
                }
            }
            if (is_array) {
                data.forEach(add);
            } else {
                keys.forEach(function(key){
                    add(data[key], key);
                });
            }
            if (!result.length) {
                // called without `loop`, it will execute the `else`
                // clause if present. It should not be there, but
                // let's delete it anyway.
                delete $DATA.loop;
                result.push(f($DATA));
            }
            return TR.out(result);
        },

        empty: empty,

        iterable: function(val) {
            // this covers arrays as well
            return val != null && typeof val == "object";
        },

        slice: slice,

        escape: escape,

        escape_html: function(str) {
            return escape(str, "html");
        },

        escape_js: function(str) {
            return escape(str, "js");
        },

        string: string,

        spaceless: spaceless,

        merge: merge,

        include: function(name, context, optional) {
            if (Array.isArray(name)) {
                // XXX: move the complication in `with` (?)
                for (var i = 0; i < name.length; ++i) {
                    var ret = TR.exec(name[i], context, true);
                    if (ret != null) {
                        return ret;
                    }
                }
                if (!optional) {
                    throw new Error("Could not find any of the templates: " + JSON.stringify(name));
                }
            } else {
                return TR.exec(name, context, optional);
            }
        },

        extend: function(name, context) {
            return TR.include(name, context);
        },

        block: function(context, name) {
            var b = findBlock(name);
            // XXX: what does PHP Twig do when block is missing?
            return b ? b[name](context) : "";
        },

        parent: function(context, block) {
            return withShadowBlock(block, function(){
                return TR.block(context, block);
            });
        },

        register: function(name, template) {
            name = name.replace(/^\/*/, "");
            template = REGISTRY[name] = template();
            template.$name = name;
        },

        get: function(tmpl) {
            if (tmpl instanceof Template) {
                return tmpl;
            }
            if (REGISTRY[tmpl]) {
                return REGISTRY[tmpl];
            }
            if (CURRENT) {
                tmpl = TR.resolve(CURRENT.$name, tmpl);
            }
            tmpl = tmpl.replace(/^\/*/, "");
            return REGISTRY[tmpl];
        },

        with: function(template_name, func, ignore_missing) {
            var tmpl = TR.get(template_name);
            if (!tmpl) {
                if (ignore_missing) return null;
                throw new Error("Could not find template " + template_name);
            }
            var save_current = CURRENT;
            var save_blocks = BLOCKS;
            try {
                BLOCKS = BLOCKS.concat(tmpl.$blocks);
                CURRENT = tmpl;
                return func(tmpl);
            } finally {
                CURRENT = save_current;
                BLOCKS.pop();
            }
        },

        exec: function(template_name, args, ignore_missing) {
            return TR.with(template_name, function(tmpl){
                return "" + tmpl.$main(args || {});
            }, ignore_missing);
        },

        add_path: function(name, value) {
            PATHS[name] = value;
        },

        resolve: function(src, dest) {
            dest = replace_paths(dest);
            if (/^\//.test(dest)) {
                // absolute path — src doesn't matter
                return dest.substr(1);
            }
            if (/^@/.test(dest)) {
                // absolute path — src doesn't matter
                return dest;
            }
            // normalize relative path
            src = src.split(/\/+/);
            src.pop();
            dest.split(/\/+/).forEach(function(part){
                if (part && part != ".") {
                    if (part == "..") src.pop();
                    else src.push(part);
                }
            });
            return src.join("/");
        },

        index: function(obj, prop) {
            return obj == null ? null : obj[prop];
        },

        add_global: function(name, value) {
            globals[name] = value;
        },

        is_global: function(name) {
            return HOP.call(globals, name);
        },

        global: function(name) {
            return globals[name];
        },

        macro: readMacroArgs,

        named_arg: function(name, value) {
            return new NamedArg(name, value);
        },
    };

    return TR;
};
