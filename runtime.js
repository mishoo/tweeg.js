TWEEG_RUNTIME = (function(){
    var TR = {
        filter: {
            json_encode: function(val, indent) {
                return JSON.stringify(val, null, indent);
            }
        },

        operator: {
            "matches": function(str, rx) {
                var m = /^\/(.*)\/([igmsy])?$/.exec(rx);
                if (!m) {
                    throw new Error("Invalid regular expression: " + rx);
                }
                return new RegExp(m[1], m[2]).exec(str);
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
                var i;
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
                return Object.prototype.hasOwnProperty.call(data, thing);
            }
        },

        bool: function(val) {
            return !!val;       // XXX: there are some twig particularities here
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
            return data.join(""); // XXX: autoescape!
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
            return TR.out(result);
        }
    };
    return TR;
})();
