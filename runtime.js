TWEEG_RUNTIME = function(){
    "use strict";

    var REGISTRY = {};

    var CURRENT = null;

    var PATHS = {};

    function Template() {}

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
        if (thing != null && thing !== false) {
            if (typeof thing == "object") {
                return "Array";
            } else {
                return thing + "";
            }
        }
        return "";
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

    function trim(thing) {
        return String(thing).trim();
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

    var globals = {};

    var TR = {
        t: function(data) {
            // make a Template instance
            // XXX: inheritance
            return TR.merge(new Template(), data);
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
                return JSON.stringify(val, null, indent);
            },
            e: function(val) {
                return html_escape(string(val));
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
            join: function(array, separator) {
                return array.join(separator);
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
                Object.keys(parts).forEach(function(substr){
                    var replacement = parts[substr], pos = str.length;
                    while (replacement && str) {
                        pos = str.lastIndexOf(substr, pos);
                        if (pos < 0) {
                            break;
                        } else {
                            str = str.substr(0, pos) + replacement + str.substr(pos + substr.length);
                        }
                    }
                });
                return str;
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
            striptags: striptags
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
                str = String(str);
                x = String(x);
                return str.substr(0, x.length) == x;
            },
            "ends with": function(str, x) {
                str = String(str);
                x = String(x);
                var pos = str.lastIndexOf(x);
                return pos + x.length == str.length;
            },
            "..": range,
            "in": function(thing, data) {
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

        for: function(data, f) {
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
                var val = f(loop, el, i);
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
                // called without parameters will execute the `else`
                // clause if present
                result.push(f());
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

        spaceless: function(html) {
            return string(html).replace(/^\s+|\s+$/g, "")
                .replace(/>\s+</, "><");
        },

        merge: merge,

        include: function(name, context, optional) {
            if (Array.isArray(name)) {
                // XXX: move the complication in `with` (?)
                for (var i = 0; i < name.length; ++i) {
                    var ret = TR.exec(name[i], true, context);
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

        register: function(name, template) {
            name = name.replace(/^\/*/, "");
            template = REGISTRY[name] = template();
            template.$name = name;
        },

        get: function(tmpl) {
            if (tmpl instanceof Template) {
                return tmpl;
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
            var save = CURRENT;
            try {
                return func(CURRENT = tmpl);
            } finally {
                CURRENT = save;
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
        }
    };

    return TR;
};
