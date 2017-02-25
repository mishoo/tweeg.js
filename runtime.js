TWEEG_RUNTIME = function(){
    "use strict";

    var REGISTRY = {};

    function RawString(str) {
        this.value = str;
    }
    RawString.prototype = {
        toString: function() {
            return this.value + "";
        }
        // valueOf: function() {
        //     return this.toString();
        // }
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

    function toString(thing) {
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
        return thing.length;
    }

    var TR = {
        func: {
            cycle: function(array, index) {
                return array[index % array.length];
            },
            slice: slice
        },

        filter: {
            json_encode: function(val, indent) {
                return JSON.stringify(val, null, indent);
            },
            e: function(val) {
                return htmlEscape("" + val);
            },
            escape: function(val, strategy) {
                return escape("" + val, strategy);
            },
            raw: function(val) {
                return safeString("" + val);
            },
            slice: slice,
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
            "..": function(beg, end) {
                var i, a;
                if (end >= beg) {
                    for (i = beg, a = []; i <= end; ++i) {
                        a.push(i);
                    }
                } else {
                    for (i = beg, a = []; i >= end; --i) {
                        a.push(i);
                    }
                }
                return a;
            },
            "in": function(thing, data) {
                if (Array.isArray(data) || typeof data == "string") {
                    return data.indexOf(thing) >= 0;
                }
                return HOP.call(data, thing);
            }
        },

        bool: function(val) {
            if (Array.isArray(val)) {
                return !!val.length;
            }
            if (val === "0") {
                return false;
            }
            return !!val;
        },

        number: function(val) {
            if (typeof val == "number") {
                return val;
            }
            // PHP “semantics” below.
            val = parseFloat(val);
            return isNaN(val) ? 0 : val;
        },

        make_hash: function(data) {
            for (var i = 0, obj = {}; i < data.length;) {
                obj[data[i++]] = data[i++];
            }
            return obj;
        },

        out: function(data) {
            var ret = "";
            for (var i = 0; i < data.length; ++i) {
                ret += toString(data[i]);
            }
            return safeString(ret);
        },

        for: function(data, f) {
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

        empty: function(val) {
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
        },

        iterable: function(val) {
            // this covers arrays as well
            return val != null && typeof val == "object";
        },

        slice: slice,

        escape: escape,

        toString: toString,

        merge: Object.assign || function(a) {
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
        },

        include: function(name, optional, context) {
            return JSON.stringify(context, null, 2);
        },

        register: function(name, template) {
            template = REGISTRY[name] = template();
            template.$name = name;
        }
    };

    return TR;
};
