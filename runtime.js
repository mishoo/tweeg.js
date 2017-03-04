TWEEG_RUNTIME = function(){
    "use strict";

    var REGISTRY = {};

    var CURRENT = null;

    var PATHS = {};

    function Template() {}

    function replacePaths(filename) {
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

    function htmlEscape(str) {
        return safeString(str.replace(/&/g, "&amp;")
                          .replace(/\x22/g, "&quot;")
                          .replace(/\x27/g, "&#x27;")
                          .replace(/</g, "&lt;")
                          .replace(/>/g, "&gt;")
                          .replace(/\u00A0/g, "&#xa0;"));
    }

    function jsEscape(str) {
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
                return htmlEscape(str);
              case "js":
                return jsEscape(str);
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
        if (length == null) return 0;
        return String(thing).length;
    }

    function empty(val) {
        if (val == "" || val == null || val === false) {
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

    function sort(thing) {
        if (Array.isArray(thing))
            return thing.slice().sort();
        var result = {};
        Object.keys(thing).map(function(key){
            return { key: key, val: thing[key] };
        }).sort(function(a, b){
            return a.val < b.val ? -1 : a.val > b.val ? 1 : 0;
        }).forEach(function(x){
            result[x.key] = x.val;
        });
        return result;
    }

    function range(beg, end, step) {
        if (step == null) step = 1;
        else if (step < 0) step = -step;
        var i, a;
        if (end >= beg) {
            for (i = beg, a = []; i <= end; i += step) {
                a.push(i);
            }
        } else {
            for (i = beg, a = []; i >= end; i -= step) {
                a.push(i);
            }
        }
        return a;
    }

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
            slice: slice
        },

        filter: {
            json_encode: function(val, indent) {
                return JSON.stringify(val, null, indent);
            },
            e: function(val) {
                return htmlEscape(string(val));
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
            keys: keys,
            batch: batch,
            first: first,
            last: last,
            trim: trim,
            abs: Math.abs,
            round: Math.round,
            slice: slice,
            sort: sort,
            length: length
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
                first     : true,
                last      : !n
            };
            var result = [];
            function add(el, i) {
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
                    loop.last = !(--loop.revindex0);
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
            name = name.replace(/^\/?/, "/");
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
            tmpl = tmpl.replace(/^\/?/, "/");
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
            dest = replacePaths(dest);
            if (/^\//.test(dest)) {
                // absolute path — src doesn't matter
                return dest.substr(1);
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
        }
    };

    return TR;
};
